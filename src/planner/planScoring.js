// Plan-quality scoring + curated iteration sweeps.
// Pure aggregation over the existing generateMasterplan() output — no
// changes to the generator itself. Used to turn a large seed sweep into
// a small, hand-curatable shortlist for the iteration gallery.

import { generateMasterplan } from './masterplanGenerator';

const GREEN_TARGET_MIN = 35;
const GREEN_TARGET_MAX = 50;

// Unit-mix balance: 1.0 = perfectly even spread across typologies present,
// 0 = all units are a single typology. Rewards variety without requiring
// a specific target mix (mixTargets already covers that separately).
function unitMixBalance(buildings) {
  const counts = {};
  let total = 0;
  buildings.forEach(b => b.units.forEach(u => {
    counts[u.typologyId] = (counts[u.typologyId] || 0) + 1;
    total++;
  }));
  const types = Object.keys(counts);
  if (total === 0 || types.length <= 1) return types.length === 1 ? 0.3 : 0;

  // Normalised entropy across typology shares.
  const entropy = types.reduce((s, t) => {
    const p = counts[t] / total;
    return s - p * Math.log(p);
  }, 0);
  const maxEntropy = Math.log(types.length);
  return maxEntropy > 0 ? entropy / maxEntropy : 0;
}

function floorVariety(buildings) {
  const floors = buildings.map(b => b.floors).filter(Boolean);
  if (!floors.length) return 0;
  const spread = Math.max(...floors) - Math.min(...floors);
  // Some variety is good (visual interest), too much reads as incoherent.
  return 1 - Math.min(1, Math.abs(spread - 4) / 8);
}

// scorePlan(plan) → single quality number, higher is better.
// Built entirely from aggregates already present on a generateMasterplan()
// result: totalUnits, floors.min/max, greenPercent, buildings.length, and
// a derived unit-mix tally — no new generator logic required.
export function scorePlan(plan) {
  if (!plan || !plan.buildings?.length) return -Infinity;

  const { buildings, totalUnits, greenPercent, floors } = plan;

  const greenScore = greenPercent >= GREEN_TARGET_MIN && greenPercent <= GREEN_TARGET_MAX
    ? 1
    : 1 - Math.min(1, Math.abs(greenPercent - (GREEN_TARGET_MIN + GREEN_TARGET_MAX) / 2) / 40);

  const densityScore = Math.min(1, totalUnits / Math.max(1, buildings.length * 12));
  const diversityScore = Math.min(1, buildings.length / 6);
  const mixScore = unitMixBalance(buildings);
  const massingScore = floorVariety(buildings);

  return (
    greenScore     * 30 +
    densityScore   * 20 +
    diversityScore * 15 +
    mixScore       * 20 +
    massingScore   * 15
  );
}

// generateCuratedIterations(siteBounds, sitePolygon, options, { sweepCount, keep })
// Sweeps a range of seeds through the existing generator, scores each with
// scorePlan, and returns the best `keep` as { seed, plan, score } tuples
// sorted descending by score.
export function generateCuratedIterations(siteBounds, sitePolygon, options = {}, { sweepCount = 60, keep = 20 } = {}) {
  const results = [];
  for (let i = 0; i < sweepCount; i++) {
    const seed = i + 1;
    let plan;
    try {
      plan = generateMasterplan(siteBounds, seed, sitePolygon, options);
    } catch {
      continue;
    }
    if (!plan) continue;
    results.push({ seed, plan, score: scorePlan(plan) });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, keep);
}
