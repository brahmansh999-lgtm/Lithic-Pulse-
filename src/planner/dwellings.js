// dwellings — turn the massing's `units` FLOORPLATE boxes into actual
// dwellings (1B/2B/3B/4B homes), and mark the top-floor 4-beds as
// double-height penthouses.
//
// Why this exists: a `units` box out of siteGrid.cellsToBoxes is a fragment of
// floorplate carved from the buildable cell grid — measured on the small class
// the ground floor is 5 boxes of 78–107 m². Those are not apartments. The
// Massing panel's "Units" figure counted those BOXES, so it reported 17 "units"
// for a building whose real dwelling count is several times that. Subdividing
// here is what makes that number mean homes.
//
// The typology areas are NOT invented for this feature — TYPOLOGIES in
// masterplanGenerator.js already carries measured areas (1B·1P 28 m² through
// 4B·8P 140 m²) with GLB room references and bed-count colours. This module
// reuses that table rather than inventing a parallel one.
//
// What IS a design decision (and is labelled as such in the UI): the
// double-height penthouse. Every measured GLB floor is 3.5–4.0 m — there is no
// double-height space anywhere in the source buildings. So penthouses are a
// rule we impose, not a fact we read.

import { TYPOLOGIES, TYPOLOGY_MAP } from './masterplanGenerator';

// Deterministic PRNG — same seed, same building, every render.
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Dwellings smaller than the smallest typology can't be homes. A leftover
// strip below this is kept as plain floorplate rather than being rounded up
// into a fake apartment.
const MIN_DWELLING_M2 = 24;

// Penthouses are 4-bed by definition here (the user's model: "penthouse =
// 4BHK"). Both real 4-bed typologies qualify.
const PENTHOUSE_TYPOLOGY_IDS = ['4b5p', '4b8p'];

// Share of TOP-FLOOR dwellings that become double-height penthouses, per
// programme brief. Penthouses sit on the top floor and extrude UPWARD above
// the roofline, so they add silhouette without consuming the floor below —
// total floor count and every dwelling beneath stay untouched.
//
// The share varies by brief so the briefs differ in unit MIX as well as in
// zone area, which is what they already claim to do: a dense-housing scheme
// puts more, smaller homes on the plot; an amenity-rich one fewer, larger.
export const PENTHOUSE_SHARE_BY_BRIEF = {
  'dense-housing': 0.08,
  'compact-core':  0.10,
  'perimeter':     0.12,
  'as-measured':   0.15,
  'green-led':     0.15,
  'courtyard':     0.18,
  'open-ground':   0.20,
  'amenity-rich':  0.22,
};
export const DEFAULT_PENTHOUSE_SHARE = 0.15;

// Per-brief bias over the typology table (index-aligned with TYPOLOGIES).
// Same mechanism CONCEPT_TYPOLOGY_WEIGHTS already uses in masterplanGenerator
// — relative weights, not normalised, that shift the centre of the mix rather
// than forcing a monoculture.
//                          1b1p 1b2p 2b3p 2b4p 3b4p 3b5p 4b5p 4b8p
const BRIEF_TYPOLOGY_WEIGHTS = {
  'dense-housing': [2.5, 2.5, 2.0, 1.5, 0.8, 0.5, 0.3, 0.2],
  'compact-core':  [2.0, 2.0, 2.0, 1.5, 1.0, 0.8, 0.5, 0.3],
  'perimeter':     [1.2, 1.5, 2.0, 2.0, 1.5, 1.2, 0.8, 0.5],
  'as-measured':   [1.0, 1.5, 2.0, 2.0, 1.5, 1.2, 1.0, 0.8],
  'green-led':     [1.0, 1.2, 1.8, 1.8, 1.5, 1.5, 1.2, 1.0],
  'courtyard':     [0.8, 1.0, 1.5, 2.0, 2.0, 1.8, 1.2, 1.0],
  'open-ground':   [0.8, 1.0, 1.5, 1.8, 2.0, 1.8, 1.5, 1.2],
  'amenity-rich':  [0.6, 0.8, 1.2, 1.5, 2.0, 2.0, 1.8, 1.5],
};

function weightsForBrief(briefKey) {
  return BRIEF_TYPOLOGY_WEIGHTS[briefKey] ?? BRIEF_TYPOLOGY_WEIGHTS['as-measured'];
}

// Live per-bed-count multiplier on top of the brief's own weights — the same
// mechanism zoneOverrides uses for zone area (MassingStage.jsx), just for
// which typologies get picked when slicing a floorplate. This can never
// invent floor area: dwellingsFromBox still greedily fills the SAME real
// box area with typologies (see the loop below), so pushing weight toward
// 3-4 bed homes reduces the dwelling COUNT (fewer, bigger homes fit the same
// area) rather than growing the building.
function applyMixOverrides(weights, mixOverrides) {
  if (!mixOverrides) return weights;
  return TYPOLOGIES.map((t, i) => (weights[i] ?? 1) * (mixOverrides[t.beds] ?? 1));
}

// Real, honest per-bed-count AREA share, derived from the SAME weight table
// that actually drives typology picking (weightsForBrief + mixOverrides) —
// not a separate invented split. Each typology contributes weight×areaM2 as
// its expected share of floor area under weighted-random selection; grouping
// that by bed count and normalising gives "roughly how much of the units
// zone's real area should go to 1B/2B/3B/4B homes" for
// MassingStage.jsx's floorsFromBubbleLayout to size the four spatial
// bed-group bubbles (units_1b..4b) with, before any individual box is
// actually sliced into homes.
export function bedGroupShares(briefKey, mixOverrides) {
  const weights = applyMixOverrides(weightsForBrief(briefKey), mixOverrides);
  const totals = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let sum = 0;
  TYPOLOGIES.forEach((t, i) => {
    const w = Math.max(0, weights[i] ?? 1) * t.areaM2;
    totals[t.beds] += w;
    sum += w;
  });
  if (sum <= 0) return { 1: 0.25, 2: 0.25, 3: 0.25, 4: 0.25 };
  return Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v / sum]));
}

// Real dwellings are not corridors. A home much deeper than it is wide can't
// be planned (no daylight to the back, no sensible room layout), so slicing is
// constrained to keep each dwelling within this aspect ratio where the plate
// allows it.
const MAX_DWELLING_ASPECT = 2.6;
// A habitable room needs real width; below this a "dwelling" is a passage.
const MIN_DWELLING_SIDE_M = 3.0;

// Pick a typology that actually fits THIS band's real depth within both the
// span remaining and the aspect cap — not just "is the area small enough"
// (pickTypology's test), which is what let the old picker choose typologies
// that then couldn't physically fit their assigned band once handed off to
// sliceBox. Picking directly against the band's own geometry is what makes
// per-band greedy filling (below) actually correct instead of guessing a
// flat area budget upfront and hoping it happens to distribute cleanly.
function pickTypologyForBand(bandDepth, spanRemaining, weights, rand, opts) {
  const pool = TYPOLOGIES
    .map((t, i) => ({ t, w: weights[i] ?? 1 }))
    .filter(({ t }) => !opts?.onlyIds || opts.onlyIds.includes(t.id))
    .filter(({ t }) => {
      const length = t.areaM2 / bandDepth;
      if (length > spanRemaining + 1e-6) return false;
      const aspect = Math.max(length, bandDepth) / Math.min(length, bandDepth);
      return aspect <= MAX_DWELLING_ASPECT;
    });
  if (!pool.length) return null;
  const total = pool.reduce((s, p) => s + p.w, 0);
  if (total <= 0) return pool[0].t;
  let r = rand() * total;
  for (const p of pool) { r -= p.w; if (r <= 0) return p.t; }
  return pool[pool.length - 1].t;
}

// A sensible band depth for whatever typologies are actually allowed here
// (opts.onlyIds — a wing's bed-group sub-zone restricts this to ONE bed
// count, see MassingStage.jsx's splitByBedGroup). A box holding only 1-bed
// homes (28-38 m²) needs much shallower bands than one holding only 4-beds
// (108-140 m²) — sqrt(areaM2) is a reasonable proxy for a squarish unit's
// natural depth. Getting this wrong is a real, measured bug: capping bands
// at a flat 3 regardless of what's allowed gave a large 1-bed-restricted
// zone the same ~13m band depth a 4-bed zone would get, which no real 28 m²
// home can fit within the aspect cap (would need to be ~2m wide) — the
// entire zone came back untyped, 0% utilised, on a real XL site.
function targetBandDepthM(opts) {
  const pool = TYPOLOGIES.filter(t => !opts?.onlyIds || opts.onlyIds.includes(t.id));
  if (!pool.length) return MIN_DWELLING_SIDE_M * 2;
  const avgSide = pool.reduce((s, t) => s + Math.sqrt(t.areaM2), 0) / pool.length;
  return Math.max(MIN_DWELLING_SIDE_M, avgSide);
}

// Slice a floorplate box into dwelling-sized pieces.
//
// Cutting only along the long axis produces ribbons on deep plates: measured
// on the XL class that gave 1.8 x 15.9 m "apartments" (9:1), with 27% of all
// dwellings worse than 3:1. So the plate is first divided ACROSS its depth
// into bands no deeper than a sensible dwelling, then each band is cut along
// its length into homes. That is also how real slab housing works — a double-
// banked block is two rows of flats either side of a corridor, not one row of
// very deep ones.
//
// Each band is filled by its OWN greedy pick loop, directly against that
// band's real (bandDepth, remaining span) — not by picking one flat list of
// typologies against the whole box's area up front and hoping it happens to
// fit once divided into bands round-robin. That earlier two-stage approach
// (pick globally, then distribute) is what caused two real, measured bugs on
// a live XL site: picked typologies routinely didn't match what their
// assigned band could actually hold, so either (a) the last dwelling in a
// band absorbed all leftover length regardless of its real typology size —
// up to +116% mislabelled — or (b) a typology got placed at an aspect ratio
// this file's own MAX_DWELLING_ASPECT never actually checked (33% of
// dwellings violated it, worst case 4.17:1). Picking directly against each
// band's real geometry, one dwelling at a time until nothing more fits,
// fixes both at the source AND fills each band as fully as it honestly can
// — no picked-then-discarded typologies, no wasted capacity from a mismatch
// that was never real to begin with.
function sliceBox(box, weights, rand, opts) {
  const w = box.x1 - box.x0, d = box.z1 - box.z0;
  const alongX = w >= d;
  const span = alongX ? w : d;   // long axis: homes are laid out along this
  const depth = alongX ? d : w;  // short axis: may need banding

  // How many bands across the depth keeps dwellings reasonably proportioned
  // for whatever typologies are actually allowed in THIS box (see
  // targetBandDepthM) — no fixed cap; a deep box restricted to small homes
  // genuinely needs many shallow bands, the same way real slab housing adds
  // more rows of flats rather than fewer, deeper ones.
  const target = targetBandDepthM(opts);
  const bands = Math.max(1, Math.round(depth / target) || 1);
  const bandDepth = depth / bands;

  const out = [];
  for (let bi = 0; bi < bands; bi++) {
    const b0 = bi * bandDepth, b1 = b0 + bandDepth;
    let cursor = 0;
    let lastDwellingIdx = -1;
    while (true) {
      const t = pickTypologyForBand(bandDepth, span - cursor, weights, rand, opts);
      if (!t) break;
      const length = t.areaM2 / bandDepth;
      const bEnd = cursor + length;
      lastDwellingIdx = out.length;
      out.push({
        ...box,
        x0: alongX ? box.x0 + cursor : box.x0 + b0,
        x1: alongX ? box.x0 + bEnd   : box.x0 + b1,
        z0: alongX ? box.z0 + b0     : box.z0 + cursor,
        z1: alongX ? box.z0 + b1     : box.z0 + bEnd,
        typologyId: t.id,
        beds: t.beds,
      });
      cursor = bEnd;
    }
    // Leftover band length — nothing left fits this band's real depth within
    // the aspect cap. A thin leftover strip (under a real habitable room's
    // minimum side) can't be its own floorplate — it reads as a passage
    // wedged next to a real home, not a room — so absorb it into the
    // dwelling that's already there instead of rendering it as its own box.
    // Only a leftover wide enough to plausibly BE its own spare floorplate
    // (no home fit, but the strip is still room-sized) stays separate.
    const leftover = span - cursor;
    if (leftover > 1e-6 && leftover < MIN_DWELLING_SIDE_M && lastDwellingIdx >= 0) {
      const d = out[lastDwellingIdx];
      if (alongX) { d.x1 = box.x0 + span; } else { d.z1 = box.z0 + span; }
    } else if (leftover > 1e-6) {
      out.push({
        ...box,
        x0: alongX ? box.x0 + cursor : box.x0 + b0,
        x1: alongX ? box.x1          : box.x0 + b1,
        z0: alongX ? box.z0 + b0     : box.z0 + cursor,
        z1: alongX ? box.z0 + b1     : box.z1,
        typologyId: null,
        beds: null,
      });
    }
  }
  return out;
}

// Subdivide one `units` box into dwellings.
//
// opts.onlyIds restricts picking to the box's own wing bed-group (see the
// caller below) — a real preference, not a hard requirement. After a
// topology perturbation (split/merge/floor-count change, see
// MassingStage.jsx's generateMassingIterations) reshapes a box, NONE of that
// narrow typology set may still fit its new dimensions/aspect, and sliceBox
// silently comes back with zero real dwellings even though the box is
// plenty big enough for SOME home — measured live, this collapsed whole
// variations to 0 dwellings at a 126% green:units ratio. A big-enough box
// always gets a real home from *some* typology; retry unrestricted rather
// than leaving it silently empty.
export function dwellingsFromBox(box, weights, rand, opts) {
  const area = (box.x1 - box.x0) * (box.z1 - box.z0);
  if (area < MIN_DWELLING_M2) return [{ ...box, typologyId: null, beds: null }];
  const sliced = sliceBox(box, weights, rand, opts);
  if (sliced.some(b => b.typologyId) || !opts?.onlyIds) return sliced;
  return sliceBox(box, weights, rand, { ...opts, onlyIds: null });
}

// ── Public API ────────────────────────────────────────────────────────────
// Subdivide every `units` box in `floors` into real dwellings, and mark
// penthouses on the top floor.
//
// Returns a NEW floors array; non-`units` boxes (community/services/entry) are
// passed through untouched — they are not homes and must not be subdivided.
//
// Penthouse boxes carry `heightFloors: 2`. The renderer reads that to extrude
// them upward; anything that doesn't understand the field still sees a valid
// box with the same x0/x1/z0/z1 footprint, so columns, clipping and Rhino
// export are unaffected.
export function subdivideIntoDwellings(floors, { briefKey, seed = 0, mixOverrides } = {}) {
  if (!Array.isArray(floors) || !floors.length) return floors;
  const weights = applyMixOverrides(weightsForBrief(briefKey), mixOverrides);
  const rand = mulberry32(0x0D3E11 + (seed | 0) * 7919);
  const topIdx = floors.length - 1;

  const out = floors.map((floor, fi) => {
    const boxes = floor.boxes.flatMap((b) => {
      if (b.type !== 'units') return [b];
      // A box carved from one of the units_1b..4b spatial bed-group zones
      // (see zoningGraph.js/floorsFromBubbleLayout) already IS a specific
      // bed count — restrict typology picking to that bed count's real
      // typologies instead of re-rolling across all four, so the box's
      // slicing matches the zone it was actually placed in. Boxes with no
      // bedGroup (older callers, or a degenerate site with no bubble split)
      // fall back to the full weighted pick across every typology.
      const onlyIds = b.bedGroup
        ? TYPOLOGIES.filter(t => t.beds === b.bedGroup).map(t => t.id)
        : null;
      return dwellingsFromBox(b, weights, rand, { onlyIds });
    });
    return { ...floor, boxes, _isTop: fi === topIdx };
  });

  // Penthouses: only on the top floor, only real 4-bed homes, and only the
  // brief's share of them. Chosen deterministically by sorting candidates on a
  // stable hash so the same building always produces the same penthouses.
  const top = out[topIdx];
  if (top) {
    const share = PENTHOUSE_SHARE_BY_BRIEF[briefKey] ?? DEFAULT_PENTHOUSE_SHARE;
    const dwellings = top.boxes.filter(b => b.type === 'units' && b.typologyId);
    // At least one penthouse whenever the brief asks for a non-zero share and
    // the top floor has any homes at all. Math.round alone silently produced
    // ZERO on small buildings (a 4-dwelling top floor at the dense-housing 8%
    // rounds to 0), which reads as the feature being broken rather than as a
    // deliberately lean mix — and quietly contradicts the brief's own claim.
    const wanted = dwellings.length && share > 0
      ? Math.max(1, Math.round(dwellings.length * share))
      : 0;
    if (wanted > 0) {
      // Prefer the largest homes — a penthouse is the big unit on top, not a
      // random one. Ties broken deterministically by position.
      const ranked = [...dwellings].sort((a, b) => {
        const aa = (a.x1 - a.x0) * (a.z1 - a.z0);
        const bb = (b.x1 - b.x0) * (b.z1 - b.z0);
        return bb - aa || (a.x0 - b.x0) || (a.z0 - b.z0);
      });
      const chosen = new Set(ranked.slice(0, wanted));
      top.boxes = top.boxes.map((b) => {
        if (!chosen.has(b)) return b;
        // Upgrade to a real 4-bed typology if it isn't one already, choosing
        // the largest that still fits the dwelling's actual footprint.
        const area = (b.x1 - b.x0) * (b.z1 - b.z0);
        const fits = PENTHOUSE_TYPOLOGY_IDS
          .map(id => TYPOLOGY_MAP[id])
          .filter(t => t && t.areaM2 <= area + 1e-6)
          .sort((p, q) => q.areaM2 - p.areaM2);
        const t = fits[0] ?? TYPOLOGY_MAP[b.typologyId];
        return {
          ...b,
          typologyId: t?.id ?? b.typologyId,
          beds: t?.beds ?? b.beds,
          heightFloors: 2,
          isPenthouse: true,
        };
      });
    }
  }

  return out.map(({ _isTop, ...f }) => f);
}

// Stamp each box's real vertical extent (y0/y1) from its floor.
//
// Boxes built by the bubble-layout pipeline come out of siteGrid's
// cellsToBoxes, which only produces {x0,x1,z0,z1,type} — no height at all.
// Everything ON SCREEN still looked right because buildMassing reads
// floor.y0/floor.y1 rather than the box's own, so the omission was invisible
// in the 3D view while quietly breaking everything that consumes a box as a
// solid:
//   • rhinoExport's OBJ writer called b.y0.toFixed(3) on undefined and threw
//     ("Cannot read properties of undefined (reading 'toFixed')"), so the OBJ
//     deliverable was broken outright;
//   • the JSON export shipped every box with no height fields at all;
//   • ColumnPlacementStage's structuralVolumeM3 evaluated to NaN, feeding the
//     embodied-carbon badge.
// Stamping here — after subdivision, merging and every clip — means the height
// is present on exactly the geometry that gets rendered and exported.
//
// Penthouses carry heightFloors > 1 and genuinely occupy that much vertical
// space (they extrude above the roofline), so their y1 reflects it; that is
// what the renderer draws, so it is what the export must contain.
export function stampBoxHeights(floors) {
  if (!Array.isArray(floors)) return floors;
  return floors.map((floor) => {
    const fy0 = floor.y0 ?? 0;
    const fy1 = floor.y1 ?? (fy0 + 3.4);
    const h = fy1 - fy0;
    return {
      ...floor,
      boxes: floor.boxes.map((b) => {
        const mult = b.heightFloors > 1 ? b.heightFloors : 1;
        return { ...b, y0: fy0, y1: fy0 + h * mult };
      }),
    };
  });
}

// Count real dwellings (not floorplate fragments) across a floors array.
export function countDwellings(floors) {
  return (floors ?? []).reduce(
    (s, f) => s + f.boxes.filter(b => b.type === 'units' && b.typologyId).length, 0);
}

// Unit-mix breakdown by bed count, for the metrics panel.
export function dwellingMix(floors) {
  const mix = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let penthouses = 0;
  for (const f of floors ?? []) {
    for (const b of f.boxes) {
      if (b.type !== 'units' || !b.typologyId) continue;
      if (b.beds in mix) mix[b.beds]++;
      if (b.isPenthouse) penthouses++;
    }
  }
  return { mix, penthouses };
}
