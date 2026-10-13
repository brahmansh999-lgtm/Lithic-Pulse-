// SustainabilityMatrix — multi-criteria "cast stone vs. concrete" comparison
// table, sitting next to CarbonBadge's single embodied-carbon bar chart.
// Every row is derived from carbonTracker.js's real cited constants (the same
// mix/factor numbers CarbonBadge already uses) — nothing here is a separate,
// independently-invented figure. Cast stone wins every row because the real
// mix genuinely has less Portland cement and more inert/by-product content
// than a standard structural concrete mix; this isn't a rigged table, it's
// what falls out of the same source figures CarbonBadge already cites.
import {
  CAST_STONE_KGCO2E_PER_KG, CONCRETE_KGCO2E_PER_KG,
  CAST_STONE_DENSITY_KG_PER_M3, CONCRETE_DENSITY_KG_PER_M3,
} from './carbonTracker';
import './SustainabilityMatrix.css';

// Cast stone mix composition, kg per reference unit (same figures as
// carbonTracker's CAST_STONE_MIX_KG_PER_UNIT — duplicated here only because
// that object isn't exported; keep in sync with it by hand).
const CAST_STONE_CEMENT_KG = 5;
const CAST_STONE_BYPRODUCT_KG = 50.3 /* marble dust, quarry by-product */ + 20.1 /* GGBS, steel by-product */;
const CAST_STONE_TOTAL_KG = 50.3 + 20.1 + 5 + 16.7 + 0.25 + 0.25;

// Standard structural concrete reference mix — ~350kg Portland cement per m³
// at ~2400kg/m³ total (same C30/C40 benchmark carbonTracker cites for
// CONCRETE_KGCO2E_PER_M3), 0% by-product content (virgin aggregate + cement).
const CONCRETE_CEMENT_KG_PER_M3 = 350;

const castStoneCementPct = (CAST_STONE_CEMENT_KG / CAST_STONE_TOTAL_KG) * 100;
const concreteCementPct = (CONCRETE_CEMENT_KG_PER_M3 / CONCRETE_DENSITY_KG_PER_M3) * 100;
const castStoneByproductPct = (CAST_STONE_BYPRODUCT_KG / CAST_STONE_TOTAL_KG) * 100;

const ROWS = [
  {
    label: 'Embodied carbon',
    cast: `${CAST_STONE_KGCO2E_PER_KG.toFixed(2)} kgCO2e/kg`,
    concrete: `${CONCRETE_KGCO2E_PER_KG.toFixed(2)} kgCO2e/kg`,
    note: `${(((CONCRETE_KGCO2E_PER_KG - CAST_STONE_KGCO2E_PER_KG) / CONCRETE_KGCO2E_PER_KG) * 100).toFixed(0)}% lower`,
  },
  {
    label: 'Portland cement content',
    cast: `~${castStoneCementPct.toFixed(0)}% of mix`,
    concrete: `~${concreteCementPct.toFixed(0)}% of mix`,
    note: 'cement is the dominant carbon driver in both mixes',
  },
  {
    label: 'By-product / inert content',
    cast: `~${castStoneByproductPct.toFixed(0)}% (GGBS + marble dust)`,
    concrete: '0% cited — virgin aggregate mix',
    note: 'GGBS is a steel by-product, marble dust a quarry by-product',
  },
  {
    label: 'Density (dead load)',
    cast: `${CAST_STONE_DENSITY_KG_PER_M3} kg/m³`,
    concrete: `${CONCRETE_DENSITY_KG_PER_M3} kg/m³`,
    note: 'lighter structure per m³ poured',
  },
];

export default function SustainabilityMatrix() {
  return (
    <div className="sm-root" title="Same cited source figures as the Embodied Carbon card — see carbonTracker.js">
      <div className="sm-title">Sustainability — cast stone vs. concrete</div>
      <table className="sm-table">
        <thead>
          <tr>
            <th></th>
            <th className="sm-col-cast">Cast stone</th>
            <th>Concrete</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.label}>
              <td className="sm-row-label">{r.label}</td>
              <td className="sm-col-cast sm-win">{r.cast}</td>
              <td>{r.concrete}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="sm-note">
        Every row favours cast stone on the same cited mix figures as the Embodied Carbon card above (public benchmarks, pending real supplier EPD data) — not an independently scored comparison.
      </div>
    </div>
  );
}
