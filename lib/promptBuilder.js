// This file is the heart of the project. It assembles a fresh, bounded
// prompt every turn from structured pieces (world bible + extracted facts +
// a short window of recent turns) instead of replaying an ever-growing raw
// chat history. That's the fix for the drift/cost problem in the original
// local version.

const SKILL_LABELS = { 1: 'Untrained', 2: 'Unskilled', 3: 'Competent', 4: 'Highly skilled', 5: 'Exceptional' };

function skillLabel(value) {
  return SKILL_LABELS[value] || 'Unrated';
}

const CHAPTER_LENGTHS = {
  short: '150-250 words',
  medium: '300-450 words',
  long: '650-900 words'
};

const LANGUAGE_NAMES = { fr: 'French', en: 'English' };

function buildMasterPrompt({ language, chapterLength, authorMode } = {}) {
  const lengthRange = CHAPTER_LENGTHS[chapterLength] || CHAPTER_LENGTHS.medium;
  const languageName = LANGUAGE_NAMES[language] || LANGUAGE_NAMES.fr;
  return `You are the Narrator AI for a choose-your-own-adventure
game. You write immersive, sensory, second-person narrative in the tone and
genre established by the World Bible below. You never break character, never
mention that you are an AI, and never contradict established facts.

RESPONSE LANGUAGE: Write "chapter_text" and "suggested_actions" in ${languageName}.
Keep all JSON field names in English exactly as specified below.

FORMATTING: Write "chapter_text" as short paragraphs (2-4 sentences each),
separated by a blank line (\\n\\n), so it reads easily on a phone screen.
Give dialogue its own line rather than burying it mid-paragraph.
${authorMode ? `
AUTHOR MODE IS ACTIVE FOR THIS TURN: the input below is a direct, out-of-character
instruction from the author to you, the Narrator — not an action taken by the
player character. Follow it directly and narrate its consequences into the
story. Do not run a skill check against it (set "outcome" to "n/a" and
"skill_used" to null) — it isn't something the character attempted, it's a
directive you're carrying out.` : ''}

Every response MUST be a single JSON object, with no text before or after it,
matching exactly this shape:

{
  "chapter_text": string,        // ${lengthRange} of narrative, second person
  "outcome": "success" | "partial_success" | "failure" | "n/a", // see SKILL CHECKS below
  "skill_used": string | null,   // the skill from SKILLS this action was checked against, or null
  "game_over": { "result": "victory" | "defeat", "text": string } | null, // see VICTORY/DEFEAT below
  "tracked_item_updates": [{ "name": string, "new_value": string | number }], // see TRACKED ITEMS below
  "secret_info": string,         // the FULL updated hidden-state block — see SECRET INFO below
  "state_updates": {
    "location": string | null,        // current location if it changed, else null
    "new_facts": string[],            // new durable facts worth remembering (short, plain sentences)
    "characters_changed": [{ "name": string, "change": string }],
    "inventory_changed": string[]     // items gained or lost, described briefly
  },
  "image_prompt": string | null, // short visual description of THIS SCENE ONLY — see IMAGE PROMPTS below
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

SECRET INFO:
- SECRET INFO below is state the player never sees directly — background
  plot movement, NPCs' private thoughts or motives, time passing, anything
  useful for staying consistent that shouldn't be said outright to the player.
- Return the FULL updated block in "secret_info" every turn (not a diff):
  carry forward whatever is still relevant, drop what's resolved or stale,
  add whatever this turn's events newly imply. Keep it compact — a handful
  of short lines, not an essay.
- If there's nothing hidden worth tracking yet, an empty string is fine.

IMAGE PROMPTS:
- IMAGE STYLE below (if any) is automatically added around whatever you
  write in "image_prompt" before it reaches the image model — do not repeat
  those style words yourself.
- "image_prompt" should describe only THIS SCENE: who/what is the subject,
  their appearance and expression if a character is present, and the
  setting — concrete and visual, not the mood or art style.
- Set "image_prompt" to null when the scene has nothing worth illustrating
  differently from the last image (e.g. a pure dialogue beat in the same spot).

Rules:
- Stay strictly consistent with the World Bible, the known facts, and character states given below.
- Only include "new_facts" that are genuinely new and durable (not restating what's already known).
- Keep chapter_text focused on the immediate scene — do not resolve the whole story in one turn.
- If the player's action is impossible or nonsensical in this world, narrate the attempt and its natural consequence rather than refusing.`;
}

function buildWorldCreationPrompt(playerIdea, language) {
  const languageName = LANGUAGE_NAMES[language] || LANGUAGE_NAMES.fr;
  return {
    system: `You turn a short player idea into a structured "World Bible" for
a choose-your-own-adventure game. Write every text field (title, description,
setting, instructions, opening_chapter, etc.) in ${languageName}. Keep all JSON
field names in English exactly as specified below. Respond with ONLY a JSON
object, no other text, in this shape:

{
  "title": string,
  "description": string,    // 1-2 sentences shown in the world list when picking a story — a hook,
                             // doesn't affect gameplay
  "objective": string | null, // a goal shown to the player from the first turn to give them direction
                             // (e.g. "Find out who is sending the letters"), or null for a fully
                             // open-ended story with no set goal
  "mature_content": boolean, // true if this idea implies violence, horror, sexual content, etc.
  "content_warnings": string[], // short content categories to warn about if mature_content is true
                             // (e.g. "violence", "body horror") — empty array otherwise
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
  "starting_characters": [   // NPCs the player may encounter, not playable
    {
      "name": string,
      "role": string,
      "detail": string,       // full background, personality, and story role — shown to the narrator
                               // in depth when this NPC has appeared in the last few turns
      "one_liner": string,    // one short sentence reminder — shown instead of "detail" when this NPC
                               // hasn't appeared recently, to keep the prompt small
      "appearance": string,   // physical description
      "location": string      // where this NPC is normally found
    }
  ],
  "starting_scene": string,  // 2-3 sentences describing where the story begins
  "opening_chapter": string, // 200-350 words, second person, in short paragraphs separated by a blank
                              // line (\n\n) so it's easy to read on a phone — the actual first chapter
                              // of play, which should not assume any specific playable character yet,
                              // since the player hasn't chosen one at this point
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
  ],
  "image_style": string,        // 1 sentence describing the overall visual style/mood for this world's
                                 // illustrations, matching its tone (e.g. "moody painterly illustration,
                                 // desaturated blues and greys, soft directional lighting")
  "image_style_prefix": string, // short comma-separated phrase prepended to every single image prompt
                                 // (e.g. "atmospheric fantasy illustration,") — keep it brief, it's added every time
  "image_style_suffix": string  // short comma-separated phrase appended to every single image prompt
                                 // (e.g. ", muted color palette, dramatic lighting, highly detailed")
}`,
    user: `Player's idea: ${playerIdea}`
  };
}

function buildTurnPrompt({
  world, memoryFacts, characters, recentTurns, playerAction, activeCharacter, trackedItems, secretInfo,
  language, chapterLength, authorMode, authorNote
}) {
  const worldBible = `WORLD BIBLE
Title: ${world.title}
Setting: ${world.setting}
Tone: ${world.tone}
Rules: ${(world.rules || []).join('; ')}
SKILLS: ${(world.skills || []).join(', ') || '(none defined)'}
OBJECTIVE: ${world.objective || '(none set — this is an open-ended story)'}`;

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

  // Characters seen in the last few turns get their full sheet; others get
  // only a one-line reminder, to keep the prompt from growing unbounded as
  // the cast of a long story accumulates.
  const recentText = recentTurns.map(t => `${t.playerAction} ${t.chapterText}`).join(' ');
  const charactersBlock = characters.length
    ? `OTHER CHARACTERS\n${characters.map(c => {
        const seenRecently = recentText.includes(c.name);
        if (seenRecently) {
          const details = [c.status, c.appearance ? `Appearance: ${c.appearance}` : null, c.location ? `Usually at: ${c.location}` : null]
            .filter(Boolean).join(' | ');
          return `- ${c.name} (${c.role || 'unknown role'}): ${details}`;
        }
        return `- ${c.name}: ${c.oneLiner || c.status}`;
      }).join('\n')}`
    : 'OTHER CHARACTERS\n(none introduced yet)';

  const secretInfoBlock = `SECRET INFO (hidden from the player)\n${secretInfo || '(none tracked yet)'}`;

  const imageStyleBlock = `IMAGE STYLE\n${world.imageStyle || '(none defined — write image_prompt as a plain scene description)'}`;

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

${secretInfoBlock}

${imageStyleBlock}

${recentBlock}

${authorNote ? `NARRATOR GUIDANCE FOR THIS RETRY (from the author, not visible to the player character — steer the outcome accordingly while still treating the line below as the player's actual action): ${authorNote}\n\n` : ''}${authorMode ? 'AUTHOR INSTRUCTION THIS TURN (out-of-character, follow directly)' : 'PLAYER ACTION THIS TURN'}: ${playerAction}`;

  return { system: buildMasterPrompt({ language, chapterLength, authorMode }), user };
}

// Frames a scene prompt from the narrator with the world's own visual style,
// so illustrations stay coherent turn to turn instead of drifting with
// whatever the narrator happens to write each time.
function buildImagePrompt(world, scenePrompt) {
  if (!scenePrompt) return null;
  // Strip any leading/trailing commas the author (or the world-creation AI)
  // already typed, so joining with ", " never produces doubled punctuation
  // regardless of how prefix/suffix happen to be formatted.
  const clean = s => (s || '').trim().replace(/^,+\s*/, '').replace(/,+\s*$/, '');
  const parts = [clean(world.imageStylePrefix), scenePrompt.trim(), clean(world.imageStyleSuffix)].filter(Boolean);
  return parts.join(', ');
}

// Generates one new playable character to add to an existing world, from a
// short free-text description — used by the "Générer un personnage par IA"
// button in the world editor.
function buildCharacterGenerationPrompt(world, description) {
  return {
    system: `Generate a single playable character for an existing choose-your-own-adventure
world. Respond with ONLY a JSON object, no other text, in this shape:

{
  "name": string,
  "description": string, // background, personality, why they're in this story — this shapes gameplay
  "skills": { [skillName: string]: number } // exactly one entry per skill listed below, each rated 1-5
}`,
    user: `WORLD: ${world.title}
Setting: ${world.setting}
Tone: ${world.tone}
SKILLS: ${(world.skills || []).join(', ')}

Player's description of the character to create: ${description}`
  };
}

// A light-touch edit to an existing world's core fields, driven by a natural
// language request — used by the "Retoucher avec l'IA" button. Deliberately
// scoped to the fields below only: it never touches playable characters,
// tracked items, or the opening chapter, since saves already reference those
// and silently invalidating them would be worse than not editing them here.
function buildWorldAiEditPrompt(world, instruction) {
  const editable = {
    title: world.title,
    description: world.description,
    objective: world.objective,
    mature_content: world.mature,
    content_warnings: world.contentWarnings,
    setting: world.setting,
    tone: world.tone,
    rules: world.rules,
    instructions: world.instructions,
    author_style: world.authorStyle,
    skills: world.skills,
    victory_condition: world.victoryCondition,
    victory_text: world.victoryText,
    defeat_condition: world.defeatCondition,
    defeat_text: world.defeatText,
    image_style: world.imageStyle,
    image_style_prefix: world.imageStylePrefix,
    image_style_suffix: world.imageStyleSuffix
  };
  return {
    system: `Apply the requested change to this world. Respond with ONLY a JSON
object, no other text, containing every field from CURRENT WORLD below (unchanged
fields included verbatim) with the requested change applied. Keep the same shape
and field names. Only change what the request actually asks for — leave everything
else exactly as it was. Avoid changing "skills" unless the request specifically
asks to add, remove, or rename a skill, since existing characters are rated
against the current list.`,
    user: `CURRENT WORLD\n${JSON.stringify(editable, null, 2)}\n\nREQUESTED CHANGE: ${instruction}`
  };
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

module.exports = {
  buildWorldCreationPrompt, buildTurnPrompt, buildSummaryPrompt, buildImagePrompt,
  buildCharacterGenerationPrompt, buildWorldAiEditPrompt, buildMasterPrompt, skillLabel
};
