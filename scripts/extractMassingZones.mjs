// Extracts real architectural-program zone data (Units / Green / Connector /
// Amenity / Parking) from DXF/READ.dxf — a Rhino "Make2D" export with a
// single building's floor plans (Ground / 1-3 / 4-5 / 6th) laid out
// left-to-right on one sheet, each room labelled by MTEXT (e.g. "CORRIDOOR",
// "SOCIAL SEATING POCKETS", "GREEN PATCH FROM BASEMENT", unit-typology codes
// like "3B4P"). Room polygons in the DXF are drawn with LINE+ARC segments
// (rounded-rect corners), not closed POLYLINEs, so exact room boundaries
// aren't reconstructed here — per the agreed scope, this produces
// APPROXIMATE per-floor zone blocks (position + footprint estimated from
// label spacing/proximity), not pixel-exact polygons. Good enough for the
// isometric massing diagram (MassingStage.jsx), not for construction docs.
//
// Usage: node scripts/extractMassingZones.mjs > src/planner/data/massingZones.json
//
// Coordinate notes:
// - DXF header declares $INSUNITS=6 (metres) but the actual drawn coordinate
//   spans only make sense as millimetres (confirmed against the 11 bldg_gl
//   precedents' real siteSpanM in precedentZoning.json) — values are used
//   here in raw drawing units since everything is normalised to 0..1 anyway.
// - MTEXT text values use RTF-like run formatting, e.g.
//   "{\fArial;CAR}\P{\fArial;PARK}\P{\fArial;BASEMENT}\P{\fArial;ENTRY}" —
//   \P is a paragraph break, {\fArial;...} wraps each run. Must split on \P
//   and strip the font-run wrapper, or text gets mangled (stray "P"s eaten).

import { readFileSync, writeFileSync } from 'fs';

const SRC = 'DXF/READ.dxf';

function readSection(text, name) {
  const lines = text.split(/\r?\n/);
  const startIdx = lines.findIndex((l, i) => l.trim() === '2' && lines[i + 1]?.trim() === name && lines[i - 1]?.trim() === '0' === false ? false : true);
  // Simpler: find "SECTION" / "2" / name, then the matching ENDSEC.
  let start = -1, end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === 'SECTION' && lines[i + 2]?.trim() === name) { start = i; break; }
  }
  if (start === -1) return [];
  for (let i = start; i < lines.length; i++) {
    if (lines[i].trim() === 'ENDSEC') { end = i; break; }
  }
  return lines.slice(start, end + 1);
}

function cleanMText(raw) {
  return raw
    .split('\\P')
    .map(s => s.replace(/\{\\fArial;/g, '').replace(/\}/g, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMText(entityLines) {
  const items = [];
  for (let i = 0; i < entityLines.length; i++) {
    if (entityLines[i].trim() === '0' && (entityLines[i + 1] || '').trim() === 'MTEXT') {
      let text = '', x = null, y = null;
      let j = i + 2;
      while (j < entityLines.length && entityLines[j].trim() !== '0') {
        const code = entityLines[j].trim();
        const val = (entityLines[j + 1] || '').trim();
        if (code === '1' || code === '3') text += val;
        else if (code === '10') x = parseFloat(val);
        else if (code === '20') y = parseFloat(val);
        j += 2;
      }
      if (x != null && y != null) items.push({ text: cleanMText(text), x, y });
      i = j - 1;
    }
  }
  return items;
}

// ── Classify a cleaned room label into Units / Green / Connector / Amenity
// / Parking, matching the user's reference floor-plan colour scheme
// (blue=units, yellow=green/community, grey=connector) plus Parking as its
// own bucket since "CAR PARK BASEMENT ENTRY" doesn't fit the other 4.
function classify(text) {
  const t = text.toLowerCase().replace(/\s/g, '');
  if (/^\d[a-z]\d[a-z]?$/.test(t)) return 'units'; // 3B4P, 1b1p, 3b6p, 2B3P etc.
  if (/corrido/.test(t)) return 'connector';
  if (/carpark|basemententry/.test(t)) return 'parking';
  if (/greenpatch|waterbody|privategarden|courtyard/.test(t)) return 'green';
  if (/socialseating|multipurpose|reception|lobby|meditation|quietreading|minitheatre|gamesroom|gym|^wc$/.test(t)) return 'amenity';
  return null; // floor-plan titles, "Iteration for...", stray notes
}

const FLOOR_TITLES = [
  { match: /ground floor plan/i,    key: 'ground', floorIndex: 0, floorSpan: 1 },
  { match: /first.*second.*third/i, key: 'f1to3',  floorIndex: 1, floorSpan: 3 },
  { match: /fourth and fifth/i,     key: 'f4to5',  floorIndex: 4, floorSpan: 2 },
  { match: /sixth floor plan/i,     key: 'f6',     floorIndex: 6, floorSpan: 1 },
];

// The unit-typology legend (3B4P, 1b1p, etc.) sits in a separate row well
// above all 4 floor plans on this sheet (y > ~60000 drawing units) — it's a
// typology key, not a spatial room on any floor, so it's excluded from the
// per-floor spatial pass below.
const UNIT_LEGEND_MIN_Y = 60000;

function nearestFloor(x, titles) {
  let best = null, bestD = Infinity;
  for (const t of titles) {
    const d = Math.abs(t.x - x);
    if (d < bestD) { bestD = d; best = t; }
  }
  return best?.floor ?? null;
}

// Approximate per-floor zone footprints from label positions + nearest-
// neighbour spacing (Voronoi-ish): each label's half-extent is half the
// distance to its nearest sibling on the same floor, clamped to a sane
// range. Same-category labels on one floor merge into one bounding block.
function buildFloorZones(floorRooms) {
  const xs = floorRooms.map(r => r.x), ys = floorRooms.map(r => r.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = (maxX - minX) || 1, spanY = (maxY - minY) || 1;
  const padX = spanX * 0.15, padY = spanY * 0.15; // labels sit inside rooms, not at edges

  const norm = (x, y) => ({
    x: (x - minX + padX) / (spanX + padX * 2),
    y: (y - minY + padY) / (spanY + padY * 2),
  });
  const nearestDist = (r, all) => {
    let best = Infinity;
    for (const o of all) {
      if (o === r) continue;
      best = Math.min(best, Math.hypot(o.x - r.x, o.y - r.y));
    }
    return Number.isFinite(best) ? best : spanX * 0.3;
  };

  const byCat = {};
  for (const r of floorRooms) {
    const half = Math.max(0.04, Math.min(0.22, (nearestDist(r, floorRooms) / (spanX + spanY)) * 0.9));
    const p = norm(r.x, r.y);
    (byCat[r.cat] ??= []).push({ ...p, half, text: r.text });
  }

  const blocks = {};
  for (const [cat, pts] of Object.entries(byCat)) {
    let minPX = Infinity, maxPX = -Infinity, minPY = Infinity, maxPY = -Infinity;
    pts.forEach(p => {
      minPX = Math.min(minPX, p.x - p.half); maxPX = Math.max(maxPX, p.x + p.half);
      minPY = Math.min(minPY, p.y - p.half); maxPY = Math.max(maxPY, p.y + p.half);
    });
    minPX = Math.max(0, minPX); maxPX = Math.min(1, maxPX);
    minPY = Math.max(0, minPY); maxPY = Math.min(1, maxPY);
    blocks[cat] = {
      x: minPX, z: minPY,
      w: Math.max(0.06, maxPX - minPX),
      d: Math.max(0.06, maxPY - minPY),
      rooms: pts.map(p => p.text),
    };
  }

  // Real unit rooms were never individually labelled (only the typology mix
  // was). Derive "units" as the floor's remainder — the half not occupied
  // by the labelled communal/parking core.
  if (!blocks.units) {
    const labelledCx = Object.values(blocks).reduce((s, b) => s + (b.x + b.w / 2), 0) / (Object.values(blocks).length || 1);
    blocks.units = labelledCx < 0.5
      ? { x: 0.55, z: 0, w: 0.45, d: 1, rooms: [] }
      : { x: 0,    z: 0, w: 0.45, d: 1, rooms: [] };
  }

  return blocks;
}

function main() {
  const text = readFileSync(SRC, 'utf8');
  const entityLines = readSection(text, 'ENTITIES');
  const mtext = parseMText(entityLines);

  const titles = mtext
    .map(l => ({ ...l, floor: FLOOR_TITLES.find(f => f.match.test(l.text)) }))
    .filter(l => l.floor);

  const unitLegend = mtext.filter(l => classify(l.text) === 'units' && l.y > UNIT_LEGEND_MIN_Y);

  const rooms = mtext
    .map(l => ({ ...l, cat: classify(l.text) }))
    .filter(l => l.cat && l.y <= UNIT_LEGEND_MIN_Y)
    .map(l => ({ ...l, floor: nearestFloor(l.x, titles) }))
    .filter(l => l.floor);

  const byFloorKey = {};
  for (const r of rooms) (byFloorKey[r.floor.key] ??= []).push(r);

  const floors = {};
  for (const [key, floorRooms] of Object.entries(byFloorKey)) {
    floors[key] = { label: FLOOR_TITLES.find(f => f.key === key), blocks: buildFloorZones(floorRooms) };
  }

  // Collapse into one zoneBlocks set keyed "<category>__<floorKey>" so the
  // isometric diagram reads as a real stacked building — each floor's rooms
  // sit at their own y0/y1 band (7 storeys total: ground=0, 1-3, 4-5, 6).
  const TOTAL_FLOORS = 7;
  const zoneBlocks = {};
  for (const [key, floor] of Object.entries(floors)) {
    const { floorIndex, floorSpan } = floor.label;
    const y0 = floorIndex / TOTAL_FLOORS;
    const y1 = (floorIndex + floorSpan) / TOTAL_FLOORS;
    for (const [cat, b] of Object.entries(floor.blocks)) {
      // "CAR PARK BASEMENT ENTRY" is a repeated note pointing to the
      // basement on every floor sheet, not an actual room on upper floors.
      if (cat === 'parking' && key !== 'ground') continue;
      zoneBlocks[`${cat}__${key}`] = { category: cat, x: b.x, z: b.z, w: b.w, d: b.d, y0, y1, floorLabel: key, rooms: b.rooms };
    }
  }

  const out = {
    sourceFile: SRC,
    unitTypologyLegend: unitLegend.map(l => l.text),
    floorCount: TOTAL_FLOORS,
    zoneBlocks,
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.stderr.write(`Extracted ${Object.keys(zoneBlocks).length} zone blocks across ${Object.keys(floors).length} floor groups\n`);
}

main();
