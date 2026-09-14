const fetch = require('node-fetch');

// Each provider function has the same signature: ({ system, user, apiKey, model }) -> Promise<string>
// The returned string is expected to be raw JSON text (per the prompt's instructions).

async function callAnthropic({ system, user, apiKey, model }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: model || 'claude-sonnet-4-6',
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: user }]
    })
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content.map(b => b.text || '').join('');
}

async function callOpenAI({ system, user, apiKey, model }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: model || 'gpt-4o',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    })
  });
  if (!res.ok) throw new Error(`OpenAI API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

async function callOpenRouter({ system, user, apiKey, model }) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: model || 'anthropic/claude-sonnet-4.6',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    })
  });
  if (!res.ok) throw new Error(`OpenRouter API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

async function callGemini({ system, user, apiKey, model }) {
  const m = model || 'gemini-2.0-flash';
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }]
      })
    }
  );
  if (!res.ok) throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
}

// Deterministic fake provider — no network, no key required. Used for local
// testing and as a safe default so the app never fails with "no key set".
async function callMock({ system, user }) {
  const isSummary = /Summarize the following story turns/.test(system || '');
  if (isSummary) {
    return 'The traveler arrived at the lighthouse and began exploring its fog-wrapped steps, with the Keeper watching cautiously from the doorway.';
  }
  const isWorldCreation = /Player's idea:/.test(user);
  if (isWorldCreation) {
    return JSON.stringify({
      title: 'The Glass Lighthouse',
      setting: 'A lighthouse city built from sea-glass, perched above a fogbound coast.',
      tone: 'quiet mystery',
      rules: ['The fog hides more than weather', 'Glass remembers what it reflects'],
      starting_characters: [{ name: 'Keeper Oduya', role: 'lighthouse keeper', description: 'Guarded, watchful, knows more than she says.' }],
      starting_scene: 'You arrive at the lighthouse steps as the evening fog rolls in.',
      opening_chapter: 'The fog reaches the steps before you do, curling around your ankles like something curious. Keeper Oduya watches from the doorway, lantern unlit. "You\'re early," she says, though you were told nothing about a schedule.'
    });
  }
  return JSON.stringify({
    chapter_text: 'You step forward, and the fog seems to lean in around you, as if listening. Somewhere above, the lighthouse lens turns without a keeper\'s hand.',
    state_updates: { location: 'Lighthouse steps', new_facts: [], characters_changed: [], inventory_changed: [] },
    image_prompt: 'A foggy lighthouse at dusk, glass architecture, a lone figure on stone steps',
    suggested_actions: ['Call out to the Keeper', 'Climb the steps', 'Look for another way in']
  });
}

const providers = { anthropic: callAnthropic, openai: callOpenAI, openrouter: callOpenRouter, gemini: callGemini, mock: callMock };

async function generateText({ provider, system, user, apiKey, model }) {
  const fn = providers[provider] || providers.mock;
  const raw = await fn({ system, user, apiKey, model });
  return raw;
}

module.exports = { generateText };
