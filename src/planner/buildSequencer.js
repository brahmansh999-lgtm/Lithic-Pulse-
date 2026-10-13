// Site-wide build/assembly sequencer — orders a generated masterplan's
// buildings into construction waves and derives a real per-building
// programme (sourcing → casting → delivery → assembly), reusing the same
// lead-time/parallel-line math as the Configurator's Sourcing & Deliver step.
// This is what drives the masterplan's build-sequence timeline scrubber.

import { computeBOM, bomSummary, CATEGORIES } from '../configurator/utils/computeBOM';
import suppliersData from '../configurator/data/suppliers.json';
import layouts from '../configurator/data/roomLayouts.json';
import catalogueData from '../configurator/data/catalogue.json';
import typologiesData from '../configurator/data/typologies.json';

const RECIPE = catalogueData.substrateRecipe;
const TYPOLOGIES = typologiesData.typologies;
const TRUCK_PAYLOAD = 12000; // kg
const DELIVERY_ORDER = [CATEGORIES.STRUCTURAL, CATEGORIES.ENVELOPE, CATEGORIES.OPENINGS, CATEGORIES.FITOUT];
// Each lane here queues whole BUILDINGS (not individual trucks). The
// sequencer is only offered on small sites (see MAX_SEQUENCER_BUILDINGS in
// PlanControls.jsx) where a single real precast yard's line count is a
// meaningful number, not a megaproject's multi-factory logistics.
const MAX_PARALLEL_LINES = 12;

// Real per-building queuing only makes sense — and stays fast — on small
// sites. Above this size the "how many factories/crews run in parallel"
// question stops being answerable from one generated site alone, so the
// feature is disabled rather than guessing at a meaningless line count.
export const MAX_SEQUENCER_BUILDINGS = 60;
function parallelLines(buildingCount) {
  return Math.max(1, Math.min(MAX_PARALLEL_LINES, Math.ceil(buildingCount / 4)));
}

function classify(part) {
  const m = (part.material || '').toLowerCase();
  const id = (part.id || '').toLowerCase();
  if (m.includes('grp')) return 'grp';
  if (m.includes('glass') || id.includes('win')) return 'glass';
  if (m.includes('geopolymer')) return 'geopolymer';
  return 'castStone';
}

// Same edge-midpoint convention buildRoadNetwork() in masterplanGenerator.js
// uses, recomputed here from the plan's own cols/rows/cellSize — keeps the
// sequencer's notion of "the site entrance" consistent with how the road
// network was actually laid out, without needing the generator to export
// its internal entry cell.
function accessPoints(plan, accessEdges) {
  const { cols, rows, cellSize } = plan;
  const edges = accessEdges?.length ? accessEdges : ['south', 'east'];
  const edgeMap = {
    north: { c: Math.floor(cols / 2), r: 0 },
    south: { c: Math.floor(cols / 2), r: rows - 1 },
    west:  { c: 0, r: Math.floor(rows / 2) },
    east:  { c: cols - 1, r: Math.floor(rows / 2) },
  };
  return edges.filter(e => edgeMap[e]).map(e => {
    const { c, r } = edgeMap[e];
    return { x: c * cellSize, z: r * cellSize };
  });
}

function buildingCentroid(b, cellSize) {
  const x = b.col * cellSize + (b.w * cellSize) / 2;
  const z = b.row * cellSize + (b.d * cellSize) / 2;
  return { x, z };
}

const fastestLeadByClass = (() => {
  const f = {};
  suppliersData.suppliers.forEach(s => s.materials.forEach(mc => {
    if (!(mc in f) || s.leadWeeks < f[mc]) f[mc] = s.leadWeeks;
  }));
  return f;
})();

// computeBOM is pure given (typologyId, config) — every unit of the same
// typology across every building in the plan produces an identical result,
// so memoize it per typology instead of recomputing it per unit. This is
// the real cost center: without caching, a 50-building site with ~3 units
// each calls computeBOM 150+ times for needs alone, and previously another
// 600+ times for truck loads (4x per unit, once per delivery category).
const bomCache = new Map();
function getBOM(typologyId, config) {
  const key = typologyId + '|' + JSON.stringify(config);
  let parts = bomCache.get(key);
  if (!parts) {
    const t = TYPOLOGIES.find(t => t.id === typologyId);
    parts = t ? computeBOM(t, config, layouts).filter(p => !p.isSummary) : [];
    bomCache.set(key, parts);
  }
  return parts;
}

// Per-building BOM (its own unit mix), reduced to the same supplier-need
// breakdown the Sourcing panel shows, so the slowest-arriving raw material
// for THIS building's specific typology mix gates its own sourcing time.
function buildingNeeds(building, config) {
  const needs = {};
  building.units.forEach(u => {
    getBOM(u.typologyId, config).forEach(p => {
      const kg = p.weightKgTotal || 0;
      if (kg <= 0) return;
      const cls = classify(p);
      needs[cls] = (needs[cls] || 0) + kg;
      if (cls === 'castStone') {
        needs.marbleDust     = (needs.marbleDust     || 0) + kg * RECIPE.marbleDust;
        needs.ggbs           = (needs.ggbs           || 0) + kg * RECIPE.ggbs;
        needs.portlandCement = (needs.portlandCement || 0) + kg * RECIPE.portlandCement;
      }
    });
  });
  return needs;
}

function buildingTruckLoads(building, config) {
  const pieces = [];
  building.units.forEach(u => {
    DELIVERY_ORDER.forEach(cat => {
      getBOM(u.typologyId, config).filter(p => p.category === cat).forEach(p => {
        for (let i = 0; i < p.qty; i++) pieces.push(p.weightKgEach);
      });
    });
  });
  const trucks = [];
  let kg = 0;
  pieces.forEach(wt => {
    if (kg + wt > TRUCK_PAYLOAD) { trucks.push(kg); kg = 0; }
    kg += wt;
  });
  if (kg > 0) trucks.push(kg);
  return trucks.length;
}

/**
 * Sequence every building in the plan into a real construction programme.
 * Returns { buildings: [{ id, order, distFromAccess, areaM2, weeks: {sourcingStart, sourcingEnd, castingStart, castingEnd, deliveryStart, deliveryEnd, assemblyStart, assemblyEnd} }], totalWeeks, lines }
 */
export function sequenceBuilds(plan, config, accessEdges) {
  if (!plan?.buildings?.length) return { buildings: [], totalWeeks: 0, lines: 1 };
  const pts = accessPoints(plan, accessEdges);
  const cellSize = plan.cellSize || 2.0;

  // 1. Order by distance to nearest access point — buildings closest to the
  // site entrance are reachable (and craneable) first in a real build.
  const withDist = plan.buildings
    .filter(b => b.units?.length > 0)
    .map(b => {
      const { x, z } = buildingCentroid(b, cellSize);
      const dist = Math.min(...pts.map(p => Math.hypot(x - p.x, z - p.z)));
      return { building: b, dist };
    })
    .sort((a, b) => a.dist - b.dist);

  const lines = parallelLines(withDist.length);

  // 2. Each building gets its own sourcing/casting/delivery duration from
  // its real unit mix, then is queued onto one of `lines` parallel slots —
  // building i starts casting when slot (i % lines) frees up, exactly like
  // a real precast yard running several bays at once.
  const laneFreeAt = new Array(lines).fill(0);
  const results = withDist.map(({ building, dist }, i) => {
    const needs = buildingNeeds(building, config);
    const neededClasses = Object.keys(needs).filter(c => c in fastestLeadByClass || ['castStone','marbleDust','ggbs','portlandCement'].includes(c));
    const sourcingWeeks = Math.max(0, ...neededClasses.map(c => fastestLeadByClass[c] ?? 0));

    const areaM2 = building.units.reduce((s, u) => s + (u.areaM2 || 0), 0);
    const castingWeeks  = Math.max(1, Math.ceil((areaM2 / 20) * 1.5));
    const totalLoads    = buildingTruckLoads(building, config);
    const deliveryWeeks = Math.max(1, Math.ceil(totalLoads / 5));
    const assemblyWeeks = Math.max(1, Math.ceil(areaM2 / 30));

    const lane = i % lines;
    const castingStart  = Math.max(laneFreeAt[lane], sourcingWeeks);
    const castingEnd    = castingStart + castingWeeks;
    const deliveryStart = castingEnd;
    const deliveryEnd   = deliveryStart + deliveryWeeks;
    const assemblyStart = deliveryStart + Math.min(1, deliveryWeeks);
    const assemblyEnd   = Math.max(deliveryEnd, assemblyStart + assemblyWeeks);
    laneFreeAt[lane] = castingEnd;

    return {
      id: building.id,
      order: i,
      distFromAccess: dist,
      areaM2,
      weeks: {
        sourcingStart: 0, sourcingEnd: sourcingWeeks,
        castingStart, castingEnd,
        deliveryStart, deliveryEnd,
        assemblyStart, assemblyEnd,
      },
    };
  });

  const totalWeeks = Math.max(1, ...results.map(r => r.weeks.assemblyEnd));
  return { buildings: results, totalWeeks, lines };
}

// Which phase a building is in at a given week, for overlay coloring.
export function phaseAtWeek(weeks, week) {
  if (week < weeks.sourcingEnd) return 'sourcing';
  if (week < weeks.castingEnd) return 'casting';
  if (week < weeks.deliveryEnd) return 'delivery';
  if (week < weeks.assemblyEnd) return 'assembly';
  return 'done';
}
