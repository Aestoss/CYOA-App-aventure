const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./lib/db');
const { createWorld, playTurn, getSettings, selectCharacter } = require('./lib/gameEngine');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/worlds', (req, res) => {
  res.json(db.get('worlds').value());
});

app.get('/api/worlds/:id', (req, res) => {
  const world = db.get('worlds').find({ id: req.params.id }).value();
  if (!world) return res.status(404).json({ error: 'World not found' });
  const turns = db.get('turns').filter({ worldId: world.id }).sortBy('turnNumber').value();
  const characters = db.get('characters').filter({ worldId: world.id }).value();
  const playableCharacters = db.get('playableCharacters').filter({ worldId: world.id }).value();
  res.json({ world, turns, characters, playableCharacters });
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
