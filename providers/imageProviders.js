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
async function callLocalSD({ prompt, apiKey, baseUrl, model }) {
  const url = `${(baseUrl || 'http://localhost:7860').replace(/\/$/, '')}/sdapi/v1/txt2img`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({
      prompt,
      steps: 20,
      width: 512,
      height: 512,
      // Per-request checkpoint override (AUTOMATIC1111's documented
      // override_settings shape) -- lets Fogbound's "Image model" field
      // pick between checkpoints (e.g. illustration vs. photorealistic)
      // without changing the WebUI's persisted default. Swapping
      // checkpoints costs real time/VRAM on AUTOMATIC1111's side, same as
      // switching it by hand in the UI.
      ...(model ? { override_settings: { sd_model_checkpoint: model }, override_settings_restore_afterwards: false } : {})
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

// Best-effort classification by filename -- AUTOMATIC1111's API doesn't
// report what a checkpoint is meant to draw, so this guesses from known
// names. Covers the two checkpoints setup-automatic1111.ps1 downloads by
// default (NoobAI-XL, RealVisXL) plus other well-known models in each
// family, so a manually added checkpoint still gets a sensible label
// instead of none. Falls back to 'other', never to no category at all --
// the dropdown always shows "<what it does> - <name>".
const ILLUSTRATION_KEYWORDS = ['noobai', 'illustrious', 'pony', 'animagine', 'waifu', 'niji', 'anything', 'counterfeit', 'aingdiffusion'];
const PHOTOREAL_KEYWORDS = ['realvis', 'juggernaut', 'epicrealism', 'photoreal', 'realistic', 'dreamshaper', 'absolutereality', 'realism'];

function classifyLocalSdModel(filename) {
  const lower = filename.toLowerCase();
  if (ILLUSTRATION_KEYWORDS.some(k => lower.includes(k))) return 'illustration';
  if (PHOTOREAL_KEYWORDS.some(k => lower.includes(k))) return 'photorealistic';
  return 'other';
}

// Lists checkpoints currently installed in AUTOMATIC1111, via its documented
// /sdapi/v1/sd-models endpoint -- feeds the per-world "Image model" preset
// dropdown so it reflects what's actually on disk instead of requiring the
// exact filename to be typed by hand. `value` (the filename, with
// extension) is what gets saved as world.imageModel and sent back as
// override_settings.sd_model_checkpoint by callLocalSD above.
async function listLocalSdModels({ apiKey, baseUrl }) {
  const url = `${(baseUrl || 'http://localhost:7860').replace(/\/$/, '')}/sdapi/v1/sd-models`;
  const res = await fetch(url, {
    headers: { ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    timeout: 5000
  });
  if (!res.ok) throw new Error(`Local Stable Diffusion API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data || []).map(m => {
    const rawName = (m.filename || '').split(/[\\/]/).pop() || m.model_name || m.title || 'model';
    const value = rawName;
    const name = rawName.replace(/\.(safetensors|ckpt)$/i, '');
    return { value, name, category: classifyLocalSdModel(rawName) };
  });
}

module.exports = { generateImage, listLocalSdModels };
