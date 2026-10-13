// Derives column positions for a building's footprint, snapped to a
// centre-to-centre grid pitch (metres). This is NOT part of
// masterplanGenerator.js's massing/placement logic — it's a layer on top
// that reads a finished building's footprint + a target pitch (usually the
// approved precedent's targetColumnGridM from zoningTargets.js) and produces
// a real structural grid, the way an architect would overlay column lines on
// a massing study before any structural design begins.
//
// Why this exists as its own module: there was no column GEOMETRY anywhere
// in the masterplan pipeline before this — "columns" only existed as a
// per-unit material/BOM choice in the Configurator (computeBOM.js
// COLUMN_TYPES), entirely decoupled from plan position. Bringing precedent
// column data in meant generating real positions for the first time, not
// tuning an existing parameter.

import { CELL } from './masterplanGenerator';

// buildColumnGrid(building, gridPitchM) → [{ col, row }] in GRID CELLS
// (same coordinate space as building.col/row/footprint), one entry per
// column line intersection inside the building's footprint, inset half a
// bay from each edge so columns don't land exactly on the external wall.
export function buildColumnGrid(building, gridPitchM) {
  if (!gridPitchM || gridPitchM <= 0) return [];
  const pitchCells = gridPitchM / CELL;
  if (pitchCells < 1) return []; // pitch finer than the grid resolution — not meaningful at this scale

  const { col, row, w, d } = building;
  const columns = [];

  const inset = pitchCells / 2;
  for (let x = inset; x < w - inset * 0.5; x += pitchCells) {
    for (let z = inset; z < d - inset * 0.5; z += pitchCells) {
      columns.push({ col: col + Math.round(x), row: row + Math.round(z) });
    }
  }
  // De-duplicate (rounding can collapse two near-identical lines into the same cell on small footprints).
  const seen = new Set();
  return columns.filter(c => {
    const key = `${c.col},${c.row}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Attaches a columnGrid[] to every real building (units.length > 0) in a
// plan, using the approved zoning spec's targetColumnGridM. Call this once
// after generateMasterplan() / before rendering, on the chosen variation —
// not during the sweep, since the sweep only needs scoreAgainstZoning's
// numeric checks and computing full column grids for every swept candidate
// would be wasted work for the ones that get filtered out.
export function attachColumnGrids(plan, gridPitchM) {
  if (!plan || !gridPitchM) return plan;
  plan.buildings.forEach(b => {
    if (b.units?.length > 0) b.columnGrid = buildColumnGrid(b, gridPitchM);
  });
  return plan;
}
