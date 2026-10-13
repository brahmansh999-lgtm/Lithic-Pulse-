/**
 * Extract programme from medium GLB using real named nodes:
 *   UN_*          → residential units (individual apartments)
 *   staircase     → services
 *   PLINTH        → services (ground-floor core)
 *   balconies     → skip (part of units visually)
 * Community space: not present in medium GLB — use PLINTH area ground floor
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

function nodeBBox(node) {
  const box = new THREE.Box3();
  node.traverse(c => {
    if (c.isMesh) {
      const cb = new THREE.Box3().setFromObject(c);
      if (!cb.isEmpty()) box.union(cb);
    }
  });
  return box.isEmpty() ? null : box;
}

function floorIdx(y) {
  for (let i = 0; i < FLOOR_Y.length - 1; i++) {
    if (y >= FLOOR_Y[i] - 1.5 && y < FLOOR_Y[i + 1] + 0.5) return i;
  }
  return 0;
}

function toObj(b, y0, y1, type, label) {
  return {
    type, label,
    x0: +b.min.x.toFixed(3), x1: +b.max.x.toFixed(3),
    y0: +y0.toFixed(3),       y1: +y1.toFixed(3),
    z0: +b.min.z.toFixed(3), z1: +b.max.z.toFixed(3),
  };
}

const allBoxes = [];

// ── UN_* nodes = individual residential units ──────────────────────────────
const unitNodes = [];
scene.traverse(n => { if (/^UN(_\d+)?$/.test(n.name)) unitNodes.push(n); });
console.log(`Found ${unitNodes.length} UN_* nodes`);

let unitNum = 0;
for (const node of unitNodes) {
  // Only top-level UN nodes (direct children of scene or one level down)
  if (node.parent?.name && /^UN/.test(node.parent.name)) continue;
  const box = nodeBBox(node);
  if (!box) continue;
  const midY = (box.min.y + box.max.y) / 2;
  const fi = floorIdx(midY);
  const y0 = FLOOR_Y[fi];
  const y1 = FLOOR_Y[fi + 1] ?? y0 + 4;
  const w = box.max.x - box.min.x;
  const d = box.max.z - box.min.z;
  if (w < 1 || d < 1) continue;
  unitNum++;
  allBoxes.push({ floorIdx: fi, ...toObj(box, y0, y1, 'units', node.name) });
}
console.log(`→ ${unitNum} residential unit boxes`);

// ── staircase node = services ─────────────────────────────────────────────
const stairNode = scene.getObjectByName('staircase');
if (stairNode) {
  // per-floor boxes
  const perFloor = FLOOR_Y.slice(0, -1).map(() => new THREE.Box3());
  stairNode.traverse(c => {
    if (!c.isMesh) return;
    const cb = new THREE.Box3().setFromObject(c);
    if (cb.isEmpty()) return;
    const fi = floorIdx((cb.min.y + cb.max.y) / 2);
    if (fi >= 0 && fi < perFloor.length) perFloor[fi].union(cb);
  });
  perFloor.forEach((b, fi) => {
    if (!b.isEmpty()) allBoxes.push({ floorIdx: fi, ...toObj(b, FLOOR_Y[fi], FLOOR_Y[fi+1], 'services', 'Staircase') });
  });
  console.log('Staircase: added service boxes per floor');
}

// ── PLINTH node = ground-floor community/lobby ────────────────────────────
const plinthNode = scene.getObjectByName('PLINTH');
if (plinthNode) {
  const box = nodeBBox(plinthNode);
  if (box) {
    allBoxes.push({ floorIdx: 0, ...toObj(box, FLOOR_Y[0], FLOOR_Y[1], 'community', 'Lobby / Plinth') });
    console.log('PLINTH: added community box');
  }
}

// ── external_wall → detect balconies as community on ground floor? No — skip.

// ── Group into floors ──────────────────────────────────────────────────────
const floors = FLOOR_Y.slice(0, -1).map((y0, fi) => {
  const y1 = FLOOR_Y[fi + 1];
  const boxes = allBoxes.filter(b => b.floorIdx === fi);
  const u = boxes.filter(b => b.type === 'units').length;
  const s = boxes.filter(b => b.type === 'services').length;
  const c = boxes.filter(b => b.type === 'community').length;
  console.log(`Floor ${fi+1} (y${y0}–${y1}): ${u} units  ${s} services  ${c} community`);
  return { floorIdx: fi, y0, y1, boxes };
});

writeFileSync(resolve(root, 'public/BLDGS/programme_medium.json'), JSON.stringify({ floors }, null, 2));
console.log('\nWrote public/BLDGS/programme_medium.json');
