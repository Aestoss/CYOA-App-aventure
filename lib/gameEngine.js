const { v4: uuid } = require('uuid');
const db = require('./db');
const { generateText } = require('../providers/textProviders');
const { generateImage } = require('../providers/imageProviders');
const { recordCost } = require('./costTracker');
const {
  buildWorldCreationPrompt, buildTurnPrompt, buildSummaryPrompt, buildImagePrompt,
  buildCharacterGenerationPrompt, buildWorldAiEditPrompt
} = require('./promptBuilder');

const RECENT_TURNS_WINDOW = 5;
const SUMMARIZE_EVERY = 10;
const RELEVANT_FACTS_LIMIT = 20;

function parseModelJSON(raw) {
  // Models occasionally wrap JSON in prose or code fences despite instructions;
  // this strips the common cases before parsing.
  const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // A response that doesn't end with a closing brace was almost certainly
    // cut off by an output-token cap before the model finished — a much
    // more useful diagnosis than a bare "Unexpected end of JSON input" when
    // this shows up in logs.
    if (!cleaned.endsWith('}')) {
      throw new Error(`Model response was truncated before valid JSON completed (likely hit a max output token limit) — got ${cleaned.length} chars: ...${cleaned.slice(-120)}`);
    }
    throw e;
  }
}

function getSettings() {
  return db.get('settings').value();
}

async function callText({ system, user, kind, worldId, saveId }) {
  const settings = getSettings();
  const { text, usage } = await generateText({
    provider: settings.textProvider,
    system,
    user,
    apiKey: settings.apiKeys[settings.textProvider],
    model: settings.textModel
  });
  recordCost({ worldId, saveId, kind, provider: settings.textProvider, model: settings.textModel, usage });
  return text;
}

// ---------- World templates ----------
// A world is a reusable template: create it once, then start as many
// independent saves from it as you like — each save gets its own turns,
// character choice, tracked-item values, and hidden state.

async function createWorld(playerIdea, language) {
  const settings = getSettings();
  // Baked onto the world at creation time, not read live from settings on
  // every turn afterwards — a world's own instructions/scenes are already
  // written in this language, and a later global setting change shouldn't
  // fight against that (see TODO.md: language now sticks per-world).
  const worldLanguage = language || settings.language;
  const worldId = uuid(); // generated up front so the creation call's cost can be attributed to it
  const { system, user } = buildWorldCreationPrompt(playerIdea, worldLanguage);
  const raw = await callText({ system, user, kind: 'world_creation', worldId });
  const parsed = parseModelJSON(raw);

  const world = {
    id: worldId,
    title: parsed.title,
    description: parsed.description || '',
    objective: parsed.objective || null,
    mature: Boolean(parsed.mature_content),
    contentWarnings: parsed.content_warnings || [],
    version: '1.00',
    language: worldLanguage,
    setting: parsed.setting,
    tone: parsed.tone,
    rules: parsed.rules || [],
    instructions: parsed.instructions || '',
    authorStyle: parsed.author_style || '',
    skills: parsed.skills || [],
    startingScene: parsed.starting_scene,
    openingChapter: parsed.opening_chapter,
    background: parsed.background || '',
    firstAction: parsed.first_action || null,
    victoryCondition: parsed.victory_condition || null,
    victoryText: parsed.victory_text || null,
    defeatCondition: parsed.defeat_condition || null,
    defeatText: parsed.defeat_text || null,
    imageStyle: parsed.image_style || '',
    imageStylePrefix: parsed.image_style_prefix || '',
    imageStyleSuffix: parsed.image_style_suffix || '',
    imageModel: null, // optional per-world override; null = provider default
    coverImageUrl: null,
    characterSelectText: parsed.character_select_text || null, // shown to the player at character selection, in addition to the mature-content warning
    designNotes: playerIdea, // author-only note, never sent to the AI — the idea this world was generated from
    createdAt: new Date().toISOString()
  };

  if (settings.imagesEnabled) {
    try {
      world.coverImageUrl = await generateCoverImage(world, settings);
    } catch (e) {
      // A missing cover image is cosmetic — never block world creation on it.
      world.coverImageUrl = null;
    }
  }

  db.get('worlds').push(world).write();

  const playableCharacters = (parsed.playable_characters || []).map(c => ({
    id: uuid(), worldId: world.id, name: c.name, description: c.description, skills: c.skills || {},
    initialTrackedItemValues: c.initial_tracked_item_values || {},
    portraitUrl: null
  }));
  if (settings.imagesEnabled) {
    for (const c of playableCharacters) {
      c.portraitUrl = await generateCharacterPortrait(world, c);
    }
  }
  playableCharacters.forEach(c => db.get('playableCharacters').push(c).write());

  (parsed.tracked_items || []).forEach(i => {
    db.get('trackedItemDefs').push({
      id: uuid(),
      worldId: world.id,
      name: i.name,
      dataType: i.data_type === 'number' ? 'number' : 'text',
      description: i.description,
      visibility: i.visibility === 'ai_only' ? 'ai_only' : 'player_and_ai',
      updateAutomatically: Boolean(i.update_automatically),
      updateInstructions: i.update_instructions || '',
      initialValue: i.initial_value ?? (i.data_type === 'number' ? 0 : '')
    }).write();
  });

  (parsed.starting_characters || []).forEach(c => {
    db.get('worldNpcs').push({
      id: uuid(),
      worldId: world.id,
      name: c.name,
      role: c.role,
      detail: c.detail || c.description || '',
      oneLiner: c.one_liner || '',
      appearance: c.appearance || '',
      location: c.location || ''
    }).write();
  });

  return { world, playableCharacters };
}

function getWorld(worldId) {
  const world = db.get('worlds').find({ id: worldId }).value();
  if (!world) throw new Error('World not found');
  return world;
}

function bumpVersion(version) {
  const n = parseFloat(version);
  return (Number.isFinite(n) ? n + 0.01 : 1.01).toFixed(2);
}

function generateCoverImage(world, settings) {
  return generateImage({
    provider: settings.imageProvider,
    prompt: buildImagePrompt(world, `Cover art for "${world.title}": ${world.setting}`),
    apiKey: settings.apiKeys[settings.imageProvider],
    model: world.imageModel
  });
}

// Manual edits from the world-editor form. Fields previously reachable only
// through the AI retouch (title, skills, setting/tone/rules, victory/defeat)
// are now directly editable too — a natural-language retouch is
// disproportionate for renaming a world or fixing a single skill.
function updateWorld(worldId, {
  title, instructions, authorStyle, imageStyle, imageStylePrefix, imageStyleSuffix, imageModel,
  description, objective, background, firstAction, mature, contentWarnings,
  setting, tone, rules, skills, victoryCondition, victoryText, defeatCondition, defeatText,
  characterSelectText, designNotes
}) {
  const world = getWorld(worldId);
  const next = {
    title: title !== undefined ? title : world.title,
    instructions: instructions !== undefined ? instructions : world.instructions,
    authorStyle: authorStyle !== undefined ? authorStyle : world.authorStyle,
    imageStyle: imageStyle !== undefined ? imageStyle : world.imageStyle,
    imageStylePrefix: imageStylePrefix !== undefined ? imageStylePrefix : world.imageStylePrefix,
    imageStyleSuffix: imageStyleSuffix !== undefined ? imageStyleSuffix : world.imageStyleSuffix,
    imageModel: imageModel !== undefined ? imageModel : world.imageModel,
    description: description !== undefined ? description : world.description,
    objective: objective !== undefined ? objective : world.objective,
    background: background !== undefined ? background : world.background,
    firstAction: firstAction !== undefined ? firstAction : world.firstAction,
    mature: mature !== undefined ? Boolean(mature) : world.mature,
    contentWarnings: contentWarnings !== undefined ? contentWarnings : world.contentWarnings,
    setting: setting !== undefined ? setting : world.setting,
    tone: tone !== undefined ? tone : world.tone,
    rules: rules !== undefined ? rules : world.rules,
    skills: skills !== undefined ? skills : world.skills,
    victoryCondition: victoryCondition !== undefined ? victoryCondition : world.victoryCondition,
    victoryText: victoryText !== undefined ? victoryText : world.victoryText,
    defeatCondition: defeatCondition !== undefined ? defeatCondition : world.defeatCondition,
    defeatText: defeatText !== undefined ? defeatText : world.defeatText,
    characterSelectText: characterSelectText !== undefined ? characterSelectText : world.characterSelectText,
    designNotes: designNotes !== undefined ? designNotes : world.designNotes,
    version: bumpVersion(world.version)
  };
  db.get('worlds').find({ id: worldId }).assign(next).write();
  return db.get('worlds').find({ id: worldId }).value();
}

// "Regenerate cover image" button in the world editor — the cover is
// otherwise only ever set once, at creation, with no way to retry or
// refresh it afterwards.
async function regenerateWorldCover(worldId) {
  const world = getWorld(worldId);
  const settings = getSettings();
  if (!settings.imagesEnabled) throw new Error('Image generation is disabled in Settings');
  const coverImageUrl = await generateCoverImage(world, settings);
  db.get('worlds').find({ id: worldId }).assign({ coverImageUrl, version: bumpVersion(world.version) }).write();
  return db.get('worlds').find({ id: worldId }).value();
}

// A light AI retouch: "make the tone darker", "add a rival character to the
// premise", etc. Only touches the world's core narrative fields — never
// playable characters, tracked items, or the opening chapter, since saves
// already depend on those staying put.
async function aiEditWorld(worldId, instruction) {
  const world = getWorld(worldId);
  const { system, user } = buildWorldAiEditPrompt(world, instruction);
  const raw = await callText({ system, user, kind: 'world_ai_edit', worldId });
  const parsed = parseModelJSON(raw);
  const next = {
    title: parsed.title ?? world.title,
    description: parsed.description ?? world.description,
    objective: parsed.objective ?? world.objective,
    background: parsed.background ?? world.background,
    firstAction: parsed.first_action ?? world.firstAction,
    mature: typeof parsed.mature_content === 'boolean' ? parsed.mature_content : world.mature,
    contentWarnings: parsed.content_warnings ?? world.contentWarnings,
    setting: parsed.setting ?? world.setting,
    tone: parsed.tone ?? world.tone,
    rules: parsed.rules ?? world.rules,
    instructions: parsed.instructions ?? world.instructions,
    authorStyle: parsed.author_style ?? world.authorStyle,
    skills: parsed.skills ?? world.skills,
    victoryCondition: parsed.victory_condition ?? world.victoryCondition,
    victoryText: parsed.victory_text ?? world.victoryText,
    defeatCondition: parsed.defeat_condition ?? world.defeatCondition,
    defeatText: parsed.defeat_text ?? world.defeatText,
    imageStyle: parsed.image_style ?? world.imageStyle,
    imageStylePrefix: parsed.image_style_prefix ?? world.imageStylePrefix,
    imageStyleSuffix: parsed.image_style_suffix ?? world.imageStyleSuffix,
    version: bumpVersion(world.version)
  };
  db.get('worlds').find({ id: worldId }).assign(next).write();
  return db.get('worlds').find({ id: worldId }).value();
}

// ---------- Playable characters (world templates) ----------

// A character portrait is only ever shown at selection time, never in
// gameplay itself (matching Infinite Worlds) — a missing/failed portrait is
// cosmetic and never blocks creating or playing a character.
async function generateCharacterPortrait(world, character) {
  const settings = getSettings();
  if (!settings.imagesEnabled) return null;
  try {
    return await generateImage({
      provider: settings.imageProvider,
      prompt: buildImagePrompt(world, `Portrait of ${character.name}: ${character.description}`),
      apiKey: settings.apiKeys[settings.imageProvider],
      model: world.imageModel
    });
  } catch (e) {
    return null;
  }
}

function addCharacter(worldId, { name, description, skills, initialTrackedItemValues }) {
  const world = getWorld(worldId);
  if (!name || !name.trim()) throw new Error('name is required');
  const character = {
    id: uuid(),
    worldId,
    name: name.trim(),
    description: description || '',
    skills: skills || Object.fromEntries((world.skills || []).map(s => [s, 3])),
    initialTrackedItemValues: initialTrackedItemValues || {},
    portraitUrl: null
  };
  db.get('playableCharacters').push(character).write();
  return character;
}

async function generateCharacterWithAI(worldId, description) {
  const world = getWorld(worldId);
  if (!description || !description.trim()) throw new Error('description is required');
  const { system, user } = buildCharacterGenerationPrompt(world, description.trim());
  const raw = await callText({ system, user, kind: 'character_generation', worldId });
  const parsed = parseModelJSON(raw);
  const character = {
    id: uuid(),
    worldId,
    name: parsed.name,
    description: parsed.description || '',
    skills: parsed.skills || {},
    initialTrackedItemValues: {},
    portraitUrl: null
  };
  character.portraitUrl = await generateCharacterPortrait(world, character);
  db.get('playableCharacters').push(character).write();
  return character;
}

function updateCharacter(worldId, characterId, { name, description, skills, initialTrackedItemValues }) {
  const character = db.get('playableCharacters').find({ id: characterId, worldId }).value();
  if (!character) throw new Error('Character not found');
  const next = {
    name: name !== undefined ? name : character.name,
    description: description !== undefined ? description : character.description,
    skills: skills !== undefined ? skills : character.skills,
    initialTrackedItemValues: initialTrackedItemValues !== undefined ? initialTrackedItemValues : character.initialTrackedItemValues
  };
  db.get('playableCharacters').find({ id: characterId, worldId }).assign(next).write();
  return db.get('playableCharacters').find({ id: characterId, worldId }).value();
}

function deleteCharacter(worldId, characterId) {
  const character = db.get('playableCharacters').find({ id: characterId, worldId }).value();
  if (!character) throw new Error('Character not found');
  db.get('playableCharacters').remove({ id: characterId, worldId }).write();
}

// "Regenerate portrait" button — separate from updateCharacter because it's
// an async AI call the manual-edit form shouldn't have to wait on, and
// because it's meaningful to retry independently of any other field.
async function regenerateCharacterPortrait(worldId, characterId) {
  const world = getWorld(worldId);
  const settings = getSettings();
  if (!settings.imagesEnabled) throw new Error('Image generation is disabled in Settings');
  const character = db.get('playableCharacters').find({ id: characterId, worldId }).value();
  if (!character) throw new Error('Character not found');
  const portraitUrl = await generateImage({
    provider: settings.imageProvider,
    prompt: buildImagePrompt(world, `Portrait of ${character.name}: ${character.description}`),
    apiKey: settings.apiKeys[settings.imageProvider],
    model: world.imageModel
  });
  db.get('playableCharacters').find({ id: characterId, worldId }).assign({ portraitUrl }).write();
  return db.get('playableCharacters').find({ id: characterId, worldId }).value();
}

// ---------- Tracked items (world templates) ----------
// Generated once at world creation, but editable afterwards like playable
// characters — adding one doesn't retroactively touch in-progress saves
// (playTurn already falls back to a def's initialValue when a save has no
// value row yet for it), and deleting one cleans up any current values so
// no save is left pointing at a tracked-item def that no longer exists.

function addTrackedItem(worldId, { name, dataType, description, visibility, updateAutomatically, updateInstructions, initialValue }) {
  getWorld(worldId);
  if (!name || !name.trim()) throw new Error('name is required');
  const item = {
    id: uuid(),
    worldId,
    name: name.trim(),
    dataType: dataType === 'number' ? 'number' : 'text',
    description: description || '',
    visibility: visibility === 'ai_only' ? 'ai_only' : 'player_and_ai',
    updateAutomatically: Boolean(updateAutomatically),
    updateInstructions: updateInstructions || '',
    initialValue: initialValue ?? (dataType === 'number' ? 0 : '')
  };
  db.get('trackedItemDefs').push(item).write();
  return item;
}

function updateTrackedItem(worldId, itemId, { name, dataType, description, visibility, updateAutomatically, updateInstructions, initialValue }) {
  const item = db.get('trackedItemDefs').find({ id: itemId, worldId }).value();
  if (!item) throw new Error('Tracked item not found');
  const next = {
    name: name !== undefined ? name : item.name,
    dataType: dataType !== undefined ? (dataType === 'number' ? 'number' : 'text') : item.dataType,
    description: description !== undefined ? description : item.description,
    visibility: visibility !== undefined ? (visibility === 'ai_only' ? 'ai_only' : 'player_and_ai') : item.visibility,
    updateAutomatically: updateAutomatically !== undefined ? Boolean(updateAutomatically) : item.updateAutomatically,
    updateInstructions: updateInstructions !== undefined ? updateInstructions : item.updateInstructions,
    initialValue: initialValue !== undefined ? initialValue : item.initialValue
  };
  db.get('trackedItemDefs').find({ id: itemId, worldId }).assign(next).write();
  return db.get('trackedItemDefs').find({ id: itemId, worldId }).value();
}

function deleteTrackedItem(worldId, itemId) {
  const item = db.get('trackedItemDefs').find({ id: itemId, worldId }).value();
  if (!item) throw new Error('Tracked item not found');
  db.get('saveTrackedItemValues').remove({ itemDefId: itemId }).write();
  db.get('trackedItemDefs').remove({ id: itemId, worldId }).write();
}

// ---------- NPCs (world templates) ----------
// Each save copies these into its own saveCharacters row at creation time
// and evolves independently from there — editing or deleting the world-level
// template afterwards never touches an already-created save's own copy.

function addNpc(worldId, { name, role, detail, oneLiner, appearance, location }) {
  getWorld(worldId);
  if (!name || !name.trim()) throw new Error('name is required');
  const npc = {
    id: uuid(),
    worldId,
    name: name.trim(),
    role: role || '',
    detail: detail || '',
    oneLiner: oneLiner || '',
    appearance: appearance || '',
    location: location || ''
  };
  db.get('worldNpcs').push(npc).write();
  return npc;
}

function updateNpc(worldId, npcId, { name, role, detail, oneLiner, appearance, location }) {
  const npc = db.get('worldNpcs').find({ id: npcId, worldId }).value();
  if (!npc) throw new Error('NPC not found');
  const next = {
    name: name !== undefined ? name : npc.name,
    role: role !== undefined ? role : npc.role,
    detail: detail !== undefined ? detail : npc.detail,
    oneLiner: oneLiner !== undefined ? oneLiner : npc.oneLiner,
    appearance: appearance !== undefined ? appearance : npc.appearance,
    location: location !== undefined ? location : npc.location
  };
  db.get('worldNpcs').find({ id: npcId, worldId }).assign(next).write();
  return db.get('worldNpcs').find({ id: npcId, worldId }).value();
}

function deleteNpc(worldId, npcId) {
  const npc = db.get('worldNpcs').find({ id: npcId, worldId }).value();
  if (!npc) throw new Error('NPC not found');
  db.get('worldNpcs').remove({ id: npcId, worldId }).write();
}

// ---------- Saves (one playthrough of a world) ----------
// Starting a save never calls the AI again for the opening chapter — the
// world template already has one, written to work before any character is
// chosen, so every new adventure from the same world is instant and free.

// A compact copy of everything about a save that can change turn to turn —
// stored on each turn so "revenir à cette page" can restore exactly this
// state later, without needing a separate history table.
function captureSnapshot(save) {
  const itemValues = db.get('saveTrackedItemValues').filter({ saveId: save.id }).value();
  const characters = db.get('saveCharacters').filter({ saveId: save.id }).value();
  return {
    trackedItemValues: itemValues.map(v => ({ itemDefId: v.itemDefId, value: v.value })),
    characters: characters.map(c => ({
      name: c.name, role: c.role, status: c.status, oneLiner: c.oneLiner, appearance: c.appearance, location: c.location
    })),
    secretInfo: save.secretInfo,
    gameOver: save.gameOver
  };
}

function createSave(worldId) {
  const world = getWorld(worldId);
  const save = {
    id: uuid(),
    worldId,
    activeCharacterId: null,
    gameOver: null,
    secretInfo: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  db.get('saves').push(save).write();

  db.get('trackedItemDefs').filter({ worldId }).value().forEach(def => {
    db.get('saveTrackedItemValues').push({ id: uuid(), saveId: save.id, itemDefId: def.id, value: def.initialValue }).write();
  });

  db.get('worldNpcs').filter({ worldId }).value().forEach(npc => {
    db.get('saveCharacters').push({
      id: uuid(), saveId: save.id, name: npc.name, role: npc.role,
      status: npc.detail, oneLiner: npc.oneLiner, appearance: npc.appearance, location: npc.location
    }).write();
  });

  // Worlds with a "background" (player-facing popup shown at adventure
  // start) generate their real first turn on demand from world.firstAction,
  // once a character is chosen — see POST /api/saves/:id/turn and the
  // background-modal flow in app.js. Older worlds without one keep the
  // free, static opening_chapter turn created immediately here.
  if (world.background) {
    return { save, openingTurn: null };
  }

  const openingTurn = {
    id: uuid(),
    saveId: save.id,
    turnNumber: 0,
    playerAction: '(story begins)',
    chapterText: world.openingChapter,
    outcome: 'n/a',
    skillUsed: null,
    gameOver: null,
    imagePrompt: null,
    imageUrl: null,
    suggestedActions: [],
    snapshot: captureSnapshot(save),
    createdAt: new Date().toISOString()
  };
  db.get('turns').push(openingTurn).write();

  return { save, openingTurn };
}

function getSave(saveId) {
  const save = db.get('saves').find({ id: saveId }).value();
  if (!save) throw new Error('Save not found');
  return save;
}

// Tracked items are seeded onto the save at createSave() time, before any
// character is chosen — so a character's own starting overrides (e.g. a
// "rich" character starting with more gold than a "poor" one) can only be
// applied here, once we actually know which character was picked.
function applyCharacterStartingItemValues(saveId, worldId, character) {
  const overrides = character.initialTrackedItemValues || {};
  if (!Object.keys(overrides).length) return;
  const itemDefs = db.get('trackedItemDefs').filter({ worldId }).value();
  Object.entries(overrides).forEach(([itemName, value]) => {
    const def = itemDefs.find(d => d.name === itemName);
    if (!def) return;
    const valueRow = db.get('saveTrackedItemValues').find({ saveId, itemDefId: def.id }).value();
    if (valueRow) {
      db.get('saveTrackedItemValues').find({ saveId, itemDefId: def.id }).assign({ value }).write();
    } else {
      db.get('saveTrackedItemValues').push({ id: uuid(), saveId, itemDefId: def.id, value }).write();
    }
  });
}

function selectCharacter(saveId, characterId) {
  const save = getSave(saveId);
  const character = db.get('playableCharacters').find({ id: characterId, worldId: save.worldId }).value();
  if (!character) throw new Error('Character not found');
  applyCharacterStartingItemValues(saveId, save.worldId, character);
  db.get('saves').find({ id: saveId }).assign({ activeCharacterId: characterId, updatedAt: new Date().toISOString() }).write();
  return character;
}

// A defeat always ends the story for good. A victory only ends it by
// default — the player may choose to keep going in the same save.
function continueAfterVictory(saveId) {
  const save = getSave(saveId);
  if (!save.gameOver) throw new Error('This story has not ended');
  if (save.gameOver.result !== 'victory') throw new Error('Only a victory can be continued');
  db.get('saves').find({ id: saveId }).assign({ gameOver: null, updatedAt: new Date().toISOString() }).write();
  return save;
}

// Destructive, on purpose (no branching): discards every turn after
// targetTurnNumber and restores the save's evolving state (tracked items,
// characters, secretInfo, gameOver) to exactly how it was right after that
// turn — "reprendre à partir d'ici".
function rewindToTurn(saveId, targetTurnNumber) {
  getSave(saveId);
  const targetTurn = db.get('turns').find({ saveId, turnNumber: targetTurnNumber }).value();
  if (!targetTurn) throw new Error('Turn not found');
  const snapshot = targetTurn.snapshot || { trackedItemValues: [], characters: [], secretInfo: '', gameOver: null };

  db.get('turns').remove(t => t.saveId === saveId && t.turnNumber > targetTurnNumber).write();
  db.get('memoryFacts').remove(f => f.saveId === saveId && f.turnNumber > targetTurnNumber).write();

  db.get('saveTrackedItemValues').remove({ saveId }).write();
  (snapshot.trackedItemValues || []).forEach(v => {
    db.get('saveTrackedItemValues').push({ id: uuid(), saveId, itemDefId: v.itemDefId, value: v.value }).write();
  });

  db.get('saveCharacters').remove({ saveId }).write();
  (snapshot.characters || []).forEach(c => {
    db.get('saveCharacters').push({ id: uuid(), saveId, ...c }).write();
  });

  db.get('saves').find({ id: saveId }).assign({
    secretInfo: snapshot.secretInfo || '',
    gameOver: snapshot.gameOver || null,
    updatedAt: new Date().toISOString()
  }).write();

  return getSave(saveId);
}

// Redo a past turn: rewinds to just before it, then plays it again — either
// with an edited action, or the same action plus extra guidance about what
// should happen differently this time. Everything after that turn is lost,
// same as any other rewind.
async function regenerateTurn(saveId, turnNumber, { action, note } = {}) {
  if (turnNumber < 1) throw new Error('The opening chapter cannot be regenerated');
  const original = db.get('turns').find({ saveId, turnNumber }).value();
  if (!original) throw new Error('Turn not found');
  const actionToUse = (action && action.trim()) || original.playerAction;

  rewindToTurn(saveId, turnNumber - 1);
  return playTurn(saveId, actionToUse, { authorNote: note && note.trim() ? note.trim() : undefined });
}

function deleteSave(saveId) {
  getSave(saveId);
  db.get('turns').remove({ saveId }).write();
  db.get('memoryFacts').remove({ saveId }).write();
  db.get('saveCharacters').remove({ saveId }).write();
  db.get('saveTrackedItemValues').remove({ saveId }).write();
  db.get('costLog').remove({ saveId }).write();
  db.get('saves').remove({ id: saveId }).write();
}

function deleteWorld(worldId) {
  getWorld(worldId);
  db.get('saves').filter({ worldId }).value().forEach(save => deleteSave(save.id));
  db.get('playableCharacters').remove({ worldId }).write();
  db.get('worldNpcs').remove({ worldId }).write();
  db.get('trackedItemDefs').remove({ worldId }).write();
  db.get('costLog').remove({ worldId, saveId: null }).write();
  db.get('worlds').remove({ id: worldId }).write();
}

async function playTurn(saveId, playerAction, { authorMode, authorNote } = {}) {
  const save = getSave(saveId);
  const world = getWorld(save.worldId);
  const settings = getSettings();
  if (!save.activeCharacterId) throw new Error('Choose a character before playing');
  if (save.gameOver) throw new Error('This story has already ended');

  const activeCharacter = db.get('playableCharacters').find({ id: save.activeCharacterId }).value();
  const memoryFacts = db.get('memoryFacts')
    .filter({ saveId })
    .takeRight(RELEVANT_FACTS_LIMIT)
    .value();
  const characters = db.get('saveCharacters').filter({ saveId }).value();
  const itemDefs = db.get('trackedItemDefs').filter({ worldId: world.id }).value();
  const itemValues = db.get('saveTrackedItemValues').filter({ saveId }).value();
  const trackedItems = itemDefs.map(def => {
    const valueRow = itemValues.find(v => v.itemDefId === def.id);
    return { ...def, value: valueRow ? valueRow.value : def.initialValue };
  });
  const allTurns = db.get('turns').filter({ saveId }).sortBy('turnNumber').value();
  const recentTurns = allTurns.slice(-RECENT_TURNS_WINDOW);

  const { system, user } = buildTurnPrompt({
    world, memoryFacts, characters, recentTurns, playerAction, activeCharacter, trackedItems, secretInfo: save.secretInfo,
    language: world.language || settings.language, chapterLength: settings.chapterLength, authorMode, authorNote
  });
  const raw = await callText({ system, user, kind: 'turn', worldId: world.id, saveId });
  const parsed = parseModelJSON(raw);

  const framedImagePrompt = buildImagePrompt(world, parsed.image_prompt);
  let imageUrl = null;
  if (settings.imagesEnabled && framedImagePrompt) {
    try {
      imageUrl = await generateImage({
        provider: settings.imageProvider,
        prompt: framedImagePrompt,
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
    saveId,
    turnNumber,
    playerAction,
    chapterText: parsed.chapter_text,
    outcome: parsed.outcome || 'n/a',
    skillUsed: parsed.skill_used || null,
    gameOver,
    imagePrompt: framedImagePrompt,
    imageUrl,
    suggestedActions: parsed.suggested_actions || [],
    createdAt: new Date().toISOString()
  };
  db.get('turns').push(turn).write();

  const saveUpdates = { updatedAt: new Date().toISOString() };
  if (gameOver) saveUpdates.gameOver = gameOver;
  if (typeof parsed.secret_info === 'string') saveUpdates.secretInfo = parsed.secret_info;
  db.get('saves').find({ id: saveId }).assign(saveUpdates).write();

  // Persist structured memory — this is what makes facts survive long after
  // they scroll out of the "recent turns" window.
  const updates = parsed.state_updates || {};
  (updates.new_facts || []).forEach(fact => {
    db.get('memoryFacts').push({ id: uuid(), saveId, turnNumber, fact, createdAt: new Date().toISOString() }).write();
  });
  (updates.characters_changed || []).forEach(c => {
    const existing = db.get('saveCharacters').find({ saveId, name: c.name }).value();
    if (existing) {
      db.get('saveCharacters').find({ saveId, name: c.name }).assign({ status: c.change }).write();
    } else {
      db.get('saveCharacters').push({ id: uuid(), saveId, name: c.name, role: 'unknown', status: c.change }).write();
    }
  });

  // Only items marked as auto-updating can actually be changed by the AI —
  // static reference items and unrecognized names are ignored defensively,
  // since this echoes back through JSON parsed from a model's output.
  (parsed.tracked_item_updates || []).forEach(u => {
    const def = itemDefs.find(d => d.name === u.name);
    if (!def || !def.updateAutomatically) return;
    const valueRow = db.get('saveTrackedItemValues').find({ saveId, itemDefId: def.id }).value();
    if (valueRow) {
      db.get('saveTrackedItemValues').find({ saveId, itemDefId: def.id }).assign({ value: u.new_value }).write();
    } else {
      db.get('saveTrackedItemValues').push({ id: uuid(), saveId, itemDefId: def.id, value: u.new_value }).write();
    }
  });

  // Snapshot the state as it stands right after this turn's mutations, so
  // rewinding or regenerating from this turn later can restore it exactly.
  const updatedSave = getSave(saveId);
  const snapshot = captureSnapshot(updatedSave);
  db.get('turns').find({ id: turn.id }).assign({ snapshot }).write();
  turn.snapshot = snapshot;

  await maybeSummarize(saveId, turnNumber);

  return turn;
}

// Every SUMMARIZE_EVERY turns, compress older turns into one memory fact so
// the "recent turns" window stays small and cheap regardless of how long the
// story runs.
async function maybeSummarize(saveId, turnNumber) {
  if (turnNumber === 0 || turnNumber % SUMMARIZE_EVERY !== 0) return;
  const allTurns = db.get('turns').filter({ saveId }).sortBy('turnNumber').value();
  const toSummarize = allTurns.slice(0, -RECENT_TURNS_WINDOW);
  if (toSummarize.length < SUMMARIZE_EVERY) return;

  const { system, user } = buildSummaryPrompt(toSummarize);
  try {
    const save = getSave(saveId);
    const summary = await callText({ system, user, kind: 'summary', worldId: save.worldId, saveId });
    db.get('memoryFacts').push({
      id: uuid(), saveId, turnNumber, fact: `(summary) ${summary.trim()}`, createdAt: new Date().toISOString()
    }).write();
  } catch (e) {
    // Summarization is a nice-to-have; never let it break gameplay.
  }
}

module.exports = {
  createWorld, getWorld, updateWorld, aiEditWorld, deleteWorld, regenerateWorldCover,
  addCharacter, generateCharacterWithAI, updateCharacter, deleteCharacter, regenerateCharacterPortrait,
  addTrackedItem, updateTrackedItem, deleteTrackedItem,
  addNpc, updateNpc, deleteNpc,
  createSave, getSave, selectCharacter, continueAfterVictory, deleteSave,
  playTurn, rewindToTurn, regenerateTurn, getSettings
};
