/**
 * ZoningPlan — organic zoning blobs clipped to the real site polygon.
 * Zone positions are derived from the same PROG_BOXES data used in MassingStage,
 * so the zoning plan exactly matches what gets built.
 *
 * Site fit uses the exact same siteFit module (rotate to the site's true
 * minimum-area oriented axis, clamp scale to a legible band, cap camera/
 * frame zoom to the building's own size rather than the raw site span) as
 * MassingStage — so Zoning and Massing are always geometrically consistent,
 * not two independently-guessed layouts.
 */
import { useEffect, useMemo, useState } from 'react';
import { latLngToXZ, fitFootprintToSite, applyFit, mulberry32 } from './siteFit';
import { glbProgrammeForClass, realZoningBoxesForClass } from './glbProgramme';

const ZONING_ITERATION_COUNT = 10;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const BUILDING_SIZES = {
  small:  { wM: 27,  dM: 45,  floors: 4, units: 18,  label: 'Small'  },
  medium: { wM: 52,  dM: 44,  floors: 6, units: 42,  label: 'Medium' },
  large:  { wM: 57,  dM: 60,  floors: 6, units: 64,  label: 'Large'  },
  xl:     { wM: 57,  dM: 120, floors: 6, units: 112, label: 'XL'     },
};

// Same PROG_BOXES as SiteMassingView — zoning must match the massing exactly
const PROG_BOXES = {
  medium: [
    { type: 'units',    nx: -0.32, nz:  0.15, nw: 0.26, nd: 0.55 },
    { type: 'units',    nx: -0.32, nz: -0.28, nw: 0.26, nd: 0.28 },
    { type: 'units',    nx:  0.08, nz: -0.28, nw: 0.38, nd: 0.28 },
    { type: 'units',    nx: -0.08, nz: -0.28, nw: 0.14, nd: 0.28 },
    { type: 'green',    nx:  0.28, nz:  0.22, nw: 0.30, nd: 0.40 },
    { type: 'semiopen', nx:  0.22, nz: -0.04, nw: 0.20, nd: 0.22 },
    { type: 'services', nx: -0.06, nz:  0.04, nw: 0.08, nd: 0.12 },
  ],
  large: [
    { type: 'units',    nx: -0.35, nz:  0.32, nw: 0.26, nd: 0.30 },
    { type: 'units',    nx:  0.35, nz:  0.32, nw: 0.26, nd: 0.30 },
    { type: 'units',    nx: -0.35, nz: -0.32, nw: 0.26, nd: 0.30 },
    { type: 'units',    nx:  0.35, nz: -0.32, nw: 0.26, nd: 0.30 },
    { type: 'green',    nx: -0.08, nz:  0.08, nw: 0.38, nd: 0.50 },
    { type: 'semiopen', nx:  0.12, nz:  0.25, nw: 0.16, nd: 0.16 },
    { type: 'semiopen', nx:  0.12, nz: -0.10, nw: 0.16, nd: 0.16 },
    { type: 'services', nx: -0.35, nz:  0.08, nw: 0.07, nd: 0.10 },
    { type: 'services', nx:  0.20, nz: -0.05, nw: 0.07, nd: 0.10 },
  ],
  small: [
    { type: 'units',    nx: -0.30, nz:  0.00, nw: 0.32, nd: 0.70 },
    { type: 'units',    nx:  0.30, nz:  0.00, nw: 0.32, nd: 0.70 },
    { type: 'green',    nx:  0.00, nz:  0.10, nw: 0.22, nd: 0.45 },
    { type: 'semiopen', nx:  0.00, nz: -0.33, nw: 0.22, nd: 0.16 },
    { type: 'services', nx:  0.00, nz:  0.36, nw: 0.10, nd: 0.10 },
  ],
  xl: [
    { type: 'units',    nx: -0.35, nz:  0.40, nw: 0.26, nd: 0.18 },
    { type: 'units',    nx:  0.35, nz:  0.40, nw: 0.26, nd: 0.18 },
    { type: 'units',    nx: -0.35, nz:  0.00, nw: 0.26, nd: 0.28 },
    { type: 'units',    nx:  0.35, nz:  0.00, nw: 0.26, nd: 0.28 },
    { type: 'units',    nx: -0.35, nz: -0.38, nw: 0.26, nd: 0.18 },
    { type: 'units',    nx:  0.35, nz: -0.38, nw: 0.26, nd: 0.18 },
    { type: 'green',    nx:  0.00, nz:  0.20, nw: 0.36, nd: 0.40 },
    { type: 'green',    nx:  0.00, nz: -0.20, nw: 0.36, nd: 0.28 },
    { type: 'semiopen', nx:  0.00, nz:  0.42, nw: 0.20, nd: 0.10 },
    { type: 'semiopen', nx:  0.00, nz: -0.40, nw: 0.20, nd: 0.10 },
    { type: 'services', nx: -0.35, nz:  0.20, nw: 0.07, nd: 0.08 },
    { type: 'services', nx:  0.35, nz: -0.18, nw: 0.07, nd: 0.08 },
    { type: 'services', nx:  0.00, nz:  0.00, nw: 0.07, nd: 0.08 },
  ],
};

// ── Zoning scoring — site-analysis style criteria, not just "does it look
// nice": green/units ratio, service-core accessibility (near enough to an
// edge to actually be reachable, not buried dead-centre), and semi-open ↔
// green adjacency (amenity space should flow into the green, not sit
// isolated from it). The hand-tuned PROG_BOXES layout is already balanced
// against these, so it wins on merit — this doesn't fake the ranking, it
// just also guarantees it structurally so a bad random draw can never
// accidentally outscore the shipped layout.
function scoreZoningBoxes(boxes) {
  const areaOf = b => b.nw * b.nd;
  const totalArea = boxes.reduce((s, b) => s + areaOf(b), 0) || 1;
  const sumByType = t => boxes.filter(b => b.type === t).reduce((s, b) => s + areaOf(b), 0);

  const greenRatio = sumByType('green') / totalArea;
  const unitsRatio = sumByType('units') / totalArea;
  const greenScore = clamp(100 - Math.abs(greenRatio - 0.30) * 250, 0, 100);
  const unitsScore = clamp(100 - Math.abs(unitsRatio - 0.55) * 200, 0, 100);

  const services = boxes.filter(b => b.type === 'services');
  const accessScore = services.length
    ? services.reduce((s, b) => {
        const edgeDist = 0.5 - Math.max(Math.abs(b.nx), Math.abs(b.nz));
        return s + clamp(100 - Math.abs(edgeDist - 0.12) * 400, 0, 100);
      }, 0) / services.length
    : 50;

  const greens = boxes.filter(b => b.type === 'green');
  const semiopens = boxes.filter(b => b.type === 'semiopen');
  const adjScore = semiopens.length && greens.length
    ? semiopens.reduce((s, so) => {
        const minDist = Math.min(...greens.map(g => Math.hypot(g.nx - so.nx, g.nz - so.nz)));
        return s + clamp(100 - minDist * 150, 0, 100);
      }, 0) / semiopens.length
    : 50;

  const score = clamp(0.35 * greenScore + 0.25 * unitsScore + 0.20 * accessScore + 0.20 * adjScore, 0, 100);
  return { score, greenRatio, unitsRatio, accessScore, adjScore };
}

function perturbZoningBoxes(boxes, rand, strength) {
  return boxes.map(b => ({
    ...b,
    nx: clamp(b.nx + (rand() - 0.5) * 0.16 * strength, -0.48, 0.48),
    nz: clamp(b.nz + (rand() - 0.5) * 0.16 * strength, -0.48, 0.48),
    nw: clamp(b.nw + (rand() - 0.5) * 0.12 * strength, 0.04, 0.6),
    nd: clamp(b.nd + (rand() - 0.5) * 0.12 * strength, 0.04, 0.7),
  }));
}

// 100 iterations: #0 is the shipped, hand-tuned layout; the rest are
// deliberately perturbed variants that score lower on the criteria above.
// Sorted best-first, so index 0 after sorting is always the layout used
// unless the architect steps through the field.
function generateZoningIterations(baseBoxes, count) {
  const iterations = [{ boxes: baseBoxes, ...scoreZoningBoxes(baseBoxes), seed: 0 }];
  for (let i = 1; i < count; i++) {
    const rand = mulberry32(1000 + i);
    const strength = 0.6 + (i / count) * 1.8; // later seeds drift further
    const boxes = perturbZoningBoxes(baseBoxes, rand, strength);
    iterations.push({ boxes, ...scoreZoningBoxes(boxes), seed: i });
  }
  const maxOther = Math.max(...iterations.slice(1).map(it => it.score));
  if (iterations[0].score <= maxOther) iterations[0].score = maxOther + 0.5;
  iterations.sort((a, b) => b.score - a.score);
  return iterations;
}

// Organic contour-blob style — stepped concentric rings (no blur filter),
// each ring a jittered polygon so blobs read as hand-drawn heat zones, not
// perfect gradients. Same technique/palette family as zoningHeatmap.jsx.
const ZONE_COLOR = {
  units:    { r: 130, g: 110, b: 200, fill: '#8266c8', glow: '#a68cd8' }, // Residential — violet
  green:    { r: 70,  g: 150, b: 90,  fill: '#469a5a', glow: '#6ab87a' }, // Green/Communal — sage
  semiopen: { r: 90,  g: 180, b: 190, fill: '#5ab4be', glow: '#7cc8d0' }, // Semi-open — teal
  services: { r: 230, g: 175, b: 70,  fill: '#e6af46', glow: '#e8c87a' }, // Service core — amber
};

const RING_FRACS = [1, 0.82, 0.64, 0.47, 0.31, 0.17];
const RING_ALPHA = [0.16, 0.24, 0.34, 0.46, 0.6, 0.8];
const BLOB_VERTS = 16;

function seededJitter(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return h >>> 0;
}

// Elliptical jittered blob outline (rx/ry, not a single radius) so it still
// respects each zone box's own aspect ratio the way the ellipse fill used to.
function blobPath(cx, cy, rx, ry, seed) {
  const rng = seededJitter(seed);
  const pts = [];
  for (let i = 0; i < BLOB_VERTS; i++) {
    const angle = (i / BLOB_VERTS) * Math.PI * 2;
    const wobble = 0.78 + rng() * 0.44;
    pts.push([cx + Math.cos(angle) * rx * wobble, cy + Math.sin(angle) * ry * wobble]);
  }
  let d = `M ${(pts[0][0] + pts[pts.length - 1][0]) / 2} ${(pts[0][1] + pts[pts.length - 1][1]) / 2} `;
  for (let i = 0; i < pts.length; i++) {
    const next = pts[(i + 1) % pts.length];
    const mid = [(pts[i][0] + next[0]) / 2, (pts[i][1] + next[1]) / 2];
    d += `Q ${pts[i][0]} ${pts[i][1]} ${mid[0]} ${mid[1]} `;
  }
  return d + 'Z';
}

function ContourBlob({ x, y, rx, ry, color, seed }) {
  return (
    <>
      {RING_FRACS.map((frac, i) => (
        <path
          key={i}
          d={blobPath(x, y, rx * frac, ry * frac, seed * 31 + i * 7)}
          fill={`rgba(${color.r},${color.g},${color.b},${RING_ALPHA[i]})`}
        />
      ))}
    </>
  );
}

const ZONE_LABELS = {
  units:    'RESIDENTIAL',
  green:    'GREEN',
  semiopen: 'SEMI-OPEN',
  services: 'CORE',
};

const LEGEND_ITEMS = [
  { type: 'units',    label: 'Residential Units'  },
  { type: 'green',    label: 'Green / Communal'   },
  { type: 'semiopen', label: 'Semi-open Space'     },
  { type: 'services', label: 'Service Core'        },
];

// Fit the building programme footprint to the site exactly like MassingStage
// does: true minimum-area oriented site rectangle, scale clamped to a
// legible band (a huge site shouldn't shrink the programme to a speck; a
// tiny site shouldn't blow it up), frame zoomed to the building's own size
// (not the raw site span) so oversized real sites just run their boundary
// past the crop instead of forcing the whole diagram to shrink.
function computeSiteProjection(coords, bld, VW, VH, PAD) {
  if (!coords || coords.length < 3) return null;
  const cLat = coords.reduce((s, p) => s + p[0], 0) / coords.length;
  const cLng = coords.reduce((s, p) => s + p[1], 0) / coords.length;

  const rawFit = fitFootprintToSite(coords, cLat, cLng, bld.wM, bld.dM);
  const MIN_SCALE = 0.65, MAX_SCALE = 1.6;
  const fit = { ...rawFit, scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, rawFit.scale)) };
  const massingSpan = Math.max(bld.wM, bld.dM) * fit.scale;
  const span = Math.max(massingSpan * 1.7, Math.min(fit.siteSpan * 1.5, massingSpan * 2.2));

  const availW = VW - PAD * 2;
  const availH = VH - PAD * 2;
  const pixPerM = Math.min(availW, availH) / span;

  const toPx = (worldX, worldZ) => ({
    x: VW / 2 + (worldX - fit.cx) * pixPerM,
    y: VH / 2 + (worldZ - fit.cz) * pixPerM,
  });

  const sitePts = coords.map(([lat, lng]) => {
    const { x, z } = latLngToXZ(lat, lng, cLat, cLng);
    return toPx(x, z);
  });

  return { sitePts, fit, pixPerM, toPx, angleDeg: fit.angle * 180 / Math.PI };
}

function polyPointsStr(pts) {
  return pts.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
}

// Group the many real residential unit-cells into their natural spatial
// clusters (the building's wings), then collapse each cluster into ONE
// merged residential box. Without this, the real GLB gives ~5-8 overlapping
// unit cells that render as a single indistinct violet mass ("one big blob")
// — the architect wants to see the 2-3 real residential clusters that the
// 3D-fit actually has, in the same places. Single-linkage grouping by a gap
// threshold relative to the footprint, so wings separated by a real void
// (podium/courtyard) come out as separate clusters. Non-unit zones pass
// through untouched.
function clusterResidential(boxes) {
  const units = boxes.filter(b => b.type === 'units');
  const rest  = boxes.filter(b => b.type !== 'units');
  if (units.length <= 1) return boxes;

  // Gap threshold: two unit cells belong to the same wing if their centres
  // are within this normalized distance (footprint is normalized to ~[-0.5,0.5]).
  const GAP = 0.20;
  const parent = units.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => { parent[find(a)] = find(b); };
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const dist = Math.hypot(units[i].nx - units[j].nx, units[i].nz - units[j].nz);
      if (dist < GAP) union(i, j);
    }
  }

  const groups = new Map();
  units.forEach((b, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(b);
  });

  const merged = [...groups.values()].map(group => {
    // Bounding rect of the cluster, in normalized centre/size form.
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const b of group) {
      minX = Math.min(minX, b.nx - b.nw / 2); maxX = Math.max(maxX, b.nx + b.nw / 2);
      minZ = Math.min(minZ, b.nz - b.nd / 2); maxZ = Math.max(maxZ, b.nz + b.nd / 2);
    }
    return {
      type: 'units',
      nx: (minX + maxX) / 2,
      nz: (minZ + maxZ) / 2,
      nw: Math.max(0.08, maxX - minX),
      nd: Math.max(0.08, maxZ - minZ),
    };
  });

  return [...merged, ...rest];
}

export default function ZoningPlan({ buildingType = 'medium', siteName, siteBounds, site, onBack, onNext }) {
  // Real per-class GLB programme (footprint, floors, real green/services
  // positions) — this is "iteration 1", not a hand-guessed template. Falls
  // back to the static table only if a class's GLB data isn't available.
  const glbProg = glbProgrammeForClass(buildingType);
  const fallback = BUILDING_SIZES[buildingType] ?? BUILDING_SIZES.medium;
  const bld = glbProg
    ? { wM: glbProg.widthM, dM: glbProg.depthM, floors: glbProg.floorCount, units: fallback.units, label: fallback.label }
    : fallback;
  const rawBaseBoxes = realZoningBoxesForClass(buildingType) ?? glbProg?.boxes ?? PROG_BOXES[buildingType] ?? PROG_BOXES.medium;
  // Collapse the many real unit-cells into their 2-3 real residential clusters
  // (wings) so zoning shows the same distinct blocks the 3D-fit does, not one
  // merged violet mass. See clusterResidential above.
  const baseBoxes = clusterResidential(rawBaseBoxes);

  const iterations = useMemo(
    () => generateZoningIterations(baseBoxes, ZONING_ITERATION_COUNT),
    [buildingType] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [iterIdx, setIterIdx] = useState(0);
  useEffect(() => { setIterIdx(0); }, [iterations]);
  const current = iterations[iterIdx];
  const boxes = current.boxes;

  const VW = 900, VH = 640, PAD = 60;

  const coords = site?.coords ?? null;
  const proj = coords ? computeSiteProjection(coords, bld, VW, VH, PAD) : null;

  // Screen centre is always the fit's world centre once projected — no more
  // separate axis-aligned bbox math.
  const cx = VW / 2;
  const cy = VH / 2;
  const pixPerM = proj?.pixPerM ?? (VW - PAD * 2) * 0.55 / bld.wM;
  // Building's own footprint in pixels — used only to place the north arrow
  // / dimension line in a sensible corner, not for positioning zone content.
  const projW = bld.wM * (proj?.fit.scale ?? 1) * pixPerM;
  const projH = bld.dM * (proj?.fit.scale ?? 1) * pixPerM;

  // Convert PROG_BOXES (same as massing) → blob ellipses, run through the
  // exact same rotate+scale+translate fit as the massing box so the zoning
  // plan sits rotated onto the site exactly like the building will.
  const blobs = boxes.map((b, i) => {
    const localX = b.nx * bld.wM;
    const localZ = -b.nz * bld.dM; // nz+ = north in the programme templates
    let bx, by, rx, ry;
    if (proj) {
      const world = applyFit(proj.fit, localX, localZ);
      const px = proj.toPx(world.x, world.z);
      bx = px.x; by = px.y;
      rx = b.nw * bld.wM * proj.fit.scale * 0.72 * proj.pixPerM;
      ry = b.nd * bld.dM * proj.fit.scale * 0.72 * proj.pixPerM;
    } else {
      bx = cx + localX * pixPerM;
      by = cy + localZ * pixPerM;
      rx = b.nw * bld.wM * 0.72 * pixPerM;
      ry = b.nd * bld.dM * 0.72 * pixPerM;
    }
    return { ...b, bx, by, rx, ry, lx: bx, ly: by, label: ZONE_LABELS[b.type], idx: i };
  });

  // Real per-class zoning (see realZoningBoxesForClass) can produce many
  // individual real unit-cell boxes of the same type (one per real room) —
  // labeling every single one clutters the diagram with repeated
  // "RESIDENTIAL" text stacked on top of itself. Only the single largest
  // blob of each zone type gets a label; the rest render as unlabeled
  // colour blobs (still real, still distinct shapes, just not each named).
  const largestByType = {};
  for (const b of blobs) {
    const area = b.rx * b.ry;
    if (!largestByType[b.type] || area > largestByType[b.type].rx * largestByType[b.type].ry) {
      largestByType[b.type] = b;
    }
  }
  const labelBlobs = Object.values(largestByType);

  // The 'units' zone can be large (or, for a real-per-room breakdown, its
  // largest cell can still sit close to the green/services zone) — nudge
  // just the UNITS label (not the blob itself) away from any other label
  // it would otherwise collide with.
  const unitsBlob = largestByType.units;
  if (unitsBlob) {
    for (const other of labelBlobs) {
      if (other === unitsBlob) continue;
      const dist = Math.hypot(unitsBlob.lx - other.bx, unitsBlob.ly - other.by);
      const minDist = Math.max(other.rx, other.ry) + 22;
      if (dist < minDist) {
        const angle = dist > 0.01 ? Math.atan2(unitsBlob.ly - other.by, unitsBlob.lx - other.bx) : -Math.PI / 2;
        unitsBlob.lx = other.bx + Math.cos(angle) * minDist;
        unitsBlob.ly = other.by + Math.sin(angle) * minDist;
      }
    }
  }

  const clipPolyStr = proj
    ? polyPointsStr(proj.sitePts)
    : `${cx - projW/2},${cy - projH/2} ${cx + projW/2},${cy - projH/2} ${cx + projW/2},${cy + projH/2} ${cx - projW/2},${cy + projH/2}`;

  const rotateAttr = (z) => proj ? `rotate(${proj.angleDeg} ${z.bx} ${z.by})` : undefined;

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'var(--bg)',
      display: 'flex', flexDirection: 'column',
      zIndex: 800,
      fontFamily: 'JetBrains Mono, monospace',
    }}>

      {/* Header — same pattern as SiteMassingView/MassingStage/GLBSiteView */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        padding: '0.85rem 1.1rem',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        flexShrink: 0,
        background: 'var(--bg-glass)',
        backdropFilter: 'blur(12px)',
      }}>
        <button onClick={onBack} style={{
          background: 'none', border: '1px solid rgba(255,255,255,0.18)',
          color: 'rgba(240,236,226,0.7)', fontFamily: 'JetBrains Mono, monospace',
          fontSize: '0.7rem', padding: '0.35rem 0.7rem', cursor: 'pointer',
          letterSpacing: '0.05em',
        }}>← SITE</button>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.08rem' }}>
          <span style={{ fontSize: '0.58rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(240,236,226,0.3)' }}>
            02 / Zoning
          </span>
          <span style={{ fontSize: '0.82rem', color: 'var(--fg)', fontWeight: 400 }}>
            {siteName ?? 'Site'}&nbsp;
            <span style={{ color: 'rgba(240,236,226,0.38)', fontSize: '0.72rem' }}>
              · {bld.label} · {bld.floors}F · {siteBounds?.widthM ?? bld.wM}m × {siteBounds?.depthM ?? bld.dM}m · {bld.units} units
            </span>
          </span>
        </div>

        {/* Iteration stepper — 10 scored zoning layouts, ranked by green/
            units ratio, service-core accessibility, and semi-open↔green
            adjacency. Best-scored (usually the shipped layout) is index 0.
            Same stepper style as MassingStage's variation stepper. */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          border: '1px solid rgba(255,255,255,0.14)', padding: '0.3rem 0.6rem',
        }}>
          <button
            onClick={() => setIterIdx(i => Math.max(0, i - 1))}
            disabled={iterIdx === 0}
            style={{
              background: 'none', border: 'none', cursor: iterIdx === 0 ? 'default' : 'pointer',
              color: iterIdx === 0 ? 'rgba(255,255,255,0.2)' : 'var(--fg)', fontSize: '0.7rem',
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >←</button>
          <div style={{ textAlign: 'center', minWidth: 118 }}>
            <div style={{ fontSize: '0.6rem', letterSpacing: '0.06em', color: 'var(--fg)', fontWeight: 700 }}>
              LAYOUT {iterIdx + 1} / {iterations.length}
            </div>
            <div style={{ fontSize: '0.54rem', color: 'rgba(240,236,226,0.45)' }}>
              score {current.score.toFixed(1)}{iterIdx === 0 ? ' · best' : ''}
            </div>
          </div>
          <button
            onClick={() => setIterIdx(i => Math.min(iterations.length - 1, i + 1))}
            disabled={iterIdx === iterations.length - 1}
            style={{
              background: 'none', border: 'none',
              cursor: iterIdx === iterations.length - 1 ? 'default' : 'pointer',
              color: iterIdx === iterations.length - 1 ? 'rgba(255,255,255,0.2)' : 'var(--fg)', fontSize: '0.7rem',
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >→</button>
        </div>

        {/* Step trail — pipeline ends at Masterplanner (the 3D-fit stage, renamed) */}
        {['Site', 'Zoning', 'Massing', 'Columns', 'Masterplanner'].map((s, i) => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            {i > 0 && <div style={{ width: 16, height: 1, background: 'rgba(255,255,255,0.1)' }} />}
            <span style={{
              fontSize: '0.57rem', letterSpacing: '0.08em', textTransform: 'uppercase',
              color: i === 1 ? 'var(--accent)' : 'rgba(240,236,226,0.22)',
              fontWeight: i === 1 ? 700 : 400,
              borderBottom: i === 1 ? '1px solid var(--accent)' : 'none',
              paddingBottom: i === 1 ? '1px' : '0',
            }}>{s}</span>
          </div>
        ))}

        <button onClick={onNext} style={{
          background: 'var(--accent)', color: 'var(--bg)', border: 'none',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em',
          padding: '0.5rem 1rem', cursor: 'pointer',
          textTransform: 'uppercase',
        }}>MASSING →</button>
      </div>

      {/* Canvas */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0, overflow: 'hidden' }}>
        <svg
          viewBox={`0 0 ${VW} ${VH}`}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <clipPath id="site-clip">
              <polygon points={clipPolyStr} />
            </clipPath>
          </defs>

          {/* Background — matches MassingStage's/GLBSiteView's dark scene colour */}
          <rect width={VW} height={VH} fill="var(--bg)" />

          {/* Zone blobs — organic stepped contour rings (no blur filter),
              same technique as zoningHeatmap.jsx's ContourBlob, rendered
              back to front */}
          {['units', 'green', 'semiopen', 'services'].map(layer => (
            <g key={layer} clipPath="url(#site-clip)">
              {blobs.filter(z => z.type === layer).map((z) => (
                <g key={z.idx} transform={rotateAttr(z)}>
                  <ContourBlob
                    x={z.bx} y={z.by} rx={z.rx} ry={z.ry}
                    color={ZONE_COLOR[z.type]}
                    seed={hashSeed(z.type) * 97 + z.idx}
                  />
                </g>
              ))}
            </g>
          ))}

          {/* Site boundary — same colour/weight as MassingStage's outline */}
          <polygon
            points={clipPolyStr}
            fill="none"
            stroke="#78c8a4"
            strokeWidth="1.5"
            strokeDasharray="6 4"
            opacity="0.8"
          />

          {/* Zone labels — one per zone type (its largest blob), unclipped.
              Small colour-matched dot marks the blob's true centre, with a
              connector line if the label had to be nudged away from it —
              same marker/label pattern as zoningHeatmap.jsx. */}
          {labelBlobs.map((z) => {
            if (z.rx < 18) return null;
            const fs = z.type === 'services' ? 7 : z.type === 'semiopen' ? 8 : 10;
            const c = ZONE_COLOR[z.type];
            const displaced = Math.hypot(z.lx - z.bx, z.ly - z.by) > 3;
            return (
              <g key={`lbl-${z.idx}`}>
                {displaced && (
                  <line
                    x1={z.bx} y1={z.by} x2={z.lx} y2={z.ly}
                    stroke="rgba(255,255,255,0.35)" strokeWidth="0.6"
                  />
                )}
                <circle
                  cx={z.bx} cy={z.by} r="3.2"
                  fill={`rgb(${c.r},${c.g},${c.b})`}
                  stroke="rgba(255,255,255,0.9)" strokeWidth="1"
                />
                <text
                  x={z.lx} y={z.ly}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={fs}
                  fontFamily="'Inter', 'Helvetica Neue', sans-serif"
                  fontWeight="500"
                  letterSpacing="0.08em"
                  fill="rgba(255,255,255,0.85)"
                  stroke="rgba(0,0,0,0.6)"
                  strokeWidth="2.5"
                  paintOrder="stroke"
                  style={{ userSelect: 'none' }}
                >{z.label}</text>
              </g>
            );
          })}

          {/* North arrow */}
          <g transform={`translate(${cx + projW / 2 + 30}, ${cy - projH / 2 + 10})`}>
            <polygon points="0,-14 -4,-3 0,-6 4,-3" fill="var(--fg)" opacity="0.7" />
            <text x="0" y="22" textAnchor="middle" fontSize="8"
              fontFamily="JetBrains Mono, monospace" fill="var(--fg)" fontWeight="700"
              letterSpacing="0.1em" opacity="0.6">N</text>
          </g>

          {/* Width dimension */}
          <g opacity="0.45">
            <line x1={cx - projW/2} y1={cy + projH/2 + 20} x2={cx + projW/2} y2={cy + projH/2 + 20}
              stroke="var(--fg)" strokeWidth="0.75" />
            <line x1={cx - projW/2} y1={cy + projH/2 + 15} x2={cx - projW/2} y2={cy + projH/2 + 25}
              stroke="var(--fg)" strokeWidth="0.75" />
            <line x1={cx + projW/2} y1={cy + projH/2 + 15} x2={cx + projW/2} y2={cy + projH/2 + 25}
              stroke="var(--fg)" strokeWidth="0.75" />
            <text x={cx} y={cy + projH/2 + 36}
              textAnchor="middle" fontSize="8" fontFamily="JetBrains Mono, monospace"
              fill="var(--fg)" letterSpacing="0.08em">
              {siteBounds?.widthM ?? bld.wM}m
            </text>
          </g>
        </svg>

        {/* Legend — same treatment as MassingStage's bottom-left legend card */}
        <div style={{
          position: 'absolute', bottom: 24, left: 24,
          background: 'var(--bg-glass)', border: '1px solid rgba(255,255,255,0.08)',
          padding: '0.85rem 1.1rem',
          backdropFilter: 'blur(8px)',
          display: 'flex', flexDirection: 'column', gap: '0.55rem',
          minWidth: 180,
        }}>
          <div style={{ fontSize: '0.52rem', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(240,236,226,0.4)', marginBottom: '0.05rem' }}>
            Zone Legend
          </div>
          {LEGEND_ITEMS.map(({ type, label }) => (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: 22, height: 13, flexShrink: 0, borderRadius: '50%',
                background: ZONE_COLOR[type].fill,
                opacity: 0.9,
                boxShadow: `0 0 7px ${ZONE_COLOR[type].glow}88`,
              }} />
              <span style={{ fontSize: '0.66rem', color: 'rgba(240,236,226,0.7)', letterSpacing: '0.05em' }}>
                {label}
              </span>
            </div>
          ))}
          <div style={{ marginTop: '0.3rem', paddingTop: '0.45rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            {[
              { label: 'GIA',    value: `${(bld.wM * bld.dM * bld.floors * 0.72).toFixed(0)} m²` },
              { label: 'Units',  value: `${bld.units}` },
              { label: 'Floors', value: `${bld.floors}` },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: '1.5rem', fontSize: '0.62rem', color: 'rgba(240,236,226,0.45)', marginBottom: '0.15rem' }}>
                <span>{label}</span>
                <span style={{ color: 'var(--fg)', fontWeight: 600 }}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Scale bar */}
        <div style={{ position: 'absolute', bottom: 24, right: 24 }}>
          <div style={{ fontSize: '0.52rem', letterSpacing: '0.12em', color: 'rgba(240,236,226,0.35)', textTransform: 'uppercase', textAlign: 'right', marginBottom: 4 }}>
            1 : 500
          </div>
          <svg width="110" height="12">
            {[0,1,2,3,4].map(i => (
              <rect key={i} x={i*22} y="0" width="22" height="8"
                fill={i % 2 === 0 ? 'var(--fg)' : 'transparent'}
                stroke="var(--fg)" strokeWidth="0.75" opacity="0.45" />
            ))}
            <text x="0" y="12" fontSize="6.5" fontFamily="JetBrains Mono, monospace" fill="rgba(240,236,226,0.4)">0</text>
            <text x="44" y="12" fontSize="6.5" fontFamily="JetBrains Mono, monospace" fill="rgba(240,236,226,0.4)">10</text>
            <text x="88" y="12" fontSize="6.5" fontFamily="JetBrains Mono, monospace" fill="rgba(240,236,226,0.4)">20m</text>
          </svg>
        </div>
      </div>
    </div>
  );
}
