/**
 * Extract programme boxes from medium GLB using actual node names:
 *   - community_space  → community
 *   - staircase + lift → services
 *   - floors (minus above) → residential units
 */
import { createRequire } from 'module';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, '..');

const THREE = require('three');
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;

const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
const { DRACOLoader } = await import('three/examples/jsm/loaders/DRACOLoader.js');

const draco = new DRACOLoader();
draco.setDecoderPath(resolve(root, 'node_modules/three/examples/jsm/libs/draco/'));
draco.setDecoderConfig({ type: 'js' });
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);

const buf = readFileSync(resolve(root, 'BLDGS/glbmedium.glb'));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const gltf = await new Promise((res, rej) => loader.parse(ab, '', res, rej));
const scene = gltf.scene;
scene.updateMatrixWorld(true);

const FLOOR_Y = [0.5, 4.5, 8.0, 11.5, 15.0, 19.0, 22.5];

function bbox(node) {
  const box = new THREE.Box3();
  node.traverse(c => {
    if (c.isMesh) {
      const cb = new THREE.Box3().setFromObject(c);
      if (!cb.isEmpty()) box.union(cb);
    }
  });
  return box.isEmpty() ? null : box;
}

function toObj(b, y0, y1) {
  return {
    x0: +b.min.x.toFixed(3), x1: +b.max.x.toFixed(3),
    y0: +y0.toFixed(3),       y1: +y1.toFixed(3),
    z0: +b.min.z.toFixed(3), z1: +b.max.z.toFixed(3),
  };
}

function floorBand(y) {
  for (let i = 0; i < FLOOR_Y.length - 1; i++) {
    if (y >= FLOOR_Y[i] - 1.0 && y < FLOOR_Y[i + 1]) return i;
  }
  return -1;
}

// ── 1. Services: staircase + lift — one box per floor they span ──────────────
const serviceNodes = ['staircase', 'lift'].map(n => scene.getObjectByName(n)).filter(Boolean);
console.log('Service nodes found:', serviceNodes.map(n => n.name));

const serviceBoxes = []; // [{floorIdx, box}]
for (const node of serviceNodes) {
  // Get per-mesh boxes, assign to floors
  const perFloor = FLOOR_Y.slice(0, -1).map(() => new THREE.Box3());
  node.traverse(c => {
    if (!c.isMesh) return;
    const cb = new THREE.Box3().setFromObject(c);
    if (cb.isEmpty()) return;
    const midY = (cb.min.y + cb.max.y) / 2;
    const fi = floorBand(midY);
    if (fi >= 0) perFloor[fi].union(cb);
  });
  perFloor.forEach((b, fi) => {
    if (!b.isEmpty()) serviceBoxes.push({ floorIdx: fi, type: 'services', box: b });
  });
}

// ── 2. Community: community_space node — one box per floor ───────────────────
const commNode = scene.getObjectByName('community_space');
console.log('Community node:', commNode ? 'found' : 'not found');

const communityBoxes = [];
if (commNode) {
  const perFloor = FLOOR_Y.slice(0, -1).map(() => new THREE.Box3());
  commNode.traverse(c => {
    if (!c.isMesh) return;
    const cb = new THREE.Box3().setFromObject(c);
    if (cb.isEmpty()) return;
    const midY = (cb.min.y + cb.max.y) / 2;
    const fi = floorBand(midY);
    if (fi >= 0) perFloor[fi].union(cb);
  });
  perFloor.forEach((b, fi) => {
    if (!b.isEmpty()) communityBoxes.push({ floorIdx: fi, type: 'community', box: b });
  });
}

// ── 3. Residential units: floors node, per-mesh → merge into unit footprints ─
// Exclude XZ regions occupied by services/community
const floorsNode = scene.getObjectByName('floors');
console.log('Floors node:', floorsNode ? 'found' : 'not found');

function mergeOverlapping(boxes, gap = 0.5) {
  const used = new Set();
  const out = [];
  for (let i = 0; i < boxes.length; i++) {
    if (used.has(i)) continue;
    const m = boxes[i].clone();
    used.add(i);
    let changed = true;
    while (changed) {
      changed = false;
      for (let j = 0; j < boxes.length; j++) {
        if (used.has(j)) continue;
        if (boxes[j].min.x <= m.max.x + gap && boxes[j].max.x >= m.min.x - gap &&
            boxes[j].min.z <= m.max.z + gap && boxes[j].max.z >= m.min.z - gap) {
          m.union(boxes[j]);
          used.add(j);
          changed = true;
        }
      }
    }
    out.push(m);
  }
  return out;
}

// Collect service+community XZ footprints per floor to subtract
const exclusions = [...serviceBoxes, ...communityBoxes];

function overlapsExclusion(box, floorIdx) {
  return exclusions.some(e =>
    e.floorIdx === floorIdx &&
    e.box.min.x < box.max.x && e.box.max.x > box.min.x &&
    e.box.min.z < box.max.z && e.box.max.z > box.min.z
  );
}

const unitsByFloor = FLOOR_Y.slice(0, -1).map(() => []);

floorsNode?.traverse(c => {
  if (!c.isMesh) return;
  const cb = new THREE.Box3().setFromObject(c);
  if (cb.isEmpty()) return;
  const w = cb.max.x - cb.min.x;
  const d = cb.max.z - cb.min.z;
  const h = cb.max.y - cb.min.y;
  if (h > 1.5 || w < 1.5 || d < 1.5) return;
  const midY = (cb.min.y + cb.max.y) / 2;
  const fi = floorBand(midY);
  if (fi < 0) return;
  if (!overlapsExclusion(cb, fi)) {
    unitsByFloor[fi].push(cb);
  }
});

const unitBoxes = [];
unitsByFloor.forEach((boxes, fi) => {
  const merged = mergeOverlapping(boxes);
  merged.forEach(b => unitBoxes.push({ floorIdx: fi, type: 'units', box: b }));
});

// ── 4. Assemble per-floor output ─────────────────────────────────────────────
const floors = FLOOR_Y.slice(0, -1).map((y0, fi) => {
  const y1 = FLOOR_Y[fi + 1];
  const all = [
    ...serviceBoxes.filter(e => e.floorIdx === fi).map(e => ({ type: e.type, ...toObj(e.box, y0, y1) })),
    ...communityBoxes.filter(e => e.floorIdx === fi).map(e => ({ type: e.type, ...toObj(e.box, y0, y1) })),
    ...unitBoxes.filter(e => e.floorIdx === fi).map(e => ({ type: e.type, ...toObj(e.box, y0, y1) })),
  ];
  console.log(`Floor ${fi+1} (y${y0}–${y1}): ${all.filter(x=>x.type==='units').length} units, ${all.filter(x=>x.type==='services').length} service, ${all.filter(x=>x.type==='community').length} community`);
  return { floorIdx: fi, y0, y1, boxes: all };
});

writeFileSync(resolve(root, 'public/BLDGS/programme_medium.json'), JSON.stringify({ floors }, null, 2));
console.log('\nWrote public/BLDGS/programme_medium.json');
