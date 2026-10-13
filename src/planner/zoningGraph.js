// zoningGraph — authored bubble-diagram data: zone types as nodes, adjacency
// relationships as weighted edges. One shared graph (adjacency between zone
// TYPES is generically true — green space should sit next to semi-open
// amenity regardless of building size); only per-node target AREA varies by
// class/site (fed in separately as areaHints). Mirrors how DESIGN_RULE_PRESETS
// in zoningTargets.js is authored data, not hardcoded per class.
//
// Every floor is now laid out from this same graph (not just ground floor) —
// FLOOR_TIER_NODES controls which nodes are INCLUDED per floor tier, mirroring
// the real GLB asymmetry (ground floor carries entry/green/services;
// upper floors are units only).

// 'circulation' is deliberately NOT a zone here. The real GLB programme has
// no measured circulation area — glbProgramme.js:77 explicitly filters it out
// ("a massing-level connective surface, not a programme area"), so a
// circulation bubble had no area budget to spend and fell back to a nominal
// radius. That made it settle wherever relaxation left it, producing a block
// floating clear of the building. A zone with no measured area cannot be laid
// out honestly, so it is not laid out at all.
//
// TWO-LEVEL units layout: the real housing mass is organised into WINGS
// (real spatial clusters — a building rarely reads as one blob; it reads as
// a few distinct masses with real gaps of green/amenity between them), and
// each wing is independently subdivided into the four real dwelling bed
// counts (1B/2B/3B/4B). This mirrors how the previous single-level
// units_1b..4b design already worked (see MassingStage.jsx's
// floorsFromBubbleLayout and dwellings.js's bedGroupShares/subdivide) —
// wings just add one more real spatial layer on top, not a new mechanism.
//
// Wing COUNT and per-wing area SHARE are both computed live per site in
// MassingStage.jsx (wingCount from real buildable area, shares from a
// deliberate size gradient — see WING_SIZE_DECAY below), not hardcoded here;
// this file only provides the GENERIC graph-shape functions (adjacency,
// tiers, base radii) parameterised by however many wings a given site gets.
export const UNITS_BED_GROUPS = ['units_1b', 'units_2b', 'units_3b', 'units_4b'];

// A deliberate, labelled DESIGN decision, not measured data: real schemes
// read as one dominant mass plus smaller secondary ones, not N identical
// blocks — see MassingStage.jsx's wingAreaShares, which turns this decay
// rate into normalised per-wing area shares for however many wings a site
// gets.
export const WING_SIZE_DECAY = 0.75;

export function wingType(i) { return `wing_${i}`; }
export function wingZoneTypes(n) {
  return Array.from({ length: n }, (_, i) => wingType(i));
}

// Green is a real graph node again — NOT carved as an interior courtyard
// (that was tried and explicitly rejected: "no courtyards, just green
// terraces that act as connecting places between the community"). It
// competes for land like any other zone, pulled toward every wing at once
// (see WING_EXTERNAL_ADJACENCY below) — with wing count now capped at 1-2
// (MassingStage.jsx's MAX_WINGS), that pull reliably settles it in the
// real GAP between the wings instead of squeezed to one side, which is
// what happened the first time this was tried (with up to 4 wings, green
// only ever felt 1/4 of a fair pull toward "the middle").

// Nominal seed radius in metres — a starting "how much room this bubble
// wants" before real area demand (from glbProgramme boxes) rescales it.
export const ZONE_BASE_RADIUS = {
  green:       7,
  semiopen:    5,
  services:    4,
  entry:       3,
};
// Per-bed-group nominal radius, used by the nested per-wing sub-graph. The
// four bed-group bubbles split what used to be one 9m 'units' bubble, so
// each starts smaller (~half, since a typical mix leans toward 1-2 bed).
export const BED_GROUP_BASE_RADIUS = {
  units_1b: 6, units_2b: 6, units_3b: 5, units_4b: 4,
  core_stair: 2, core_lift: 1.3,
};
export function wingBaseRadius(n) {
  const r = { ...ZONE_BASE_RADIUS };
  wingZoneTypes(n).forEach((w) => { r[w] = 8; });
  return r;
}

// Edge weight: positive = attraction (spring pulls the pair together),
// negative = repulsion bias (keep this pair apart, e.g. noise separation).
// Symmetric/undirected — listed once, both directions implied.
// green<->units outranks green<->semiopen deliberately. It used to be the
// other way round (units 2, semiopen 3), which bound communal green space more
// tightly to VOID space than to the housing it exists to serve — and semiopen
// is filtered out before rendering (it is amenity/void, not solid mass), so it
// acted as an invisible tether dragging Green toward the site edge. Measured on
// Kensington, mean green-to-units overshoot beyond what the spring wants:
// 7.0m with the old weights, 4.2m with these, 2.3m with no semiopen edge at
// all. That drift is what made the sun slider look destructive — Green ended
// up ~0.65 of the way to the boundary, reading as detached amenity rather than
// part of the building.
export const NON_UNITS_ADJACENCY = [
  ['entry',       'services',    2],
  ['green',       'semiopen',    2],
  ['semiopen',    'services',   -1],
];

// Each wing inherits the exact adjacency the single 'units' node used to
// have toward entry/green/services (entry/green attract, services repels).
// Weights are divided by wing COUNT: green/entry used to feel ONE spring at
// weight 3 from the single 'units' node; with N wings each pulling at the
// old weight, they'd feel Nx the old total coupling force — verified live
// (see MEMORY: this exact trap already hit once when 'units' first split
// into bed groups, node positions blew up to x≈700+ on a ~190m site).
// Dividing by N keeps the AGGREGATE force on green/entry/services matching
// what relaxGraph's damping/step-clamp were actually tuned against.
//
// Wings themselves MUTUALLY REPEL (unlike bed groups, which mutually
// attract to stay one mass) — that repulsion is what actually demarcates
// them into distinct areas with real gaps between, and green (attracted to
// the wings collectively) naturally settles into those gaps rather than
// piling against one edge — reliably now that MAX_WINGS caps at 1-2
// (MassingStage.jsx), not up to 4.
const WING_EXTERNAL_ADJACENCY = [
  ['entry',    3],
  ['green',    3],
  ['services', -2],
];
const WING_MUTUAL_REPEL = -1.5;
// 'tower-cluster' wants wings to settle close/near-touching rather than at
// relaxGraph's normal repulsion-spring equilibrium (~2.2x the pair's own
// radius sum — see bubbleLayout.js's relaxGraph targetDist formula, which
// this doesn't change). A much weaker repel weight doesn't move that target
// distance, but it lets the adjacency/containment forces that DO pull wings
// together (shared entry/green, site containment) actually win instead of
// being overpowered by the repulsion spring, so wings settle materially
// closer without touching relaxGraph's shared physics constants — those
// stay generic for every other style.
const WING_MUTUAL_REPEL_TIGHT = -0.05;
export function wingAdjacency(n, tight = false) {
  const wings = wingZoneTypes(n);
  const repel = tight ? WING_MUTUAL_REPEL_TIGHT : WING_MUTUAL_REPEL;
  return [
    ...wings.flatMap((w) => WING_EXTERNAL_ADJACENCY.map(([other, wt]) => [w, other, wt / n])),
    ...wings.flatMap((a, i) => wings.slice(i + 1).map((b) => [a, b, repel])),
    ...NON_UNITS_ADJACENCY,
  ];
}

// Which nodes exist per floor tier at the WING level. Ground floor carries
// the full real-GLB programme (entry/green/services/semiopen); upper
// floors are wings only by default — MassingStage.jsx adds 'green' back in
// for whichever specific upper floors it assigns a connecting terrace to
// (see assignTerraceFloors), since that depends on real floor count.
export function wingFloorTierNodes(n) {
  const wings = wingZoneTypes(n);
  return {
    ground: [...wings, 'green', 'semiopen', 'services', 'entry'],
    upper:  [...wings],
  };
}

// Stair + lift core, one per wing. glbProgrammeForClass's own ground-floor
// derivation only ever exposes a MERGED stair+lift "services/core" box (see
// glbProgramme.js), so unlike every other zone in this file these two are
// not both individually measured. MassingStage.jsx uses the real per-class
// 'staircase' GLB mesh (glbProgramme.js's realStairAreaForClass) for
// core_stair wherever it's trustworthy — checked across all 11 extracted
// classes, only 3 give a believable single-flight footprint, the rest are
// clustering artifacts hundreds of m² too large. CORE_STAIR_AREA_M2 below is
// the FALLBACK for the other classes, not the only source.
//
// The GLB's 'lift' mesh has no trustworthy equivalent at all — in every
// class that has one it's a lobby/reach-volume artifact (26-2264 m² for a
// single lift, never a real shaft), so core_lift is always the rule-based
// ESTIMATE: a standard 8-person passenger lift shaft (~2.1m x 2.15m, a
// common manufacturer size). CORE_STAIR_AREA_M2's own fallback value is
// sized the same way — Approved Document B's minimum flight/landing width
// for a residential stair (~2.5m x 5m) — and happens to land within ~1m² of
// the 3 real measured classes, a useful cross-check that it's a reasonable
// estimate. One core per wing regardless of wing size — defensible since
// wing count is capped at 1-2 (MassingStage.jsx's MAX_WINGS), so a wing is
// never so large it plausibly needs a second core.
export const CORE_ZONE_TYPES = ['core_stair', 'core_lift'];
export const CORE_STAIR_AREA_M2 = 12.5;
export const CORE_LIFT_AREA_M2 = 4.5;
// The nested per-wing graph's full node list: the four bed groups plus the
// wing's one stair+lift core.
export const WING_SUBZONE_TYPES = [...UNITS_BED_GROUPS, ...CORE_ZONE_TYPES];

// The NESTED per-wing sub-graph: the four bed-group nodes (mutually
// attracting to stay one coherent mass — the wing they belong to already
// carries the relationship to green/entry/services one level up;
// MassingStage.jsx pulls this sub-graph toward its own wing's real anchor
// position via a biasForce instead, see floorsFromBubbleLayout) plus the
// core: stair and lift sit adjacent to each other (a real core is one
// combined landing) and pull modestly toward every bed group they serve, so
// they settle central to the units rather than off to one side.
const BED_GROUP_MUTUAL_WEIGHT = 0.6;
const CORE_MUTUAL_WEIGHT = 3;
const CORE_TO_BED_WEIGHT = 0.8;
export function bedGroupAdjacency() {
  const bedMutual = UNITS_BED_GROUPS.flatMap((a, i) => UNITS_BED_GROUPS.slice(i + 1).map((b) => [a, b, BED_GROUP_MUTUAL_WEIGHT]));
  const coreToBed = CORE_ZONE_TYPES.flatMap((c) => UNITS_BED_GROUPS.map((b) => [c, b, CORE_TO_BED_WEIGHT]));
  return [...bedMutual, ['core_stair', 'core_lift', CORE_MUTUAL_WEIGHT], ...coreToBed];
}

// Build a lookup: type -> [{ other, weight }], restricted to `types` and to
// the given adjacency list (both required now — see wingAdjacency/
// bedGroupAdjacency, since the graph SHAPE itself varies with wing count).
export function adjacencyLookup(types, adjacencyList) {
  const set = new Set(types);
  const map = new Map(types.map(t => [t, []]));
  for (const [a, b, weight] of adjacencyList) {
    if (!set.has(a) || !set.has(b)) continue;
    map.get(a)?.push({ other: b, weight });
    map.get(b)?.push({ other: a, weight });
  }
  return map;
}
