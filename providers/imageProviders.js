const fetch = require('node-fetch');

// Returns a URL (or base64 data URL) for the generated image, or null.

// Stability's v2beta "core" endpoint is a single fixed model — it has no
// per-request model parameter to override, unlike Replicate. Model choice
// on Stability would mean switching to an entirely different endpoint
// (ultra/sd3/core each are separate models), which is out of scope here.
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

async function callReplicate({ prompt, apiKey, model }) {
  const start = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      version: model || 'black-forest-labs/flux-schnell',
      input: { prompt }
    })
  });
  if (!start.ok) throw new Error(`Replicate API error ${start.status}: ${await start.text()}`);
  const prediction = await start.json();
  // Caller is expected to poll prediction.urls.get if not immediately resolved;
  // simplified here for the MVP.
  return prediction.output ? prediction.output[0] : null;
}

// Targets AUTOMATIC1111's Stable Diffusion WebUI (the standard local image
// tool, chosen over ComfyUI for the same reason Ollama was chosen for local
// text: a single synchronous JSON endpoint, no websocket/queue/node-graph to
// drive). Requires the user to have started it with --api (off by default).
// Reaches it through the same authenticated Caddy+tunnel bridge as Ollama —
// see scripts/windows/setup-ollama-bridge.ps1 — since it's the same PC/GPU.
//
// NOTE: written from AUTOMATIC1111's documented /sdapi/v1/txt2img shape
// (stable for years) but not exercised against a live instance in this
// session — no such environment available here. Report back anything that
// doesn't match and it'll get fixed.
async function callLocalSD({ prompt, apiKey, baseUrl }) {
  const url = `${(baseUrl || 'http://localhost:7860').replace(/\/$/, '')}/sdapi/v1/txt2img`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({
      prompt,
      steps: 20,
      width: 512,
      height: 512
    })
  });
  if (!res.ok) throw new Error(`Local Stable Diffusion API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const image = data.images && data.images[0];
  return image ? `data:image/png;base64,${image}` : null;
}

async function callMock({ prompt }) {
  // No network call — returns a placeholder so the UI has something to render during testing.
  return null;
}

const providers = { stability: callStability, replicate: callReplicate, localsd: callLocalSD, mock: callMock, none: callMock };

async function generateImage({ provider, prompt, apiKey, model, baseUrl }) {
  if (!prompt) return null;
  const fn = providers[provider] || providers.mock;
  return fn({ prompt, apiKey, model, baseUrl });
}

module.exports = { generateImage };
