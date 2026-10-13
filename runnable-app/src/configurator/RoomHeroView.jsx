import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree, useFrame, createPortal } from '@react-three/fiber';
import { OrbitControls, TransformControls, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import RoomEnv from '../shared/RoomEnv';
import CinematicFX from '../shared/CinematicFX';
import { BaseRoom, FurniturePiece3D, FurnTextureApplier, ROOMS_META } from './RoomConfigurator';
import { makeColumnMat, makePlasterMat } from './utils/materials';
import './RoomHeroView.css';

// Drop a real exterior panorama at public/hdri/exterior.hdr (.hdr/.exr/.jpg
// all supported) to replace the flat skyline-plane hack with a proper IBL
// environment that windows reflect and show — RoomEnv silently falls back to
// the synthetic studio environment if this file isn't present yet.
const EXTERIOR_HDRI_URL = '/hdri/exterior.hdr';

// ── Per-room camera presets ──────────────────────────────────────────────
// Coordinates are in ROOM SPACE (BaseRoom recenters the GLB so the room centre
// is x=0/z=0 and the floor is y=0). For each room you specify EXACTLY where the
// camera stands (eye) and what it aims at (look), plus optional fov. Any room
// with an entry here uses it verbatim — no auto-framing, no guessing. Rooms
// without an entry fall back to the automatic hero-column framing.
//
// To capture values: in the View Your Home console the rig logs the auto eye/
// look; set `window.__cam = { eye:[x,y,z], look:[x,y,z], fov:65 }`, dial it in,
// then tell me the numbers and I paste them here for that room id.
//
// Reference (ROOM1, after recenter): x:-6.4..6.4, z:-4.5..4.5, floor y=0,
// ceiling ~4.5m, star-capital tops at y~3-4.
// Intentionally empty — a non-empty entry here OVERRIDES the live auto-framing
// (see precedence comment above InteriorCaptureRig), which would make every
// user's render ignore their actual furniture placement. The exported
// per-room angles (computed with no furniture, for reference) live in
// docs/render-camera-angles.json — use them only if a SPECIFIC room needs a
// permanent hand-tuned override regardless of furniture.
const CAMERA_BY_ROOM = {};

// Layer-visibility set for BaseRoom — module-level constant so we're not
// allocating a new Set() every render (BaseRoom's effect depends on this by
// reference).
const EMPTY_LAYER_SET = new Set();

// Default material/style prompt — editable live in the Render Controls panel.
// Describes ONLY materials/light/mood + a hard "don't change geometry"
// instruction; never specific furniture (which would make the model invent
// pieces that aren't in the actual capture).
const DEFAULT_RENDER_PROMPT =
  'A real photograph of an existing finished interior — not a drawing, not a ' +
  'sketch, not a line diagram, not a blueprint, not a CAD render: a photo, shot ' +
  'on a camera, with real depth of field and soft photographic shadows. ' +
  'CRITICAL: do NOT change the geometry in any way. The exact shape, number, ' +
  'position, thickness, and outline of every structural column, wall, and the ' +
  'ceiling must stay EXACTLY as in the input image — trace them precisely, do ' +
  'not merge, split, remove, add, move, resize, straighten, or restyle any ' +
  'column, wall, or ceiling surface. The ceiling is a smooth, subtly faceted / ' +
  'folded surface broken into soft angular planes (not flat, not vaulted, not ' +
  'a fan-vault) — preserve that exact faceting. Every wall, window opening, ' +
  'door, the floor plan, and all furniture must stay in the exact same place ' +
  'and shape as the input — do not add, remove, or move any object. ONLY change ' +
  'surface materials, colour, and lighting — never form. There is exactly ONE ' +
  'glazed opening, a large irregular angled window with thin dark mullions. ' +
  'THE VIEW THROUGH THAT WINDOW IS NOT OPTIONAL AND NOT INVENTABLE: it must ' +
  'be EXACTLY a dense low-rise London residential street — ordinary brick and ' +
  'rendered terraced houses, pitched tile roofs, small chimney stacks with ' +
  'chimney pots, in muted brick-red, grey-slate, and weathered cream tones, ' +
  'under a soft pale sky, seen from a height of a few storeys looking ' +
  'slightly down and across the rooftops. ABSOLUTELY DO NOT show factories, ' +
  'industrial buildings, cranes, warehouses, cooling towers, pylons, bridges, ' +
  'a distant city skyline, mountains, water, or any landscape that is not an ' +
  'ordinary residential terraced street — if unsure what to put outside the ' +
  'glass, default to plain London rooftops and chimney pots, nothing else. ' +
  'Render that view ONLY inside the framed glazed opening. EVERY other ' +
  'surface is a SOLID plaster wall: keep all solid walls completely solid ' +
  'and opaque, do ' +
  'NOT cut, add, or imagine any window, arch, opening, recess, or hole in a ' +
  'solid wall. MATERIALS — read this carefully, it is the most important ' +
  'instruction: every wall and the ceiling are finished in ONE material ONLY ' +
  '— smooth, light off-white to warm sand-toned plaster with soft tonal ' +
  'variation, no visible texture beyond a faint trowel grain. NEVER exposed ' +
  'brick, NEVER bare concrete (except the floor), NEVER stone block, NEVER ' +
  'wallpaper, NEVER any material other than plaster on any wall or ceiling ' +
  'surface — if in doubt, render plaster. The floor is polished pale grey ' +
  'concrete, partly covered by a warm terracotta/rust woven jute area rug ' +
  'that is visibly DARKER and more saturated than the pale walls — the rug ' +
  'must read as a distinct rust-orange shape against the floor, never the ' +
  'same tone as the walls or floor. FURNITURE COLOUR CONTRAST IS MANDATORY — ' +
  'every piece of furniture must be a clearly different colour from the ' +
  'walls and from every other piece, with crisp visible edges between them, ' +
  'never the same pale tone as the plaster: the bed frame is SOLID DARK ' +
  'WALNUT BROWN wood (much darker than the walls) with bright WHITE linen ' +
  'bedding and pillows that read as pure white against the dark frame; the ' +
  'sofa is SOLID DARK CHARCOAL GREY/BLACK fabric, clearly darker than every ' +
  'wall and floor; the coffee table is SOLID DARK WALNUT wood; the potted ' +
  'plants have vivid SATURATED GREEN leaves and TERRACOTTA-ORANGE clay pots. ' +
  'Do not let any piece of furniture blend, fade, or merge into the wall, ' +
  'floor, or rug colour — each object must be instantly readable as a ' +
  'separate solid object with its own strong, distinct colour and a crisp ' +
  'silhouette, the way furniture looks in a real, well-lit interior photo, ' +
  'not washed out or colour-matched to the room. Keep every piece of ' +
  'furniture in its exact position and shape, only change its material and ' +
  'colour. Warm golden-hour sunlight streams in low through the glazed ' +
  'opening, raking across the plaster walls and furniture and casting long ' +
  'soft shadows, but the light never washes out or flattens the colour ' +
  'contrast between furniture and walls. Calm, minimal, sunlit, ' +
  'Scandinavian-loft mood. Ultra-photorealistic architectural interior ' +
  'photography, shot on a full-frame camera, warm golden-hour light, sharp ' +
  'focus, high detail, strong colour contrast between furniture and ' +
  'architecture, no people, no text, no watermark, no diagram labels, no ' +
  'measurement lines.';

// Warm GENDO-look prompt for Structure/img2img engines (which GENERATE light &
// colour from text, since they don't read the reference photo). Editable live.
const GENDO_WARM_PROMPT =
  'warm photorealistic interior photograph, golden hour sunlight streaming in, ' +
  'warm honey oak timber floor, smooth warm off-white lime plaster walls and ' +
  'faceted ceiling, a low oak platform bed with crisp white linen bedding, a ' +
  'dark charcoal grey fabric sofa, a terracotta-rust woven jute rug, green ' +
  'potted plants in terracotta pots, framed abstract paintings in dark wood ' +
  'frames hanging on the wall, soft natural shadows, cosy inhabited. ' +
  // SURREAL / FINE-ART MOOD — dreamlike stillness, painterly composition, in
  // the spirit of de Chirico / Magritte's uncanny empty interiors, layered
  // ON TOP of the photographic base rather than replacing it (keeps the
  // architecture/materials real, pushes only atmosphere/mood toward surreal).
  'dreamlike surreal atmosphere, uncanny stillness, fine-art photography mood, ' +
  'painterly quality of light, quiet and enigmatic, de Chirico and Magritte ' +
  'influence, long soft shadows, a sense of suspended time. ' +
  // BALCONY — real geometry now exists for this (a low parapet wall + a flat
  // black backdrop plane just past it, see BalconyDressing). Describe EXACTLY
  // that, sized correctly: a SMALL, NARROW balcony (about 3 feet / 1 metre
  // deep), NOT a deep terrace. The flat black surface behind the parapot is
  // the canvas for the skyline — paint the skyline directly ONTO that black
  // plane, not floating in empty space beyond it.
  'beyond the window is a SMALL, NARROW private balcony only about 3 feet ' +
  '(1 metre) deep, with a low solid parapet wall at waist height — NOT a deep ' +
  'terrace, NOT a large patio, just a slim ledge. Directly behind that narrow ' +
  'balcony, flush against the flat black backdrop surface, render a dense ' +
  'low-rise London residential street of ordinary Victorian brick terraced ' +
  'houses with pitched slate roofs and small chimney pots, muted brick-red ' +
  'and grey-slate tones, under a soft pale overcast sky — paint this skyline ' +
  'flat onto that backdrop plane like a backdrop mural, close behind the ' +
  'narrow balcony, NOT far away, NOT a deep view. NO skyscrapers, NO tower ' +
  'blocks, NO high-rise, NO modern glass towers — only ordinary low rooftops. ' +
  'architectural photography, full-frame camera, high detail, no people, no text.';
const GENDO_WARM_NEGATIVE =
  'cold lighting, blue lighting, grey, washed out, flat lighting, CGI, 3D render, ' +
  'clay render, untextured, warped geometry, melted architecture, melted column, ' +
  'distorted column, ' +
  'deep balcony, large terrace, wide patio, spacious balcony, ' +
  'skyscraper, skyscrapers, high-rise, tower block, glass tower, modern towers, ' +
  'tall buildings, distant skyline, ' +
  'people, text, watermark';

// Default negative prompt — editable in the Render Controls panel. Steers the
// model away from the geometry distortions we keep fighting.
const DEFAULT_NEGATIVE_PROMPT =
  'blueprint, line drawing, line art, sketch, pencil sketch, technical drawing, ' +
  'architectural diagram, CAD drawing, wireframe, schematic, measurement lines, ' +
  'dimension lines, annotations, labels, grid paper, monochrome line art, ' +
  'exposed brick, bare concrete walls, stone block walls, wallpaper, ' +
  'dark moody lighting, cold blue lighting, fan vault, ribbed vault, ' +
  'cathedral ceiling, gothic arches, ' +
  'monochrome room, single colour room, furniture same colour as walls, ' +
  'furniture blending into background, washed out colours, low contrast, ' +
  'flat lighting, faded colours, beige on beige, pale furniture on pale walls, ' +
  'factory, factories, industrial complex, industrial buildings, warehouse, ' +
  'crane, cooling tower, smokestack, power plant, refinery, pylon, bridge, ' +
  'distant city skyline, skyscrapers, mountains, ocean, lake, river, ' +
  'countryside, forest, desert landscape outside window, ' +
  'extra windows, extra openings, new window, window on a solid wall, ' +
  'arched opening in a wall, hole in the wall, false opening, ' +
  'distorted columns, extra columns, missing columns, warped geometry, ' +
  'melted architecture, blocked windows, empty bare room, no furniture, ' +
  'people, text, watermark, blurry, lowres, cartoon, illustration';

// "View Your Home" — captures one interior shot of the home, sends it to the
// local AI-render backend (Hugging Face FLUX img2img), and shows the photoreal
// result. The raw GLB room is a grey concrete shell, so the AI repaint is what
// turns it into a believable finished home. No interactive camera for the user.

export default function RoomHeroView({ typology, placedFurniture = [], onNext }) {
  const roomIdx = typology?.glb
    ? Math.max(0, ROOMS_META.findIndex(r => r.file === typology.glb))
    : 0;
  const room = ROOMS_META[roomIdx];

  // Only render the user's OWN placed furniture — no auto-staged default
  // layout. An empty room is rendered too (no furniture-first gate).
  const stagedFurniture = placedFurniture || [];

  const [sceneBox, setSceneBox] = useState(null);
  const [rawShot, setRawShot]   = useState(null);   // grey-shell interior screenshot
  const [aiImg, setAiImg]       = useState(null);   // photoreal AI result
  // 'placing' | 'capturing' | 'ai' | 'done' | 'error'
  // 'placing': the user sees the live 3D room and drags to position the
  // camera themselves (the auto-framing math is only a starting point) —
  // this replaced relying purely on auto-framing, which couldn't reliably
  // guess a good angle for every furniture layout.
  const [phase, setPhase]       = useState('placing');
  const [error, setError]       = useState(null);
  const startedRef = useRef(false);

  // The live "Camera view" thumbnail (PreviewThumbnail) mounts a SECOND full
  // WebGL scene — its own copy of the room GLB, furniture, environment PMREM
  // and lights. Mounting it at the same instant as the main dollhouse view
  // means decoding/compiling two full scenes at once, which is the ~4s stall
  // that froze the whole UI on entering this step. Two fixes, no lost feature:
  //   1) showThumb — a toggle so it can be turned off entirely (default on).
  //   2) thumbReady — defer mounting the heavy second scene until a beat AFTER
  //      the main scene is up, so the main view is interactive immediately and
  //      the thumbnail spins up in the background instead of blocking it.
  const [showThumb, setShowThumb] = useState(true);
  const [thumbReady, setThumbReady] = useState(false);
  useEffect(() => {
    if (phase !== 'placing') { setThumbReady(false); return; }
    const t = setTimeout(() => setThumbReady(true), 700);
    return () => clearTimeout(t);
  }, [phase]);

  // ── Manual render controls (the "Render Controls" panel) ──────────────────
  // These are set by the user before clicking AI Enhance, so the render is no
  // longer a black box: pick the engine, the reference photo, edit the prompt,
  // and set how hard geometry is locked.
  // Style Transfer is the default — it's the only engine that takes the
  // reference photo AS AN IMAGE (init_image + style_image), not just a text
  // description of it, and it DOES accept prompt/negative_prompt too (the
  // earlier assumption that it had no text input was wrong). Structure
  // (control/structure) locks geometry via a real extracted depth/edge
  // CONTROL MAP (control_strength) instead, and Ultra is a general img2img
  // model — both still available in Render Controls.
  // DEFAULT = Structure (control/structure). Diagnosed from debug renders:
  // Style Transfer preserves the grey capture's OWN cold lighting/colour and
  // will not adopt the reference photo's warm golden look no matter the slider
  // values — that's a hard limit of that endpoint. Structure locks the exact
  // geometry from the 3D capture (via a real extracted control map) and GENERATES
  // warm photographic light/materials from the prompt, which is the combo that
  // actually turns a grey capture into a warm reference-style room.
  const [engine, setEngine]       = useState('structure'); // style | structure | ultra | sd35 | sdxl | auto
  const [refImages, setRefImages] = useState([]);          // [{name, thumb}]
  const [refImage, setRefImage]   = useState(null);        // chosen filename
  // Two REAL, independent knobs (Stability's Style Transfer endpoint actually
  // exposes 3 params — composition_fidelity, change_strength, style_strength —
  // and they are NOT one "lock" axis; conflating them into a single slider is
  // what caused "95% locked" to still warp the room, because style_strength/
  // change_strength were hardcoded to 0.95 regardless of the slider, fighting
  // composition_fidelity on every render). Per Stability's own docs + reported
  // interior/architecture workflows: composition_fidelity and change_strength
  // are both "preserve structure" knobs (HIGH = preserve), while style_strength
  // is "how much of the reference photo's material/colour comes through"
  // (independent of geometry). So: Geometry Lock drives composition_fidelity
  // directly and change_strength inversely-capped into the reported safe
  // preserve-range (0.2-0.6, not 0.95); Material Strength drives style_strength
  // on its own, decoupled from geometry entirely.
  // Defaults tuned for FULL FREEDOM / reference-driven look: low geometry lock
  // (so the reference repaints hard) + high material strength (reference photo
  // dominates) + NO prompt (the reference image is the only style source).
  // For Structure the geometry is locked by the control map, so the lock slider
  // can sit high (geometry won't warp) while the PROMPT generates the warm look.
  const [lockStrength, setLockStrength] = useState(0.70);     // geometry-lock 0..1 (HIGH = preserve)
  const [materialStrength, setMaterialStrength] = useState(0.95); // reference material strength 0..1 (Style Transfer only)
  // Structure does NOT read the reference photo — the warm GENDO look has to be
  // described. This prompt is the look: warm golden light, oak, terracotta,
  // charcoal sofa, plaster, London rooftops. Editable live in Render Controls.
  const [promptText, setPromptText] = useState(GENDO_WARM_PROMPT);
  const [showControls, setShowControls] = useState(false);
  // Advanced render params (full control).
  const [negativePrompt, setNegativePrompt] = useState(GENDO_WARM_NEGATIVE);
  const [seed, setSeed]           = useState(0);      // 0 = random each render
  const [seedLocked, setSeedLocked] = useState(false);
  const [cfgScale, setCfgScale]   = useState(8.5);    // prompt adherence (SD3.5/SDXL)
  const [steps, setSteps]         = useState(40);     // quality/speed (SDXL)
  const [outputFormat, setOutputFormat] = useState('png');

  // ── RAW Stability params — TOTAL FREEDOM, no clamps, no mapping. Whatever is
  // set here is sent VERBATIM to the API. Each is null = "let the engine use the
  // geometry-lock fallback"; set a number to override that param directly.
  //   Style Transfer:  composition_fidelity (0..1), change_strength (0.1..1), style_strength (0..1)
  //   Structure:       control_strength (0..1)
  //   Ultra/SD3.5/SDXL: i2i_strength (0..1)  (LOW = preserve input)
  // Defaults dialed in from a real render: style_strength 1.0 + change 0.65 gave
  // the warm GENDO look but MELTED the column (too much freedom to ignore the
  // 3D geometry). These values keep the warmth while locking structure back in:
  //   composition_fidelity 0.90 (track input structure), change_strength 0.42
  //   (less reworking → column survives), style_strength 0.82 (strong warm
  //   transfer without "ignore the init image entirely").
  const [rawCompFidelity, setRawCompFidelity] = useState(0.87);
  const [rawChangeStrength, setRawChangeStrength] = useState(0.57);
  const [rawStyleStrength, setRawStyleStrength] = useState(0.75);
  const [rawControlStrength, setRawControlStrength] = useState(0.7);
  const [rawI2IStrength, setRawI2IStrength] = useState(0.4);

  // Load the available reference photos once (for the picker gallery).
  useEffect(() => {
    let alive = true;
    fetch('/api/ref-images')
      .then(r => r.json())
      .then(d => { if (alive && Array.isArray(d.images)) {
        setRefImages(d.images);
        if (d.images[0] && !refImage) setRefImage(d.images[0].name);
      }})
      .catch(() => {});
    return () => { alive = false; };
  }, []); // eslint-disable-line

  // The camera marker: TWO draggable points in room space — eye (where the
  // camera stands) and look (what it aims at). Dragging eye moves the
  // camera; dragging look re-aims it. This is what's shown in the dollhouse
  // view during 'placing', and is exactly what the small POV thumbnail
  // renders from. null until the auto-frame computes a starting position.
  const [cameraMarker, setCameraMarker] = useState(null);

  // Manual camera nudge — a ONE-SHOT delta applied to wherever the camera
  // currently is, then cleared (not cumulative from a fixed base). Since
  // freezeCamera keeps the camera at its last live position between
  // captures, a cumulative offset would compound incorrectly on every click;
  // a one-shot delta moves correctly regardless of how the base position
  // (auto-framed or manually placed) was set.
  // Manual camera nudge — now operates directly on cameraMarker's eye/look
  // (the single source of truth for where the shot is taken from), relative
  // to the marker's own current facing, so "forward"/"right"/"rotate" feel
  // natural regardless of how the marker got there (dollhouse placement or a
  // previous nudge).
  const NUDGE_STEP = 0.4;        // metres per click
  const ROTATE_STEP = Math.PI / 24; // ~7.5° per click
  const nudgeBy = useCallback((delta) => {
    setCameraMarker(m => {
      if (!m) return m;
      const eye = new THREE.Vector3(...m.eye);
      const look = new THREE.Vector3(...m.look);
      const forward = look.clone().sub(eye).normalize();
      const up = new THREE.Vector3(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(forward, up).normalize();
      const move = new THREE.Vector3()
        .addScaledVector(forward, delta.forward || 0)
        .addScaledVector(right, delta.right || 0)
        .addScaledVector(up, delta.up || 0);
      eye.add(move);
      look.add(move);
      if (delta.rotate) {
        look.sub(eye).applyAxisAngle(up, delta.rotate).add(eye);
      }
      return { eye: eye.toArray(), look: look.toArray() };
    });
    startedRef.current = false; // allow onCaptured to fire again for the new shot
    setAiImg(null);              // a moved shot invalidates any previous AI enhance
    setPhase('capturing');
  }, []);

  const safeName = (typology?.label || 'home').replace(/[^\w]+/g, '-').toLowerCase();

  // Send the captured interior screenshot to the AI backend, using whatever
  // the Render Controls panel currently has set (engine, reference photo,
  // prompt, geometry-lock). Nothing is hidden — what you pick is what's sent.
  const runAi = useCallback(async (shot) => {
    setPhase('ai');
    setError(null);
    // Close the Render Controls panel once a render is actually submitted —
    // its job (pick settings, hit render) is done. Previously it stayed open
    // through the whole AI call and reopened the instant 'done' remounted,
    // pushing the freshly-rendered image out of the visible area beneath the
    // (now pointless) settings panel — to anyone watching it looked like "I
    // can't see the image, only a download link," when the image was simply
    // off-screen below the still-open controls.
    setShowControls(false);
    try {
      const resp = await fetch('/api/ai-render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: shot,
          beds: typology?.beds ?? null,
          engine,                 // which Stability endpoint to use
          refImage,               // which reference photo (Style Transfer)
          prompt: promptText,     // the (editable) material/style prompt
          strength: lockStrength, // geometry-lock 0..1
          materialStrength,       // reference material strength 0..1 (Style Transfer only)
          opts: {
            negativePrompt,
            // If the seed is locked, send it; else 0 → backend randomises.
            seed: seedLocked ? seed : 0,
            cfgScale,
            steps,
            outputFormat,
            // RAW params — sent VERBATIM, no clamp/mapping server-side. The user
            // owns every Stability knob directly.
            raw: {
              composition_fidelity: rawCompFidelity,
              change_strength: rawChangeStrength,
              style_strength: rawStyleStrength,
              control_strength: rawControlStrength,
              i2i_strength: rawI2IStrength,
            },
          },
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `Request failed (${resp.status})`);
      setAiImg(data.image);
      setPhase('done');
    } catch (err) {
      setError(err?.message || String(err));
      setPhase('error');
    }
  }, [typology, engine, refImage, promptText, lockStrength, materialStrength, negativePrompt, seed, seedLocked, cfgScale, steps, outputFormat, rawCompFidelity, rawChangeStrength, rawStyleStrength, rawControlStrength, rawI2IStrength]);

  // The textured 3D capture (real PBR materials + directional sunlight,
  // rendered in OUR scene) is the primary, reliable, free result — it's
  // guaranteed to match the actual room exactly. AI enhancement is now an
  // explicit opt-in action (the "✦ AI Enhance" button below), not automatic,
  // since it costs real money per attempt and can hallucinate a different
  // room entirely. window.__skipAi has no effect anymore — that was only
  // needed to bypass the old auto-AI default.
  const onCaptured = useCallback((shot) => {
    if (startedRef.current) return;
    startedRef.current = true;
    setRawShot(shot);
    setPhase('done');
  }, []);

  // User clicked "Capture this view" while in 'placing' — take the shot from
  // wherever cameraMarker currently sits.
  const captureFromHere = useCallback(() => {
    startedRef.current = false;
    setPhase('capturing');
  }, []);

  // Go back to live placement to try a different angle (from the 'done' or
  // 'error' screen, or to redo after AI Enhance). cameraMarker is left as-is
  // so the dollhouse view reopens exactly where the user left it.
  const backToPlacing = useCallback(() => {
    startedRef.current = false;
    setAiImg(null);
    setRawShot(null);
    setPhase('placing');
  }, []);

  const retry = useCallback(() => { if (rawShot) runAi(rawShot); }, [rawShot, runAi]);

  const displayImg = aiImg || rawShot;
  const orbitRef = useRef(null);

  // The god-rays "sun" reference mesh — GodRays needs an actual rendered Mesh
  // instance to use as the light-shaft origin, so we mount an invisible disc
  // (see SunDisc below) and capture it here once React attaches the ref. A
  // plain useState (not useRef) so CinematicFX re-renders with the real mesh
  // as soon as it exists — mirrors the sceneBox/ColumnEdgeBoost mount pattern
  // already used in this file.
  const [sunMesh, setSunMesh] = useState(null);

  return (
    <div className="rhv-root">
      {/* Render stage — visible + draggable while placing the camera; hidden
          (but still rendering, so the capture below works) at all other times. */}
      <div className={`rhv-stage ${phase === 'placing' ? 'rhv-stage--live' : ''}`}>
        <Canvas
          className="rhv-canvas"
          // VSMShadowMap (not the boolean default, which silently resolves to
          // the hard-edged PCFShadowMap in current three.js) — this is what
          // makes shadow-radius actually do something, giving the soft,
          // large-area-light-style shadow penumbra real archviz renders have
          // instead of a harsh, aliased CG edge under furniture. Shadows ARE
          // on during placing now too (just the directional key light's
          // shadow map — cheap) so the dollhouse view doesn't look like a
          // flat, shadowless grey CG shell while you're choosing the angle;
          // only the much heavier AO/bloom/godrays composer stays off during
          // active dragging (see the CinematicFX gate below).
          shadows={{ type: THREE.VSMShadowMap }}
          camera={{ fov: 60, near: 0.05, far: 4000, position: [4, 1.6, 4] }}
          gl={{
            antialias: true,
            powerPreference: 'high-performance',
            toneMapping: THREE.ACESFilmicToneMapping,
            // Hotter exposure for the captured hero frame — reads as bright
            // sunlit daylight interior (archviz look) rather than a dim CG shell.
            toneMappingExposure: phase === 'placing' ? 1.05 : 1.28,
            outputColorSpace: THREE.SRGBColorSpace,
            preserveDrawingBuffer: true,
          }}
          dpr={Math.min(window.devicePixelRatio, 2)}
          frameloop="demand"
        >
          <color attach="background" args={['#0a0a0c']} />
          {/* Image-based lighting. For the captured hero frame we push the IBL
              harder so the real PBR materials (polished concrete, plaster,
              wood, glass) actually show their reflections/sheen — the single
              biggest "archviz vs grey shell" lever short of a full HDRI. */}
          <RoomEnv intensity={phase === 'placing' ? 0.75 : 1.05} hdriUrl={EXTERIOR_HDRI_URL} />
          {/* Real directional "sun" through the windows — this is what a pure
              IBL can't give: crisp directional shadows under columns/furniture
              and a clear light/shade read on the vault, which is what makes a
              CG shell start to look like an actually-lit room. */}
          <directionalLight
            position={[6, 8, 4]}
            // Stronger, warmer key sun for the captured frame — golden-hour
            // intensity + a warmer colour so the capture reads as a sunlit
            // interior (archviz) rather than a flat grey CG shell. This warmth
            // also carries into the AI render as the base light direction/colour.
            intensity={phase === 'placing' ? 2.4 : 4.2}
            color={phase === 'placing' ? '#fff1d8' : '#ffe1ad'}
            castShadow
            // Full-res shadow map for the capture (4096 — sharper, more defined
            // contact shadows under the bed/columns that sell it as real), cheap
            // 512 while dragging so placement stays smooth.
            shadow-mapSize={phase === 'placing' ? [512, 512] : [4096, 4096]}
            shadow-bias={-0.0004}
            shadow-normalBias={0.02}
            // The default Three.js shadow-camera frustum is only ±5 units —
            // this room spans roughly ±6.4m × ±4.5m, so without an explicit
            // frustum the shadow camera clips the room edges and furniture
            // placed there casts NO shadow at all (or a low-res, clipped one).
            // That's exactly why beds/nightstands looked flat and "not
            // properly captured" — they were sitting outside the default
            // shadow frustum. Sized to comfortably cover the whole footprint.
            shadow-camera-left={-9}
            shadow-camera-right={9}
            shadow-camera-top={9}
            shadow-camera-bottom={-9}
            shadow-camera-near={0.5}
            shadow-camera-far={24}
            // Tighter penumbra for the capture (1.4 vs 2.5) — crisper, more
            // grounded contact shadows that read as real sunlight rather than a
            // washed-out soft blob; still soft enough to look natural.
            shadow-radius={phase === 'placing' ? 2.5 : 1.4}
          />
          {/* Soft warm BOUNCE fill from below/front for the captured frame —
              mimics light bouncing off the pale floor back up onto the vault,
              softening the shadow side so it reads as a real interior with
              global-illumination-like fill, not a harsh single-light CG render.
              IMPORTANT: this light casts NO shadow, so turning it up actually
              WASHES OUT ground-contact shadows right around furniture (it
              floods the floor near the legs with unshadowed light, fighting
              the very shadow that grounds the piece) — kept modest, AO does
              the contact-shadow work instead. */}
          {phase !== 'placing' && (
            <directionalLight position={[0, 1.0, 5]} intensity={0.45} color="#ffe8cf" castShadow={false} />
          )}
          {/* Rim/edge light from a grazing, roughly opposite angle — this is
              what actually makes column edges/curvature readable as real
              geometry in the FLAT capture sent to Stability. A single key
              light + soft AO leaves column-to-column boundaries as a
              near-uniform grey gradient with no hard edge cue, which is why
              the AI model was reinterpreting/losing the column shapes — it
              had no strong visual signal that an edge was even there. A
              cool, low-angle rim light catches a bright highlight line right
              along each edge/curve, the same trick real architectural
              photography uses for the same reason. */}
          <directionalLight
            position={[-5, 1.6, -6]}
            intensity={phase === 'placing' ? 1.1 : 0.7}
            // Cool rim while placing (reads column edges for the AI); for the
            // captured frame, warm it down so it accents edges without fighting
            // the golden key light and turning the shadow side cold/blue.
            color={phase === 'placing' ? '#bcd6ff' : '#e8dcff'}
            castShadow={false}
          />
          {/* Warm ambient for the capture (golden-hour fill) vs cool while
              placing. A warm, slightly stronger ambient fills the shadow side
              with bounce-light colour instead of leaving it dead grey. */}
          <ambientLight
            intensity={phase === 'placing' ? 0.18 : 0.24}
            color={phase === 'placing' ? '#dbe6f0' : '#ffedd2'}
          />

          {/* Invisible bright disc at the key light's position — GodRays uses
              this as the light-shaft origin. Occluded by the room geometry
              from inside (as a real sun would be), so the shafts only appear
              where the window opening actually lets light through. */}
          {phase !== 'placing' && (
            <SunDisc position={[6, 8, 4]} onReady={setSunMesh} />
          )}

          <React.Suspense fallback={null}>
            <BaseRoom
              key={room.file}
              file={room.file}
              pigmentHex="#f0ece6"
              hiddenLayers={EMPTY_LAYER_SET}
              onReady={setSceneBox}
              onLayers={() => {}}
            />
            {stagedFurniture.map(p => (
              <FurniturePiece3D key={p.uid} piece={p} sceneBox={sceneBox} readOnly />
            ))}
            <ColumnEdgeBoost ready={!!sceneBox} roomBox={sceneBox} />
            <WallArt ready={!!sceneBox} roomBox={sceneBox} />
            <BalconyDressing ready={!!sceneBox} roomBox={sceneBox} />
          </React.Suspense>

          <React.Suspense fallback={null}>
            <FurnTextureApplier pieces={stagedFurniture} />
          </React.Suspense>

          {/* Postprocessing (AO + bloom + SMAA) is the heaviest per-frame cost
              in this scene, and OrbitControls fires invalidate() on every
              drag pixel under frameloop="demand" — re-running the full
              composer at mouse-move frequency is what made placement feel
              laggy. Skip it ENTIRELY while live-placing (the live preview is
              a small thumbnail anyway, full quality isn't visible there);
              it only matters for the actual captured frame. */}
          {phase !== 'placing' && sunMesh && (
            <CinematicFX
              aoQuality="ultra"
              aoHalfRes={false}
              // A wide AO radius (1.3) tuned for room-scale columns barely
              // registers on furniture-scale objects (a 0.5m-tall nightstand)
              // — the sample radius is bigger than the thing it should be
              // darkening under. Tightened so small furniture gets a crisp
              // contact shadow instead of reading as flat/floating.
              // Stronger AO = deeper contact shadows in crevices/corners and
              // under furniture → much more material depth and "grounded" realism.
              aoIntensity={3.6}
              aoRadius={0.6}
              // A touch more bloom so the bright window light blooms naturally
              // like a real sunlit interior photo.
              bloomIntensity={0.42}
              vignette={0.32}
              sun={sunMesh}
            />
          )}

          {phase === 'placing' ? (
            <PlacementRig
              box={sceneBox}
              furniture={stagedFurniture}
              preset={CAMERA_BY_ROOM[room.id]}
              orbitRef={orbitRef}
              cameraMarker={cameraMarker}
              setCameraMarker={setCameraMarker}
            />
          ) : (
            <InteriorCaptureRig
              box={sceneBox}
              furniture={stagedFurniture}
              preset={CAMERA_BY_ROOM[room.id]}
              cameraMarker={cameraMarker}
              onCaptured={onCaptured}
            />
          )}
        </Canvas>
      </div>

      {phase === 'placing' && (
        <>
          {/* Deferred + toggleable: the second full scene only mounts once the
              main view is up (thumbReady) and only if the user wants it. This
              is what removes the double-scene stall on entering this step. */}
          {showThumb && thumbReady && (
            <PreviewThumbnail room={room} furniture={stagedFurniture} cameraMarker={cameraMarker} />
          )}
          <div className="rhv-place-overlay">
            <div className="rhv-place-hint">
              The blue glowing cone shows what the camera sees · drag the gumball arrows to move, drag its rings to rotate · drag empty space to orbit
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button
                className="rhv-place-btn"
                onClick={() => setShowThumb(s => !s)}
                style={{
                  background: 'none', border: '1px solid rgba(255,255,255,0.25)',
                  color: 'rgba(240,236,226,0.7)', fontFamily: 'var(--mono, monospace)',
                  fontSize: '0.68rem', padding: '0.5rem 0.8rem', cursor: 'pointer',
                  letterSpacing: '0.05em',
                }}
                title="The live camera-view preview mounts a second 3D scene. Turn it off for maximum performance."
              >
                {showThumb ? 'Hide camera preview' : 'Show camera preview'}
              </button>
              <button className="rhv-next-btn rhv-place-btn" onClick={captureFromHere}>
                Capture this view
              </button>
            </div>
          </div>
        </>
      )}

      <div className="rhv-eyebrow">
        <span className="rhv-eyebrow-label">Your Home</span>
        <span className="rhv-eyebrow-unit">{typology?.label || room.label}</span>
      </div>

      {/* Result overlay — all the user sees, except during live placement
          where it's empty; pointer-events disabled then so it doesn't sit
          on top of the draggable 3D stage and block OrbitControls. */}
      <div className={`rhv-shot-overlay ${phase === 'placing' ? 'rhv-shot-overlay--inert' : ''}`}>

        {(phase === 'capturing' || phase === 'ai') && (
          <div className="rhv-shot-loading">
            <div className="rhv-ai-spinner" />
            <div className="rhv-shot-loading-label">
              {phase === 'capturing' ? 'Preparing your home…' : 'Rendering your home…'}
            </div>
            {phase === 'ai' && (
              <div className="rhv-shot-loading-sub">First render can take 20–60s on the free tier.</div>
            )}
          </div>
        )}

        {phase === 'done' && displayImg && (
          <>
            <div className="rhv-shot-main">
              <img className="rhv-shot-img" src={displayImg} alt="Render of your home" />
            </div>
            <div className="rhv-shot-actions">
              <a className="rhv-render-btn" href={displayImg} download={`${safeName}-render.png`}>↓ Download Image</a>
              <button className="rhv-ai-enhance-btn" onClick={() => runAi(rawShot)}>
                {aiImg ? '✦ Re-Enhance' : '✦ AI Enhance (optional)'}
              </button>
              <button
                className={`rhv-render-btn ${showControls ? 'rhv-render-btn--active' : ''}`}
                onClick={() => setShowControls(s => !s)}
              >
                ⚙ Render Controls
              </button>
              {aiImg && (
                <button className="rhv-render-btn" onClick={() => setAiImg(null)}>
                  ↺ Reset to 3D capture
                </button>
              )}
              <button className="rhv-render-btn" onClick={backToPlacing}>
                ⤺ Reposition camera
              </button>
              {onNext && (
                <button className="rhv-next-btn rhv-next-btn--inline" onClick={onNext}>
                  Continue
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                    <path d="M2.5 6.5h8M8 3.5l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              )}
            </div>

            {showControls && (
              <RenderControls
                engine={engine} setEngine={setEngine}
                refImages={refImages} refImage={refImage} setRefImage={setRefImage}
                lockStrength={lockStrength} setLockStrength={setLockStrength}
                materialStrength={materialStrength} setMaterialStrength={setMaterialStrength}
                promptText={promptText} setPromptText={setPromptText}
                negativePrompt={negativePrompt} setNegativePrompt={setNegativePrompt}
                seed={seed} setSeed={setSeed}
                seedLocked={seedLocked} setSeedLocked={setSeedLocked}
                cfgScale={cfgScale} setCfgScale={setCfgScale}
                steps={steps} setSteps={setSteps}
                outputFormat={outputFormat} setOutputFormat={setOutputFormat}
                rawCompFidelity={rawCompFidelity} setRawCompFidelity={setRawCompFidelity}
                rawChangeStrength={rawChangeStrength} setRawChangeStrength={setRawChangeStrength}
                rawStyleStrength={rawStyleStrength} setRawStyleStrength={setRawStyleStrength}
                rawControlStrength={rawControlStrength} setRawControlStrength={setRawControlStrength}
                rawI2IStrength={rawI2IStrength} setRawI2IStrength={setRawI2IStrength}
                onRender={() => runAi(rawShot)}
              />
            )}

            {/* Camera nudge — re-frames the shot relative to its current
                position/facing. Each click re-captures instantly (free, no AI
                cost); AI Enhance must be re-run manually after moving. */}
            <div className="rhv-cam-controls">
              <span className="rhv-cam-label">Camera</span>
              <button className="rhv-cam-btn" title="Forward" onClick={() => nudgeBy({ forward: NUDGE_STEP })}>↑</button>
              <button className="rhv-cam-btn" title="Back" onClick={() => nudgeBy({ forward: -NUDGE_STEP })}>↓</button>
              <button className="rhv-cam-btn" title="Left" onClick={() => nudgeBy({ right: -NUDGE_STEP })}>←</button>
              <button className="rhv-cam-btn" title="Right" onClick={() => nudgeBy({ right: NUDGE_STEP })}>→</button>
              <button className="rhv-cam-btn" title="Up" onClick={() => nudgeBy({ up: NUDGE_STEP })}>⤒</button>
              <button className="rhv-cam-btn" title="Down" onClick={() => nudgeBy({ up: -NUDGE_STEP })}>⤓</button>
              <button className="rhv-cam-btn" title="Rotate left" onClick={() => nudgeBy({ rotate: ROTATE_STEP })}>↺</button>
              <button className="rhv-cam-btn" title="Rotate right" onClick={() => nudgeBy({ rotate: -ROTATE_STEP })}>↻</button>
            </div>
          </>
        )}

        {phase === 'error' && (
          <div className="rhv-shot-error">
            <div className="rhv-shot-error-title">Couldn’t render your home yet</div>
            <div className="rhv-shot-error-msg">{error}</div>
            {/* Show the raw screenshot so the screen isn't empty meanwhile. */}
            {rawShot && <img className="rhv-shot-img rhv-shot-img--raw" src={rawShot} alt="Preview" />}
            <div className="rhv-shot-actions">
              <button className="rhv-render-btn" onClick={retry}>Try again</button>
              {onNext && <button className="rhv-next-btn rhv-next-btn--inline" onClick={onNext}>Skip →</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Interior capture rig ──────────────────────────────────────────────
// The ROOM*.glb files are a whole flat (bedroom + living room + balcony in
// one mesh, no per-room tags) — there's no metadata saying "this is the
// bedroom." Centring the camera on the WHOLE footprint's bounding box (the
// old approach) lands it straddling walls or in a corridor, which is why
// renders showed the building exterior instead of a room interior.
//
// Fix: sample candidate eye-height points across the footprint and, for each,
// cast rays in 8 horizontal directions against the real wall/column/door
// meshes. A point genuinely inside an enclosed room hits a nearby wall in
// most directions (a few metres away); a point in open space, a void, or
// outside the building escapes to the edge of the whole bounding box instead.
// Pick whichever sampled point is most "enclosed", then look toward the
// direction with the most open room to see into.
// Downscale a source canvas to a FIXED 1024×576 (exact 16:9, both dimensions
// multiples of 64) and return a JPEG data URL.
//
// Why fixed, not "scale to a max edge": diffusion models (incl. Stability's
// SD3.5) require width/height divisible by 64 internally. The capture stage
// is already locked to 1280×720, but the old "scale longest edge to 768"
// logic produced 768×432 — 432 is NOT a multiple of 64 (432/64 = 6.75).
// Stability's img2img endpoint silently fell back to a different (portrait)
// canvas for non-conforming inputs instead of erroring, which is what
// produced the wrong-aspect-ratio renders. 1024×576 is exact 16:9 AND a
// clean 64-multiple on both axes, within SD3.5's supported 640-1536px range.
function downscaleCanvas(srcCanvas, targetW = 1024, targetH = 576) {
  const out = document.createElement('canvas');
  out.width = targetW; out.height = targetH;
  const ctx = out.getContext('2d');
  ctx.drawImage(srcCanvas, 0, 0, targetW, targetH);
  // JPEG at 0.85 — much smaller than PNG, and img2img doesn't need lossless.
  return out.toDataURL('image/jpeg', 0.85);
}

// Mounted only while phase === 'placing'. The MAIN view here is a pulled-
// back dollhouse orbit of the whole room (not first-person) — drag-orbiting
// this is cheap (just the main camera moving, no marker geometry changes),
// which is what actually fixes the lag: the old first-person mode re-ran
// camera math + the full postprocessing stack on every drag pixel of the
// SAME view the user was staring at, so any hitch was maximally visible.
// Two draggable markers — eye (camera position) and look (aim point) — sit
// in the scene; dragging them is what positions the actual render camera,
// fed live into a small POV thumbnail (see PreviewThumbnail below).
function PlacementRig({ box, furniture = [], preset = null, orbitRef, cameraMarker, setCameraMarker }) {
  const { camera, scene, gl, invalidate, setDpr } = useThree();
  const initedRef = useRef(false);

  // Cutaway: this room's roof and floor are a single fused 'slab' mesh (no
  // separate hideable "roof" layer for every room, confirmed by dumping the
  // real GLB layer names) — toggling layer visibility can't isolate just the
  // roof. A world-space clipping plane slices away everything above ~2.1m
  // (just above standing-eye height, below the vault peak) so the pulled-
  // back dollhouse view can actually see the floor/furniture/markers inside,
  // without needing per-room mesh-naming assumptions.
  useEffect(() => {
    if (!box) return;
    const cutY = box.min.y + 2.1;
    const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), cutY);
    gl.localClippingEnabled = true;
    const materials = [];
    scene.traverse(n => {
      if (n.isMesh && n.material) {
        const mats = Array.isArray(n.material) ? n.material : [n.material];
        for (const m of mats) { m.clippingPlanes = [plane]; materials.push(m); }
      }
    });
    invalidate();
    return () => {
      for (const m of materials) m.clippingPlanes = [];
      gl.localClippingEnabled = false;
      invalidate();
    };
  }, [box, scene, gl, invalidate]);

  // Compute a sensible STARTING eye/look only if no marker exists yet — this
  // rig unmounts/remounts every time phase leaves and re-enters 'placing'
  // (via "Reposition camera"), and re-running the auto-frame on every
  // remount would silently overwrite wherever the user had already dragged
  // the marker to. Always re-frame the dollhouse orbit camera itself though,
  // since that's just a default viewing angle, not the user's placed shot.
  useEffect(() => {
    if (!box || initedRef.current) return;
    initedRef.current = true;
    if (!cameraMarker) {
      const { eyePoint, target } = computeAutoCamera(box, scene, furniture, preset);
      setCameraMarker({ eye: eyePoint.toArray(), look: target.toArray() });
    }

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.z) * 1.6;
    camera.fov = 50;
    camera.near = 0.05;
    camera.far = Math.max(size.x, size.y, size.z) * 12;
    camera.position.set(center.x + maxDim * 0.7, maxDim * 0.85, center.z + maxDim * 0.7);
    camera.up.set(0, 1, 0);
    camera.lookAt(center.x, box.min.y, center.z);
    camera.updateProjectionMatrix();
    if (orbitRef.current) { orbitRef.current.target.set(center.x, box.min.y, center.z); orbitRef.current.update(); }
    invalidate();
  }, [box, scene, furniture, preset, camera, orbitRef, invalidate, setCameraMarker]);

  // Same adaptive-DPR trick as before, but now it actually matters less —
  // the dollhouse orbit itself is cheap. Kept as extra headroom on lower-end
  // GPUs since the full room + furniture is still being rendered.
  const fullDpr = Math.min(window.devicePixelRatio, 2);
  const onStart = useCallback(() => setDpr(1), [setDpr]);
  const onEnd   = useCallback(() => { setDpr(fullDpr); invalidate(); }, [setDpr, fullDpr, invalidate]);

  return (
    <>
      <OrbitControls
        ref={orbitRef}
        makeDefault
        enablePan
        enableDamping={false}
        panSpeed={0.6}
        rotateSpeed={0.5}
        zoomSpeed={0.7}
        minDistance={1}
        maxDistance={60}
        onStart={onStart}
        onEnd={onEnd}
      />
      {cameraMarker && (
        <CameraMarkerGizmo
          cameraMarker={cameraMarker}
          setCameraMarker={setCameraMarker}
          invalidate={invalidate}
        />
      )}
    </>
  );
}

// The camera marker is ONE object — a rig sitting at "eye" with a real 3D
// orientation. ONE combined gumball: both the move arrows (TransformControls
// "translate") AND the rotate rings ("rotate") are mounted on the SAME rig
// at the SAME time, so it looks and behaves like a single Blender/Maya-style
// gumball — drag an arrow to move, drag a ring to spin, no mode switching.
// "look" is derived from the rig's forward vector whenever either control
// moves it; the blue dot + line are just a visual facing readout.
function CameraMarkerGizmo({ cameraMarker, setCameraMarker, invalidate }) {
  const rigRef = useRef(null);
  const initedRef = useRef(null); // tracks the marker reference we last synced FROM
  const { controls } = useThree(); // the default OrbitControls, via makeDefault
  // rigRef.current is only non-null AFTER the <group> below has mounted —
  // reading it in the SAME render pass that attaches it is too early (refs
  // don't trigger a re-render on their own), so without this the
  // TransformControls below would never actually appear. This state flips
  // once, forcing the one extra render needed to see the now-attached ref.
  const [rigMounted, setRigMounted] = useState(false);

  // Sync the rig's transform from cameraMarker whenever it changes for a
  // reason OTHER than this gizmo's own drag (e.g. reset, nudge buttons,
  // initial auto-frame) — guarded so we don't fight the live drag.
  useEffect(() => {
    if (!rigRef.current || initedRef.current === cameraMarker) return;
    initedRef.current = cameraMarker;
    const eye = new THREE.Vector3(...cameraMarker.eye);
    const look = new THREE.Vector3(...cameraMarker.look);
    rigRef.current.position.copy(eye);
    rigRef.current.lookAt(look);
  }, [cameraMarker]);

  const onDragStart = useCallback(() => { if (controls) controls.enabled = false; }, [controls]);
  const onDragEnd = useCallback(() => {
    if (controls) controls.enabled = true;
    if (rigRef.current) {
      const forward = new THREE.Vector3();
      rigRef.current.getWorldDirection(forward);
      const eye = rigRef.current.position.clone();
      const look = eye.clone().addScaledVector(forward, 1.5);
      const next = { eye: eye.toArray(), look: look.toArray() };
      initedRef.current = next; // this update IS the gizmo's own — don't re-sync from it
      setCameraMarker(next);
    }
    invalidate();
  }, [controls, setCameraMarker, invalidate]);

  return (
    <>
      {/* The rig group: everything inside is in the camera's LOCAL space and
          points down its forward (-Z) axis, so the frustum + facing arrow
          inherit the rig's live position/rotation automatically while you drag
          — no per-frame syncing needed. This is what makes "which way is it
          facing" instantly readable: you see the actual cone of view. */}
      <group ref={(n) => { rigRef.current = n; if (n && !rigMounted) setRigMounted(true); }}>
        {/* Small camera body at the apex (where the lens is). */}
        <mesh>
          <boxGeometry args={[0.34, 0.24, 0.22]} />
          <meshBasicMaterial color="#ffd166" />
        </mesh>
        {/* The lens, pointing forward (-Z). */}
        <mesh position={[0, 0, -0.16]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.09, 0.12, 0.12, 16]} />
          <meshBasicMaterial color="#1c1c1c" />
        </mesh>
        <CameraFrustum fov={60} aspect={16 / 9} dist={3.2} />
      </group>
      <CameraMarkerLink eye={cameraMarker.eye} look={cameraMarker.look} />
      {rigMounted && (
        <>
          <TransformControls
            object={rigRef.current}
            mode="translate"
            size={0.85}
            onMouseDown={onDragStart}
            onMouseUp={onDragEnd}
          />
          <TransformControls
            object={rigRef.current}
            mode="rotate"
            size={0.85}
            onMouseDown={onDragStart}
            onMouseUp={onDragEnd}
          />
        </>
      )}
    </>
  );
}

// Draws the camera's actual VIEW FRUSTUM in the rig's local space: a wireframe
// pyramid projecting forward (-Z) plus a translucent far plane, so you can see
// exactly what the camera sees and which way it points. A bold centre arrow
// reinforces the facing direction. All geometry is local to the rig group, so
// it tracks the camera marker live as you move/rotate the gumball.
function CameraFrustum({ fov = 60, aspect = 16 / 9, dist = 3.2 }) {
  const { lineGeom, planeArgs, planePos } = useMemo(() => {
    const hh = Math.tan((fov * Math.PI / 180) / 2) * dist; // half-height at dist
    const hw = hh * aspect;                                 // half-width at dist
    const z = -dist; // forward is -Z
    // Four far-plane corners + apex at origin.
    const apex = new THREE.Vector3(0, 0, 0);
    const tl = new THREE.Vector3(-hw,  hh, z);
    const tr = new THREE.Vector3( hw,  hh, z);
    const br = new THREE.Vector3( hw, -hh, z);
    const bl = new THREE.Vector3(-hw, -hh, z);
    const pts = [
      apex, tl,  apex, tr,  apex, br,  apex, bl,   // apex → 4 corners
      tl, tr,  tr, br,  br, bl,  bl, tl,           // far rectangle
    ];
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    return { lineGeom: g, planeArgs: [hw * 2, hh * 2], planePos: [0, 0, z] };
  }, [fov, aspect, dist]);

  return (
    <>
      {/* Frustum edges — bright so they read over the busy wireframe scene. */}
      <lineSegments geometry={lineGeom} renderOrder={3}>
        <lineBasicMaterial color="#ffd166" transparent opacity={0.95} depthTest={false} />
      </lineSegments>
      {/* Translucent "what the camera sees" far plane — the filled rectangle
          makes the viewing direction unmistakable at a glance. */}
      <mesh position={planePos} renderOrder={2}>
        <planeGeometry args={planeArgs} />
        <meshBasicMaterial color="#7dd3fc" transparent opacity={0.28} side={THREE.DoubleSide} depthWrite={false} depthTest={false} />
      </mesh>
      {/* Bold centre facing arrow down -Z. */}
      <mesh position={[0, 0, -dist * 0.55]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={4}>
        <cylinderGeometry args={[0.03, 0.03, dist * 0.7, 8]} />
        <meshBasicMaterial color="#ff5d5d" depthTest={false} />
      </mesh>
      <mesh position={[0, 0, -dist * 0.95]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={4}>
        <coneGeometry args={[0.1, 0.26, 12]} />
        <meshBasicMaterial color="#ff5d5d" depthTest={false} />
      </mesh>
    </>
  );
}

function CameraMarkerLink({ eye, look }) {
  const points = useMemo(() => [new THREE.Vector3(...eye), new THREE.Vector3(...look)], [eye, look]);
  const geom = useMemo(() => new THREE.BufferGeometry().setFromPoints(points), [points]);
  return (
    <line geometry={geom}>
      <lineBasicMaterial color="#ffd166" transparent opacity={0.6} />
    </line>
  );
}

// Renders the COLUMNS as flat untextured white with crisp DARK EDGE LINES so
// the captured image hands Stability hard, unambiguous geometry (clean shapes
// + outlined edges) instead of a noisy speckled aggregate-concrete blob the AI
// had to guess at. Applied ONLY to this view's meshes (never the shared
// singleton mats — Configure stays untouched):
//   1. Real textured PBR materials (diff/normal/rough/AO), pushed harder than
//      the Configure defaults — stronger normal scale + AO so surfaces read
//      as genuinely lit, photoreal stone/plaster rather than a flat CG shell.
//   2. STILL overlay a THREE.LineSegments built from EdgesGeometry on every
//      column mesh, in near-black — this is what actually fixed the AI losing
//      column geometry (a clear edge cue), and it works just as well drawn on
//      top of a textured surface as on a flat one, so we keep it.
// The line overlay is parented to each mesh, so it inherits the mesh's world
// transform automatically and stays glued to the geometry.
const _COL_REAL_MAT = makeColumnMat();
_COL_REAL_MAT.normalScale.set(0.85, 0.85);
_COL_REAL_MAT.aoMapIntensity = 1.0;
_COL_REAL_MAT.envMapIntensity = 0.5;
// Plain LineBasicMaterial — deliberately NOT the fat-line (LineSegments2)
// version: that's a Mesh subclass that gets swept into raycast traversal and
// caused a scene-graph corruption / stack overflow (see ColumnEdgeBoost).
// LineSegments (built on this material) has no raycast() method at all, so
// it's naturally invisible to Raycaster.intersectObjects — safe by construction.
// Pushed darker + fully opaque (was #1c1c1c @ 0.75) for a stronger edge cue.
const _COL_EDGE_MAT = new THREE.LineBasicMaterial({ color: '#666666', linewidth: 0.5, transparent: true, opacity: 0.4 });
// "Halo" copy — a second pass of the SAME edge geometry drawn very slightly
// scaled-up and BEHIND the real line, so it peeks out a fraction on every
// side and visually thickens the apparent stroke (a 2D-vector-art outline
// trick). Same colour/darkness as the main line, just lower renderOrder so
// it never overdraws the crisp foreground line.
const _COL_EDGE_HALO_MAT = new THREE.LineBasicMaterial({ color: '#000000', transparent: false, opacity: 1.0 });
// Deliberately NO exterior view — WindowSkylineBackdrop was removed (nothing
// should render past the glass: no skyline, no invented exterior, just the
// window opening itself). The blue tint that used to read against that
// backdrop is gone too — with nothing behind it now, the glass shows the
// scene's own near-black background (#0a0a0c) through it, which reads as a
// clean dark window rather than a blue-tinted void. Kept genuinely
// transparent/glassy (not opaque black) so the AI still reads it as GLASS,
// not a solid wall — just with nothing visible beyond it.
const _WIN_GLASS_MAT = new THREE.MeshPhysicalMaterial({
  color: '#1a1d20', roughness: 0.05, metalness: 0.0,
  reflectivity: 0.08, clearcoat: 0.0,
  transparent: true, opacity: 0.22, envMapIntensity: 0.2,
  side: THREE.DoubleSide, depthWrite: false,
});
// Real textured plaster for WALLS in the capture (was flat-color before).
// Phantom windows happened because the AI read dark/recessed/noisy wall
// areas as openings — that's solved by keeping walls evenly, brightly lit
// (lighting fix, not material fix), so the wall material itself can now be
// the same real plaster as the rest of the room.
const _WALL_REAL_MAT = makePlasterMat();
_WALL_REAL_MAT.normalScale.set(0.7, 0.7);
_WALL_REAL_MAT.envMapIntensity = 0.4;
// A bold dark FRAME drawn around the real window meshes' outline — this is the
// unambiguous "the ONLY real opening is HERE" signal, so the AI keeps glass
// where the frame is and treats every other wall as solid.
const _WIN_FRAME_MAT = new THREE.LineBasicMaterial({ color: '#222', transparent: true, opacity: 0.95 });
const WALL_KEYS = ['internal wall', 'external wall', 'wall', 'default'];

// Bright unlit disc standing in for the sun, at the same position as the key
// directional light. GodRays reads this mesh's screen-space position (and
// whether the room's own geometry occludes it) to know where to cast shafts
// from — so light only streaks across the room where a real opening (the
// window) lets the disc show through, exactly like a real sun shaft.
const _SUN_MAT = new THREE.MeshBasicMaterial({ color: '#fff6e0', toneMapped: false });
function SunDisc({ position, onReady }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) onReady(ref.current); }, [onReady]);
  return (
    <mesh ref={ref} position={position}>
      <sphereGeometry args={[0.6, 16, 16]} />
      <primitive object={_SUN_MAT} attach="material" />
    </mesh>
  );
}

// ── Wall art (paintings) ────────────────────────────────────────────────────
// Generates a small abstract/surreal "painting" texture procedurally on a
// canvas (no asset files needed) — soft painterly colour blocks + a horizon
// line, the kind of ambiguous abstract composition that reads as fine art
// rather than a literal photo-in-a-frame. Cached per call so repeated mounts
// don't regenerate the canvas.
const _ART_TEXTURE_CACHE = {};
function makeArtTexture(seed) {
  if (_ART_TEXTURE_CACHE[seed]) return _ART_TEXTURE_CACHE[seed];
  const c = document.createElement('canvas');
  c.width = 256; c.height = 320;
  const ctx = c.getContext('2d');
  // Each seed picks a different muted, painterly palette — kept warm/earthy so
  // the paintings sit naturally in the GENDO warm-plaster look rather than
  // clashing with jarring saturated colour.
  const PALETTES = [
    ['#e8d9c2', '#b08a5e', '#3a2f28', '#8c6f4f'], // warm ochre/umber
    ['#cfd6cf', '#7c8a78', '#2e3a30', '#a8a48f'], // muted sage/stone
    ['#e3c9b8', '#a8503c', '#2a2018', '#caa97a'], // terracotta/rust
  ];
  const pal = PALETTES[seed % PALETTES.length];
  ctx.fillStyle = pal[0]; ctx.fillRect(0, 0, c.width, c.height);
  // A soft horizon band + a floating "moon/sun" disc — de Chirico / Magritte-
  // style ambiguous, dreamlike composition: a flat horizon, an empty sky, one
  // odd circular form. Deliberately abstract, not a literal scene.
  const horizonY = c.height * (0.55 + (seed % 3) * 0.06);
  ctx.fillStyle = pal[1]; ctx.fillRect(0, horizonY, c.width, c.height - horizonY);
  ctx.beginPath();
  ctx.fillStyle = pal[2];
  ctx.arc(c.width * (0.3 + (seed % 4) * 0.12), horizonY * 0.45, 30 + (seed % 3) * 6, 0, Math.PI * 2);
  ctx.fill();
  // A few soft vertical strokes (suggesting distant columns/figures) for
  // texture without becoming a literal recognisable subject.
  ctx.fillStyle = pal[3];
  for (let i = 0; i < 3; i++) {
    const x = c.width * (0.15 + i * 0.3 + (seed % 5) * 0.03);
    ctx.fillRect(x, horizonY - 60, 6, 60);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _ART_TEXTURE_CACHE[seed] = tex;
  return tex;
}

const _FRAME_MAT = new THREE.MeshStandardMaterial({ color: '#2b1d12', roughness: 0.55, metalness: 0.1 });

function Painting({ position, rotationY = 0, w = 0.6, h = 0.8, seed = 0 }) {
  const tex = useMemo(() => makeArtTexture(seed), [seed]);
  const frameDepth = 0.04;
  const innerW = w - 0.08, innerH = h - 0.08;
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* Frame */}
      <mesh material={_FRAME_MAT} castShadow receiveShadow>
        <boxGeometry args={[w, h, frameDepth]} />
      </mesh>
      {/* Artwork — inset, slightly forward of the frame face */}
      <mesh position={[0, 0, frameDepth / 2 + 0.002]}>
        <planeGeometry args={[innerW, innerH]} />
        <meshStandardMaterial map={tex} roughness={0.85} metalness={0} />
      </mesh>
    </group>
  );
}

// Auto-places 2 framed paintings on the solid wall (the wall WITHOUT the
// window — keeps the glazed elevation clean) at eye-level height, spaced
// across the wall's footprint using the room's own bounding box. Purely
// decorative dressing, like ColumnEdgeBoost/WindowSkylineBackdrop, not part
// of the draggable furniture catalogue — no placement UI needed for this.
function WallArt({ ready, roomBox = null }) {
  if (!ready || !roomBox) return null;
  const min = roomBox.min, max = roomBox.max;
  const wallX = max.x - 0.05; // against the solid right-hand wall, inset slightly
  const centerZ = (min.z + max.z) / 2;
  const spread = (max.z - min.z) * 0.22;
  const eyeY = min.y + 1.55;
  return (
    <>
      <Painting position={[wallX, eyeY, centerZ - spread]} rotationY={-Math.PI / 2} w={0.62} h={0.82} seed={0} />
      <Painting position={[wallX, eyeY + 0.05, centerZ + spread]} rotationY={-Math.PI / 2} w={0.5} h={0.66} seed={1} />
    </>
  );
}

// ── Balcony backdrop + dressing ─────────────────────────────────────────────
// The GLB has a real "balconies" mesh group — a genuine, narrow (~0.9m/3ft)
// slab beyond the window, NOT the deeper terrace in the GENDO reference
// photos. Earlier renders showed a generic skyline or flat dark void there
// because the slab itself is washed-out/featureless in the capture — barely
// any visual signal to anchor on. Fix: measure the REAL balcony mesh's actual
// bounding box at runtime (never hardcode coordinates — every ROOM*.glb may
// differ), then (1) add a flat BLACK backdrop plane just past its far edge
// so the prompt has a literal "canvas" to paint a skyline onto instead of
// guessing into empty space, and (2) add a low parapet edge + a couple of
// plant pots sized to the SLAB'S REAL width, so it unmistakably reads as a
// small balcony, not a generic terrace.
const _BACKDROP_MAT = new THREE.MeshBasicMaterial({ color: '#000000', side: THREE.DoubleSide });
const _PARAPET_MAT = new THREE.MeshStandardMaterial({ color: '#cfc9bd', roughness: 0.85, metalness: 0 });

function BalconyDressing({ ready, roomBox = null }) {
  const { scene } = useThree();
  const [balBox, setBalBox] = useState(null);
  useEffect(() => {
    if (!ready) return;
    let found = null;
    scene.traverse(n => {
      if (found) return;
      for (let p = n; p; p = p.parent) {
        if ((p.name || '').toLowerCase() === 'balconies') { found = p; break; }
      }
    });
    if (found) {
      const box = new THREE.Box3().setFromObject(found);
      if (!box.isEmpty()) setBalBox(box);
    }
  }, [ready, scene]);

  if (!ready || !roomBox || !balBox) return null;
  const size = balBox.getSize(new THREE.Vector3());
  const center = balBox.getCenter(new THREE.Vector3());
  // Whichever horizontal axis is the SHORT one is the balcony's depth
  // (the narrow ~0.9m dimension); the long axis runs along the window.
  const depthIsX = size.x < size.z;
  const farEdge = depthIsX
    ? (center.x > roomBox.getCenter(new THREE.Vector3()).x ? balBox.max.x : balBox.min.x)
    : (center.z > roomBox.getCenter(new THREE.Vector3()).z ? balBox.max.z : balBox.min.z);
  const wallLen = depthIsX ? size.z : size.x;
  const backdropH = Math.max(size.y, 2.4);
  const parapetH = 1.0;
  const parapetY = balBox.min.y + parapetH / 2;

  return (
    <group>
      {/* Flat black backdrop just past the real slab's far edge — gives the
          render prompt a literal canvas to paint a skyline onto, instead of
          the model guessing into an undefined void. */}
      <mesh
        position={depthIsX ? [farEdge, center.y, center.z] : [center.x, center.y, farEdge]}
        rotation={depthIsX ? [0, Math.PI / 2, 0] : [0, 0, 0]}
        material={_BACKDROP_MAT}
      >
        <planeGeometry args={[wallLen * 1.4, backdropH * 1.6]} />
      </mesh>
      {/* Low parapet wall along the slab's outer edge, sized to its REAL
          (short, ~0.9m) footprint — not a guessed/oversized terrace wall. */}
      <mesh
        position={depthIsX ? [farEdge, parapetY, center.z] : [center.x, parapetY, farEdge]}
        material={_PARAPET_MAT}
        castShadow receiveShadow
      >
        {depthIsX
          ? <boxGeometry args={[0.12, parapetH, wallLen]} />
          : <boxGeometry args={[wallLen, parapetH, 0.12]} />}
      </mesh>
    </group>
  );
}

function ColumnEdgeBoost({ ready, roomBox = null }) {
  const { scene, invalidate } = useThree();
  const doneRef = useRef(false);
  useEffect(() => {
    if (!ready || doneRef.current) return;
    doneRef.current = true;
    const added = [];
    const winMeshes = [];
    scene.traverse((n) => {
      if (!n.isMesh || !n.geometry) return;
      let isCol = false, isWin = false, isWall = false;
      for (let p = n; p; p = p.parent) {
        const nm = (p.name || '').toLowerCase();
        if (nm.includes('column')) { isCol = true; break; }
        if (nm.includes('window') || nm.includes('glass')) { isWin = true; break; }
        if (WALL_KEYS.some(k => nm.includes(k))) { isWall = true; break; }
      }
      // Reclassify by GEOMETRY when a piece is named "internal_walls" but is
      // actually shaped like a column shaft — this GLB groups the vertical
      // shafts flanking each window under internal_walls and only the vault
      // fan-out capitals under "columns", so by NAME these shafts read as
      // flat wall panels and got no edge-lines / column material, even
      // though visually they're clearly the room's columns (confirmed via
      // a bounding-box probe: tall, near-zero-thickness vertical slabs
      // sitting ~1.5m+ from the room's centre line, exactly where a column
      // would stand). Tall + narrow + off-centre overrides the name-based
      // wall classification.
      if (isWall && !isCol) {
        const b = new THREE.Box3().setFromObject(n);
        if (!b.isEmpty()) {
          const s = b.getSize(new THREE.Vector3());
          const c = b.getCenter(new THREE.Vector3());
          const thin = Math.min(s.x, s.z) < 0.15;
          const tall = s.y > 1.5;
          const offCentre = Math.max(Math.abs(c.x), Math.abs(c.z)) > 1.5;
          if (thin && tall && offCentre) { isCol = true; isWall = false; }
        }
      }
      // Windows → obviously-glass material + a bold dark FRAME around the real
      // opening, so the AI keeps glass HERE and nowhere else.
      if (isWin) {
        n.material = _WIN_GLASS_MAT; n.renderOrder = 1;
        if (!n.userData.__framed) {
          n.userData.__framed = true;
          const edges = new THREE.EdgesGeometry(n.geometry, 20);
          const frame = new THREE.LineSegments(edges, _WIN_FRAME_MAT);
          frame.renderOrder = 3;
          n.add(frame);
          added.push(edges);
        }
        winMeshes.push(n);
        return;
      }
      // Walls → flat solid plaster (no dark recesses the AI misreads as holes).
      if (isWall) { n.material = _WALL_REAL_MAT; return; }
      if (!isCol) return;
      // 1) Real textured PBR, boosted normal/AO for crisp shading.
      n.material = _COL_REAL_MAT;
      // 2) Dark edge lines. The reference's fan-vault facets are shallow
      //    folds (often well under 25° between adjacent faces) — at a 25°
      //    threshold most of those real creases were being filtered out
      //    entirely, which is why the vault read soft/flat instead of
      //    crisply faceted like the reference. Lowered to 12° to catch the
      //    real geometric creases without flagging coplanar triangulation
      //    noise (anything under ~8° is just mesh subdivision, not a fold).
      if (!n.userData.__edged) {
        n.userData.__edged = true;
        // REVERTED the fat-line (LineSegments2) experiment — it's a Mesh
        // subclass that got swept into the camera-placement raycast traversal
        // (scene.traverse collects all isMesh objects) and corrupted something
        // in the scene graph badly enough to stack-overflow the recursive
        // intersect(). Not worth the fragility for an unproven benefit — back
        // to plain LineSegments, which has NO raycast method at all (so it's
        // naturally invisible to Raycaster, no override needed).
        // Lowered from 12° → 8° so subtler facet creases still get a drawn
        // edge instead of being filtered out and reading as a smooth surface.
        const edges = new THREE.EdgesGeometry(n.geometry, 8);
        const lines = new THREE.LineSegments(edges, _COL_EDGE_MAT);
        lines.renderOrder = 2;
        n.add(lines);
        added.push(edges);
      }
    });

    invalidate();
    return () => {
      for (const g of added) g.dispose();
    };
  }, [ready, scene, invalidate, roomBox]);
  return null;
}

// Small "what the camera sees" thumbnail — its OWN small Canvas (not a
// render-target trick) with a camera placed exactly at the marker's eye/
// look. useGLTF caches the parsed room geometry by URL, so this second
// Canvas is cheap — no second network fetch, just a small extra draw call
// for a tiny viewport. frameloop="demand" + invalidate only when the marker
// actually moves, so it costs nothing while idle.
// Mirrors InteriorCaptureRig's eye refinement (see refineEyeNearMarker) so
// the thumbnail you compose against while dragging the gumball IS the shot
// that actually gets captured — previously this rendered the raw marker
// position while the real capture silently nudged the eye to a nearby
// better-scoring spot afterward, so "the angle I picked" and "the angle I
// got" could quietly diverge (too close to a wall, a column in the way).
function PreviewCamera({ eye, look, box }) {
  const { camera, scene, invalidate } = useThree();
  useEffect(() => {
    const rawEye = new THREE.Vector3(...eye);
    const lookPt = new THREE.Vector3(...look);
    const refinedEye = box ? refineEyeNearMarker(box, scene, rawEye, lookPt) : rawEye;
    const shift = new THREE.Vector3().subVectors(refinedEye, rawEye);
    camera.position.copy(refinedEye);
    camera.lookAt(lookPt.clone().add(shift));
    camera.updateProjectionMatrix();
    invalidate();
  }, [eye, look, box, scene, camera, invalidate]);
  return null;
}

function PreviewThumbnail({ room, furniture, cameraMarker }) {
  // Own sceneBox state — this is a separate Canvas/scene from the main
  // capture rig, so it needs its own BaseRoom onReady to get a real roomBox
  // for ColumnEdgeBoost. Without it, the skyline backdrop fell back to
  // scanning the whole scene for a centre, which can skew the outward
  // direction — so this thumbnail (the live "what the camera sees" preview
  // shown while placing furniture) wasn't reliably showing the window view.
  const [thumbBox, setThumbBox] = useState(null);
  if (!cameraMarker) return null;
  return (
    <div className="rhv-preview-thumb">
      <div className="rhv-preview-thumb-label">Camera view</div>
      <Canvas
        className="rhv-preview-thumb-canvas"
        shadows={false}
        camera={{ fov: 60, near: 0.05, far: 200 }}
        gl={{ antialias: true, outputColorSpace: THREE.SRGBColorSpace, toneMapping: THREE.ACESFilmicToneMapping }}
        dpr={1}
        frameloop="demand"
      >
        <color attach="background" args={['#0a0a0c']} />
        <RoomEnv intensity={0.55} hdriUrl={EXTERIOR_HDRI_URL} />
        <directionalLight position={[6, 8, 4]} intensity={2.2} color="#fff3df" />
        <directionalLight position={[-5, 1.6, -6]} intensity={1.1} color="#bcd6ff" />
        <ambientLight intensity={0.22} color="#dbe6f0" />
        <React.Suspense fallback={null}>
          <BaseRoom key={room.file} file={room.file} pigmentHex="#f0ece6" hiddenLayers={EMPTY_LAYER_SET} onReady={setThumbBox} onLayers={() => {}} />
          {furniture.map(p => <FurniturePiece3D key={p.uid} piece={p} sceneBox={thumbBox} readOnly />)}
          <ColumnEdgeBoost ready={!!thumbBox} roomBox={thumbBox} />
        </React.Suspense>
        <PreviewCamera eye={cameraMarker.eye} look={cameraMarker.look} box={thumbBox} />
      </Canvas>
    </div>
  );
}

// ── Manual Render Controls panel ──────────────────────────────────────────
// Exposes the real render parameters so AI Enhance isn't a black box: pick the
// Stability engine, the reference photo (Style Transfer), edit the prompt, and
// set how hard geometry is locked. Whatever is set here is exactly what gets
// sent — no hidden defaults.
const ENGINE_OPTS = [
  { id: 'style',     label: 'Style Transfer', hint: 'Uses your reference photo · ~8 cr' },
  { id: 'structure', label: 'Structure Lock', hint: 'Best geometry, text only · ~3 cr' },
  { id: 'ultra',     label: 'Ultra',          hint: 'Flagship, text only · ~8 cr' },
  { id: 'sd35',      label: 'SD3.5 Medium',   hint: 'Cheaper img2img · ~3.5 cr' },
  { id: 'sdxl',      label: 'SDXL 1.0',       hint: 'Cheapest · ~0.9 cr' },
];

// A single raw API parameter: a fine 0.01-step slider + a directly-editable
// number box, showing the EXACT value sent to Stability (no mapping).
function RawParam({ label, hint, value, onChange, min = 0, max = 1 }) {
  return (
    <div style={{ margin: '8px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: '#d8d2c4' }}>{label}</span>
        <input
          type="number" min={min} max={max} step={0.01} value={value}
          onChange={e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) onChange(v); }}
          style={{ width: 64, fontFamily: 'monospace', fontSize: '0.72rem', textAlign: 'right',
                   background: '#1a1a1e', color: '#e6b873', border: '1px solid #444', borderRadius: 4, padding: '2px 4px' }}
        />
      </div>
      <input
        type="range" min={min} max={max} step={0.01} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="rhv-rc-slider"
      />
      <div style={{ fontSize: '0.6rem', color: '#888', marginTop: 2 }}>{hint}</div>
    </div>
  );
}

function RenderControls({
  engine, setEngine, refImages, refImage, setRefImage,
  lockStrength, setLockStrength, materialStrength, setMaterialStrength,
  promptText, setPromptText,
  negativePrompt, setNegativePrompt, seed, setSeed, seedLocked, setSeedLocked,
  cfgScale, setCfgScale, steps, setSteps, outputFormat, setOutputFormat,
  rawCompFidelity, setRawCompFidelity, rawChangeStrength, setRawChangeStrength,
  rawStyleStrength, setRawStyleStrength, rawControlStrength, setRawControlStrength,
  rawI2IStrength, setRawI2IStrength,
  onRender,
}) {
  const usesRef = engine === 'style';
  const lockPct = Math.round(lockStrength * 100);
  const materialPct = Math.round(materialStrength * 100);
  const usesCfg = engine === 'sd35' || engine === 'sdxl';
  const usesSteps = engine === 'sdxl';
  return (
    <div className="rhv-rc">
      <div className="rhv-rc-title">Render Controls</div>

      {/* Engine picker */}
      <div className="rhv-rc-group">
        <label className="rhv-rc-label">Engine</label>
        <div className="rhv-rc-engines">
          {ENGINE_OPTS.map(o => (
            <button
              key={o.id}
              className={`rhv-rc-engine ${engine === o.id ? 'rhv-rc-engine--on' : ''}`}
              onClick={() => setEngine(o.id)}
              title={o.hint}
            >
              <span className="rhv-rc-engine-name">{o.label}</span>
              <span className="rhv-rc-engine-hint">{o.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── RAW Stability params — TOTAL FREEDOM. Sent verbatim, no clamps. ── */}
      <div className="rhv-rc-group">
        <label className="rhv-rc-label" style={{ color: '#e6b873' }}>
          ⚙ Raw API params — sent exactly as set, no clamping
        </label>

        {engine === 'style' && (
          <>
            <RawParam label="composition_fidelity" hint="output style ↔ input style (def 0.9)"
              value={rawCompFidelity} onChange={setRawCompFidelity} min={0} max={1} />
            <RawParam label="change_strength" hint="how much the image CHANGES · high=more change (def 0.9)"
              value={rawChangeStrength} onChange={setRawChangeStrength} min={0.1} max={1} />
            <RawParam label="style_strength" hint="reference influence · 1=ignore your 3D entirely (def 1.0)"
              value={rawStyleStrength} onChange={setRawStyleStrength} min={0} max={1} />
          </>
        )}
        {engine === 'structure' && (
          <RawParam label="control_strength" hint="geometry lock · high=obey your 3D harder (def 0.7)"
            value={rawControlStrength} onChange={setRawControlStrength} min={0} max={1} />
        )}
        {(engine === 'ultra' || engine === 'sd35' || engine === 'sdxl') && (
          <RawParam label="strength (img2img)" hint="how far from your capture · LOW=preserve, HIGH=reinvent"
            value={rawI2IStrength} onChange={setRawI2IStrength} min={0} max={1} />
        )}
      </div>

      {/* Reference image picker — only meaningful for Style Transfer */}
      <div className={`rhv-rc-group ${usesRef ? '' : 'rhv-rc-group--dim'}`}>
        <label className="rhv-rc-label">
          Reference photo {usesRef ? '' : '(only used by Style Transfer)'}
        </label>
        <div className="rhv-rc-refs">
          {refImages.length === 0 && <span className="rhv-rc-empty">No images in render_ref/</span>}
          {refImages.map(img => (
            <button
              key={img.name}
              className={`rhv-rc-ref ${refImage === img.name ? 'rhv-rc-ref--on' : ''}`}
              onClick={() => setRefImage(img.name)}
              title={img.name}
            >
              {img.thumb
                ? <img src={img.thumb} alt={img.name} />
                : <span className="rhv-rc-ref-noimg">{img.name}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Geometry-lock slider */}
      <div className="rhv-rc-group">
        <label className="rhv-rc-label">
          Geometry lock <span className="rhv-rc-val">{lockPct}%</span>
        </label>
        <input
          type="range" min="0" max="100" step="5"
          value={lockPct}
          onChange={e => setLockStrength(Number(e.target.value) / 100)}
          className="rhv-rc-slider"
        />
        <div className="rhv-rc-scale">
          <span>looser · more freedom</span>
          <span>locked · exact geometry</span>
        </div>
      </div>

      {/* Material strength slider — independent of geometry lock, only meaningful for Style Transfer */}
      <div className={`rhv-rc-group ${usesRef ? '' : 'rhv-rc-group--dim'}`}>
        <label className="rhv-rc-label">
          Material strength <span className="rhv-rc-val">{materialPct}%</span>
          {usesRef ? '' : ' (only used by Style Transfer)'}
        </label>
        <input
          type="range" min="0" max="100" step="5"
          value={materialPct}
          onChange={e => setMaterialStrength(Number(e.target.value) / 100)}
          className="rhv-rc-slider"
        />
        <div className="rhv-rc-scale">
          <span>closer to grey shell</span>
          <span>reference materials dominate</span>
        </div>
      </div>

      {/* Prompt editor */}
      <div className="rhv-rc-group">
        <label className="rhv-rc-label">Prompt (materials, light, mood)</label>
        <textarea
          className="rhv-rc-prompt"
          value={promptText}
          onChange={e => setPromptText(e.target.value)}
          rows={5}
          spellCheck={false}
        />
        <button className="rhv-rc-reset" onClick={() => setPromptText(DEFAULT_RENDER_PROMPT)}>
          Reset prompt to default
        </button>
      </div>

      {/* Negative prompt */}
      <div className="rhv-rc-group">
        <label className="rhv-rc-label">Negative prompt (what to avoid)</label>
        <textarea
          className="rhv-rc-prompt rhv-rc-prompt--sm"
          value={negativePrompt}
          onChange={e => setNegativePrompt(e.target.value)}
          rows={2}
          spellCheck={false}
        />
        <button className="rhv-rc-reset" onClick={() => setNegativePrompt(DEFAULT_NEGATIVE_PROMPT)}>
          Reset negative prompt
        </button>
      </div>

      {/* Seed */}
      <div className="rhv-rc-group">
        <label className="rhv-rc-label">Seed</label>
        <div className="rhv-rc-row">
          <label className="rhv-rc-check">
            <input type="checkbox" checked={seedLocked} onChange={e => setSeedLocked(e.target.checked)} />
            Lock seed (reproduce the same image)
          </label>
        </div>
        <div className="rhv-rc-row">
          <input
            type="number" min="0" max="4294967294"
            className="rhv-rc-num"
            value={seed}
            disabled={!seedLocked}
            onChange={e => setSeed(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
            placeholder="0 = random"
          />
          <button
            className="rhv-rc-reset"
            onClick={() => setSeed(Math.floor(Math.random() * 4294967293) + 1)}
            disabled={!seedLocked}
          >
            🎲 Random seed
          </button>
        </div>
        {!seedLocked && <div className="rhv-rc-note">Unlocked → every render gets a fresh random seed.</div>}
      </div>

      {/* cfg_scale — prompt adherence */}
      <div className={`rhv-rc-group ${usesCfg ? '' : 'rhv-rc-group--dim'}`}>
        <label className="rhv-rc-label">
          Prompt adherence (cfg) <span className="rhv-rc-val">{cfgScale}</span>
          {!usesCfg && <span className="rhv-rc-note-inline"> · only SD3.5 / SDXL</span>}
        </label>
        <input
          type="range" min="1" max="20" step="0.5"
          value={cfgScale}
          onChange={e => setCfgScale(Number(e.target.value))}
          className="rhv-rc-slider"
        />
        <div className="rhv-rc-scale"><span>looser</span><span>follows prompt hard</span></div>
      </div>

      {/* steps — quality vs speed */}
      <div className={`rhv-rc-group ${usesSteps ? '' : 'rhv-rc-group--dim'}`}>
        <label className="rhv-rc-label">
          Steps (quality) <span className="rhv-rc-val">{steps}</span>
          {!usesSteps && <span className="rhv-rc-note-inline"> · only SDXL</span>}
        </label>
        <input
          type="range" min="10" max="50" step="5"
          value={steps}
          onChange={e => setSteps(Number(e.target.value))}
          className="rhv-rc-slider"
        />
        <div className="rhv-rc-scale"><span>faster</span><span>higher quality</span></div>
      </div>

      {/* output format */}
      <div className="rhv-rc-group">
        <label className="rhv-rc-label">Output format</label>
        <div className="rhv-rc-fmt">
          {['png', 'jpeg', 'webp'].map(f => (
            <button
              key={f}
              className={`rhv-rc-fmt-btn ${outputFormat === f ? 'rhv-rc-fmt-btn--on' : ''}`}
              onClick={() => setOutputFormat(f)}
            >{f.toUpperCase()}</button>
          ))}
        </div>
      </div>

      <button className="rhv-rc-render" onClick={onRender}>
        ✦ Render with these settings
      </button>
    </div>
  );
}

// Shared auto-framing math, used both as PlacementRig's starting position
// and as InteriorCaptureRig's fallback when no manual placement happened.
// Pure function — no camera/gl side effects — so it's safe to call from
// either rig. Returns world-space eye/look points and a lens fov.
function computeAutoCamera(box, scene, furniture = [], preset = null) {
  const size = box.getSize(new THREE.Vector3());
  const min = box.min;
  const max = box.max;
  const W = size.x, H = size.y, D = size.z;

  // ── Stand INSIDE the room and frame the star-vault COLUMNS. ─────────────
  // The columns/capitals are this design's hero feature and sit ABOVE eye
  // level, so the camera must be inside the footprint, at standing height,
  // looking slightly UP toward a column — not pulled far back outside the
  // building (which framed the exterior wall).
  const center = box.getCenter(new THREE.Vector3());

  // Find the real column meshes in the scene and collect their world centres.
  // A "column" in the GLB is NOT one mesh — the `columns` node holds ~24 child
  // pieces (shaft + capital quadrants + base) per several columns. So we
  // collect every column PIECE's world position, then CLUSTER them by XZ
  // proximity into distinct columns. With 2-3 columns in a room this yields
  // 2-3 clusters; we then frame ONE hero column, not the empty gap between them.
  const piecePts = [];
  scene.traverse(n => {
    if (!n.isMesh) return;
    // A piece counts as a column piece if itself or any ancestor is named 'column(s)'.
    let isCol = false;
    for (let p = n; p; p = p.parent) {
      if ((p.name || '').toLowerCase().includes('column')) { isCol = true; break; }
    }
    if (!isCol) return;
    const b = new THREE.Box3().setFromObject(n);
    if (b.isEmpty()) return;
    const c = b.getCenter(new THREE.Vector3());
    piecePts.push({ x: c.x, y: c.y, z: c.z, topY: b.max.y });
  });

  // Cluster pieces into columns: pieces within ~1.2m in XZ belong to the same
  // column (a column footprint is < 1m; capital quadrants spread a little).
  const CLUSTER_R2 = 1.2 * 1.2;
  const columns = [];  // { x, z, topY, count }
  for (const pt of piecePts) {
    let cl = null;
    for (const c of columns) {
      if ((c.x - pt.x) ** 2 + (c.z - pt.z) ** 2 <= CLUSTER_R2) { cl = c; break; }
    }
    if (cl) {
      cl.x = (cl.x * cl.count + pt.x) / (cl.count + 1);
      cl.z = (cl.z * cl.count + pt.z) / (cl.count + 1);
      cl.topY = Math.max(cl.topY, pt.topY);
      cl.count++;
    } else {
      columns.push({ x: pt.x, z: pt.z, topY: pt.topY, count: 1 });
    }
  }

  // Find window meshes the same way columns are found — the reference
  // photos this project targets always centre the shot on a window (the
  // vault arch framing a view out), so "aim at a hero column" alone could
  // land the camera facing a flat wall with the column only grazing the
  // edge of frame, even though a column happened to be nearest. Windows are
  // the real anchor for "the interesting wall" of the room.
  const windowPts = [];
  scene.traverse(n => {
    if (!n.isMesh) return;
    let isWin = false;
    for (let p = n; p; p = p.parent) {
      const nm = (p.name || '').toLowerCase();
      if (nm.includes('window') || nm.includes('glass')) { isWin = true; break; }
    }
    if (!isWin) return;
    const b = new THREE.Box3().setFromObject(n);
    if (b.isEmpty()) return;
    const c = b.getCenter(new THREE.Vector3());
    windowPts.push({ x: c.x, y: c.y, z: c.z });
  });
  const WIN_CLUSTER_R2 = 1.5 * 1.5;
  const windows = []; // { x, z, count }
  for (const pt of windowPts) {
    let cl = null;
    for (const w of windows) {
      if ((w.x - pt.x) ** 2 + (w.z - pt.z) ** 2 <= WIN_CLUSTER_R2) { cl = w; break; }
    }
    if (cl) { cl.x = (cl.x * cl.count + pt.x) / (cl.count + 1); cl.z = (cl.z * cl.count + pt.z) / (cl.count + 1); cl.count++; }
    else windows.push({ x: pt.x, z: pt.z, count: 1 });
  }

  // Anchor the shot around the user's furniture if placed, else the room centre.
  const anchor = new THREE.Vector3(center.x, min.y, center.z);
  if (furniture.length > 0) {
    const fc = new THREE.Vector3(); let n = 0;
    for (const p of furniture) { fc.x += (p.x ?? 0); fc.z += (p.z ?? 0); n++; }
    if (n > 0) { anchor.x = fc.x / n; anchor.z = fc.z / n; }
  }

  // ── RAYCAST-BASED ENCLOSURE FRAMING ─────────────────────────────────────
  // The footprint is an irregular vaulted hall: its BOUNDING-BOX corners fall
  // partly OUTSIDE the real walls, so any "stand in a bbox corner" heuristic
  // lands the camera behind a parapet or facing open void (the black areas in
  // the captures). The only reliable way to place a camera that's genuinely
  // INSIDE an enclosed part of the room — and aimed at a direction that's
  // backed by a wall rather than escaping to the void — is to test against the
  // REAL geometry with rays. We:
  //   1. Grid-sample candidate eye points at eye height across the footprint.
  //   2. From each, cast a fan of horizontal rays at the actual wall/column/
  //      slab meshes. A point inside an enclosed room hits geometry within a
  //      few metres in MOST directions; a point in open space / outside the
  //      shell escapes to the far bbox edge in many directions.
  //   3. Keep well-enclosed points that aren't claustrophobically close to a
  //      wall, prefer the one nearest the user's furniture, then aim down a
  //      direction that has real depth BUT is still closed by a wall (so the
  //      shot reads as a room with a back wall, never a void).
  const eyeHeight = min.y + 1.55;
  const aimXZ = new THREE.Vector2(anchor.x, anchor.z);

  // Meshes to test against: the room SHELL only (walls, columns, slabs, doors,
  // windows) — never furniture or the helper markers, which shouldn't define
  // "enclosure". Glass counts as a boundary (a window still closes the room).
  const shellMeshes = [];
  scene.traverse(n => {
    // LineSegments2 (the fat column-edge overlay) sets isMesh=true but its
    // raycast() needs a renderer/resolution context not guaranteed here —
    // exclude it explicitly, not just via its own disabled raycast(), so this
    // collection never depends on that override staying in place.
    if (!n.isMesh || n.visible === false || n.isLineSegments2) return;
    let skip = false;
    for (let p = n; p; p = p.parent) {
      const nm = (p.name || '').toLowerCase();
      if (nm.includes('furniture') || nm === 'default') { skip = true; break; }
    }
    if (!skip) shellMeshes.push(n);
  });

  const NDIRS = 16;
  const dirVecs = [];
  for (let i = 0; i < NDIRS; i++) {
    const a = (i / NDIRS) * Math.PI * 2;
    dirVecs.push(new THREE.Vector2(Math.cos(a), Math.sin(a)));
  }
  const ray = new THREE.Raycaster();
  ray.far = Math.max(W, D) * 1.5;
  const MAX_ROOM = Math.min(Math.max(W, D), 14); // a "wall hit" must be within this
  const _o = new THREE.Vector3();
  const _d = new THREE.Vector3();

  // Returns { hits, minHit, dirDepths[] } for a candidate eye point.
  const probe = (x, z) => {
    _o.set(x, eyeHeight, z);
    const dirDepths = new Array(NDIRS).fill(ray.far);
    let hits = 0, minHit = Infinity;
    for (let i = 0; i < NDIRS; i++) {
      _d.set(dirVecs[i].x, 0, dirVecs[i].y);
      ray.set(_o, _d);
      const hit = ray.intersectObjects(shellMeshes, true)[0];
      if (hit) {
        dirDepths[i] = hit.distance;
        if (hit.distance <= MAX_ROOM) { hits++; minHit = Math.min(minHit, hit.distance); }
      }
    }
    return { hits, minHit, dirDepths };
  };

  // Grid-sample candidate eye points (inset from bbox edges).
  const candidates = [];
  const NX = 7, NZ = 7, pad = 0.6;
  for (let ix = 0; ix < NX; ix++) {
    for (let iz = 0; iz < NZ; iz++) {
      const x = min.x + pad + (W - 2 * pad) * (ix / (NX - 1));
      const z = min.z + pad + (D - 2 * pad) * (iz / (NZ - 1));
      // Don't stand inside a column shaft.
      if (columns.some(c => (c.x - x) ** 2 + (c.z - z) ** 2 < 0.7 * 0.7)) continue;
      const pr = probe(x, z);
      // Enclosed: most rays hit a wall within room scale, and we're not jammed
      // against one (minHit gives breathing room).
      if (pr.hits >= Math.ceil(NDIRS * 0.6) && pr.minHit >= 0.8) {
        candidates.push({ x, z, ...pr });
      }
    }
  }

  // Distance to the nearest shell wall along a horizontal direction from a
  // point (how much open room there is that way before hitting geometry).
  const wallDist = (x, z, dx, dz) => {
    _o.set(x, eyeHeight, z); _d.set(dx, 0, dz); ray.set(_o, _d);
    const h = ray.intersectObjects(shellMeshes, true)[0];
    return h ? h.distance : ray.far;
  };

  // ── REFERENCE-MATCHED COMPOSITION ───────────────────────────────────────
  // The reference interior (Amin Taha bedroom) is an AXIAL shot: the camera
  // looks STRAIGHT at the big arched WINDOW, dead level, with the flaring
  // fan-vault columns framing it symmetrically left and right and the bed/sofa
  // in the foreground. To reproduce that, when windows exist we (a) AIM at the
  // window the furniture is nearest to (the hero opening), and (b) prefer eye
  // positions that sit on that window's perpendicular AXIS facing it — so the
  // vault-columns flank the window symmetrically, exactly like the reference.
  let heroWin = null;
  if (windows.length) {
    let bestD = Infinity;
    for (const w of windows) {
      const d = (w.x - aimXZ.x) ** 2 + (w.z - aimXZ.y) ** 2;
      if (d < bestD) { bestD = d; heroWin = w; }
    }
  }
  // Axis the camera should look ALONG = from room interior toward the window
  // (the window normal, approximated as the direction from room centre to the
  // window). Standing back along this axis puts the window dead-centre.
  const winAxis = heroWin
    ? new THREE.Vector2(heroWin.x - center.x, heroWin.z - center.z)
    : new THREE.Vector2(0, 0);
  const hasWinAxis = winAxis.lengthSq() > 0.25;
  if (hasWinAxis) winAxis.normalize();

  let eyePoint, target;
  if (candidates.length) {
    const STANDOFF = 4.0;   // ideal camera-to-subject distance (m)
    const MIN_STANDOFF = 3.0;
    // Aim at the hero WINDOW (reference-style) when one exists, else the
    // furniture/room anchor; level, a hair below eye height.
    const aimPt = heroWin ? new THREE.Vector2(heroWin.x, heroWin.z) : aimXZ.clone();
    target = new THREE.Vector3(aimPt.x, eyeHeight - 0.25, aimPt.y);

    // Score every enclosed candidate as a CAMERA position: we want one that is
    // roughly STANDOFF metres from the subject, with the subject in front of
    // it (so it's looking INTO the room toward the window/furniture), enough
    // open room BEHIND the subject for depth, a clear column-free sightline,
    // AND — for the reference look — sitting on the window's perpendicular
    // axis so the shot is axial/symmetric.
    let best = null, bestScore = -Infinity;
    for (const c of candidates) {
      const toSubj = new THREE.Vector2(aimPt.x - c.x, aimPt.y - c.z);
      const dist = toSubj.length();
      if (dist < MIN_STANDOFF) continue;       // too close → wall-in-the-face
      toSubj.normalize();
      // Open depth BEHIND the subject (past it, away from camera) — a longer
      // run before the back wall gives the composition depth.
      const behind = wallDist(aimPt.x, aimPt.y, toSubj.x, toSubj.y);
      // Clearance of the look corridor: nearest column to the eye→subject ray.
      let corr = Infinity;
      for (const col of columns) {
        const px = col.x - c.x, pz = col.z - c.z;
        const t = THREE.MathUtils.clamp(px * toSubj.x + pz * toSubj.y, 0, dist);
        corr = Math.min(corr, Math.hypot(px - toSubj.x * t, pz - toSubj.y * t));
      }
      if (!columns.length) corr = 1.5;
      // Axiality: how well the look direction aligns with the window axis
      // (dot of toSubj with winAxis; 1 = perfectly looking straight at window).
      const axiality = hasWinAxis ? (toSubj.x * winAxis.x + toSubj.y * winAxis.y) : 0;
      const score =
        -Math.abs(dist - STANDOFF) * 1.0 +   // near ideal standoff
        Math.min(behind, 5) * 0.6 +          // depth behind subject
        Math.min(corr, 1.5) * 2.0 +          // clear (un-blocked) sightline
        Math.max(0, axiality) * 3.0;         // axial/symmetric to the window
      if (score > bestScore) { bestScore = score; best = c; }
    }

    if (best) {
      eyePoint = new THREE.Vector3(best.x, eyeHeight, best.z);
    } else {
      // No candidate far enough from the subject: back OFF from the subject
      // along the most-open enclosed direction to manufacture a standoff.
      let bestI = 0, bestDepth = -1;
      const spot = candidates[0];
      for (let i = 0; i < NDIRS; i++) {
        const dd = spot.dirDepths[i];
        if (dd <= MAX_ROOM && dd > bestDepth) { bestDepth = dd; bestI = i; }
      }
      const backDir = dirVecs[bestI];
      const push = Math.min(STANDOFF, Math.max(0, bestDepth - 0.8));
      eyePoint = new THREE.Vector3(
        aimXZ.x + backDir.x * push, eyeHeight, aimXZ.y + backDir.y * push,
      );
    }
  } else {
    // Fallback (no enclosed sample found): conservative central level shot.
    eyePoint = new THREE.Vector3(center.x, eyeHeight, center.z);
    target = new THREE.Vector3(aimXZ.x, eyeHeight - 0.25, aimXZ.y);
    const back = new THREE.Vector3().subVectors(eyePoint, target).setY(0);
    if (back.lengthSq() < 1e-4) back.set(0, 0, 1);
    back.normalize();
    eyePoint.x = target.x + back.x * 3.5;
    eyePoint.z = target.z + back.z * 3.5;
  }

  // ── CAMERA SOURCE PRECEDENCE: window.__cam (live tuning) > preset (hardcoded
  // per room) > auto (computed above). The live override lets you dial in a
  // room's numbers in the console; the preset is the baked-in result per room.
  const camOverride = (typeof window !== 'undefined') ? window.__cam : null;
  // A real-estate-photography lens — wide enough to read the room as a
  // space, but not so wide it distorts verticals into a fisheye look. 60° is
  // the sweet spot here: 68° pushed the walls out far enough that the shot
  // saw past the room edges into black void.
  let fov = 60;
  if (preset) {
    if (preset.eye)  eyePoint.fromArray(preset.eye);
    if (preset.look) target.fromArray(preset.look);
    if (preset.fov)  fov = preset.fov;
  }
  if (camOverride) {
    if (camOverride.eye)  eyePoint.fromArray(camOverride.eye);
    if (camOverride.look) target.fromArray(camOverride.look);
    if (camOverride.fov)  fov = camOverride.fov;
  }
  return { eyePoint, target, fov, far: Math.max(W, H, D) * 12 };
}

// Takes the user's manually-placed eye/look and nudges the EYE position to
// the best nearby spot, without changing what they're looking at or
// surprising them with a different composition. Reuses the same raycast
// "is this point actually enclosed by real walls" technique as
// computeAutoCamera, but seeded in a small radius around the user's own
// marker (not the whole room) — this fixes the common failure modes of
// manual placement (too close to a wall, standing in a void/outside the
// shell, a column blocking the sightline) while staying faithful to the
// angle the user chose. Falls back to the marker UNCHANGED if no nearby spot
// scores better — refinement should never make a shot worse or unrecognisable.
function refineEyeNearMarker(box, scene, eye, look) {
  const min = box.min, max = box.max;
  const eyeHeight = eye.y;

  const shellMeshes = [];
  scene.traverse(n => {
    // LineSegments2 (the fat column-edge overlay) sets isMesh=true but its
    // raycast() needs a renderer/resolution context not guaranteed here —
    // exclude it explicitly, not just via its own disabled raycast(), so this
    // collection never depends on that override staying in place.
    if (!n.isMesh || n.visible === false || n.isLineSegments2) return;
    let skip = false;
    for (let p = n; p; p = p.parent) {
      const nm = (p.name || '').toLowerCase();
      if (nm.includes('furniture') || nm === 'default') { skip = true; break; }
    }
    if (!skip) shellMeshes.push(n);
  });
  if (!shellMeshes.length) return eye.clone();

  const NDIRS = 16;
  const dirVecs = [];
  for (let i = 0; i < NDIRS; i++) {
    const a = (i / NDIRS) * Math.PI * 2;
    dirVecs.push(new THREE.Vector2(Math.cos(a), Math.sin(a)));
  }
  const ray = new THREE.Raycaster();
  const W = max.x - min.x, D = max.z - min.z;
  ray.far = Math.max(W, D) * 1.5;
  const MAX_ROOM = Math.min(Math.max(W, D), 14);
  const _o = new THREE.Vector3();
  const _d = new THREE.Vector3();

  const probe = (x, z) => {
    _o.set(x, eyeHeight, z);
    let hits = 0, minHit = Infinity;
    for (let i = 0; i < NDIRS; i++) {
      _d.set(dirVecs[i].x, 0, dirVecs[i].y);
      ray.set(_o, _d);
      const hit = ray.intersectObjects(shellMeshes, true)[0];
      if (hit && hit.distance <= MAX_ROOM) { hits++; minHit = Math.min(minHit, hit.distance); }
    }
    return { hits, minHit };
  };

  // Distance from the eye to its OWN look target — preserve roughly the same
  // standoff the user picked, don't second-guess "how close is too close".
  const toLook = new THREE.Vector2(look.x - eye.x, look.z - eye.z);
  const userDist = toLook.length();
  const lookDir = userDist > 1e-4 ? toLook.clone().normalize() : new THREE.Vector2(0, 1);

  // Sample a small local grid around the user's own eye position — a 1.5m
  // radius is enough to escape "half a step into a wall" or "just outside
  // the shell" without relocating to a different part of the room entirely.
  const RADIUS = 1.5;
  const STEPS = 5;
  let best = null, bestScore = -Infinity;
  for (let ix = 0; ix < STEPS; ix++) {
    for (let iz = 0; iz < STEPS; iz++) {
      const x = eye.x + (ix / (STEPS - 1) - 0.5) * 2 * RADIUS;
      const z = eye.z + (iz / (STEPS - 1) - 0.5) * 2 * RADIUS;
      if (x < min.x + 0.3 || x > max.x - 0.3 || z < min.z + 0.3 || z > max.z - 0.3) continue;
      const pr = probe(x, z);
      if (pr.hits < Math.ceil(NDIRS * 0.6) || pr.minHit < 0.6) continue; // not enclosed / jammed against geometry

      // Sightline along the user's chosen look direction must actually reach
      // roughly as far as they intended — penalise spots where something
      // (a column, a wall corner) now blocks the same view sooner than before.
      _o.set(x, eyeHeight, z);
      _d.set(lookDir.x, 0, lookDir.y);
      ray.set(_o, _d);
      const sightHit = ray.intersectObjects(shellMeshes, true)[0];
      const sightDist = sightHit ? sightHit.distance : ray.far;

      const distFromUser = Math.hypot(x - eye.x, z - eye.z);
      const score =
        -distFromUser * 1.2 +                              // prefer staying close to where they pointed
        Math.min(pr.minHit, 1.5) * 1.0 +                    // breathing room from the nearest wall
        Math.min(sightDist, userDist + 1.5) * 1.5;          // clear, undiminished sightline
      if (score > bestScore) { bestScore = score; best = { x, z }; }
    }
  }

  if (!best) return eye.clone();
  return new THREE.Vector3(best.x, eyeHeight, best.z);
}

// Captures one shot from the camera's CURRENT live transform (used right
// after manual placement in the dollhouse view (or a nudge button click) —
// cameraMarker.eye/look is the user's chosen angle; the EYE position is
// auto-refined to the best nearby enclosed spot (see refineEyeNearMarker)
// before capture, so small placement mistakes (too close to a wall, a
// column blocking the view) get fixed without changing what they aimed at.
// Falls back to the auto-framing math only if no marker exists yet.
function InteriorCaptureRig({ box, furniture = [], preset = null, cameraMarker = null, onCaptured }) {
  const { gl, scene, camera } = useThree();

  useEffect(() => {
    if (!box) return;

    if (cameraMarker) {
      const rawEye = new THREE.Vector3(...cameraMarker.eye);
      const lookPt = new THREE.Vector3(...cameraMarker.look);
      const refinedEye = refineEyeNearMarker(box, scene, rawEye, lookPt);
      camera.fov = 60;
      camera.near = 0.05;
      camera.far = Math.max(box.getSize(new THREE.Vector3()).length(), 10) * 12;
      camera.up.set(0, 1, 0);
      camera.position.copy(refinedEye);
      // Keep looking at the same point the user picked, shifted by however
      // much the eye moved, so the framing/composition direction is
      // preserved exactly — only the standing spot was nudged.
      const shift = new THREE.Vector3().subVectors(refinedEye, rawEye);
      camera.lookAt(lookPt.clone().add(shift));
    } else {
      const { eyePoint, target, fov, far } = computeAutoCamera(box, scene, furniture, preset);
      camera.fov = fov;
      camera.near = 0.05;
      camera.far = far;
      camera.up.set(0, 1, 0);
      camera.position.copy(eyePoint);
      camera.lookAt(target);
    }
    camera.updateProjectionMatrix();

    if (typeof window !== 'undefined') {
      window.__lastCam = {
        eye: camera.position.toArray().map(v => +v.toFixed(3)),
        fov: camera.fov,
      };
    }

    // Capture after two frames so textures/AO/env are settled.
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        gl.render(scene, camera);
        let url = null;
        try {
          url = downscaleCanvas(gl.domElement);
        } catch { /* ignore */ }
        if (url) onCaptured(url);
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [box, gl, scene, camera, onCaptured, cameraMarker, furniture, preset]);

  return null;
}
