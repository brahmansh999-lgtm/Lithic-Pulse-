// Aggregates per-unit BOM across every unit in a finalised plan, for the
// Manufacturer's "how much, what, when" view. Reuses computeBOM/bomSummary
// as-is — no new BOM logic — since per-unit customization only happens
// when a Home Owner opens the Configurator, and most units in a finalised
// plan won't have gone through that yet. Each unit's typology gets a
// sensible default config so the rollup reflects a buildable baseline.
import { computeBOM, bomSummary } from './computeBOM';
import layouts from '../data/roomLayouts.json';
import typologiesData from '../data/typologies.json';

const { typologies } = typologiesData;

export const DEFAULT_CONFIG = {
  balcony:    'BAL_NONE',
  partition:  'PAR_OPEN',
  pigment:    'PIG_NONE',
  glazing:    'GLZ_STANDARD',
  marbleDust: 50.3,
  ggbs:       20.1,
  cement:     5,
  water:      16.7,
  basaltFibre:       0.25,
  superplasticizer:  0.25,
};

function resolveTypology(typologyId) {
  return typologies.find(t => t.id === typologyId) ?? typologies[0];
}

// aggregateBOM(units, defaultConfigByTypology?) → { parts, summary, mouldTotals }
// units: plan.buildings[].units[] flattened, each with a typologyId.
export function aggregateBOM(units, defaultConfigByTypology = {}) {
  const totals = new Map(); // part id -> merged part

  units.forEach(unit => {
    const typology = resolveTypology(unit.typologyId);
    const config = defaultConfigByTypology[unit.typologyId] || DEFAULT_CONFIG;
    const parts = computeBOM(typology, config, layouts);

    parts.forEach(p => {
      if (p.isSummary) return;
      const existing = totals.get(p.id);
      if (existing) {
        existing.qty += p.qty;
        existing.weightKgTotal += p.weightKgTotal;
      } else {
        totals.set(p.id, { ...p });
      }
    });
  });

  const parts = Array.from(totals.values());
  const summary = bomSummary(parts);

  const mouldTotals = parts
    .filter(p => p.mouldType && p.uniqueMoulds > 0)
    .map(p => ({ id: p.id, label: p.label, mouldType: p.mouldType, totalCasts: p.qty }));

  return { parts, summary, mouldTotals };
}
