// Local backend for AI archviz rendering — runs INSIDE the Vite dev server as
// middleware (no separate process). Holds provider credentials server-side
// (never shipped to the browser) and proxies image-to-image requests so a
// grey 3D viewport screenshot comes back as a photoreal interior.
//
// Endpoint: POST /api/ai-render
//   body: { image: "data:image/png;base64,...", prompt?: string, strength?: number }
//   200 -> { image: "data:image/<fmt>;base64,..." }  (the photoreal result —
//           <fmt> is png/jpeg/webp, whichever the caller's opts.outputFormat
//           requested; defaults to png if unset/invalid)
//   4xx/5xx -> { error: "..." }                      (human-readable reason)
//
// Stability AI only: Style Transfer (~8 credits/render) is PRIMARY whenever
// a real reference photo exists in render_ref/ — it's the only endpoint
// that actually uses the user's uploaded photo as visual input (style_image),
// not just a text description of it. Falls back through Control/Structure
// (~3 credits, geometry-locked) → Stable Image Ultra (flagship quality, ~8
// credits) → SD3.5 Medium (~3.5 credits) → SDXL 1.0 (~0.9 credits) if each
// prior engine fails. No free-tier fallback to a different/worse provider —
// a silent drop to a lower-quality model produced confusing, hard-to-diagnose
// results, so a real failure here is surfaced as an error instead.

import sharp from 'sharp';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// sd3.5-medium: 3.5 credits/render — the model actually validated working
// earlier this session (Turbo visibly under-delivered at the same strength,
// barely changing the input; this is the known-good fallback tier).
const STABILITY_MODEL = 'sd3.5-medium';

// User-supplied reference photos (the actual look to match) live in
// render_ref/ at the project root. We use Stability's real Style Transfer
// endpoint, which takes these AS IMAGES — not a text description of them —
// so the AI matches the reference photo's actual materials/light/mood
// directly, rather than us guessing at it in a prompt.
const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REF_DIR = path.join(PROJECT_ROOT, 'render_ref');
// Two reference photos, picked by unit size: 4-bed units use the second shot
// (a different room scale/mood), everything else uses the first. Update
// these two filenames whenever the reference photos in render_ref/ change —
// if a name here doesn't match a real file, getReferenceImagePath() below
// silently falls back to whatever file happens to be first alphabetically,
// which is never a deliberate choice.
const REF_DEFAULT = 'GENDO_LIT_1D5F.png';
const REF_4BED    = 'GENDO_LIT_473F.png';

function listReferenceImages() {
  try {
    return readdirSync(REF_DIR).filter(f => /\.(jpe?g|png|webp)$/i.test(f));
  } catch {
    return [];
  }
}

// Resolve which reference photo to use. An explicit `refImage` filename (chosen
// manually in the Render Controls panel) wins; otherwise fall back to the
// size-based default. Throws if an explicit choice can't be found — silently
// substituting a different photo than the one the user picked would mean the
// rendered "match this reference" result doesn't match what they think it
// matches, with no signal anywhere that a swap happened.
function getReferenceImagePath(beds, refImage) {
  const files = listReferenceImages();
  if (files.length === 0) return null;
  if (refImage) {
    const chosen = files.find(f => f === refImage);
    if (!chosen) throw new Error(`Reference photo "${refImage}" not found in render_ref/.`);
    return path.join(REF_DIR, chosen);
  }
  const want = beds === 4 ? REF_4BED : REF_DEFAULT;
  const match = files.find(f => f === want);
  return path.join(REF_DIR, match || files[0]);
}

// Safety net: img2img providers can silently return a different aspect ratio
// than the input (observed with Stability's SD3.5 — it returned a portrait/
// square image for a 1024x576 landscape input instead of erroring). This
// crops+resizes the result back to the EXACT input dimensions (cover-fit, so
// nothing is letterboxed) so the final image is always correctly landscape
// regardless of what the provider does internally.
// `fmt` must match whatever output_format was actually sent to Stability
// (png/jpeg/webp) — the caller's resolved format from applyCommonV2 — so the
// bytes returned here are genuinely the format the user picked in Render
// Controls, not silently re-encoded to PNG regardless of their choice.
async function matchInputAspect(outputBuffer, inputWidth, inputHeight, fmt = 'png') {
  const meta = await sharp(outputBuffer).metadata();
  if (meta.width === inputWidth && meta.height === inputHeight && meta.format === fmt) return outputBuffer;
  let pipeline = sharp(outputBuffer);
  if (meta.width !== inputWidth || meta.height !== inputHeight) {
    pipeline = pipeline.resize(inputWidth, inputHeight, { fit: 'cover', position: 'centre' });
  }
  if (fmt === 'jpeg') pipeline = pipeline.jpeg();
  else if (fmt === 'webp') pipeline = pipeline.webp();
  else pipeline = pipeline.png();
  return pipeline.toBuffer();
}

// img2img still needs to be told to preserve structure, or a low strength keeps
// the grey shell and a high strength invents a different room. We pair a
// structure-preserving prompt with a moderate strength (set in the route).
const DEFAULT_PROMPT =
  'photorealistic interior photograph of this exact room, same layout, same ' +
  'walls windows ceiling and furniture positions, warm oak wood floor, soft ' +
  'white painted plaster walls, realistic upholstery, natural soft daylight, ' +
  'high detail, architectural photography, no people, no text';

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 25 * 1024 * 1024) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(body);
}

function decodeImageDataUrl(imageDataUrl) {
  const match = imageDataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) throw new Error('Captured screenshot was not a valid image data URL.');
  return { mime: match[1], base64: match[2] };
}

// Default negative prompt — used when the Render Controls panel doesn't send
// its own. Steers the model away from the geometry distortions we keep fighting.
const DEFAULT_NEGATIVE =
  'distorted columns, extra columns, missing columns, warped geometry, ' +
  'melted architecture, extra windows, blocked windows, people, text, ' +
  'watermark, blurry, lowres, cartoon, illustration';

// Appends the shared "advanced" render params to a v2beta multipart form, each
// only when actually provided so we never override an endpoint's own default
// with a bad value. `opts` = { negativePrompt, seed, outputFormat }.
function applyCommonV2(form, opts = {}) {
  const fmt = ['png', 'jpeg', 'webp'].includes(opts.outputFormat) ? opts.outputFormat : 'png';
  form.append('output_format', fmt);
  const neg = (typeof opts.negativePrompt === 'string' && opts.negativePrompt.trim())
    ? opts.negativePrompt.trim() : DEFAULT_NEGATIVE;
  form.append('negative_prompt', neg);
  // seed 0 = random (Stability's convention). Only send a non-zero seed so a
  // blank/0 keeps renders varied; a locked seed reproduces the same image.
  const seed = Number(opts.seed);
  if (Number.isFinite(seed) && seed > 0) form.append('seed', String(Math.floor(seed)));
  return fmt;
}

// Calls Stability AI's ControlNet "structure" endpoint. This is the real
// geometry-lock: unlike img2img/style-transfer (which only loosely respect the
// input), control/structure derives the STRUCTURE (depth/edges) of the input
// image and FORCES the generation to obey it — columns, vault ribs, window
// openings stay locked to the actual 3D geometry instead of being approximated
// and drifting. control_strength (0.01..1, higher = obey structure harder) is
// the lock knob. It's a Control endpoint (~3 credits), cheaper than Style
// Transfer (~8). Takes a plain image (our flat-edged-column capture) — no
// separate depth map needed; the endpoint computes structure internally.
async function callStructure({ apiKey, imageDataUrl, prompt, controlStrength, opts = {} }) {
  const { mime, base64 } = decodeImageDataUrl(imageDataUrl);
  const bytes = Buffer.from(base64, 'base64');
  const ext = mime.includes('png') ? 'png' : 'jpg';

  const form = new FormData();
  form.append('image', new Blob([bytes], { type: mime }), `source.${ext}`);
  form.append('prompt', prompt || DEFAULT_PROMPT);
  const fmt = applyCommonV2(form, opts);
  // control_strength balances geometry-lock vs material/style freedom. Too
  // HIGH (0.8) holds the columns/vault perfectly but starves the prompt — the
  // result just re-textures the grey input as dull grey stone instead of warm
  // plaster. ~0.55 is the sweet spot: the real columns/vault/openings stay put
  // (structure still dominates) while the prompt's warm plaster / limestone /
  // daylight actually comes through as rich archviz materials.
  // RAW — pass control_strength exactly as sent (only guard non-numbers). The
  // user owns this knob; no clamping into a "safe" band.
  const cs = (typeof controlStrength === 'number' && Number.isFinite(controlStrength)) ? controlStrength : 0.7;
  form.append('control_strength', String(cs));
  console.log(`[ai-render] structure RAW control_strength=${cs}`);

  const resp = await fetch('https://api.stability.ai/v2beta/stable-image/control/structure', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
    body: form,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    if (resp.status === 401 || resp.status === 403)
      throw new Error('Stability AI rejected the credentials (check STABILITY_API_KEY in .env).');
    if (resp.status === 429)
      throw new Error('Stability AI rate limit hit — wait a moment and retry.');
    if (resp.status === 402)
      throw new Error('Stability AI account is out of credits.');
    throw new Error(`Stability AI (Structure) error ${resp.status}: ${text.slice(0, 300)}`);
  }
  const data = await resp.json();
  if (!data.image) throw new Error('Stability AI (Structure) returned no image.');
  const outBuf = Buffer.from(data.image, 'base64');
  const { width: inW, height: inH } = await sharp(bytes).metadata();
  const fixedBuf = await matchInputAspect(outBuf, inW, inH, fmt);
  return `data:image/${fmt};base64,${fixedBuf.toString('base64')}`;
}

// Calls Stability AI's SD3.5 img2img endpoint and returns a base64 PNG data
// URL. Throws Error with a readable message on failure.
async function callStability({ apiKey, imageDataUrl, prompt, strength, opts = {} }) {
  const { mime, base64 } = decodeImageDataUrl(imageDataUrl);
  const bytes = Buffer.from(base64, 'base64');
  const ext = mime.includes('png') ? 'png' : 'jpg';

  const form = new FormData();
  form.append('image', new Blob([bytes], { type: mime }), `source.${ext}`);
  form.append('prompt', prompt || DEFAULT_PROMPT);
  form.append('mode', 'image-to-image');
  form.append('model', STABILITY_MODEL);
  const fmt = applyCommonV2(form, opts);
  // cfg_scale — prompt adherence (higher = follow the prompt harder).
  if (Number.isFinite(Number(opts.cfgScale)))
    form.append('cfg_scale', String(Math.max(1, Math.min(20, Number(opts.cfgScale)))));
  // strength 0..1 — how far from the input image. LOW keeps the exact
  // geometry (columns, furniture, walls) and only repaints surfaces; HIGH
  // lets the model invent a new room.
  form.append('strength', String(typeof strength === 'number' && Number.isFinite(strength) ? strength : 0.35));

  const resp = await fetch('https://api.stability.ai/v2beta/stable-image/generate/sd3', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
    body: form,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    if (resp.status === 401 || resp.status === 403)
      throw new Error('Stability AI rejected the credentials (check STABILITY_API_KEY in .env).');
    if (resp.status === 429)
      throw new Error('Stability AI rate limit hit — wait a moment and retry.');
    if (resp.status === 402)
      throw new Error('Stability AI account is out of credits.');
    throw new Error(`Stability AI error ${resp.status}: ${text.slice(0, 300)}`);
  }
  const data = await resp.json();
  if (!data.image) throw new Error('Stability AI returned no image.');
  const outBuf = Buffer.from(data.image, 'base64');
  const { width: inW, height: inH } = await sharp(bytes).metadata();
  const fixedBuf = await matchInputAspect(outBuf, inW, inH, fmt);
  return `data:image/${fmt};base64,${fixedBuf.toString('base64')}`;
}

// Calls Stability AI's Stable Image Ultra endpoint — their flagship model,
// 8 credits/render (same price as Style Transfer, but a real general model
// rather than reference-photo matching). Separate function from
// callStability: Ultra is a single fixed model with its OWN endpoint
// (/generate/ultra), not a `model` choice on the shared /generate/sd3
// endpoint — sending `model` there would be ignored/rejected.
async function callUltra({ apiKey, imageDataUrl, prompt, strength, opts = {} }) {
  const { mime, base64 } = decodeImageDataUrl(imageDataUrl);
  const bytes = Buffer.from(base64, 'base64');
  const ext = mime.includes('png') ? 'png' : 'jpg';

  const form = new FormData();
  form.append('image', new Blob([bytes], { type: mime }), `source.${ext}`);
  form.append('prompt', prompt || DEFAULT_PROMPT);
  form.append('mode', 'image-to-image');
  const fmt = applyCommonV2(form, opts);
  form.append('strength', String(typeof strength === 'number' && Number.isFinite(strength) ? strength : 0.45));

  const resp = await fetch('https://api.stability.ai/v2beta/stable-image/generate/ultra', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
    body: form,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    if (resp.status === 401 || resp.status === 403)
      throw new Error('Stability AI rejected the credentials (check STABILITY_API_KEY in .env).');
    if (resp.status === 429)
      throw new Error('Stability AI rate limit hit — wait a moment and retry.');
    if (resp.status === 402)
      throw new Error('Stability AI account is out of credits.');
    throw new Error(`Stability AI (Ultra) error ${resp.status}: ${text.slice(0, 300)}`);
  }
  const data = await resp.json();
  if (!data.image) throw new Error('Stability AI (Ultra) returned no image.');
  const outBuf = Buffer.from(data.image, 'base64');
  const { width: inW, height: inH } = await sharp(bytes).metadata();
  const fixedBuf = await matchInputAspect(outBuf, inW, inH, fmt);
  return `data:image/${fmt};base64,${fixedBuf.toString('base64')}`;
}

// Calls Stability AI's real Style Transfer endpoint: init_image (our 3D
// capture — supplies the room's exact geometry/composition) + style_image
// (the user's reference photo — supplies the actual materials/light/mood).
// This matches a specific look directly from a photo instead of a guessed
// text description, which is what the user explicitly asked for.
async function callStyleTransfer({ apiKey, imageDataUrl, prompt, strength, materialStrength, beds, refImage, opts = {} }) {
  const refPath = getReferenceImagePath(beds, refImage);
  if (!refPath) throw new Error('No reference image found in render_ref/.');
  console.log(`[ai-render] Style Transfer using reference: ${path.basename(refPath)}`);

  const { base64 } = decodeImageDataUrl(imageDataUrl);
  const initBytes = Buffer.from(base64, 'base64');
  const styleBytes = readFileSync(refPath);
  const { width: inW, height: inH } = await sharp(initBytes).metadata();

  // MIME must match the reference file's actual format — this used to be
  // hardcoded to image/jpeg regardless of the real extension, which was
  // silently wrong as soon as the reference photos became PNGs (the new
  // GENDO_LIT_*.png files) instead of the original .jpg set.
  const refExt = path.extname(refPath).toLowerCase();
  const refMime = refExt === '.png' ? 'image/png' : refExt === '.webp' ? 'image/webp' : 'image/jpeg';

  const form = new FormData();
  form.append('init_image', new Blob([initBytes], { type: 'image/png' }), 'source.png');
  form.append('style_image', new Blob([styleBytes], { type: refMime }), path.basename(refPath));
  // Style Transfer DOES accept a text prompt + negative_prompt (unlike what we
  // assumed earlier) — send it so the model has an explicit description of
  // the colour-contrast we want, on top of the reference photo's own pixels.
  // Prompt is OPT-IN now. The user wants the reference photo to drive the look,
  // not a rigid text description fighting it — so we only send a prompt if one
  // was explicitly passed AND non-empty. Empty/blank prompt = pure reference.
  if (typeof prompt === 'string' && prompt.trim()) {
    form.append('prompt', prompt.trim());
    console.log(`[ai-render] style-transfer prompt sent (${prompt.trim().length} chars): "${prompt.trim().slice(0, 80)}..."`);
  } else {
    console.log('[ai-render] style-transfer: NO prompt sent (reference photo only)');
  }
  const fmt = applyCommonV2(form, opts);
  // PARAMETER DIRECTIONS — verbatim from Stability's official docs (mirrored on
  // AWS Bedrock "Style Transfer"). The earlier code had two of the three knobs
  // pointed the WRONG WAY, which is the real reason "95% lock" still warped the
  // room and furniture kept dissolving:
  //
  //   • change_strength (0.1..1, default 0.9) — "how much the original image
  //     should CHANGE." HIGHER = MORE change = LESS preservation. The old code
  //     fed it the geometry-lock value directly, so lock=0.95 sent
  //     change_strength=0.95 = "repaint almost everything" — the OPPOSITE of a
  //     lock. This is THE bug. Geometry Lock must map to (1 - lock): high lock
  //     → low change → geometry preserved.
  //
  //   • style_strength (0..1, default 1) — "how much influence the style_image
  //     has. 0 = output IDENTICAL to the init image; 1 = as if NO init image
  //     was passed (pure invention from the style photo)." So HIGH starves the
  //     real 3D geometry and lets the model hallucinate. The realism band for
  //     interior/architecture (where the init's geometry must survive) is
  //     ~0.3-0.6, NOT 0.85. We scale the Material Strength slider into 0.2-0.6.
  //
  //   • composition_fidelity (0..1, default 0.9) — "how closely the output's
  //     style resembles the INPUT's style." This is a style-similarity dial,
  //     NOT a geometry lock. Kept high (0.9, the API default) so the result
  //     stays a coherent photographic interior rather than drifting stylebook.
  // TOTAL FREEDOM — NO mapping, NO clamps, NO formula. Whatever raw values the
  // Render Controls send for these three params are passed straight to Stability
  // exactly as given (only guarding against non-numbers). The user drives every
  // knob directly. opts.raw carries them: { composition_fidelity, change_strength,
  // style_strength } each 0..1 (style/comp) or 0.1..1 (change), per Stability docs.
  const raw = opts.raw || {};
  const passNum = (v, fallback) => (typeof v === 'number' && Number.isFinite(v)) ? v : fallback;
  // Fall back to the OLD geometry-lock slider only if no raw value was sent, so
  // nothing breaks for callers that haven't switched to the raw controls yet.
  const compFidelity  = passNum(raw.composition_fidelity, passNum(strength, 0.9));
  const changeStrength = passNum(raw.change_strength, typeof strength === 'number' ? 1 - strength : 0.5);
  const styleStrength  = passNum(raw.style_strength, passNum(materialStrength, 0.9));
  form.append('composition_fidelity', String(compFidelity));
  form.append('change_strength', String(changeStrength));
  form.append('style_strength', String(styleStrength));
  console.log(`[ai-render] style-transfer RAW params: composition_fidelity=${compFidelity} change_strength=${changeStrength} style_strength=${styleStrength}`);

  const resp = await fetch('https://api.stability.ai/v2beta/stable-image/control/style-transfer', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
    body: form,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    if (resp.status === 401 || resp.status === 403)
      throw new Error('Stability AI rejected the credentials (check STABILITY_API_KEY in .env).');
    if (resp.status === 429)
      throw new Error('Stability AI rate limit hit — wait a moment and retry.');
    if (resp.status === 402)
      throw new Error('Stability AI account is out of credits.');
    throw new Error(`Stability AI (Style Transfer) error ${resp.status}: ${text.slice(0, 300)}`);
  }
  const data = await resp.json();
  if (!data.image) throw new Error('Stability AI (Style Transfer) returned no image.');
  const outBuf = Buffer.from(data.image, 'base64');
  const fixedBuf = await matchInputAspect(outBuf, inW, inH, fmt);
  return `data:image/${fmt};base64,${fixedBuf.toString('base64')}`;
}

// Stability's legacy v1 SDXL engine only accepts a fixed list of resolution
// buckets for image-to-image — 1024x576 (our capture size) isn't one of them.
// 1344x768 is the closest 16:9-ish bucket (ratio 1.75 vs our 1.778).
const SDXL_ENGINE = 'stable-diffusion-xl-1024-v1-0';
const SDXL_BUCKET_W = 1344;
const SDXL_BUCKET_H = 768;

// Calls Stability AI's legacy v1 SDXL 1.0 image-to-image endpoint and returns
// a base64 PNG data URL.
async function callStabilitySDXL({ apiKey, imageDataUrl, prompt, strength, opts = {} }) {
  const { base64 } = decodeImageDataUrl(imageDataUrl);
  const inputBytes = Buffer.from(base64, 'base64');
  const { width: inW, height: inH } = await sharp(inputBytes).metadata();

  // Resize (cover-fit, no letterboxing) to the engine's required bucket size.
  const bucketBuf = await sharp(inputBytes)
    .resize(SDXL_BUCKET_W, SDXL_BUCKET_H, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();

  const form = new FormData();
  form.append('init_image', new Blob([bucketBuf], { type: 'image/png' }), 'source.png');
  form.append('init_image_mode', 'IMAGE_STRENGTH');
  // image_strength 0..1 — LOWER keeps the input image's structure; SDXL's
  // scale matches SD3.5's strength semantics directly.
  form.append('image_strength', String(typeof strength === 'number' ? Math.max(0.02, Math.min(1, strength)) : 0.45));
  form.append('text_prompts[0][text]', prompt || DEFAULT_PROMPT);
  form.append('text_prompts[0][weight]', '1');
  // Negative prompt as a second text_prompt with negative weight (v1 form).
  const neg = (typeof opts.negativePrompt === 'string' && opts.negativePrompt.trim())
    ? opts.negativePrompt.trim() : DEFAULT_NEGATIVE;
  form.append('text_prompts[1][text]', neg);
  form.append('text_prompts[1][weight]', '-1');
  // cfg_scale — prompt adherence; default 8.5 (7 under-committed → grey renders).
  form.append('cfg_scale', String(Number.isFinite(Number(opts.cfgScale)) ? Math.max(1, Math.min(20, Number(opts.cfgScale))) : 8.5));
  form.append('samples', '1');
  // steps — quality vs speed; default 40.
  form.append('steps', String(Number.isFinite(Number(opts.steps)) ? Math.max(10, Math.min(50, Math.floor(Number(opts.steps)))) : 40));
  const sdxlSeed = Number(opts.seed);
  if (Number.isFinite(sdxlSeed) && sdxlSeed > 0) form.append('seed', String(Math.floor(sdxlSeed)));

  const resp = await fetch(`https://api.stability.ai/v1/generation/${SDXL_ENGINE}/image-to-image`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
    body: form,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    if (resp.status === 401 || resp.status === 403)
      throw new Error('Stability AI rejected the credentials (check STABILITY_API_KEY in .env).');
    if (resp.status === 429)
      throw new Error('Stability AI rate limit hit — wait a moment and retry.');
    if (resp.status === 402)
      throw new Error('Stability AI account is out of credits.');
    throw new Error(`Stability AI (SDXL) error ${resp.status}: ${text.slice(0, 300)}`);
  }
  const data = await resp.json();
  const artifact = data?.artifacts?.[0];
  if (!artifact?.base64) throw new Error('Stability AI (SDXL) returned no image.');
  const outBuf = Buffer.from(artifact.base64, 'base64');
  // Crop back from the 1344x768 bucket to the EXACT original aspect/size so
  // the final image always matches what the user actually captured. This
  // legacy v1 endpoint has no output_format param of its own (always returns
  // PNG artifacts), but we still honor the user's chosen format on the way
  // out via matchInputAspect's re-encode, same as every other engine.
  const fmt = ['png', 'jpeg', 'webp'].includes(opts.outputFormat) ? opts.outputFormat : 'png';
  const fixedBuf = await matchInputAspect(outBuf, inW, inH, fmt);
  return `data:image/${fmt};base64,${fixedBuf.toString('base64')}`;
}

// Stability AI only — Style Transfer (using the user's reference photo)
// first, then Structure, then Ultra, then SD3.5, then SDXL (see callModel's
// AUTO branch below for the real chain). No Cloudflare fallback for
// rendering: a silent drop to a much lower-quality free model produced
// confusing results that looked like a "broken pipeline" when it was
// actually just a worse model answering. Better to fail loudly so the real
// cause is visible.
async function callModel({ stabilityKey, imageDataUrl, prompt, strength, materialStrength, beds, engine, refImage, opts = {} }) {
  if (!stabilityKey?.trim())
    throw new Error('No render provider configured. Add STABILITY_API_KEY to .env and restart the dev server.');

  // The frontend sends ONE "geometry-lock" knob (higher = preserve the captured
  // geometry more). The endpoints disagree on convention, so normalise here:
  //   • Style Transfer composition_fidelity + Structure control_strength: HIGHER = preserve.
  //   • Ultra / SD3.5 / SDXL image-to-image strength: LOWER = preserve → invert.
  // TOTAL FREEDOM: if the Render Controls send a raw per-engine value
  // (opts.raw.*), it is used VERBATIM with no clamp/inversion. The lock-based
  // mapping below is only a fallback for callers that don't send raw values.
  const raw = opts.raw || {};
  const num = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : undefined;
  const lock = typeof strength === 'number' ? Math.max(0, Math.min(1, strength)) : 0.5;
  const fidelity = lock;          // Structure control_strength fallback (higher = preserve)
  const i2iStrength = 1 - lock;   // Ultra / SD3.5 / SDXL fallback (lower = preserve)
  // Raw overrides per engine (undefined → engine uses its own fallback).
  const rawControl = num(raw.control_strength);
  const rawI2I     = num(raw.i2i_strength);

  // Each engine as a callable, so an explicit manual choice runs JUST that one
  // (no silent fallback masking what the user picked), while 'auto' runs the
  // default chain.
  const runStyle = () => callStyleTransfer({ apiKey: stabilityKey, imageDataUrl, prompt, strength: fidelity, materialStrength, beds, refImage, opts });
  const runStructure = () => callStructure({ apiKey: stabilityKey, imageDataUrl, prompt, controlStrength: rawControl !== undefined ? rawControl : fidelity, opts });
  const runUltra = () => callUltra({ apiKey: stabilityKey, imageDataUrl, prompt, strength: rawI2I !== undefined ? rawI2I : i2iStrength, opts });
  const runSD35 = () => callStability({ apiKey: stabilityKey, imageDataUrl, prompt, strength: rawI2I !== undefined ? rawI2I : i2iStrength, opts });
  const runSDXL = () => callStabilitySDXL({ apiKey: stabilityKey, imageDataUrl, prompt, strength: rawI2I !== undefined ? rawI2I : i2iStrength, opts });

  // MANUAL endpoint override (from the Render Controls panel). Runs exactly the
  // chosen engine and surfaces its real error rather than hiding it behind a
  // fallback — so what you pick is what you get.
  if (engine && engine !== 'auto') {
    console.log(`[ai-render] manual engine = ${engine}`);
    if (engine === 'style')     return await runStyle();
    if (engine === 'structure') return await runStructure();
    if (engine === 'ultra')     return await runUltra();
    if (engine === 'sd35')      return await runSD35();
    if (engine === 'sdxl')      return await runSDXL();
    throw new Error(`Unknown engine "${engine}".`);
  }

  // AUTO (default): Style Transfer PRIMARY — it's the only endpoint that uses
  // the user's actual reference photo (style_image) to drive materials/light,
  // which is what makes the result match the reference instead of a guessed
  // text description. Falls back through the others only if it fails.
  let hasUsableRef = false;
  try {
    hasUsableRef = !!getReferenceImagePath(beds, refImage);
  } catch (err) {
    // Explicit refImage choice didn't resolve — surfaced loudly (not silently
    // swapped) since AUTO mode degrading to Structure here is a real quality
    // change the user should be able to see in the logs.
    console.warn(`[ai-render] ${err.message} — skipping Style Transfer, falling back to Structure.`);
  }
  if (hasUsableRef) {
    try {
      return await runStyle();
    } catch (err) {
      console.warn('[ai-render] Style Transfer failed, falling back to Structure:', err.message);
    }
  }
  try {
    return await runStructure();
  } catch (err) {
    console.warn('[ai-render] Structure failed, falling back to Ultra:', err.message);
    try {
      return await runUltra();
    } catch (err2) {
      console.warn('[ai-render] Ultra failed, falling back to SD3.5 Medium:', err2.message);
      try {
        return await runSD35();
      } catch (err3) {
        console.warn('[ai-render] SD3.5 Medium also failed, falling back to SDXL:', err3.message);
        return await runSDXL();
      }
    }
  }
}

// ── AI design partner — generates structured interior options from a brief ──
// Uses a free Cloudflare LLM (Llama 3.3 70B) to turn a natural-language design
// intent ("warm japandi", "family of 4") into 3 real interior options with
// material palettes, livability scores, and reasoning. Returns parsed JSON.
const CF_LLM = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

const DESIGN_SYS =
  'You are an expert interior designer AI for a modular low-carbon housing ' +
  'platform. Given a design brief, return ONLY valid JSON (no markdown, no ' +
  'prose, no code fences): an array of exactly 3 distinct interior options. ' +
  'Each option is an object with: "label" (a short evocative name, 2-4 words), ' +
  '"score" (integer 70-99, a livability/market-fit score), "tags" (array of 3 ' +
  'short real material strings, e.g. "Oak floors"), "aiNote" (one sentence ' +
  'explaining the design rationale). Make the three options genuinely different ' +
  'in mood and materials.';

async function callDesign({ accountId, apiToken, brief }) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${CF_LLM}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: DESIGN_SYS },
        { role: 'user', content: `Design brief: ${brief}` },
      ],
      max_tokens: 700,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    if (resp.status === 401 || resp.status === 403)
      throw new Error('Cloudflare rejected the credentials (check .env).');
    if (resp.status === 429)
      throw new Error('Cloudflare rate limit hit — wait a moment and retry.');
    throw new Error(`AI provider error ${resp.status}: ${text.slice(0, 300)}`);
  }
  const data = await resp.json();
  const rawResp = data?.result?.response;
  let options;
  if (Array.isArray(rawResp)) {
    // Some CF responses come back already parsed as an array/object.
    options = rawResp;
  } else if (rawResp && typeof rawResp === 'object') {
    options = rawResp.options || rawResp.results || Object.values(rawResp);
  } else {
    let txt = String(rawResp ?? '');
    txt = txt.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
    const m = txt.match(/\[[\s\S]*\]/);
    if (m) txt = m[0];
    try { options = JSON.parse(txt); }
    catch { throw new Error('AI returned an unparseable design response — try again.'); }
  }
  if (!Array.isArray(options) || options.length === 0)
    throw new Error('AI returned no design options — try a different brief.');
  // Normalise/guard each option so the UI never gets a malformed shape.
  return options.slice(0, 3).map((o, i) => ({
    id: `ai_${i}`,
    label: String(o.label || `Option ${i + 1}`).slice(0, 48),
    score: Math.max(70, Math.min(99, parseInt(o.score, 10) || 85)),
    tags: Array.isArray(o.tags) ? o.tags.slice(0, 3).map(t => String(t).slice(0, 24)) : [],
    aiNote: String(o.aiNote || '').slice(0, 220),
  }));
}

// Vite plugin: registers the /api/ai-render + /api/ai-design routes.
export default function aiRenderPlugin() {
  return {
    name: 'ai-render-middleware',
    configureServer(server) {
      server.middlewares.use('/api/ai-render', async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' });

        const stabilityKey = process.env.STABILITY_API_KEY;
        if (!stabilityKey?.trim())
          return sendJson(res, 400, { error: 'No render provider configured. Add STABILITY_API_KEY to .env and restart the dev server.' });

        try {
          const raw = await readBody(req);
          const { image, prompt, strength, materialStrength, beds, engine, refImage, opts } = JSON.parse(raw || '{}');
          if (!image || typeof image !== 'string')
            return sendJson(res, 400, { error: 'Missing "image" (data URL) in request body.' });

          // DEBUG: dump the exact init_image (what the 3D scene actually
          // captured and sent) to disk so we can SEE what geometry/furniture is
          // really in the source — the render can only restyle what's here.
          try {
            const dbgDir = path.join(process.cwd(), 'debug');
            mkdirSync(dbgDir, { recursive: true });
            const { base64: initB64 } = decodeImageDataUrl(image);
            writeFileSync(path.join(dbgDir, 'last-init.png'), Buffer.from(initB64, 'base64'));
            console.log(`[ai-render] DEBUG wrote init_image -> debug/last-init.png (${(initB64.length / 1024).toFixed(0)}KB b64)`);
          } catch (e) { console.warn('[ai-render] debug init dump failed:', e.message); }

          const result = await callModel({ stabilityKey, imageDataUrl: image, prompt, strength, materialStrength, beds, engine, refImage, opts: opts || {} });

          // DEBUG: also dump the AI output for side-by-side inspection.
          try {
            const { base64: outB64 } = decodeImageDataUrl(result);
            writeFileSync(path.join(process.cwd(), 'debug', 'last-output.png'), Buffer.from(outB64, 'base64'));
            console.log('[ai-render] DEBUG wrote AI output -> debug/last-output.png');
          } catch (e) { console.warn('[ai-render] debug output dump failed:', e.message); }

          return sendJson(res, 200, { image: result });
        } catch (err) {
          return sendJson(res, 500, { error: err?.message || String(err) });
        }
      });

      // Lists the reference photos in render_ref/ (filename + a small base64
      // thumbnail) so the Render Controls panel can show a pickable gallery.
      server.middlewares.use('/api/ref-images', async (req, res) => {
        try {
          const files = listReferenceImages();
          const items = [];
          for (const f of files) {
            let thumb = null;
            try {
              const buf = await sharp(path.join(REF_DIR, f))
                .resize(160, 90, { fit: 'cover', position: 'centre' })
                .jpeg({ quality: 70 })
                .toBuffer();
              thumb = `data:image/jpeg;base64,${buf.toString('base64')}`;
            } catch { /* skip a bad image */ }
            items.push({ name: f, thumb });
          }
          return sendJson(res, 200, { images: items });
        } catch (err) {
          return sendJson(res, 500, { error: err?.message || String(err) });
        }
      });

      server.middlewares.use('/api/ai-design', async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' });

        const accountId = process.env.CF_ACCOUNT_ID;
        const apiToken  = process.env.CF_API_TOKEN;
        if (!accountId?.trim() || !apiToken?.trim())
          return sendJson(res, 400, { error: 'No Cloudflare credentials set. Add CF_ACCOUNT_ID and CF_API_TOKEN to .env and restart the dev server.' });

        try {
          const raw = await readBody(req);
          const { brief } = JSON.parse(raw || '{}');
          if (!brief || typeof brief !== 'string' || !brief.trim())
            return sendJson(res, 400, { error: 'Missing "brief" (design prompt) in request body.' });

          const options = await callDesign({ accountId, apiToken, brief: brief.trim().slice(0, 300) });
          return sendJson(res, 200, { options });
        } catch (err) {
          return sendJson(res, 500, { error: err?.message || String(err) });
        }
      });
    },
  };
}
