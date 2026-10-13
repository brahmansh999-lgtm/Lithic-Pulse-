import { Fragment } from 'react';

// Builds React SVG elements for the Leaflet SVGOverlay — projects the
// previewPlan's building footprints onto the site polygon with zone colours.
// The SVGOverlay coordinate system maps [0,0]→[100,100] to the site bounds.

const ZONE_FILL = {
  lobby:       'rgba(194,121,106,0.82)',
  community:   'rgba(122,158,126,0.82)',
  circulation: 'rgba(42,42,42,0.9)',
  unit:        'rgba(212,201,184,0.82)',
  services:    'rgba(212,196,160,0.82)',
  terrace:     'rgba(184,184,168,0.82)',
  green:       'rgba(58,90,58,0.82)',
  amenity:     'rgba(138,122,158,0.82)',
  support:     'rgba(158,138,122,0.82)',
};

const ZONE_STROKE = {
  lobby:       'rgba(212,137,122,0.9)',
  community:   'rgba(143,181,148,0.9)',
  circulation: 'rgba(74,74,74,0.9)',
  unit:        'rgba(196,185,168,0.9)',
  services:    'rgba(196,180,144,0.9)',
  terrace:     'rgba(168,168,152,0.9)',
  green:       'rgba(74,106,74,0.9)',
  amenity:     'rgba(154,138,174,0.9)',
  support:     'rgba(174,154,138,0.9)',
};

// Classify a unit by typologyId into a zone kind
function unitToZone(unit) {
  const id = (unit.typologyId || '').toLowerCase();
  if (id.includes('studio') || id.includes('1b'))   return 'unit';
  if (id.includes('2b') || id.includes('3b'))        return 'unit';
  if (id.includes('pent'))                           return 'terrace';
  return 'unit';
}

// Map a building's role by its position within the plan
function buildingZone(building, plan, idx) {
  const total = plan.buildings?.length ?? 1;
  // Rough heuristics: ground-floor buildings near entry → lobby, tallest → unit
  if (building.floors <= 1 && idx === 0) return 'lobby';
  if (building.typology === 'pavilion')  return 'community';
  if (idx % 4 === 3)                     return 'services';
  return 'unit';
}

export function buildZoningOverlaySVG(plan) {
  if (!plan) return null;

  const buildings = (plan.buildings || []).filter(b => b.units?.length > 0);
  if (!buildings.length) return null;

  // Normalise all footprint cells to [0..100] × [0..100] within the plan grid
  const allX = buildings.flatMap(b => [b.col, b.col + b.w]);
  const allZ = buildings.flatMap(b => [b.row, b.row + b.d]);
  const minX = Math.min(...allX), maxX = Math.max(...allX);
  const minZ = Math.min(...allZ), maxZ = Math.max(...allZ);
  const rangeX = maxX - minX || 1;
  const rangeZ = maxZ - minZ || 1;

  const toSVG = (col, row, wCells, dCells) => ({
    x:  ((col  - minX) / rangeX) * 100,
    y:  ((row  - minZ) / rangeZ) * 100,
    w:  (wCells / rangeX) * 100,
    h:  (dCells / rangeZ) * 100,
  });

  const rects = buildings.map((b, i) => {
    const zone = buildingZone(b, plan, i);
    const { x, y, w, h } = toSVG(b.col, b.row, b.w, b.d);
    const fill   = ZONE_FILL[zone]   || ZONE_FILL.unit;
    const stroke = ZONE_STROKE[zone] || ZONE_STROKE.unit;
    // Floor count label
    const label = `${b.floors}F`;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const fontSize = Math.max(1.5, Math.min(4, w * 0.3, h * 0.4));

    return (
      <g key={i}>
        <rect
          x={`${x}%`} y={`${y}%`}
          width={`${w}%`} height={`${h}%`}
          fill={fill}
          stroke={stroke}
          strokeWidth="0.4"
          rx="1"
        />
        {w > 6 && h > 4 && (
          <text
            x={`${cx}%`} y={`${cy}%`}
            textAnchor="middle" dominantBaseline="middle"
            fill="rgba(10,10,10,0.75)"
            fontSize={`${fontSize}%`}
            fontFamily="JetBrains Mono, monospace"
            fontWeight="500"
          >
            {label}
          </text>
        )}
      </g>
    );
  });

  // Green spaces
  const greens = [
    ...(plan.deckGardens || []),
    ...(plan.greenCells  || []),
  ].map((g, i) => {
    if (!g || g.col == null) return null;
    const { x, y, w, h } = toSVG(g.col, g.row, g.w || 1, g.d || 1);
    return (
      <rect
        key={`g${i}`}
        x={`${x}%`} y={`${y}%`}
        width={`${w}%`} height={`${h}%`}
        fill={ZONE_FILL.green}
        stroke={ZONE_STROKE.green}
        strokeWidth="0.3"
        rx="0.8"
      />
    );
  }).filter(Boolean);

  return <>{greens}{rects}</>;
}
