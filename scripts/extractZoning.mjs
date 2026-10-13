// Reverse-engineers a zoningSpec from a completed-building GLB.
// Runs OFFLINE in Node (NOT shipped to the browser) — the source GLBs are
// 70-445MB each; the app only ever needs the small JSON this produces.
//
// Usage: node scripts/extractZoning.mjs > src/planner/data/precedentZoning.json
//
// What it reads, per top-level node group (fuzzy-matched by name, since the
// 11 source files come from different CAD/Grasshopper exports with
// inconsistent naming — "STAIRS" vs "staircase", "green terraces" only on
// some files, "Make2D$..." debug layers on others that must be ignored):
//   columns        → grid pitch (centre-to-centre spacing) + count
//   stairs/staircase → core count + footprint (used later for stair-placement rule)
//   external wall(s) → building footprint outline → site coverage
//   floor plates/slabs/floors → floor count, floor-to-floor height → unit count estimate
//   glasses        → glazing ratio (proxy for entry/community-facing facades)
//   terrace/balcon → green/amenity space proxy
//
// Output zoningSpec shape (matches what scoreAgainstZoning will compare
// generateMasterplan() output against):
//   { id, sourceFile, footprintAreaM2, siteSpanM:{w,h}, coverageEstimatePct,
//     floorCount, floorToFloorM, unitCountEstimate, columnGridM,
//     greenAreaEstimatePct, entryFacadeHint }

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { readdirSync } from 'fs';
import { join } from 'path';

const SRC_DIR = 'bldg_gl';

// ── name classification ────────────────────────────────────────────
function classifyNode(name) {
  const n = (name || '').toLowerCase();
  if (n.startsWith('make2d') || n === 'default' || n === 'layer0') return null; // CAD export noise
  if (n.includes('column')) return 'columns';
  if (n.includes('stair')) return 'stairs';
  if (n.includes('terrace') || n.includes('green')) return 'green';
  if (n.includes('balcon')) return 'green'; // amenity-adjacent, counts toward open/communal space
  if (n.includes('external wall')) return 'externalWalls';
  if (n.includes('glass')) return 'glazing';
  if (n.includes('floor plate') || n === 'slabs' || n.includes('floor')) return 'floors';
  if (n.includes('railing') || n.includes('plinth') || n.includes('lift') || n.includes('corridor')) return 'other';
  return 'other';
}

// World-space AABB for one node's meshes (samples vertices for speed on huge meshes).
function nodeWorldBBox(node) {
  const mesh = node.getMesh();
  if (!mesh) return null;
  const m = node.getWorldMatrix();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  let any = false;
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    if (!pos) continue;
    const count = pos.getCount();
    const stride = Math.max(1, Math.floor(count / 500)); // sample, not full read — these meshes are huge
    const v = [0, 0, 0];
    for (let i = 0; i < count; i += stride) {
      pos.getElement(i, v);
      const [x, y, z] = v;
      const wx = m[0]*x + m[4]*y + m[8]*z  + m[12];
      const wy = m[1]*x + m[5]*y + m[9]*z  + m[13];
      const wz = m[2]*x + m[6]*y + m[10]*z + m[14];
      if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
      if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
      if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz;
      any = true;
    }
  }
  return any ? { minX, maxX, minY, maxY, minZ, maxZ } : null;
}

function mergeBBox(a, b) {
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX), maxX: Math.max(a.maxX, b.maxX),
    minY: Math.min(a.minY, b.minY), maxY: Math.max(a.maxY, b.maxY),
    minZ: Math.min(a.minZ, b.minZ), maxZ: Math.max(a.maxZ, b.maxZ),
  };
}

// Column instances → cluster XZ positions to estimate grid pitch (centre-to-
// centre spacing) AND return the real ground-level column centres
// themselves (raw world-space [x,z] pairs — caller normalises against the
// building's own bbox). The real centres are what let ColumnStage place
// columns at the matched GLB's ACTUAL layout instead of a synthetic
// uniform grid. The source GLBs export columns as short per-floor
// SEGMENTS stacked up the building (each ~0.9-1.5m tall), not one mesh per
// full-height column — so the raw leaf list contains the same XZ post
// position repeated at many different Y levels. Comparing all of them
// together pollutes the spacing estimate with duplicate-position noise.
// Fix: only look at segments whose minY sits in the lowest occupied band
// (ground floor posts) — one segment per real column at that level.
function estimateColumnGrid(columnBoxes) {
  if (columnBoxes.length < 4) return { gridM: null, centres: [] };

  // A column is a vertical post: its XZ position is the SAME all the way up the
  // building, just exported as many stacked per-floor SEGMENTS at different Y
  // levels. So the real column FOOTPRINT is the set of distinct XZ centres
  // across the WHOLE stack — collapse every segment onto the floor plan and
  // dedup by XZ. (The previous version only kept segments within 1m of the
  // single lowest point, which on buildings with a basement post or two below
  // the main structure threw away the entire real grid — glbmedium.glb has
  // 2460 column segments but only 8 sat in that lowest 1m band → a bogus
  // 4-column "grid". Collapsing the full stack recovers the true layout.)
  //
  // Each real post still produces several near-coincident centres (segment
  // overlap + per-floor offset jitter), so cluster within 0.6m to merge a
  // post's own segments without merging two genuinely adjacent posts (real
  // structural spans are >2m, see the gap filter below).
  const rawCentres = columnBoxes.map(b => [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2]);
  const centres = [];
  for (const c of rawCentres) {
    if (!centres.some(e => Math.hypot(e[0] - c[0], e[1] - c[1]) < 0.6)) centres.push(c);
  }
  if (centres.length < 4) return { gridM: null, centres: [] };

  const xs = [...new Set(centres.map(c => Math.round(c[0] * 10) / 10))].sort((a, b) => a - b);
  const zs = [...new Set(centres.map(c => Math.round(c[1] * 10) / 10))].sort((a, b) => a - b);
  const gaps = (arr) => {
    const d = [];
    for (let i = 1; i < arr.length; i++) {
      const g = arr[i] - arr[i - 1];
      if (g > 2.0 && g < 20) d.push(g); // plausible structural span range
    }
    return d;
  };
  const allGaps = [...gaps(xs), ...gaps(zs)];
  const gridM = allGaps.length
    ? Math.round(allGaps.slice().sort((a, b) => a - b)[Math.floor(allGaps.length / 2)] * 10) / 10
    : null;
  return { gridM, centres };
}

export async function extractOne(filePath) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(filePath);
  const root = doc.getRoot();

  const groups = { columns: [], stairs: [], green: [], externalWalls: [], glazing: [], floors: [], other: [] };

  // Group classification lives on named CONTAINER nodes (e.g. "columns",
  // "STAIRS") — their actual mesh geometry sits on unnamed leaf children one
  // level down. So: find each named group node, then collect bboxes from
  // every mesh-bearing descendant beneath it (not from the group node itself,
  // which usually has no mesh).
  const scene = root.listScenes()[0];
  if (!scene) return null;

  function collectLeafBBoxes(node, out) {
    const bbox = nodeWorldBBox(node);
    if (bbox) out.push(bbox);
    for (const child of node.listChildren()) collectLeafBBoxes(child, out);
  }

  function walkForGroups(node) {
    const cls = classifyNode(node.getName());
    if (cls && cls !== 'other') {
      collectLeafBBoxes(node, groups[cls]);
      return; // don't descend further — whole subtree already classified
    }
    for (const child of node.listChildren()) walkForGroups(child);
  }

  for (const top of scene.listChildren()) walkForGroups(top);

  let overallBBox = null;
  for (const k of Object.keys(groups)) for (const b of groups[k]) overallBBox = mergeBBox(overallBBox, b);
  if (!overallBBox) return null;

  const siteSpanM = {
    w: Math.round((overallBBox.maxX - overallBBox.minX) * 10) / 10,
    h: Math.round((overallBBox.maxZ - overallBBox.minZ) * 10) / 10,
  };

  // Footprint area from external-wall group's XZ extent (proxy — real footprint
  // is the convex hull, but for a coverage ESTIMATE the bbox is fit for purpose).
  let footprintAreaM2 = null;
  if (groups.externalWalls.length) {
    let fb = null;
    for (const b of groups.externalWalls) fb = mergeBBox(fb, b);
    footprintAreaM2 = Math.round((fb.maxX - fb.minX) * (fb.maxZ - fb.minZ));
  }
  const siteAreaM2 = siteSpanM.w * siteSpanM.h;
  const coverageEstimatePct = footprintAreaM2 && siteAreaM2
    ? Math.round((footprintAreaM2 / siteAreaM2) * 100)
    : null;

  // Floor count: cluster floor/slab leaf centroid Y values into storey bands.
  // Each "floor" leaf mesh has real thickness + per-vertex sampling noise, so
  // naive rounding produces many near-duplicate levels per actual storey
  // (e.g. one slab's samples spanning 3.6-4.8m all look like different
  // levels). Real floor-to-floor height is 2.5-4m, so cluster by gap > 1.5m
  // — wide enough to swallow in-slab noise, narrow enough not to merge
  // adjacent storeys.
  let floorCount = null, floorToFloorM = null;
  if (groups.floors.length) {
    const ys = groups.floors.map(b => (b.minY + b.maxY) / 2).sort((a, b) => a - b);
    const levels = [];
    let bandStart = 0;
    for (let i = 1; i <= ys.length; i++) {
      if (i === ys.length || ys[i] - ys[i - 1] > 1.5) {
        const band = ys.slice(bandStart, i);
        levels.push(band.reduce((s, y) => s + y, 0) / band.length);
        bandStart = i;
      }
    }
    floorCount = levels.length || null;
    if (levels.length > 1) {
      const diffs = [];
      for (let i = 1; i < levels.length; i++) diffs.push(levels[i] - levels[i - 1]);
      floorToFloorM = Math.round((diffs.reduce((s, d) => s + d, 0) / diffs.length) * 10) / 10;
    }
  }

  // Unit count estimate: gross floor area (footprint x floors) / typical unit
  // area (65m2), then a NET-EFFICIENCY factor (0.55) to account for
  // corridors, stair/lift cores, structure and external walls eating into
  // the gross area — none of which this extraction measures directly. 0.55
  // is a standard residential gross-to-net efficiency ratio; without it the
  // raw gross/65 figure overstates real achievable density by roughly 3x
  // against what masterplanGenerator.js actually produces for an equivalent
  // footprint (verified against its own seed-sweep output).
  const NET_EFFICIENCY = 0.55;
  const unitCountEstimate = footprintAreaM2 && floorCount
    ? Math.max(1, Math.round((footprintAreaM2 * floorCount * NET_EFFICIENCY) / 65))
    : null;

  const { gridM: columnGridM, centres: columnCentres } = estimateColumnGrid(groups.columns);

  // Green/amenity proxy: terrace+balcony bbox footprint area vs building footprint.
  let greenAreaEstimatePct = null;
  if (groups.green.length && footprintAreaM2) {
    let gb = null;
    for (const b of groups.green) gb = mergeBBox(gb, b);
    const greenArea = (gb.maxX - gb.minX) * (gb.maxZ - gb.minZ);
    greenAreaEstimatePct = Math.min(100, Math.round((greenArea / footprintAreaM2) * 100));
  }

  // Per-group "zone block" shape — the merged bbox of each classified group,
  // normalised against the overall building bbox into [0..1] XZ + a 0..1 Y
  // (height) fraction. This is what the isometric massing diagram (step
  // 02/Massing) extrudes into blocks — real exterior proportions traced
  // straight from the source GLB, not a procedural guess.
  const overallW = overallBBox.maxX - overallBBox.minX || 1;
  const overallH = overallBBox.maxY - overallBBox.minY || 1;
  const overallD = overallBBox.maxZ - overallBBox.minZ || 1;
  const zoneBlocks = {};
  for (const [k, boxes] of Object.entries(groups)) {
    if (!boxes.length) continue;
    let gb = null;
    for (const b of boxes) gb = mergeBBox(gb, b);
    zoneBlocks[k] = {
      x: (gb.minX - overallBBox.minX) / overallW,
      z: (gb.minZ - overallBBox.minZ) / overallD,
      w: (gb.maxX - gb.minX) / overallW,
      d: (gb.maxZ - gb.minZ) / overallD,
      y0: (gb.minY - overallBBox.minY) / overallH,
      y1: (gb.maxY - overallBBox.minY) / overallH,
    };
  }

  // Real ground-level column positions, normalised into [0..1] against the
  // overall building footprint (same XZ space as zoneBlocks above) — this
  // is the actual matched-GLB column LAYOUT, not just a pitch number, so
  // ColumnStage can place columns at the real building's real positions
  // (mapped onto the chosen massing's footprint) instead of a synthetic
  // uniform grid.
  const columnPositions = columnCentres.map(([x, z]) => ({
    x: (x - overallBBox.minX) / overallW,
    z: (z - overallBBox.minZ) / overallD,
  }));

  return {
    sourceFile: filePath,
    siteSpanM,
    footprintAreaM2,
    coverageEstimatePct,
    floorCount,
    floorToFloorM,
    unitCountEstimate,
    columnGridM,
    columnPositions,
    greenAreaEstimatePct,
    stairCoreCount: groups.stairs.length ? estimateStairCores(groups.stairs) : null,
    counts: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])),
    zoneBlocks,
  };
}

// Stair meshes are usually many small instances (treads/risers) per core, not
// one mesh per core — cluster bbox centres within 3m to estimate distinct cores.
function estimateStairCores(stairBoxes) {
  const centres = stairBoxes.map(b => [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2]);
  const cores = [];
  for (const c of centres) {
    let found = cores.find(core => Math.hypot(core[0] - c[0], core[1] - c[1]) < 3);
    if (!found) cores.push(c);
  }
  return cores.length;
}

async function main() {
  const files = readdirSync(SRC_DIR)
    .filter(f => /\.glb$/i.test(f))
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)?.[0] || '0', 10);
      const nb = parseInt(b.match(/\d+/)?.[0] || '0', 10);
      return na - nb;
    });

  const results = [];
  for (const f of files) {
    const path = join(SRC_DIR, f);
    process.stderr.write(`extracting ${f}...\n`);
    try {
      const spec = await extractOne(path);
      if (spec) results.push({ id: `precedent_${results.length + 1}`, name: f.replace(/\.glb$/i, ''), ...spec });
    } catch (e) {
      process.stderr.write(`  FAILED: ${e.message}\n`);
    }
  }
  console.log(JSON.stringify(results, null, 2));
}

// Only run the 11-precedent batch when invoked directly
// (node scripts/extractZoning.mjs) — NOT when extractOne is imported by
// extractClasses.mjs, which drives its own 4-class run.
import { pathToFileURL } from 'url';
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
