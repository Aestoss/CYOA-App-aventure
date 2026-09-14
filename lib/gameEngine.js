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
    instructions: parsed.instructions || '',
    authorStyle: parsed.author_style || '',
    skills: parsed.skills || [],
    activeCharacterId: null,
    startingScene: parsed.starting_scene,
    victoryCondition: parsed.victory_condition || null,
    victoryText: parsed.victory_text || null,
    defeatCondition: parsed.defeat_condition || null,
    defeatText: parsed.defeat_text || null,
    gameOver: null,
    secretInfo: '',
    createdAt: new Date().toISOString()
  };
  db.get('worlds').push(world).write();

  const playableCharacters = (parsed.playable_characters || []).map(c => ({
    id: uuid(), worldId: world.id, name: c.name, description: c.description, skills: c.skills || {}
  }));
  playableCharacters.forEach(c => db.get('playableCharacters').push(c).write());

  (parsed.tracked_items || []).forEach(i => {
    db.get('trackedItems').push({
      id: uuid(),
      worldId: world.id,
      name: i.name,
      dataType: i.data_type === 'number' ? 'number' : 'text',
      description: i.description,
      visibility: i.visibility === 'ai_only' ? 'ai_only' : 'player_and_ai',
      updateAutomatically: Boolean(i.update_automatically),
      updateInstructions: i.update_instructions || '',
      value: i.initial_value ?? (i.data_type === 'number' ? 0 : '')
    }).write();
  });

  (parsed.starting_characters || []).forEach(c => {
    db.get('characters').push({
      id: uuid(),
      worldId: world.id,
      name: c.name,
      role: c.role,
      status: c.detail || c.description || '',
      oneLiner: c.one_liner || '',
      appearance: c.appearance || '',
      location: c.location || ''
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
    outcome: 'n/a',
    skillUsed: null,
    gameOver: null,
    imagePrompt: null,
    imageUrl: null,
    suggestedActions: [],
    createdAt: new Date().toISOString()
  };
  db.get('turns').push(openingTurn).write();

  return { world, openingTurn, playableCharacters };
}

function selectCharacter(worldId, characterId) {
  const world = db.get('worlds').find({ id: worldId }).value();
  if (!world) throw new Error('World not found');
  const character = db.get('playableCharacters').find({ id: characterId, worldId }).value();
  if (!character) throw new Error('Character not found');
  db.get('worlds').find({ id: worldId }).assign({ activeCharacterId: characterId }).write();
  return character;
}

// Lets the player (as world author) tweak the free-text guidance the
// narrator AI follows, after the AI-generated defaults from world creation.
function updateWorldInstructions(worldId, { instructions, authorStyle }) {
  const world = db.get('worlds').find({ id: worldId }).value();
  if (!world) throw new Error('World not found');
  const next = {
    instructions: instructions !== undefined ? instructions : world.instructions,
    authorStyle: authorStyle !== undefined ? authorStyle : world.authorStyle
  };
  db.get('worlds').find({ id: worldId }).assign(next).write();
  return db.get('worlds').find({ id: worldId }).value();
}

// A defeat always ends the story for good. A victory only ends it by
// default — the player may choose to keep going in the same world.
function continueAfterVictory(worldId) {
  const world = db.get('worlds').find({ id: worldId }).value();
  if (!world) throw new Error('World not found');
  if (!world.gameOver) throw new Error('This story has not ended');
  if (world.gameOver.result !== 'victory') throw new Error('Only a victory can be continued');
  db.get('worlds').find({ id: worldId }).assign({ gameOver: null }).write();
  return world;
}

async function playTurn(worldId, playerAction) {
  const settings = getSettings();
  const world = db.get('worlds').find({ id: worldId }).value();
  if (!world) throw new Error('World not found');
  if (!world.activeCharacterId) throw new Error('Choose a character before playing');
  if (world.gameOver) throw new Error('This story has already ended');

  const activeCharacter = db.get('playableCharacters').find({ id: world.activeCharacterId }).value();
  const memoryFacts = db.get('memoryFacts')
    .filter({ worldId })
    .takeRight(RELEVANT_FACTS_LIMIT)
    .value();
  const characters = db.get('characters').filter({ worldId }).value();
  const trackedItems = db.get('trackedItems').filter({ worldId }).value();
  const allTurns = db.get('turns').filter({ worldId }).sortBy('turnNumber').value();
  const recentTurns = allTurns.slice(-RECENT_TURNS_WINDOW);

  const { system, user } = buildTurnPrompt({ world, memoryFacts, characters, recentTurns, playerAction, activeCharacter, trackedItems, secretInfo: world.secretInfo });
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
  const gameOver = (parsed.game_over && (parsed.game_over.result === 'victory' || parsed.game_over.result === 'defeat'))
    ? {
        result: parsed.game_over.result,
        text: parsed.game_over.text || (parsed.game_over.result === 'victory' ? world.victoryText : world.defeatText) || ''
      }
    : null;
  const turn = {
    id: uuid(),
    worldId,
    turnNumber,
    playerAction,
    chapterText: parsed.chapter_text,
    outcome: parsed.outcome || 'n/a',
    skillUsed: parsed.skill_used || null,
    gameOver,
    imagePrompt: parsed.image_prompt || null,
    imageUrl,
    suggestedActions: parsed.suggested_actions || [],
    createdAt: new Date().toISOString()
  };
  db.get('turns').push(turn).write();
  if (gameOver) db.get('worlds').find({ id: worldId }).assign({ gameOver }).write();
  if (typeof parsed.secret_info === 'string') {
    db.get('worlds').find({ id: worldId }).assign({ secretInfo: parsed.secret_info }).write();
  }

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

  // Only items marked as auto-updating can actually be changed by the AI —
  // static reference items and unrecognized names are ignored defensively,
  // since this echoes back through JSON parsed from a model's output.
  (parsed.tracked_item_updates || []).forEach(u => {
    const item = trackedItems.find(i => i.name === u.name);
    if (!item || !item.updateAutomatically) return;
    db.get('trackedItems').find({ id: item.id }).assign({ value: u.new_value }).write();
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

module.exports = { createWorld, playTurn, getSettings, selectCharacter, continueAfterVictory, updateWorldInstructions };
