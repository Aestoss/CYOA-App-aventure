const { v4: uuid } = require('uuid');
const db = require('./db');
const { generateText } = require('../providers/textProviders');
const { generateImage } = require('../providers/imageProviders');
const { buildWorldCreationPrompt, buildTurnPrompt, buildSummaryPrompt } = require('./promptBuilder');

const RECENT_TURNS_WINDOW = 5;
const SUMMARIZE_EVERY = 10;
const RELEVANT_FACTS_LIMIT = 20;

function parseModelJSON(raw) {
  // Models occasionally wrap JSON in prose or code fences despite instructions;
  // this strips the common cases before parsing.
  const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  return JSON.parse(cleaned);
}

function getSettings() {
  return db.get('settings').value();
}

async function createWorld(playerIdea) {
  const settings = getSettings();
  const { system, user } = buildWorldCreationPrompt(playerIdea);
  const raw = await generateText({
    provider: settings.textProvider,
    system,
    user,
    apiKey: settings.apiKeys[settings.textProvider],
    model: settings.textModel
  });
  const parsed = parseModelJSON(raw);

  const world = {
    id: uuid(),
    title: parsed.title,
    setting: parsed.setting,
    tone: parsed.tone,
    rules: parsed.rules || [],
    startingScene: parsed.starting_scene,
    createdAt: new Date().toISOString()
  };
  db.get('worlds').push(world).write();

  (parsed.starting_characters || []).forEach(c => {
    db.get('characters').push({
      id: uuid(), worldId: world.id, name: c.name, role: c.role, status: c.description
    }).write();
  });

  // The opening chapter is turn 0 — stored the same way as any other turn so
  // it participates in memory/summarization like everything after it.
  const openingTurn = {
    id: uuid(),
    worldId: world.id,
    turnNumber: 0,
    playerAction: '(story begins)',
    chapterText: parsed.opening_chapter,
    imagePrompt: null,
    imageUrl: null,
    suggestedActions: [],
    createdAt: new Date().toISOString()
  };
  db.get('turns').push(openingTurn).write();

  return { world, openingTurn };
}

async function playTurn(worldId, playerAction) {
  const settings = getSettings();
  const world = db.get('worlds').find({ id: worldId }).value();
  if (!world) throw new Error('World not found');

  const memoryFacts = db.get('memoryFacts')
    .filter({ worldId })
    .takeRight(RELEVANT_FACTS_LIMIT)
    .value();
  const characters = db.get('characters').filter({ worldId }).value();
  const allTurns = db.get('turns').filter({ worldId }).sortBy('turnNumber').value();
  const recentTurns = allTurns.slice(-RECENT_TURNS_WINDOW);

  const { system, user } = buildTurnPrompt({ world, memoryFacts, characters, recentTurns, playerAction });
  const raw = await generateText({
    provider: settings.textProvider,
    system,
    user,
    apiKey: settings.apiKeys[settings.textProvider],
    model: settings.textModel
  });
  const parsed = parseModelJSON(raw);

  let imageUrl = null;
  if (settings.imagesEnabled && parsed.image_prompt) {
    try {
      imageUrl = await generateImage({
        provider: settings.imageProvider,
        prompt: parsed.image_prompt,
        apiKey: settings.apiKeys[settings.imageProvider]
      });
    } catch (e) {
      // Image failure should never break the story turn.
      imageUrl = null;
    }
  }

  const turnNumber = (allTurns[allTurns.length - 1]?.turnNumber ?? -1) + 1;
  const turn = {
    id: uuid(),
    worldId,
    turnNumber,
    playerAction,
    chapterText: parsed.chapter_text,
    imagePrompt: parsed.image_prompt || null,
    imageUrl,
    suggestedActions: parsed.suggested_actions || [],
    createdAt: new Date().toISOString()
  };
  db.get('turns').push(turn).write();

  // Persist structured memory — this is what makes facts survive long after
  // they scroll out of the "recent turns" window.
  const updates = parsed.state_updates || {};
  (updates.new_facts || []).forEach(fact => {
    db.get('memoryFacts').push({ id: uuid(), worldId, turnNumber, fact, createdAt: new Date().toISOString() }).write();
  });
  (updates.characters_changed || []).forEach(c => {
    const existing = db.get('characters').find({ worldId, name: c.name }).value();
    if (existing) {
      db.get('characters').find({ worldId, name: c.name }).assign({ status: c.change }).write();
    } else {
      db.get('characters').push({ id: uuid(), worldId, name: c.name, role: 'unknown', status: c.change }).write();
    }
  });

  await maybeSummarize(worldId, turnNumber);

  return turn;
}

// Every SUMMARIZE_EVERY turns, compress older turns into one memory fact so
// the "recent turns" window stays small and cheap regardless of how long the
// story runs.
async function maybeSummarize(worldId, turnNumber) {
  if (turnNumber === 0 || turnNumber % SUMMARIZE_EVERY !== 0) return;
  const settings = getSettings();
  const allTurns = db.get('turns').filter({ worldId }).sortBy('turnNumber').value();
  const toSummarize = allTurns.slice(0, -RECENT_TURNS_WINDOW);
  if (toSummarize.length < SUMMARIZE_EVERY) return;

  const { system, user } = buildSummaryPrompt(toSummarize);
  try {
    const summary = await generateText({
      provider: settings.textProvider,
      system,
      user,
      apiKey: settings.apiKeys[settings.textProvider],
      model: settings.textModel
    });
    db.get('memoryFacts').push({
      id: uuid(), worldId, turnNumber, fact: `(summary) ${summary.trim()}`, createdAt: new Date().toISOString()
    }).write();
  } catch (e) {
    // Summarization is a nice-to-have; never let it break gameplay.
  }
}

module.exports = { createWorld, playTurn, getSettings };
