// This file is the heart of the project. It assembles a fresh, bounded
// prompt every turn from structured pieces (world bible + extracted facts +
// a short window of recent turns) instead of replaying an ever-growing raw
// chat history. That's the fix for the drift/cost problem in the original
// local version.

const SKILL_LABELS = { 1: 'Untrained', 2: 'Unskilled', 3: 'Competent', 4: 'Highly skilled', 5: 'Exceptional' };

function skillLabel(value) {
  return SKILL_LABELS[value] || 'Unrated';
}

const MASTER_PROMPT = `You are the Narrator AI for a choose-your-own-adventure
game. You write immersive, sensory, second-person narrative in the tone and
genre established by the World Bible below. You never break character, never
mention that you are an AI, and never contradict established facts.

Every response MUST be a single JSON object, with no text before or after it,
matching exactly this shape:

{
  "chapter_text": string,        // 100-250 words of narrative, second person
  "outcome": "success" | "partial_success" | "failure" | "n/a", // see SKILL CHECKS below
  "skill_used": string | null,   // the skill from SKILLS this action was checked against, or null
  "game_over": { "result": "victory" | "defeat", "text": string } | null, // see VICTORY/DEFEAT below
  "tracked_item_updates": [{ "name": string, "new_value": string | number }], // see TRACKED ITEMS below
  "state_updates": {
    "location": string | null,        // current location if it changed, else null
    "new_facts": string[],            // new durable facts worth remembering (short, plain sentences)
    "characters_changed": [{ "name": string, "change": string }],
    "inventory_changed": string[]     // items gained or lost, described briefly
  },
  "image_prompt": string | null, // short visual description of this scene, or null
  "suggested_actions": string[]  // 3 short, distinct next actions the player could take
}

SKILL CHECKS:
- The player character has numeric skill ratings (1-5, see PLAYER CHARACTER below).
- When the player's action has a real chance of failing (a physical feat, a risky
  social gambit, solving something that requires expertise...), pick the single
  most relevant skill, weigh the character's rating against how hard the attempt
  is given the current scene, and decide the outcome yourself — success, a
  partial/complicated success, or failure. A low rating against a hard attempt
  should fail or go badly more often than not; a high rating against an easy
  attempt should succeed cleanly. Narrate the outcome and its consequences in
  chapter_text — do not mention numbers or dice to the player.
- For actions with no real chance of failure (looking around, talking casually,
  moving to an obvious place), set "outcome" to "n/a" and "skill_used" to null —
  do not force a check where none makes sense.

VICTORY/DEFEAT:
- If VICTORY CONDITION and/or DEFEAT CONDITION are given below, judge after
  writing chapter_text whether this turn's events have genuinely and clearly
  satisfied one of them.
- Set "game_over" to null on almost every turn — only set it once a
  condition is unambiguously met by what just happened in the fiction, not
  because it seems close or likely soon. Never end the story prematurely.
- When a condition is met, set "game_over" to { "result", "text" }: "result"
  is "victory" or "defeat" matching which condition fired, and "text" is a
  short, satisfying closing message for the player (you may adapt the
  world's own victory/defeat text below, or write your own in the same
  spirit).
- If no conditions are given below, always leave "game_over" as null.

TRACKED ITEMS:
- TRACKED ITEMS below lists pieces of evolving state (inventory, reputation,
  countdowns, relationship scores...), each with its current value and,
  where it can change, precise update instructions.
- Only include an item in "tracked_item_updates" when its own update
  instructions are genuinely satisfied by what just happened — most turns
  will touch zero or one item, rarely more. Give the item's full new value
  (not a delta): e.g. for a text list, the complete updated list as one
  string; for a number, the new number.
- Items marked "(static, do not update)" have no update instructions —
  never include them in "tracked_item_updates", only use them as reference.
- Items marked "(hidden from player)" still update the same way — the
  visibility only affects what the interface shows the player, not how you
  use or update it.

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
  "instructions": string,    // 150-400 words: the main guidance for the narrator AI — the setting in
                              // more depth, what this story is actually about, the player character's
                              // role, how events and NPCs should unfold and pace, and any mechanics or
                              // constraints specific to this world. Refer to the player character as "I"
                              // (e.g. "In this story I am trying to solve a murder."). This is the most
                              // important field — write it as if briefing a co-writer who will narrate
                              // every turn and must stay consistent with it throughout.
  "author_style": string,    // the prose voice to write in — e.g. "a bestselling thriller novelist",
                              // a specific author ("Neil Gaiman"), or a genre ("a writer of children's books")
  "skills": string[],        // 4-6 short skill/attribute names that fit this world and matter for
                              // deciding whether the player's actions succeed (e.g. a fantasy world
                              // might use "Magic" and "Combat"; a Regency drama might use "Wit" and "Standing")
  "playable_characters": [   // 3-4 distinct characters the player can choose to play as
    {
      "name": string,
      "description": string, // background, personality, why they're in this story — this shapes gameplay
      "skills": { [skillName: string]: number } // one entry per skill above, each rated 1-5
    }
  ],
  "starting_characters": [{ "name": string, "role": string, "description": string }], // NPCs, not playable
  "starting_scene": string,  // 2-3 sentences describing where the story begins
  "opening_chapter": string, // 100-200 words, second person, the actual first chapter of play — should
                              // not assume any specific playable character yet, since the player
                              // hasn't chosen one at this point
  "victory_condition": string | null, // a concrete, checkable condition for winning this story
                              // (e.g. "The player character has escaped the maze"), or null if this
                              // kind of open-ended story has no natural win state — don't force one
  "victory_text": string | null,      // shown to the player when they win, matches victory_condition
  "defeat_condition": string | null,  // a concrete, checkable condition for losing, or null
  "defeat_text": string | null,       // shown to the player when they lose, matches defeat_condition
  "tracked_items": [         // 2-5 pieces of evolving state worth tracking beyond simple facts —
                              // inventory, reputation, a countdown, a relationship score, a resource...
                              // don't invent items that won't actually matter for this story
    {
      "name": string,
      "data_type": "text" | "number",
      "description": string,        // what this tracks and why it matters to the story
      "visibility": "player_and_ai" | "ai_only", // ai_only = hidden state the player never sees directly
      "update_automatically": boolean, // false = static reference info that should never change
                                        // (e.g. a character's fixed hidden motive) — true for anything
                                        // that evolves during play (inventory, health, reputation...)
      "update_instructions": string,   // only meaningful when update_automatically is true: a precise
                                        // rule for when/how to update this (e.g. "Add any item the player
                                        // character acquires; remove items used up, lost, or given away.")
      "initial_value": string | number // starting value, matching data_type (e.g. "" or [] as text, or 0)
    }
  ]
}`,
    user: `Player's idea: ${playerIdea}`
  };
}

function buildTurnPrompt({ world, memoryFacts, characters, recentTurns, playerAction, activeCharacter, trackedItems }) {
  const worldBible = `WORLD BIBLE
Title: ${world.title}
Setting: ${world.setting}
Tone: ${world.tone}
Rules: ${(world.rules || []).join('; ')}
SKILLS: ${(world.skills || []).join(', ') || '(none defined)'}`;

  const authorBlock = `AUTHOR INSTRUCTIONS (the most important guidance below — follow it closely)
${world.instructions || '(none given — use the World Bible above as your guide)'}

AUTHOR STYLE: ${world.authorStyle || '(no specific style requested)'}`;

  const characterBlock = activeCharacter
    ? `PLAYER CHARACTER
Name: ${activeCharacter.name}
Description: ${activeCharacter.description}
Skills: ${Object.entries(activeCharacter.skills || {})
        .map(([skill, value]) => `${skill} ${value} (${skillLabel(value)})`)
        .join(', ')}`
    : 'PLAYER CHARACTER\n(none chosen)';

  const conditionLines = [];
  if (world.victoryCondition) conditionLines.push(`VICTORY CONDITION: ${world.victoryCondition}`);
  if (world.defeatCondition) conditionLines.push(`DEFEAT CONDITION: ${world.defeatCondition}`);
  const conditionsBlock = conditionLines.length ? conditionLines.join('\n') : 'VICTORY/DEFEAT CONDITIONS\n(none defined for this world)';

  const itemsBlock = (trackedItems && trackedItems.length)
    ? `TRACKED ITEMS\n${trackedItems.map(i => {
        const flags = [!i.updateAutomatically ? '(static, do not update)' : null, i.visibility === 'ai_only' ? '(hidden from player)' : null]
          .filter(Boolean).join(' ');
        const rule = i.updateAutomatically ? ` | Update rule: ${i.updateInstructions}` : '';
        return `- ${i.name} (${i.dataType}) = ${JSON.stringify(i.value)} ${flags}\n  ${i.description}${rule}`;
      }).join('\n')}`
    : 'TRACKED ITEMS\n(none defined for this world)';

  const factsBlock = memoryFacts.length
    ? `KNOWN FACTS\n${memoryFacts.map(f => `- ${f.fact}`).join('\n')}`
    : 'KNOWN FACTS\n(none yet)';

  const charactersBlock = characters.length
    ? `OTHER CHARACTERS\n${characters.map(c => `- ${c.name}: ${c.status}`).join('\n')}`
    : 'OTHER CHARACTERS\n(none introduced yet)';

  const recentBlock = recentTurns.length
    ? `RECENT SCENES (most recent last)\n${recentTurns
        .map(t => `Player: ${t.playerAction}\nNarrator: ${t.chapterText}`)
        .join('\n\n')}`
    : 'RECENT SCENES\n(this is the first turn)';

  const user = `${worldBible}

${authorBlock}

${conditionsBlock}

${characterBlock}

${itemsBlock}

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

module.exports = { buildWorldCreationPrompt, buildTurnPrompt, buildSummaryPrompt, MASTER_PROMPT, skillLabel };
