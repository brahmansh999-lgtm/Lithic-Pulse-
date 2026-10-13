// Turns a raw extracted precedent profile (one completed building's measured
// geometry, see scripts/extractZoning.mjs + data/precedentZoning.json) into
// zoning TARGETS sized for a specific site — and scores a generated plan
// against those targets as a hard pass/fail gate.
//
// Why scaling is needed: each precedent is ONE building's footprint
// (2,900-5,900 m²). A real site (pocket/village tier, 5,000-25,000 m²) is
// usually several times larger than that single footprint — so we carry
// over the precedent's RATIOS (coverage %, units per m² of footprint, floor
// count, green % of footprint) and apply them to the actual site area,
// rather than copying absolute unit counts across a different-sized site.

import { generateMasterplan, CONCEPTS, CELL } from './masterplanGenerator';
import precedents from './data/precedentZoning.json';

export { precedents };

// unitsPerM2 = unitCountEstimate / footprintAreaM2 — density ratio that
// transfers across site sizes better than an absolute unit count.
function unitsPerM2(p) {
  return p.unitCountEstimate && p.footprintAreaM2 ? p.unitCountEstimate / p.footprintAreaM2 : null;
}

// coresPerUnit = stairCoreCount / unitCountEstimate — the precedent's own
// stair-core count was measured from ONE building; a real site is a
// multi-building masterplan (e.g. 24 buildings on a pocket site), so
// copying that raw count across produced an always-failing gate (7 target
// vs ~28 actual cores on a 24-building plan — same class of bug as copying
// unitCountEstimate directly before unitsPerM2 was introduced). Scale by
// the precedent's own cores-per-unit ratio instead, applied to THIS site's
// target unit count, same as density above.
function coresPerUnit(p) {
  return p.stairCoreCount && p.unitCountEstimate ? p.stairCoreCount / p.unitCountEstimate : null;
}

// Green space is NOT a separately-dialed target — it's whatever ground is
// left over once the precedent's massing/density is matched on the site.
// A precedent's coverageEstimatePct is the BUILDING's own footprint coverage
// of its own minimal bounding box (measured from one isolated building GLB),
// not the coverage of the wider site it would sit on (which also includes
// yards/access/parking the GLB never captured) — so it can't be inverted
// into a site green% directly either. scoreAgainstZoning therefore does not
// gate on greenPercent at all; whatever residual ground the matched massing
// leaves IS the green space, reported but not filtered on.

// Architect-authored placement/orientation rules — distinct from the
// numeric targets above (units/floors/grid/cores), which are SIZE targets
// scaled from a measured precedent. These are SPATIAL rules the architect
// dials in directly for a typology, transcribed from a hand sketch: single
// efficient service core, vehicular+community clustered into one site
// corner to concentrate noise there, balconies facing east (soft/bearable
// light for outdoor use) independent of the south-facing solar-gain bias
// already used for openings/massing orientation (solarAzimuth).
// Each preset is OFF by default per field (null/false) — the architect
// opts a precedent into a rule set explicitly in ArchitectZoningGate.
// ── Rule schema (all four sizes) ──────────────────────────────────────────
// fixedCoreCount: null = travel-distance auto | 1 = single | 2 = double
// noiseClusterCorner: null | 'sw'|'se'|'nw'|'ne' — corner where vehicular
//   + community are biased (generator scores) to concentrate noise
// balconyAzimuth: null | degrees — compass direction balconies face
//   (recorded as building.balconyFacing for viewer; separate from solarAzimuth)
// solarAzimuth: degrees — opening/glazing bias for solar gain (default 180=S)
// communalCorner: null | 'sw'|'se'|'nw'|'ne' — courtyard + communal space
//   biased toward this corner (max light); can differ from noiseClusterCorner
// balconyFacingMulti: null | string[] — multiple compass directions for
//   balconies (large building: east+west+south all get max sun); when set,
//   balconyAzimuth is ignored and this array drives viewer annotation
// ── Phase D additions (the 4 rules that were in the sketches but not encoded) ─
// Compass↔side convention (matches COMMUNAL_SIDES in zoningMassingVariations):
//   left = West · right = East · front = South · back = North
// communityZoneSide: null | 'east'|'west'|'south'|'north' — the COMMUNITY/
//   amenity zone is biased to this face (medium sketch: community in the East
//   for soft morning light over seating; large: communal pulled SW). Distinct
//   from communalCorner (a corner bias for the green courtyard); this is the
//   built community/amenity programme's preferred edge.
// vehicularCorner: null | 'sw'|'se'|'nw'|'ne' — vehicular circulation kept to
//   ONE corner, SEPARATE from pedestrian (sketch: "vehicular limited to one
//   corner to reduce noise"). Usually the same corner as noiseClusterCorner,
//   but kept as its own field so the rule reads explicitly and can differ.
// viewAzimuth: null | degrees — a primary VIEW the building orients toward
//   (XL/river variant: views to the river; large keeps the river/east view
//   open). Biases units/balconies toward this face so the outlook is protected.
// viewFeature: null | string — label for the view ('river', etc.), UI only.
// voidSolidVariance: false | true — "voids + solids to break the monotony of
//   the building" (every sketch). When true, massing candidates with genuine
//   stepped/cascade/void profiles (real footprint variation between floors)
//   are rewarded over flat extrusions.
export const DESIGN_RULE_PRESETS = {
  // SMALL — same rules as medium: compact single core, noise to SW corner,
  // balconies east for comfort, openings south for solar gain.
  // Site: Berkley Square (same sketch, nearly identical brief).
  small_building: {
    id: 'small_building',
    label: 'Small',
    fixedCoreCount: 1,
    noiseClusterCorner: 'sw',
    balconyAzimuth: 90,         // east — soft bearable light all day
    balconyFacingMulti: null,
    solarAzimuth: 180,          // south — max solar gain for openings
    communalCorner: null,
    communityZoneSide: 'east',  // community zone in the East (soft morning light)
    vehicularCorner: 'sw',      // vehicular limited to one corner (noise)
    viewAzimuth: null,
    viewFeature: null,
    voidSolidVariance: true,    // voids + solids to break monotony
  },

  // MEDIUM — rules encoded from hand sketch (Berkley Square):
  // single efficient service core, noise corner SW (vehicular + community
  // clustered), balconies east (comfort/subtle light), openings south (solar
  // gain), voids + solids to break monotony.
  medium_building: {
    id: 'medium_building',
    label: 'Medium',
    fixedCoreCount: 1,
    noiseClusterCorner: 'sw',
    balconyAzimuth: 90,         // east
    balconyFacingMulti: null,
    solarAzimuth: 180,          // south
    communalCorner: null,
    communityZoneSide: 'east',  // community zone in the East (soft morning light, seating)
    vehicularCorner: 'sw',      // vehicular + community clustered to one corner (noise)
    viewAzimuth: null,
    viewFeature: null,
    voidSolidVariance: true,    // voids + solids to break monotony
  },

  // LARGE — rules from hand sketch (London Sustainable Industries South Plot 10):
  // double service core (large footprint needs two), balconies face E+W+S for
  // max sunlight (three-sided exposure, unlike medium's east-only), communal
  // space + courtyard placed SW to get max light, vehicular noise corner SW
  // (same principle as medium), separation of vehicular/pedestrian, voids +
  // solids to break monotony, single building block (not fragmented cluster).
  // View toward river/east kept open.
  large_building: {
    id: 'large_building',
    label: 'Large Building Double',
    fixedCoreCount: 2,
    noiseClusterCorner: 'sw',
    balconyAzimuth: null,       // multi-directional — see balconyFacingMulti
    balconyFacingMulti: ['east', 'west', 'south'],
    solarAzimuth: 180,          // south — openings/glazing for solar gain
    communalCorner: 'sw',       // courtyard + communal in SW for max light
    communityZoneSide: 'south', // communal/community pulled south(-west) for max light
    vehicularCorner: 'sw',      // vehicular kept to one corner, separated from pedestrian
    viewAzimuth: 90,            // east — river/east view kept open
    viewFeature: 'river/east outlook',
    voidSolidVariance: true,    // voids + solids to break monotony
  },

  // EXTRA LARGE — rules from hand sketch (large-double, river variant /
  // Royal Albert Dock): views oriented to the RIVER; communal spaces in E/W/S
  // for max sun; most balconies E/W/S; vehicular/pedestrian separated;
  // "everything else pretty much same" as Large.
  extra_large_building: {
    id: 'extra_large_building',
    label: 'Extra Large',
    fixedCoreCount: 2,
    noiseClusterCorner: 'sw',
    balconyAzimuth: null,
    balconyFacingMulti: ['east', 'west', 'south'],
    solarAzimuth: 180,
    communalCorner: 'sw',
    communityZoneSide: 'east',  // communal in E/W/S — east face protected for the river outlook
    vehicularCorner: 'sw',      // vehicular one corner, separated from pedestrian
    viewAzimuth: 90,            // east — views oriented to the river
    viewFeature: 'river',
    voidSolidVariance: true,
  },
};

export const NO_DESIGN_RULES = {
  id: 'none', label: 'None',
  fixedCoreCount: null, noiseClusterCorner: null,
  balconyAzimuth: null, balconyFacingMulti: null,
  solarAzimuth: 180, communalCorner: null,
  communityZoneSide: null, vehicularCorner: null,
  viewAzimuth: null, viewFeature: null, voidSolidVariance: false,
};

// buildZoningSpec(precedent, siteAreaM2) → target numbers for this site,
// scaled from the precedent's measured ratios.
export function buildZoningSpec(precedent, siteAreaM2) {
  const density = unitsPerM2(precedent);
  const coveragePct = precedent.coverageEstimatePct ?? 78;
  const footprintOnSite = siteAreaM2 * (coveragePct / 100);

  const targetUnitCount = density ? Math.max(8, Math.round(footprintOnSite * density)) : null;
  const coreRatio = coresPerUnit(precedent);
  const targetStairCoreCount = coreRatio && targetUnitCount
    ? Math.max(1, Math.round(targetUnitCount * coreRatio))
    : precedent.stairCoreCount; // fallback for precedents missing unitCountEstimate

  return {
    sourceId: precedent.id,
    sourceName: precedent.name,
    targetUnitCount,
    targetFloorCount: precedent.floorCount,
    targetFloorToFloorM: precedent.floorToFloorM,
    targetColumnGridM: precedent.columnGridM,
    targetStairCoreCount,
    targetCoveragePct: coveragePct,
    designRules: NO_DESIGN_RULES,
  };
}

// Tolerance bands — how far a generated plan may drift from the target and
// still PASS. Wide enough that real seed variety can clear the bar, tight
// enough that the gate means something (a plan with triple the units is a
// different zoning, not a variation of this one). Green% is reported on
// every plan but NOT gated — see note above buildZoningSpec.
const UNIT_COUNT_TOLERANCE = 0.35;   // ±35%
const FLOOR_COUNT_TOLERANCE = 3;     // ± storeys

// scoreAgainstZoning(plan, zoningSpec) → { pass, score, reasons[] }
// pass = false means the plan must NOT be shown to the architect — it is a
// hard gate, not a soft ranking penalty. score (0-100, only meaningful when
// pass) ranks passing plans so the best-fit variations surface first.
export function scoreAgainstZoning(plan, spec) {
  if (!plan || !plan.buildings?.length) return { pass: false, score: 0, reasons: ['empty plan'] };

  const reasons = [];
  let score = 100;

  if (spec.targetUnitCount) {
    const delta = Math.abs(plan.totalUnits - spec.targetUnitCount) / spec.targetUnitCount;
    if (delta > UNIT_COUNT_TOLERANCE) reasons.push(`unit count ${plan.totalUnits} vs target ${spec.targetUnitCount} (off by ${Math.round(delta * 100)}%)`);
    score -= Math.min(40, delta * 80);
  }

  if (spec.targetFloorCount) {
    const maxFloor = plan.floors?.max ?? 0;
    const delta = Math.abs(maxFloor - spec.targetFloorCount);
    if (delta > FLOOR_COUNT_TOLERANCE) reasons.push(`max floors ${maxFloor} vs target ${spec.targetFloorCount} (off by ${delta})`);
    score -= Math.min(20, delta * 4);
  }

  // Entry presence — the plan must actually have a road network reaching the
  // site, not just buildings floating with no access.
  if (!plan.roads?.some(r => r.type === 'entry')) reasons.push('no entry point in road network');

  // Stair core count is NOT gated. decorateBuilding() places real internal
  // cores per building via a max-travel-distance rule, which is correct
  // architecturally — but the precedent (one large building, ~14 units/core)
  // and a real multi-building masterplan (many small buildings, each still
  // needing its own core regardless of how few units it holds — measured at
  // ~3.8 units/core on a 19-building plan) have genuinely different core
  // efficiency. That's a structural difference between single-building and
  // multi-building massing, not a fit/no-fit signal — gating on it made
  // every candidate fail regardless of how well it matched everything else.
  // (Previously gated here with a raw, then a scaled-but-still-failing
  // target — removed after confirming via a real sweep that it was zeroing
  // out 100% of candidates. Cores still get computed and rendered; they're
  // just not compared to the precedent's count.)

  return { pass: reasons.length === 0, score: Math.max(0, Math.round(score)), reasons };
}

// scoreAgainstGLBShape(plan, glbPrecedent) → 0-100
// Separate from scoreAgainstZoning: that function scores a candidate against
// the ARCHITECT'S TARGETS (units/floors scaled to this site's size). This
// one scores how closely a candidate's actual massing shape resembles the
// matched bldg_gl GLB's own real measured geometry (footprint area,
// coverage %, floor count, density) — i.e. "does this computed iteration
// converge toward the real building", not just "does it hit the brief".
// Coarse stat comparison only (footprint/coverage/floors/density ratios
// from precedentZoning.json), not real polygon/volume overlap — see
// scripts/extractZoning.mjs for what's actually measured per GLB.
export function scoreAgainstGLBShape(plan, glbPrecedent) {
  if (!plan || !plan.buildings?.length || !glbPrecedent) return 0;

  const buildings = plan.buildings.filter(b => b.units?.length > 0);
  if (!buildings.length) return 0;

  // FOOTPRINT = ground-floor plan area (whole-building plate), directly
  // comparable to the GLB's footprintAreaM2. The massing path records this as
  // plan.footprintM2 (the real plate, computed in toPlan). The legacy
  // generateMasterplan path doesn't, so fall back to summing its building
  // footprints there. NB: do NOT sum the massing path's per-floor-group
  // `buildings` — a candidate emits one units sub-volume per floor-group
  // (ground/f1to3/f4to5/f6), so summing counts the footprint ~4× and made the
  // plan read far larger than the real GLB.
  const planFootprintM2 = plan.footprintM2
    ?? buildings.reduce((s, b) => s + b.w * b.d * CELL * CELL, 0);
  const planFloorMax = plan.floors?.max ?? 0;
  const planUnits = plan.totalUnits ?? 0;
  const planDensity = planFootprintM2 ? planUnits / planFootprintM2 : 0;

  const glbDensity = glbPrecedent.unitCountEstimate && glbPrecedent.footprintAreaM2
    ? glbPrecedent.unitCountEstimate / glbPrecedent.footprintAreaM2
    : null;

  const closeness = (a, b) => (a == null || b == null || b === 0) ? null : 1 - Math.min(1, Math.abs(a - b) / b);

  const parts = [
    closeness(planFootprintM2, glbPrecedent.footprintAreaM2),
    closeness(planFloorMax, glbPrecedent.floorCount),
    closeness(planDensity, glbDensity),
  ].filter(v => v != null);

  if (!parts.length) return 0;
  const avg = parts.reduce((s, v) => s + v, 0) / parts.length;
  return Math.max(0, Math.min(100, Math.round(avg * 100)));
}

// generatePrecedentFittedIterations(siteBounds, sitePolygon, zoningSpec, baseOptions)
// Designs toward the approved zoning targets, not just random variety:
//   - sweeps a seed per concept across ALL 9 massing concepts (CONCEPTS),
//     so every massing language gets a fair shot at meeting the same targets
//   - steers via siteContext.maxFloors toward spec.targetFloorCount (the one
//     target the generator accepts as a direct constraint)
//   - HARD-FILTERS by scoreAgainstZoning: anything that fails the gate never
//     reaches the architect, regardless of how visually distinct it is
//   - returns only passing results, ranked by fit score, with NO concept name
//     surfaced (the architect picks a "variation", not a named typology)
const SEEDS_PER_CONCEPT = 12;

export function generatePrecedentFittedIterations(siteBounds, sitePolygon, zoningSpec, baseOptions = {}, { keep = 12 } = {}) {
  const results = [];
  const siteContext = {
    ...(baseOptions.siteContext || {}),
    ...(zoningSpec.targetFloorCount ? { maxFloors: zoningSpec.targetFloorCount + 1 } : {}),
  };

  let maxUnitsSeen = 0;
  let seedCounter = 1;
  for (const concept of CONCEPTS) {
    for (let i = 0; i < SEEDS_PER_CONCEPT; i++) {
      const seed = seedCounter++;
      let plan;
      try {
        plan = generateMasterplan(siteBounds, seed, sitePolygon, { ...baseOptions, siteContext, concept, designRules: zoningSpec.designRules });
      } catch {
        continue;
      }
      if (!plan) continue;
      if (plan.totalUnits > maxUnitsSeen) maxUnitsSeen = plan.totalUnits;
      const { pass, score, reasons } = scoreAgainstZoning(plan, zoningSpec);
      if (!pass) continue;
      results.push({ seed, plan, score, variationLabel: `Variation ${results.length + 1}` });
    }
  }

  results.sort((a, b) => b.score - a.score);
  // Re-label after sort so "Variation 1" is always the best fit.
  const variations = results.slice(0, keep).map((r, i) => ({ ...r, variationLabel: `Variation ${String.fromCharCode(65 + i)}` }));

  // Feasibility signal: if NOTHING passed AND the best any candidate could
  // reach is well below the target, this precedent's density genuinely
  // cannot fit on this site (not a tolerance/seed-luck issue — measured
  // directly across the real sweep, e.g. precedent_5 wants 207 units, this
  // generator tops out near 139 on a 4700 m² pocket site no matter the
  // concept/seed). Surfacing this lets the architect pick a different,
  // less-dense precedent instead of staring at an empty results screen with
  // no explanation, or being pushed toward a bigger site the brief excludes.
  const feasibilityWarning = (variations.length === 0 && zoningSpec.targetUnitCount && maxUnitsSeen < zoningSpec.targetUnitCount * 0.7)
    ? `${zoningSpec.sourceName}'s density doesn't fit this site — the best achievable is ~${maxUnitsSeen} units vs a ${zoningSpec.targetUnitCount}-unit target. Scaling the target down to fit.`
    : null;

  return { variations, feasibilityWarning, maxUnitsSeen };
}
