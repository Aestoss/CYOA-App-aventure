const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./lib/db');
const {
  createWorld, getWorld, updateWorld, aiEditWorld, deleteWorld,
  addCharacter, generateCharacterWithAI, updateCharacter, deleteCharacter,
  createSave, getSave, selectCharacter, continueAfterVictory, deleteSave,
  playTurn, getSettings
} = require('./lib/gameEngine');
const { getTotalCosts, getWorldCosts } = require('./lib/costTracker');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// secretInfo is deliberately hidden state (see docs/INFINITE_WORLDS_REFERENCE.md,
// Phase E) — strip it before any save object reaches the client. Returns a
// shallow copy so callers never accidentally mutate the live db record.
function publicSave(save) {
  if (!save) return save;
  const { secretInfo, ...rest } = save;
  return rest;
}

function worldPlayableCharacters(worldId) {
  return db.get('playableCharacters').filter({ worldId }).value();
}

function worldPublicTrackedItemDefs(worldId) {
  // ai_only tracked items are deliberately withheld from the client — that's
  // the whole point of the visibility flag (hidden state, e.g. a secret plot flag).
  return db.get('trackedItemDefs').filter({ worldId, visibility: 'player_and_ai' }).value();
}

// ---------- Worlds (reusable templates) ----------

app.get('/api/worlds', (req, res) => {
  const worlds = db.get('worlds').value();
  res.json(worlds.map(w => ({ ...w, saveCount: db.get('saves').filter({ worldId: w.id }).size().value() })));
});

app.get('/api/worlds/:id', (req, res) => {
  try {
    const world = getWorld(req.params.id);
    res.json({
      world,
      playableCharacters: worldPlayableCharacters(world.id),
      trackedItemDefs: worldPublicTrackedItemDefs(world.id)
    });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.post('/api/worlds', async (req, res) => {
  try {
    const { idea } = req.body;
    if (!idea || !idea.trim()) return res.status(400).json({ error: 'idea is required' });
    const result = await createWorld(idea.trim());
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/worlds/:id', (req, res) => {
  try {
    const { instructions, authorStyle, imageStyle, imageStylePrefix, imageStyleSuffix, description, objective, mature, contentWarnings } = req.body;
    const world = updateWorld(req.params.id, {
      instructions, authorStyle, imageStyle, imageStylePrefix, imageStyleSuffix, description, objective, mature, contentWarnings
    });
    res.json({ ok: true, world });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/worlds/:id/ai-edit', async (req, res) => {
  try {
    const { instruction } = req.body;
    if (!instruction || !instruction.trim()) return res.status(400).json({ error: 'instruction is required' });
    const world = await aiEditWorld(req.params.id, instruction.trim());
    res.json({ ok: true, world });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/worlds/:id', (req, res) => {
  try {
    deleteWorld(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- Playable characters (world templates) ----------

app.post('/api/worlds/:id/characters', (req, res) => {
  try {
    const { name, description, skills } = req.body;
    const character = addCharacter(req.params.id, { name, description, skills });
    res.json({ ok: true, character });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/worlds/:id/characters/generate', async (req, res) => {
  try {
    const { description } = req.body;
    const character = await generateCharacterWithAI(req.params.id, description);
    res.json({ ok: true, character });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/worlds/:worldId/characters/:characterId', (req, res) => {
  try {
    const { name, description, skills } = req.body;
    const character = updateCharacter(req.params.worldId, req.params.characterId, { name, description, skills });
    res.json({ ok: true, character });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/worlds/:worldId/characters/:characterId', (req, res) => {
  try {
    deleteCharacter(req.params.worldId, req.params.characterId);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- Saves (one playthrough of a world) ----------

app.get('/api/saves', (req, res) => {
  const saves = db.get('saves').value();
  const list = saves.map(s => {
    const world = db.get('worlds').find({ id: s.worldId }).value();
    const lastTurn = db.get('turns').filter({ saveId: s.id }).sortBy('turnNumber').last().value();
    return {
      ...publicSave(s),
      worldTitle: world ? world.title : '(monde supprimé)',
      worldTone: world ? world.tone : '',
      coverImageUrl: world ? world.coverImageUrl : null,
      turnCount: db.get('turns').filter({ saveId: s.id }).size().value(),
      lastAction: lastTurn ? lastTurn.playerAction : null
    };
  });
  res.json(list);
});

app.post('/api/worlds/:id/saves', (req, res) => {
  try {
    const result = createSave(req.params.id);
    res.json({ save: publicSave(result.save), openingTurn: result.openingTurn });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/saves/:id', (req, res) => {
  try {
    const save = getSave(req.params.id);
    const world = getWorld(save.worldId);
    const turns = db.get('turns').filter({ saveId: save.id }).sortBy('turnNumber').value();
    const characters = db.get('saveCharacters').filter({ saveId: save.id }).value();
    const itemDefs = worldPublicTrackedItemDefs(world.id);
    const itemValues = db.get('saveTrackedItemValues').filter({ saveId: save.id }).value();
    const trackedItems = itemDefs.map(def => {
      const row = itemValues.find(v => v.itemDefId === def.id);
      return { name: def.name, value: row ? row.value : def.initialValue };
    });
    res.json({
      save: publicSave(save),
      world,
      turns,
      characters,
      playableCharacters: worldPlayableCharacters(world.id),
      trackedItems
    });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.delete('/api/saves/:id', (req, res) => {
  try {
    deleteSave(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/saves/:id/select-character', (req, res) => {
  try {
    const { characterId } = req.body;
    if (!characterId) return res.status(400).json({ error: 'characterId is required' });
    const character = selectCharacter(req.params.id, characterId);
    res.json({ ok: true, character });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/saves/:id/continue', (req, res) => {
  try {
    const save = continueAfterVictory(req.params.id);
    res.json({ ok: true, save: publicSave(save) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/saves/:id/turn', async (req, res) => {
  try {
    const { action } = req.body;
    if (!action || !action.trim()) return res.status(400).json({ error: 'action is required' });
    const turn = await playTurn(req.params.id, action.trim());
    res.json(turn);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Costs ----------

app.get('/api/costs', (req, res) => {
  res.json(getTotalCosts());
});

app.get('/api/worlds/:id/costs', (req, res) => {
  res.json(getWorldCosts(req.params.id));
});

// ---------- Settings ----------

app.get('/api/settings', (req, res) => {
  const settings = getSettings();
  // Never send raw keys back to the client — only whether each is set.
  const safe = {
    ...settings,
    apiKeys: Object.fromEntries(Object.entries(settings.apiKeys).map(([k, v]) => [k, Boolean(v)]))
  };
  res.json(safe);
});

app.post('/api/settings', (req, res) => {
  const current = db.get('settings').value();
  const { textProvider, textModel, imageProvider, imagesEnabled, apiKeys } = req.body;
  const next = {
    textProvider: textProvider ?? current.textProvider,
    textModel: textModel ?? current.textModel,
    imageProvider: imageProvider ?? current.imageProvider,
    imagesEnabled: typeof imagesEnabled === 'boolean' ? imagesEnabled : current.imagesEnabled,
    apiKeys: { ...current.apiKeys, ...(apiKeys || {}) }
  };
  db.set('settings', next).write();
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Adventure app listening on port ${PORT}`));
