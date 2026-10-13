import * as THREE from 'three';

// ─── Lazy, deduplicated texture loading ───────────────────────────────────────
// Optimised WebP sets live in /textures-opt (2K colour/normal, 1K data maps).
// Textures load on first use and are cached, so a map is fetched + decoded at
// most once for the whole app — not 32 4K PNGs eagerly at module import.

const TEX = new THREE.TextureLoader();
const _cache = new Map(); // path → THREE.Texture (shared singleton)

function load(path, { srgb = false } = {}) {
  let t = _cache.get(path);
  if (t) return t;
  t = TEX.load(path);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  _cache.set(path, t);
  return t;
}

const OPT = '/textures-opt';
const srgb   = (p) => load(p, { srgb: true });
const linear = (p) => load(p);

// Texture-set descriptors — resolved lazily via getters so importing this
// module costs nothing until a material is actually built.
const T = {
  get plasterWhite() { return {
    d: srgb(`${OPT}/plaster_white/diff.webp`),
    n: linear(`${OPT}/plaster_white/nor.webp`),
    r: linear(`${OPT}/plaster_white/rough.webp`),
  }; },
  get plasterExt() { return {
    d: srgb(`${OPT}/plaster_external/diff.webp`),
    n: linear(`${OPT}/plaster_external/nor.webp`),
    r: linear(`${OPT}/plaster_external/rough.webp`),
  }; },
  get concreteRaw() { return {
    d: srgb(`${OPT}/concrete_raw/diff.webp`),
    n: linear(`${OPT}/concrete_raw/nor.webp`),
    r: linear(`${OPT}/concrete_raw/rough.webp`),
    ao: linear(`${OPT}/concrete_raw/ao.webp`),
  }; },
  get concretePolished() { return {
    d: srgb(`${OPT}/concrete_polished/diff.webp`),
    n: linear(`${OPT}/concrete_polished/nor.webp`),
    r: linear(`${OPT}/concrete_polished/rough.webp`),
    ao: linear(`${OPT}/concrete_polished/ao.webp`),
  }; },
  get concreteStair() { return {
    d: srgb(`${OPT}/concrete_stair/diff.webp`),
    n: linear(`${OPT}/concrete_stair/nor.webp`),
    r: linear(`${OPT}/concrete_stair/rough.webp`),
  }; },
  get wood() { return {
    d: srgb(`${OPT}/wood_walnut/diff.webp`),
    n: linear(`${OPT}/wood_walnut/nor.webp`),
    r: linear(`${OPT}/wood_walnut/rough.webp`),
    ao: linear(`${OPT}/wood_walnut/ao.webp`),
  }; },
  get metal() { return {
    d: srgb(`${OPT}/metal_fin/diff.webp`),
    n: linear(`${OPT}/metal_fin/nor.webp`),
    r: linear(`${OPT}/metal_fin/rough.webp`),
    m: linear(`${OPT}/metal_fin/metal.webp`),
  }; },
};

// ─── UV-scale shader injection ────────────────────────────────────────────────
// GLBs have packed atlas UVs (range ~0.08–0.17). Scale them in the vertex
// shader so 4K textures tile correctly across each surface.

function withUVScale(mat, scale) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uvScale = { value: scale };
    shader.vertexShader = `uniform float uvScale;\n` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      `#include <uv_vertex>`,
      `#include <uv_vertex>
       #ifdef USE_MAP
         vMapUv *= uvScale;
       #endif
       #ifdef USE_NORMALMAP
         vNormalMapUv *= uvScale;
       #endif
       #ifdef USE_ROUGHNESSMAP
         vRoughnessMapUv *= uvScale;
       #endif
       #ifdef USE_AOMAP
         vAoMapUv *= uvScale;
       #endif
       #ifdef USE_METALNESSMAP
         vMetalnessMapUv *= uvScale;
       #endif`
    );
  };
  mat.needsUpdate = true;
  return mat;
}

// ─── Material factories ───────────────────────────────────────────────────────

// Interior walls — whitish cast concrete, tinted by the user's pigment choice
// from Configure. pigmentHex multiplies onto the base concrete tone rather
// than replacing it outright, so the texture's natural grain/shading survives
// the tint instead of flattening into a single flat color.
export function makePlasterMat(pigmentHex) {
  const s = T.concretePolished;
  const base = new THREE.Color('#eceae5');
  const color = pigmentHex ? base.clone().multiply(new THREE.Color(pigmentHex)) : base;
  const mat = new THREE.MeshStandardMaterial({
    map:          s.d,
    normalMap:    s.n,
    roughnessMap: s.r,
    normalScale:  new THREE.Vector2(0.5, 0.5),
    color,
    roughness:    0.95,
    metalness:    0.0,
    side:         THREE.DoubleSide,
    envMapIntensity: 0.15,
  });
  return withUVScale(mat, 18);
}

// External walls — white cement render
export function makeExternalWallMat() {
  const s = T.plasterExt;
  const mat = new THREE.MeshStandardMaterial({
    map:          s.d,
    normalMap:    s.n,
    roughnessMap: s.r,
    normalScale:  new THREE.Vector2(1.6, 1.6),
    color:        new THREE.Color('#c4bfb6'),
    roughness:    1.0,
    metalness:    0.0,
    side:         THREE.DoubleSide,
    envMapIntensity: 0,
  });
  return withUVScale(mat, 20);
}

// Slabs / floors — white cast concrete
export function makeSlabMat() {
  const s = T.concreteRaw;
  const mat = new THREE.MeshStandardMaterial({
    map:          s.d,
    normalMap:    s.n,
    roughnessMap: s.r,
    aoMap:        s.ao,
    aoMapIntensity: 0.5,
    normalScale:  new THREE.Vector2(1.0, 1.0),
    color:        new THREE.Color('#e4e1da'),   // whitish concrete floor
    roughness:    0.95,
    metalness:    0.0,
    side:         THREE.DoubleSide,
    envMapIntensity: 0.1,
  });
  return withUVScale(mat, 28);
}

// Columns — bright polished white concrete
export function makeColumnMat() {
  const s = T.concretePolished;
  const mat = new THREE.MeshStandardMaterial({
    map:          s.d,
    normalMap:    s.n,
    roughnessMap: s.r,
    aoMap:        s.ao,
    aoMapIntensity: 0.5,
    normalScale:  new THREE.Vector2(0.4, 0.4),
    color:        new THREE.Color('#edeae4'),   // whitish concrete column
    roughness:    0.92,
    metalness:    0.0,
    side:         THREE.DoubleSide,
    envMapIntensity: 0.12,
  });
  return withUVScale(mat, 16);
}

// Staircase — light concrete
export function makeStaircaseMat() {
  const s = T.concreteStair;
  const mat = new THREE.MeshStandardMaterial({
    map:          s.d,
    normalMap:    s.n,
    roughnessMap: s.r,
    normalScale:  new THREE.Vector2(2.0, 2.0),
    color:        new THREE.Color('#bcb8b0'),
    roughness:    1.0,
    metalness:    0.0,
    side:         THREE.DoubleSide,
    envMapIntensity: 0,
  });
  return withUVScale(mat, 12);
}

// Doors — dark walnut wood (WoodFloor051 4K + AO)
export function makeWoodMat(colorHex = '#1a0e06') {
  const s = T.wood;
  const mat = new THREE.MeshStandardMaterial({
    map:          s.d,
    normalMap:    s.n,
    roughnessMap: s.r,
    aoMap:        s.ao,
    aoMapIntensity: 0.8,
    normalScale:  new THREE.Vector2(1.2, 1.2),
    color:        new THREE.Color(colorHex),
    roughness:    1.0,
    metalness:    0.0,
    side:         THREE.DoubleSide,
    envMapIntensity: 0,
  });
  return withUVScale(mat, 14);
}

// FINS — brushed aluminium / steel (Metal032 4K, with metalness map)
export function makeFinMat() {
  const s = T.metal;
  const mat = new THREE.MeshStandardMaterial({
    map:           s.d,
    normalMap:     s.n,
    roughnessMap:  s.r,
    metalnessMap:  s.m,
    normalScale:   new THREE.Vector2(1.0, 1.0),
    color:         new THREE.Color('#a8a59f'),
    roughness:     1.0,
    metalness:     0.0,
    side:          THREE.DoubleSide,
    envMapIntensity: 0,
  });
  return withUVScale(mat, 10);
}

// Glass — clear architectural pane.
// NOTE: deliberately NOT using `transmission`. Transmission forces THREE to
// re-render the entire scene to an offscreen buffer every frame so the glass can
// refract through it — roughly doubling draw cost and the single biggest source
// of lag in the configurator. For flat window panes the refraction is barely
// perceptible anyway, so we fake glass with opacity + a sharp clearcoat reflection
// + high envMap intensity. Visually ~identical for architectural glazing, but it
// renders as a plain cheap transparent surface with no extra scene pass.
export function makeGlassMat() {
  return new THREE.MeshPhysicalMaterial({
    color:              new THREE.Color('#bfe2ff'),
    roughness:          0.05,
    metalness:          0.0,
    reflectivity:       0.6,
    clearcoat:          1.0,
    clearcoatRoughness: 0.04,
    transparent:        true,
    opacity:            0.28,
    side:               THREE.DoubleSide,
    envMapIntensity:    3.5,
    depthWrite:         false,
  });
}

// ─── Apply materials to a loaded scene ───────────────────────────────────────
// Layer → material:
//   columns                            → columnMat   (polished concrete)
//   doors / DOORS                      → doorMat     (dark walnut)
//   furniture                          → furnMat     (warm walnut)
//   windows / glasses                  → glassMat    (glass)
//   slab / floors / top slabs /
//   bottom slabs / balconies           → slabMat     (raw concrete + AO)
//   external walls                     → extWallMat  (cement render)
//   FINS                               → finMat      (brushed metal)
//   STAIRCASE                          → staircaseMat(aggregate concrete)
//   internal walls / Default / rest    → wallMat     (plaster, tintable)

// Material cache. Each factory does an onBeforeCompile shader injection, and a
// shader recompile is one of the biggest GPU stalls in WebGL. applyMaterials is
// called on every room load / pigment change / scene mount, so without caching
// we rebuilt 9 materials and recompiled 9 shaders every single time. Now the
// pigment-independent materials are built exactly once and shared forever, and
// the only pigment-dependent one (interior wall plaster) is memoised per colour.
let _sharedMats = null;
const _wallMatByPigment = new Map();

function getSharedMats() {
  if (_sharedMats) return _sharedMats;
  _sharedMats = {
    extWallMat:   makeExternalWallMat(),
    slabMat:      makeSlabMat(),
    colMat:       makeColumnMat(),
    doorMat:      makeWoodMat('#5c3317'),
    furnMat:      makeWoodMat('#2a1508'),
    glassMat:     makeGlassMat(),
    finMat:       makeFinMat(),
    staircaseMat: makeStaircaseMat(),
  };
  return _sharedMats;
}

function getWallMat(pigmentHex) {
  let m = _wallMatByPigment.get(pigmentHex);
  if (!m) { m = makePlasterMat(pigmentHex); _wallMatByPigment.set(pigmentHex, m); }
  return m;
}

// The known architectural layer group names (normalised). A mesh's material
// is decided by the NEAREST NAMED ANCESTOR that matches one of these — not by
// the mesh's own name.
//
// Why: the GLBs group meshes under named parents ("glasses", "EXTERNAL WALLS",
// "columns", …) but the individual mesh children are generically named
// ("mesh_43", "mesh_154_2", …). The old code traversed every node and applied
// a material keyed off that node's OWN name: the parent group correctly set
// glass on its children, but the traversal then visited each generic-named
// child and overwrote it with the default wall material (last write wins). So
// every part collapsed to one material — the "glass locked to a single
// material" bug. Resolving by nearest named ancestor fixes it: a mesh_43 sitting
// under the "glasses" group resolves to 'glasses' and keeps glass.
const KNOWN_LAYER_KEYS = new Set([
  'columns', 'doors', 'door', 'furniture', 'windows', 'glasses', 'glass',
  'slab', 'floors', 'floor', 'top slabs', 'bottom slabs', 'balconies',
  'external walls', 'fins', 'staircase', 'internal walls', 'railings',
]);

function normKey(name) {
  return (name || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Walk up from a mesh to the closest ancestor whose (normalised) name is a
// known layer group; return that key, or '' if none matched (→ default wall).
function layerKeyForMesh(mesh) {
  let n = mesh;
  while (n) {
    const k = normKey(n.name);
    if (KNOWN_LAYER_KEYS.has(k)) return k;
    n = n.parent;
  }
  return '';
}

export function applyMaterials(scene, pigmentHex = '#f5f2ee') {
  const { extWallMat, slabMat, colMat, doorMat, furnMat, glassMat, finMat, staircaseMat } = getSharedMats();
  const wallMat = getWallMat(pigmentHex);

  // Route PER MESH by nearest named ancestor group (see layerKeyForMesh) — a
  // single pass, no parent/child overwrite. Generic-named meshes inside a
  // "glasses"/"columns"/… group inherit that group's material.
  scene.traverse((child) => {
    if (!child.isMesh) return;
    const key = layerKeyForMesh(child);
    let mat;
    if (key === 'columns') {
      mat = colMat;
    } else if (key === 'doors' || key === 'door') {
      mat = doorMat;
    } else if (key === 'furniture') {
      mat = furnMat;
    } else if (key === 'windows' || key === 'glasses' || key === 'glass') {
      mat = glassMat;
    } else if (
      key === 'slab' || key === 'floors' || key === 'floor' ||
      key === 'top slabs' || key === 'bottom slabs' || key === 'balconies'
    ) {
      mat = slabMat;
    } else if (key === 'external walls') {
      mat = extWallMat;
    } else if (key === 'fins') {
      mat = finMat;
    } else if (key === 'staircase') {
      mat = staircaseMat;
    } else {
      mat = wallMat;
    }
    child.material      = mat;
    child.castShadow    = true;
    child.receiveShadow = true;
    if (mat === glassMat) child.renderOrder = 1;
  });
}

// ─── Flat-colour materials (fast Configure mode) ─────────────────────────────
// No texture maps, no onBeforeCompile shader injection — just solid colours per
// layer. This is the lightweight path for the Configure step: textured PBR
// materials (diff+normal+rough maps × 7 sets + UV-scale shader recompiles) were
// a major load/lag source. Colours match the whitish-concrete palette so the
// room still reads correctly; we layer real textures back in skilfully later.
// One whitish-concrete material family — every part is the same near-white
// concrete, differentiated ONLY by a subtle tonal step (near-white → slightly
// greyer) so the structure reads apart without looking like different materials.
// Tight greyscale ramp, neutral (no warm/cool tint).
// Palette with CLEARLY SEPARATED tones so each structural element reads apart
// at a glance — a presentation model where you can instantly tell internal
// walls from external walls from columns from glass. Still a coherent warm
// stone+wood family, but with real contrast between adjacent parts.
// Cast stone is the MAIN structural material (columns, slabs, walls, balconies)
// → a clean LIGHT stone tone for all of them, separated only by a gentle step so
// the elements still read apart. Wood floor + glass + timber doors are the
// accents that contrast against the light stone.
// Neutral WHITE PLASTER family — columns + walls read as plain plaster (white
// for columns, a touch greyer for walls) rather than warm limestone, with wood
// doors and glass windows as the only material accents.
const FLAT_COLORS = {
  walls:          '#dcdcd8',   // interior walls — greyish-white plaster
  externalWalls:  '#d4d4cf',   // exterior walls — slightly deeper grey plaster
  columns:        '#f1f0ec',   // columns/vaults — white plaster
  slabTop:        '#cfcec9',   // roof / top slab — deeper grey plaster
  slabBottom:     '#d6d5cf',   // FLOOR — grey plaster (continuous)
  balconies:      '#d9d8d2',   // balcony decks — grey plaster
  doors:          '#8a5e34',   // doors — warm wood (accent)
  fins:           '#cdccc7',   // grey plaster
  staircase:      '#d2d1cc',   // grey plaster
  windows:        '#4a90d9',   // BLUE-TINTED GLASS — saturated architectural blue
};

let _flatMats = null;
function getFlatMats() {
  if (_flatMats) return _flatMats;
  const std = (hex, opts = {}) => new THREE.MeshStandardMaterial({
    color: new THREE.Color(hex), roughness: 0.95, metalness: 0.0,
    side: THREE.DoubleSide, envMapIntensity: 0.1, ...opts,
  });
  _flatMats = {
    colMat:        std(FLAT_COLORS.columns),
    doorMat:       std(FLAT_COLORS.doors),
    // Lightly-tinted, mostly see-through glass — low opacity so the skyline
    // backdrop (WindowSkylineBackdrop) reads clearly through it, matching the
    // Hero/render view instead of hiding the exterior behind a frosted pane.
    // MeshPhysicalMaterial (not std/Standard) so clearcoat gives it a sharp
    // specular highlight — reads as glazing instead of flat tinted plastic.
    glassMat:      new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(FLAT_COLORS.windows), transparent: true, opacity: 0.38,
      roughness: 0.05, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.05,
      reflectivity: 0.6, side: THREE.DoubleSide, envMapIntensity: 1.4, depthWrite: false,
    }),
    slabTopMat:    std(FLAT_COLORS.slabTop),
    slabBottomMat: std(FLAT_COLORS.slabBottom),
    balconyMat:    std(FLAT_COLORS.balconies),
    extWallMat:    std(FLAT_COLORS.externalWalls),
    finMat:        std(FLAT_COLORS.fins),
    staircaseMat:  std(FLAT_COLORS.staircase),
    wallMat:       std(FLAT_COLORS.walls),
  };
  return _flatMats;
}

// Same layer→material routing as applyMaterials, but with the flat colour set
// and no shadow flags (Configure has no shadow lights). Drop-in replacement.
export function applyFlatMaterials(scene) {
  const m = getFlatMats();
  // Route PER MESH by nearest named ancestor group (same fix as applyMaterials).
  scene.traverse((child) => {
    if (!child.isMesh) return;
    const key = layerKeyForMesh(child);
    let mat;
    if (key === 'columns') mat = m.colMat;
    else if (key === 'doors' || key === 'door') mat = m.doorMat;
    else if (key === 'furniture') mat = m.wallMat;   // furniture GLTFs keep own mats; this only hits baked-in furniture
    else if (key === 'windows' || key === 'glasses' || key === 'glass') mat = m.glassMat;
    else if (key === 'top slabs') mat = m.slabTopMat;
    else if (key === 'bottom slabs' || key === 'floors' || key === 'floor' || key === 'slab') mat = m.slabBottomMat;
    else if (key === 'balconies') mat = m.balconyMat;
    else if (key === 'external walls') mat = m.extWallMat;
    else if (key === 'fins') mat = m.finMat;
    else if (key === 'staircase') mat = m.staircaseMat;
    else mat = m.wallMat;   // interior walls / default

    child.material = mat;
    child.castShadow = false;
    child.receiveShadow = false;
    if (mat === m.glassMat) child.renderOrder = 1;
  });
}

// ─── Center scene at world origin for pivot rotation ─────────────────────────

export function centerScene(scene) {
  const box    = new THREE.Box3().setFromObject(scene);
  const center = box.getCenter(new THREE.Vector3());
  const size   = box.getSize(new THREE.Vector3());
  scene.position.set(-center.x, -center.y, -center.z);
  return { size, center };
}
