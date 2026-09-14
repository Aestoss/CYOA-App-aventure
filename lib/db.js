// Simple JSON-file database. Chosen deliberately over SQLite/Postgres for
// this stage: zero native dependencies, nothing that can fail to compile
// during a guided cloud deploy. Fine for single-user, hobby-scale use.
// Swappable for Postgres later without touching the routes (see README).
//
// Data model: a "world" is a reusable template (title, setting, skills,
// instructions, playable character templates, tracked-item definitions,
// NPC templates...) that always starts a brand new adventure. A "save" is
// one specific playthrough of a world — its chosen character, its turns,
// its evolving tracked-item values, its hidden secretInfo, its game-over
// state. One world can have many independent saves.

const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
require('fs').mkdirSync(dataDir, { recursive: true });

const adapter = new FileSync(path.join(dataDir, 'db.json'));
const db = low(adapter);

db.defaults({
  worlds: [],
  playableCharacters: [],
  worldNpcs: [],
  trackedItemDefs: [],
  saves: [],
  saveCharacters: [],
  saveTrackedItemValues: [],
  turns: [],
  memoryFacts: [],
  costLog: [],
  settings: {
    textProvider: 'mock',
    textModel: '',
    imageProvider: 'mock',
    imagesEnabled: false,
    apiKeys: {
      anthropic: '',
      openai: '',
      openrouter: '',
      gemini: '',
      stability: '',
      replicate: ''
    }
  }
}).write();

module.exports = db;
