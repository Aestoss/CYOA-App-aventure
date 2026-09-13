// This file is the heart of the project. It assembles a fresh, bounded
// prompt every turn from structured pieces (world bible + extracted facts +
// a short window of recent turns) instead of replaying an ever-growing raw
// chat history. That's the fix for the drift/cost problem in the original
// local version.

const MASTER_PROMPT = `You are the Narrator AI for a choose-your-own-adventure
game. You write immersive, sensory, second-person narrative in the tone and
genre established by the World Bible below. You never break character, never
mention that you are an AI, and never contradict established facts.

Every response MUST be a single JSON object, with no text before or after it,
matching exactly this shape:

{
  "chapter_text": string,        // 100-250 words of narrative, second person
  "state_updates": {
    "location": string | null,        // current location if it changed, else null
    "new_facts": string[],            // new durable facts worth remembering (short, plain sentences)
    "characters_changed": [{ "name": string, "change": string }],
    "inventory_changed": string[]     // items gained or lost, described briefly
  },
  "image_prompt": string | null, // short visual description of this scene, or null
  "suggested_actions": string[]  // 3 short, distinct next actions the player could take
}

Rules:
- Stay strictly consistent with the World Bible, the known facts, and character states given below.
- Only include "new_facts" that are genuinely new and durable (not restating what's already known).
- Keep chapter_text focused on the immediate scene — do not resolve the whole story in one turn.
- If the player's action is impossible or nonsensical in this world, narrate the attempt and its natural consequence rather than refusing.`;

function buildWorldCreationPrompt(playerIdea) {
  return {
    system: `You turn a short player idea into a structured "World Bible" for
a choose-your-own-adventure game. Respond with ONLY a JSON object, no other
text, in this shape:

{
  "title": string,
  "setting": string,        // 2-3 sentences: place, era, atmosphere
  "tone": string,            // e.g. "tense noir", "whimsical fantasy"
  "rules": string[],         // 2-4 world rules/mechanics or constraints
  "starting_characters": [{ "name": string, "role": string, "description": string }],
  "starting_scene": string,  // 2-3 sentences describing where the story begins
  "opening_chapter": string  // 100-200 words, second person, the actual first chapter of play
}`,
    user: `Player's idea: ${playerIdea}`
  };
}

function buildTurnPrompt({ world, memoryFacts, characters, recentTurns, playerAction }) {
  const worldBible = `WORLD BIBLE
Title: ${world.title}
Setting: ${world.setting}
Tone: ${world.tone}
Rules: ${(world.rules || []).join('; ')}`;

  const factsBlock = memoryFacts.length
    ? `KNOWN FACTS\n${memoryFacts.map(f => `- ${f.fact}`).join('\n')}`
    : 'KNOWN FACTS\n(none yet)';

  const charactersBlock = characters.length
    ? `CHARACTERS\n${characters.map(c => `- ${c.name}: ${c.status}`).join('\n')}`
    : 'CHARACTERS\n(none introduced yet)';

  const recentBlock = recentTurns.length
    ? `RECENT SCENES (most recent last)\n${recentTurns
        .map(t => `Player: ${t.playerAction}\nNarrator: ${t.chapterText}`)
        .join('\n\n')}`
    : 'RECENT SCENES\n(this is the first turn)';

  const user = `${worldBible}

${factsBlock}

${charactersBlock}

${recentBlock}

PLAYER ACTION THIS TURN: ${playerAction}`;

  return { system: MASTER_PROMPT, user };
}

function buildSummaryPrompt(oldTurns) {
  return {
    system: `Summarize the following story turns into a short, dense paragraph
(60-100 words) capturing only what future turns need to stay consistent:
key events, decisions, and their consequences. Respond with ONLY the
paragraph, no preamble.`,
    user: oldTurns.map(t => `Player: ${t.playerAction}\nNarrator: ${t.chapterText}`).join('\n\n')
  };
}

module.exports = { buildWorldCreationPrompt, buildTurnPrompt, buildSummaryPrompt, MASTER_PROMPT };
