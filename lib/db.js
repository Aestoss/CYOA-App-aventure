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
const SafeFileSync = require('./dbAdapter');
const path = require('path');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
require('fs').mkdirSync(dataDir, { recursive: true });

// See dbAdapter.js: atomic writes + repair-on-read for a truncated file,
// after a real production crash-loop (OOM kill mid-write corrupted this
// file, and lowdb's stock FileSync adapter had no way to recover from it).
const adapter = new SafeFileSync(path.join(dataDir, 'db.json'));
const db = low(adapter);

// A prior write already established other top-level keys (this isn't a
// brand-new install) but "settings" itself is missing -- the corruption
// incident this app already hit once wipes whichever keys sit after the
// point a truncated write cuts off, and "settings" is last in this list,
// so it's the first casualty of that same failure mode recurring. db.defaults()
// below would otherwise silently paper over this with blank settings
// (mock provider, no API keys), which looks like nothing is wrong until
// every generation call quietly starts returning placeholder text.
if (db.getState().worlds && !db.getState().settings) {
  console.error('[db] "settings" is missing but other data exists -- provider choice and API keys were lost and reset to defaults. Re-enter them in Settings.');
}

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
    imageModel: null, // global default checkpoint for 'localsd'; null = whatever Forge currently
                       // has loaded. A world's own imageModel (see gameEngine.js) wins over this
                       // when set. The special value '__chroma__' (see providers/imageProviders.js)
                       // routes to the separate, dedicated Chroma instance instead of a checkpoint
                       // override on the main one.
    imagesEnabled: false,
    localImageBaseUrl: 'http://localhost:7860', // only used when imageProvider is 'localsd' — a local
                                                 // Forge (Stable Diffusion WebUI fork) instance run with
                                                 // --api, reached the same way as ollamaBaseUrl. Also
                                                 // covers Chroma: same tunnel URL, a different path
                                                 // (/sdapi-chroma/*) picked automatically by imageModel.
    apiKeys: {
      anthropic: '',
      openai: '',
      openrouter: '',
      gemini: '',
      ollama: '', // usually unnecessary (local Ollama has no auth) — only if yours sits behind a proxy that needs one
      stability: '',
      replicate: '',
      localsd: '' // usually unnecessary (local Forge has no auth) — same caveat as ollama above
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

require('./migrations').runOneTimeMigrations(db);

module.exports = db;
