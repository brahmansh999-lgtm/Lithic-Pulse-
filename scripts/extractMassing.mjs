/**
 * extractMassing.mjs
 *
 * Reads each of the 4 building GLBs, traverses every mesh node,
 * computes its world-space axis-aligned bounding box, and clusters
 * the results into "massing blocks" — one box per top-level scene
 * child (or per floor-height slab when nodes aren't organised by block).
 *
 * Outputs: public/BLDGS/massing.json
 * Shape:
 * {
 *   small:  { bounds: {minX,maxX,minY,maxY,minZ,maxZ}, blocks: [{x0,x1,y0,y1,z0,z1}] },
 *   medium: { ... },
 *   large:  { ... },
 *   xl:     { ... }
 * }
 *
 * Each block is a single convex box derived from one named child sub-tree.
 * We skip LINE_STRIP geometry (CAD outlines) and only use TRIANGLES.
 */

import { createRequire } from 'module';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, '..');

// Three.js works in Node when loaded as CJS
const THREE = require('three');

// Patch fetch/self for Three.js loaders
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;
if (typeof globalThis.fetch === 'undefined') {
  const { readFileSync } = await import('fs');
  globalThis.fetch = async (url) => {
    const buf = readFileSync(url.replace('file://', ''));
    return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
}

const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
const { DRACOLoader } = await import('three/examples/jsm/loaders/DRACOLoader.js');

// ---------- loader setup ----------
const draco = new DRACOLoader();
// Use the wasm decoder bundled in node_modules
draco.setDecoderPath(resolve(root, 'node_modules/three/examples/jsm/libs/draco/'));
draco.setDecoderConfig({ type: 'js' });

const loader = new GLTFLoader();
loader.setDRACOLoader(draco);

// ---------- helpers ----------
function loadGLB(path) {
  const buf = readFileSync(path);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((res, rej) => loader.parse(ab, '', res, rej));
}

/**
 * Walk every Mesh in the sub-tree, expand a single Box3.
 * Ignores LineSegments / Line (LINE_STRIP) — we only want solid geometry.
 */
function subtreeBBox(node) {
  const box = new THREE.Box3();
  node.updateWorldMatrix(true, true);
  node.traverse(child => {
    if (child.isMesh) {
      const cb = new THREE.Box3().setFromObject(child);
      if (!cb.isEmpty()) box.union(cb);
    }
  });
  return box.isEmpty() ? null : box;
}

function boxToObj(b) {
  return {
    x0: +b.min.x.toFixed(3), x1: +b.max.x.toFixed(3),
    y0: +b.min.y.toFixed(3), y1: +b.max.y.toFixed(3),
    z0: +b.min.z.toFixed(3), z1: +b.max.z.toFixed(3),
  };
}

/**
 * Given a loaded GLTF scene, compute:
 *  - overall bounds (world bbox of all meshes)
 *  - blocks: one box per top-level child that contains any mesh geometry
 *
 * If a top-level child has no mesh children (e.g. just a transform group),
 * we go one level deeper. This handles Blender exports where the real
 * geometry objects are grandchildren of the scene root.
 */
function extractMassing(gltf) {
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);

  const totalBox = new THREE.Box3();
  const blocks = [];

  const children = scene.children.length > 0 ? scene.children : [scene];

  for (const child of children) {
    const box = subtreeBBox(child);
    if (!box) continue;
    totalBox.union(box);
    blocks.push({ name: child.name || '', ...boxToObj(box) });
  }

  // Merge very small/thin blocks (less than 0.5m in any dim) — likely edge artefacts
  const filtered = blocks.filter(b =>
    (b.x1 - b.x0) > 0.3 &&
    (b.y1 - b.y0) > 0.1 &&
    (b.z1 - b.z0) > 0.3
  );

  // If we only got 1 block (flat scene), cluster by floor bands
  let finalBlocks = filtered;
  if (filtered.length <= 1 && !totalBox.isEmpty()) {
    finalBlocks = clusterByFloor(scene, totalBox);
  }

  return {
    bounds: boxToObj(totalBox),
    blocks: finalBlocks,
  };
}

/**
 * Fallback: when the scene is flat (all meshes at root level),
 * cluster by Y height into floor-slab boxes using 3m floor-to-floor bands.
 */
function clusterByFloor(scene, totalBox) {
  const FLOOR_H = 3.2;
  const minY = totalBox.min.y;
  const maxY = totalBox.max.y;
  const nFloors = Math.max(1, Math.ceil((maxY - minY) / FLOOR_H));

  const slabs = Array.from({ length: nFloors }, (_, i) => {
    const y0 = minY + i * FLOOR_H;
    const y1 = Math.min(minY + (i + 1) * FLOOR_H, maxY);
    return new THREE.Box3(
      new THREE.Vector3(Infinity, y0, Infinity),
      new THREE.Vector3(-Infinity, y1, -Infinity)
    );
  });

  scene.traverse(child => {
    if (!child.isMesh) return;
    const cb = new THREE.Box3().setFromObject(child);
    if (cb.isEmpty()) return;
    const midY = (cb.min.y + cb.max.y) / 2;
    const floor = Math.min(nFloors - 1, Math.max(0, Math.floor((midY - minY) / FLOOR_H)));
    slabs[floor].min.x = Math.min(slabs[floor].min.x, cb.min.x);
    slabs[floor].max.x = Math.max(slabs[floor].max.x, cb.max.x);
    slabs[floor].min.z = Math.min(slabs[floor].min.z, cb.min.z);
    slabs[floor].max.z = Math.max(slabs[floor].max.z, cb.max.z);
  });

  return slabs
    .filter(s => isFinite(s.min.x) && isFinite(s.min.z))
    .map(s => boxToObj(s));
}

// ---------- main ----------
const FILES = {
  small:  resolve(root, 'BLDGS/glbsmall.glb'),
  medium: resolve(root, 'BLDGS/glbmedium.glb'),
  large:  resolve(root, 'BLDGS/glblarge.glb'),
  xl:     resolve(root, 'BLDGS/glbXL.glb'),
};

// Recovered originals (bldg_gl/iteration N.glb) not already represented by
// one of the 4 shipped classes above — iteration 7/9/10 are the same real
// buildings as xl/medium/small (confirmed via matching footprint+floorCount
// in classPrecedents.json vs precedentZoning.json) and iteration 6 is a
// byte-identical duplicate of iteration 1, so none of those three are
// re-extracted here. Run with `node scripts/extractMassing.mjs --recovered`.
const RECOVERED_FILES = {
  iteration1:  resolve(root, 'bldg_gl/iteration 1.glb'),
  iteration2:  resolve(root, 'bldg_gl/iteration 2.glb'),
  iteration3:  resolve(root, 'bldg_gl/iteration 3.glb'),
  iteration4:  resolve(root, 'bldg_gl/iteration 4.glb'),
  iteration5:  resolve(root, 'bldg_gl/iteration 5.glb'),
  iteration8:  resolve(root, 'bldg_gl/iteration 8.glb'),
  iteration11: resolve(root, 'bldg_gl/Iteration 11.glb'),
};

const useRecovered = process.argv.includes('--recovered');
const targets = useRecovered ? RECOVERED_FILES : FILES;

// The app reads src/planner/data/massingBlocks.json (public/BLDGS/massing.json
// was a one-time manual copy of the same content — write to the real path
// directly so the two never drift again). Merge into whatever's already
// there instead of overwriting, so re-running for one set doesn't clobber
// the other.
const outPath = resolve(root, 'src/planner/data/massingBlocks.json');
const existing = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : {};
const result = { ...existing };

for (const [key, path] of Object.entries(targets)) {
  console.log(`Loading ${key} (${path})…`);
  try {
    const gltf = await loadGLB(path);
    result[key] = extractMassing(gltf);
    console.log(`  ✓ ${result[key].blocks.length} blocks, bounds:`, result[key].bounds);
  } catch (e) {
    console.error(`  ✗ ${key}: ${e.message}`);
  }
}

writeFileSync(outPath, JSON.stringify(result, null, 2));
console.log(`\nWrote ${outPath}`);
