// Best-effort $/1M-token pricing so the cost tracker can show an estimate,
// not just raw token counts. Provider pricing changes over time (we've
// already had one model get retired mid-project) — treat every number here
// as approximate and safe to edit; a missing entry just means "unknown
// cost", never a crash.
//
// Each provider maps a few known model-name substrings to { in, out } USD
// per 1M tokens. The first matching substring wins; `default` is used when
// no specific model is set (matches each provider's own hardcoded default).

const PRICING = {
  anthropic: {
    default: { in: 3, out: 15 },
    entries: [
      ['haiku', { in: 0.8, out: 4 }],
      ['opus', { in: 15, out: 75 }],
      ['sonnet', { in: 3, out: 15 }]
    ]
  },
  openai: {
    default: { in: 2.5, out: 10 },
    entries: [
      ['mini', { in: 0.15, out: 0.6 }],
      ['gpt-4o', { in: 2.5, out: 10 }]
    ]
  },
  gemini: {
    default: { in: 0.075, out: 0.3 },
    entries: [
      ['flash', { in: 0.075, out: 0.3 }],
      ['pro', { in: 1.25, out: 5 }]
    ]
  },
  // OpenRouter proxies to wildly different underlying models at different
  // prices — showing a made-up number would be actively misleading, so we
  // only ever report token counts for it, never a $ estimate.
  openrouter: null,
  mock: { default: { in: 0, out: 0 }, entries: [] }
};

function rateFor(provider, model) {
  const table = PRICING[provider];
  if (!table) return null;
  const m = (model || '').toLowerCase();
  const match = table.entries.find(([needle]) => m.includes(needle));
  return (match ? match[1] : table.default) || null;
}

// Returns a USD estimate, or null when the provider/model has no known price.
function estimateCostUsd(provider, model, inputTokens, outputTokens) {
  const rate = rateFor(provider, model);
  if (!rate) return null;
  return (inputTokens / 1_000_000) * rate.in + (outputTokens / 1_000_000) * rate.out;
}

module.exports = { estimateCostUsd };
