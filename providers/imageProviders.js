const fetch = require('node-fetch');

// Returns a URL (or base64 data URL) for the generated image, or null.

async function callStability({ prompt, apiKey }) {
  const res = await fetch('https://api.stability.ai/v2beta/stable-image/generate/core', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
    body: (() => {
      const form = new (require('form-data'))();
      form.append('prompt', prompt);
      form.append('output_format', 'png');
      return form;
    })()
  });
  if (!res.ok) throw new Error(`Stability API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return `data:image/png;base64,${data.image}`;
}

async function callReplicate({ prompt, apiKey }) {
  const start = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      version: 'black-forest-labs/flux-schnell',
      input: { prompt }
    })
  });
  if (!start.ok) throw new Error(`Replicate API error ${start.status}: ${await start.text()}`);
  const prediction = await start.json();
  // Caller is expected to poll prediction.urls.get if not immediately resolved;
  // simplified here for the MVP.
  return prediction.output ? prediction.output[0] : null;
}

async function callMock({ prompt }) {
  // No network call — returns a placeholder so the UI has something to render during testing.
  return null;
}

const providers = { stability: callStability, replicate: callReplicate, mock: callMock, none: callMock };

async function generateImage({ provider, prompt, apiKey }) {
  if (!prompt) return null;
  const fn = providers[provider] || providers.mock;
  return fn({ prompt, apiKey });
}

module.exports = { generateImage };
