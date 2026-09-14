const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./lib/db');
const { createWorld, playTurn, getSettings, selectCharacter, continueAfterVictory, updateWorldInstructions } = require('./lib/gameEngine');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// secretInfo is deliberately hidden state (see docs/INFINITE_WORLDS_REFERENCE.md,
// Phase E) — strip it before any world object reaches the client. Returns a
// shallow copy so callers never accidentally mutate the live db record.
function publicWorld(world) {
  if (!world) return world;
  const { secretInfo, ...rest } = world;
  return rest;
}

app.get('/api/worlds', (req, res) => {
  res.json(db.get('worlds').value().map(publicWorld));
});

app.get('/api/worlds/:id', (req, res) => {
  const world = db.get('worlds').find({ id: req.params.id }).value();
  if (!world) return res.status(404).json({ error: 'World not found' });
  const turns = db.get('turns').filter({ worldId: world.id }).sortBy('turnNumber').value();
  const characters = db.get('characters').filter({ worldId: world.id }).value();
  const playableCharacters = db.get('playableCharacters').filter({ worldId: world.id }).value();
  // ai_only tracked items are deliberately withheld from the client — that's
  // the whole point of the visibility flag (hidden state, e.g. a secret plot flag).
  const trackedItems = db.get('trackedItems').filter({ worldId: world.id, visibility: 'player_and_ai' }).value();
  res.json({ world: publicWorld(world), turns, characters, playableCharacters, trackedItems });
});

app.post('/api/worlds', async (req, res) => {
  try {
    const { idea } = req.body;
    if (!idea || !idea.trim()) return res.status(400).json({ error: 'idea is required' });
    const result = await createWorld(idea.trim());
    res.json({ ...result, world: publicWorld(result.world) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/worlds/:id', (req, res) => {
  try {
    const { instructions, authorStyle } = req.body;
    const world = updateWorldInstructions(req.params.id, { instructions, authorStyle });
    res.json({ ok: true, world: publicWorld(world) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/worlds/:id/select-character', (req, res) => {
  try {
    const { characterId } = req.body;
    if (!characterId) return res.status(400).json({ error: 'characterId is required' });
    const character = selectCharacter(req.params.id, characterId);
    res.json({ ok: true, character });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/worlds/:id/continue', (req, res) => {
  try {
    const world = continueAfterVictory(req.params.id);
    res.json({ ok: true, world: publicWorld(world) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/worlds/:id/turn', async (req, res) => {
  try {
    const { action } = req.body;
    if (!action || !action.trim()) return res.status(400).json({ error: 'action is required' });
    const turn = await playTurn(req.params.id, action.trim());
    res.json(turn);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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
