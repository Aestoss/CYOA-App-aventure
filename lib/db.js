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
    ollamaBaseUrl: 'http://localhost:11434', // only used when textProvider is 'ollama' — a local Ollama
                                              // instance, or a URL you've tunneled to one, since this app
                                              // itself may be running remotely (e.g. on Railway)
    fallbackProvider: '', // '' = disabled. Offered as a one-turn-only override (never persisted) when
                           // textProvider is 'ollama' and the local bridge is reported offline/busy.
    fallbackModel: '',
    language: 'fr', // 'fr' | 'en' — language the narrator writes chapter_text/suggested_actions in
    chapterLength: 'medium', // 'short' (~200 words) | 'medium' (~400) | 'long' (~800)
    imageProvider: 'mock',
    imagesEnabled: false,
    localImageBaseUrl: 'http://localhost:7860', // only used when imageProvider is 'localsd' — a local
                                                 // AUTOMATIC1111 (Stable Diffusion WebUI) instance run with
                                                 // --api, reached the same way as ollamaBaseUrl
    apiKeys: {
      anthropic: '',
      openai: '',
      openrouter: '',
      gemini: '',
      ollama: '', // usually unnecessary (local Ollama has no auth) — only if yours sits behind a proxy that needs one
      stability: '',
      replicate: '',
      localsd: '' // usually unnecessary (local AUTOMATIC1111 has no auth) — same caveat as ollama above
    }
  }
}).write();

module.exports = db;
