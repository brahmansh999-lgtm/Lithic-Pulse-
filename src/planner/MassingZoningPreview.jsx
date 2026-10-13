import { useMemo } from 'react';
import { boxFaces, pts, project, fitViewBox, colorForCategory, LEGEND_ROWS } from './isoEngine';

// Isometric, exploded stacked-floor-group massing diagram for one zoning
// variation — renders in the architect's OWN hand-drawn visual language
// (green-communal / semi-open / service-core, see isoEngine.SKETCH_KEYS and
// the SPATIALLOGIC sketches), so the on-screen study reads as the paper key.
// Standalone diagram (NOT overlaid on the live map — a flat top-down map and
// an isometric 3D diagram can't be made to align, so this renders on its own
// canvas, same as the original massing study).
//
// Phase E: shares the iso engine with the Column stage (one projection, one
// palette), adds a soft ground shadow + per-floor explode so the massing reads
// as a real stepped object catching light, not flat coloured rectangles.

const FLOOR_H = 0.08;     // thin plates — these read as plan layers, not towers
const EXPLODE_GAP = 0.20; // modest gap so the stack stays wider-than-tall (fits the thumb)
const GRID_N = 4;         // floor plate is packed into a GRID_N × GRID_N cell mosaic
                          // (4 = big readable blocks like the sketch, not 36 specks)

// Packs ONE floor's category area-shares into a GRID_N×GRID_N mosaic of cells
// (a real packed plan in BOTH x and z, like the architect's sketch — not 1D
// strips). The generator's `blocks` already carry each category's correct
// footprint share (w×d); we only re-tile that same programme into a 2D grid
// for DISPLAY. Logic/scoring is untouched — this is preview geometry only.
//
// Placement intent mirrors the sketch: the SERVICE core sits as a compact 1-2
// cell block toward an edge; DWELLINGS (units) fill the bulk; COMMUNAL (green)
// and SEMI-OPEN (amenity) patches sit among them to "break the monotony". A
// per-floor seeded shuffle of the patch positions makes each floor-group read
// slightly differently (voids + solids) while keeping cell COUNTS faithful to
// the area shares.
function packFloor(blocks, seed) {
  const total = GRID_N * GRID_N;
  // category → target cell count from its area share of the plate
  const shares = blocks.map(b => ({ category: b.category, area: Math.max(0, b.w * b.d) }));
  const sum = shares.reduce((s, c) => s + c.area, 0) || 1;
  let cells = shares.map(c => ({ category: c.category, n: Math.max(0, Math.round((c.area / sum) * total)) }));
  // ensure units present + total cells == GRID_N²
  let allocated = cells.reduce((s, c) => s + c.n, 0);
  // adjust the dominant (units) bucket to absorb rounding drift
  const unitsCell = cells.find(c => c.category === 'units') || cells[0];
  if (unitsCell) unitsCell.n += (total - allocated);
  if (unitsCell && unitsCell.n < 1) unitsCell.n = 1;

  // build a flat list of categories, then place: service first (compact corner),
  // units as the field, communal/semi-open as scattered patches.
  const order = ['parking', 'units', 'amenity', 'green', 'connector']; // parking→service key
  const flat = [];
  for (const cat of order) {
    const c = cells.find(cc => cc.category === cat);
    if (c) for (let i = 0; i < c.n; i++) flat.push(cat);
  }
  while (flat.length < total) flat.push('units');
  flat.length = total;

  // Deterministic placement: a seeded snake fill keeps service/units contiguous
  // while distributing patches; the seed (floor index) varies it per floor.
  const grid = new Array(total).fill('units');
  // place service compactly in one corner
  const cellQueue = [];
  for (let r = 0; r < GRID_N; r++) for (let col = 0; col < GRID_N; col++) cellQueue.push(r * GRID_N + col);
  // rotate the queue by seed so the "busy" corner moves between floors
  const rot = (seed * 7) % total;
  const ordered = [...cellQueue.slice(rot), ...cellQueue.slice(0, rot)];
  flat.sort(); // group same categories so they tile as contiguous patches
  // interleave units through the patches so it doesn't all clump
  const patches = flat.filter(c => c !== 'units');
  const units = flat.filter(c => c === 'units');
  const woven = [];
  let pi = 0, ui = 0;
  for (let i = 0; i < total; i++) {
    // ~60% units field, patches sprinkled
    if (ui < units.length && (i % 5 < 3 || pi >= patches.length)) woven.push(units[ui++]);
    else if (pi < patches.length) woven.push(patches[pi++]);
    else woven.push(units[ui++] ?? 'units');
  }
  ordered.forEach((cellIdx, i) => { grid[cellIdx] = woven[i] ?? 'units'; });

  return grid; // length GRID_N², category per cell
}

function layoutScene(zoningFloors) {
  if (!zoningFloors?.length) return null;
  const items = [];
  let y = 0;
  const cw = 1 / GRID_N;
  let minXf = Infinity, maxXf = -Infinity, minZf = Infinity, maxZf = -Infinity;
  zoningFloors.forEach((floor, fi) => {
    const y0 = y, y1 = y + FLOOR_H;
    const grid = packFloor(floor.blocks, fi + 1);
    for (let r = 0; r < GRID_N; r++) {
      for (let col = 0; col < GRID_N; col++) {
        const category = grid[r * GRID_N + col];
        const x0 = col * cw, z0 = r * cw;
        items.push({ x0, x1: x0 + cw, z0, z1: z0 + cw, y0, y1, category });
        minXf = Math.min(minXf, x0); maxXf = Math.max(maxXf, x0 + cw);
        minZf = Math.min(minZf, z0); maxZf = Math.max(maxZf, z0 + cw);
      }
    }
    y = y1 + EXPLODE_GAP;
  });

  // Painter's order: far+low first.
  items.sort((a, b) => (a.x0 + a.z0 + a.y0) - (b.x0 + b.z0 + b.y0));

  const shadow = (minXf < maxXf)
    ? boxFaces(minXf, maxXf, 0, 0.001, minZf, maxZf).top
    : null;

  const allPts = items.flatMap(b => {
    const f = boxFaces(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1);
    return [...f.top, ...f.left, ...f.right];
  });
  const viewBox = fitViewBox(allPts, 0.12);

  return { items, viewBox, shadow };
}

export default function MassingZoningPreview({ zoningFloors, showLegend = false }) {
  const scene = useMemo(() => layoutScene(zoningFloors), [zoningFloors]);
  if (!scene) return null;

  return (
    <div className="mzp-wrap">
      <svg viewBox={scene.viewBox} className="mzp-svg" preserveAspectRatio="xMidYMid meet">
        {scene.shadow && (
          <polygon points={pts(scene.shadow)} className="mzp-ground-shadow" />
        )}
        {scene.items.map((b, i) => {
          const f = boxFaces(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1);
          const c = colorForCategory(b.category);
          return (
            <g key={i}>
              <polygon points={pts(f.left)}  fill={c.left}  stroke="#0a0a0a" strokeWidth="0.012" />
              <polygon points={pts(f.right)} fill={c.right} stroke="#0a0a0a" strokeWidth="0.012" />
              <polygon points={pts(f.top)}   fill={c.top}   stroke="#0a0a0a" strokeWidth="0.012" />
            </g>
          );
        })}
      </svg>
      {showLegend && (
        <div className="mzp-legend">
          {LEGEND_ROWS.map(({ key, label, top }) => (
            <div className="mzp-legend-row" key={key}>
              <span className="mzp-legend-swatch" style={{ background: top }} />
              <span className="mzp-legend-label">{label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
