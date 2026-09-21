'use strict';

const { v4: uuid } = require('uuid');

// One-time recovery for the db.json corruption incident (see dbAdapter.js
// and the CHANGELOG entry for it). The repair recovered worlds/characters/
// memoryFacts/turns but not saves/playableCharacters/... (those were added
// to the schema later, so they sit after "turns" in the object's real key
// insertion order, and the truncation landed inside "turns" itself, before
// any of them were reached).
//
// The save for "The Keeper's Small Favor" lost its own turns entirely --
// exhaustive search of the preserved corrupted backup found zero trace of
// this save's chapter text anywhere in the file, not even a broken
// fragment (the OOM kill's SIGKILL landed at the exact byte offset right
// after the last OTHER save's turns, before a single byte of this one's
// had been written in that attempt). But its memoryFacts survived
// completely -- the extraction pipeline writes to a different,
// earlier-positioned collection, so its full turn-by-turn fact log (stats,
// skills, plot beats, NPCs) is intact in the live database right now, just
// orphaned with no `saves` row pointing to it.
//
// This rebuilds a working save around that surviving history: the missing
// `saves` row, a stub playableCharacters row for the protagonist (name
// only -- the original description/skills/portrait are genuinely gone),
// stub saveCharacters rows for NPCs mentioned in the facts, and one
// "bridge" turn -- a written recap built directly from the surviving
// facts, not invented -- so the next real turn has something concrete to
// continue from instead of a cold start.
function restoreKeeperOfSmallFavor(db) {
  const SAVE_ID = 'b9626cc2-7586-4024-a44a-584381ff5b49';
  const WORLD_ID = 'f95055ad-cf59-4ce7-ac38-19a1c8b14a25';

  if (db.get('saves').find({ id: SAVE_ID }).value()) return; // already restored, or never lost
  const world = db.get('worlds').find({ id: WORLD_ID }).value();
  if (!world) return; // world itself didn't survive either -- nothing sensible to rebuild

  const facts = db.get('memoryFacts').filter({ saveId: SAVE_ID }).sortBy('turnNumber').value();
  if (!facts.length) return; // nothing recoverable for this save

  const maxTurn = facts.reduce((m, f) => Math.max(m, f.turnNumber || 0), 0);

  // Tally every named character. Harrowen is the world's own guide NPC (see
  // the world's "background"/"instructions" text) -- excluding him by name
  // leaves the protagonist as whichever remaining name is mentioned most,
  // which is far more reliable here than trying to infer "who is the
  // player" from fact phrasing.
  const mentionCount = {};
  facts.forEach(f => { if (f.character) mentionCount[f.character] = (mentionCount[f.character] || 0) + 1; });
  const namesByMentions = Object.keys(mentionCount).sort((a, b) => mentionCount[b] - mentionCount[a]);
  const protagonistName = namesByMentions.find(n => n !== 'Harrowen') || namesByMentions[0] || 'Unknown protagonist';
  const npcNames = namesByMentions.filter(n => n !== protagonistName);

  const recoveryNotice = `[Reconstructed after a database corruption incident on ${new Date().toISOString().slice(0, 10)} -- the original was lost. Rebuilt from the surviving memory-fact log.]`;

  const characterId = uuid();
  db.get('playableCharacters').push({
    id: characterId,
    worldId: WORLD_ID,
    name: protagonistName,
    description: recoveryNotice,
    skills: {},
    initialTrackedItemValues: {},
    portraitUrl: null,
    portraitPromptOverride: null
  }).write();

  npcNames.forEach(name => {
    db.get('saveCharacters').push({
      id: uuid(),
      saveId: SAVE_ID,
      name,
      role: '',
      status: '',
      oneLiner: recoveryNotice,
      appearance: '',
      location: ''
    }).write();
  });

  const recapLines = facts.map(f => `- (turn ${f.turnNumber}${f.character ? `, ${f.character}` : ''}) ${f.fact}`);
  const recapText = [
    'This chapter was reconstructed after a database corruption incident wiped the original chapter text for this save. Nothing below is invented -- every line is a fact the app itself extracted and saved while you played, which survived intact even though the narration prose did not.',
    '',
    "What's known of the story so far, in order:",
    ...recapLines
  ].join('\n');

  db.get('turns').push({
    id: uuid(),
    saveId: SAVE_ID,
    turnNumber: maxTurn,
    playerAction: '(memory restored after a data-loss incident)',
    chapterText: recapText,
    outcome: 'n/a',
    skillUsed: null,
    gameOver: null,
    imagePrompt: null,
    imageUrl: null,
    suggestedActions: ['Continue the story from here'],
    snapshot: {
      trackedItemValues: [],
      characters: npcNames.map(name => ({ name, role: '', status: '', oneLiner: '', appearance: '', location: '' })),
      secretInfo: '',
      gameOver: null
    },
    createdAt: new Date().toISOString()
  }).write();

  db.get('saves').push({
    id: SAVE_ID,
    worldId: WORLD_ID,
    activeCharacterId: characterId,
    gameOver: null,
    secretInfo: '',
    summarizedUpToTurn: maxTurn,
    createdAt: facts[0].createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }).write();

  console.error(`[recovery] Restored save ${SAVE_ID} ("The Keeper's Small Favor") from ${facts.length} surviving memory facts, up to turn ${maxTurn}. Protagonist: ${protagonistName}. NPCs: ${npcNames.join(', ') || '(none identified)'}.`);
}

function runOneTimeMigrations(db) {
  const MIGRATION_ID = 'restore-keeper-of-small-favor-2026-09-21';
  const applied = db.get('_migrations').value() || [];
  if (applied.includes(MIGRATION_ID)) return;
  try {
    restoreKeeperOfSmallFavor(db);
  } catch (e) {
    console.error(`[recovery] Migration ${MIGRATION_ID} failed: ${e.message}`);
  }
  db.set('_migrations', [...applied, MIGRATION_ID]).write();
}

module.exports = { runOneTimeMigrations };
