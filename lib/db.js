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
    chapterLength: 400, // target word count, 100-1000 in steps of 100 (see the settings slider)
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

// One-time migration: chapterLength used to be a 'short'|'medium'|'long'
// enum (see TODO.md) -- an existing db.json from before this change would
// otherwise keep that string, which chapterLengthRange() can't use as a
// word-count target. Converts it to the equivalent number, once.
const OLD_CHAPTER_LENGTH_WORDS = { short: 200, medium: 400, long: 800 };
const currentChapterLength = db.get('settings.chapterLength').value();
if (Object.prototype.hasOwnProperty.call(OLD_CHAPTER_LENGTH_WORDS, currentChapterLength)) {
  db.set('settings.chapterLength', OLD_CHAPTER_LENGTH_WORDS[currentChapterLength]).write();
}

module.exports = db;
