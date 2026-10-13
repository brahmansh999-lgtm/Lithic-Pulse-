import { useMemo } from 'react';
import { buildZoningLayout } from './masterplanGenerator';
import './ZoningDiagram.css';

// ── Zone fill styles — matching the hand-drawn sketch legend exactly ──
// hatched green  = green spaces / communal spaces
// dotted         = semi-open spaces
// solid blue     = service core
// white outline  = units
const ZONE_FILL = {
  unit:         { bg: 'rgba(240,238,230,0.08)', stroke: 'rgba(230,226,210,0.70)', label: 'Units'            },
  green:        { bg: 'rgba(55,105,50,0.72)',   stroke: 'rgba(80,150,75,0.90)',   label: 'Green / Communal' },
  semi_open:    { bg: 'rgba(195,182,148,0.22)', stroke: 'rgba(195,182,148,0.65)', label: 'Semi-Open'        },
  service_core: { bg: 'rgba(45,85,200,0.90)',   stroke: 'rgba(80,120,255,1.0)',   label: 'Service Core'     },
};

// SVG pattern defs for hatching (green) and dots (semi-open)
const PATTERNS = `
  <defs>
    <pattern id="zdg-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="5" stroke="rgba(160,230,140,0.75)" stroke-width="1.8"/>
    </pattern>
    <pattern id="zdg-dots" width="6" height="6" patternUnits="userSpaceOnUse">
      <circle cx="3" cy="3" r="1.2" fill="rgba(210,195,155,0.70)"/>
    </pattern>
  </defs>
`;

export default function ZoningDiagram({ previewPlan }) {
  const buildings = useMemo(() => {
    if (!previewPlan?.buildings) return [];
    return previewPlan.buildings
      .filter(b => b.units?.length > 0)
      .sort((a, b) => (b.w * b.d) - (a.w * a.d))
      .slice(0, 6); // show up to 6 representative buildings
  }, [previewPlan]);

  if (!previewPlan || !buildings.length) {
    return (
      <div className="zdg-root zdg-empty">
        <div className="zdg-waiting">
          <div className="zdg-waiting-icon">◈</div>
          <div>select a precedent to preview</div>
        </div>
      </div>
    );
  }

  const sizeClass = previewPlan?.lockedClass ?? null;

  return (
    <div className="zdg-root">
      <div className="zdg-grid-area">
        {buildings.map(b => <BuildingFloorPlan key={b.id} building={b} sizeClass={sizeClass} />)}
      </div>
      <Legend />
    </div>
  );
}

const CLASS_LABELS = { small: 'Small Building', medium: 'Medium Building', large: 'Large Building', xl: 'XL Building' };

// ── Per-building floor plan grid ─────────────────────────────────────
function BuildingFloorPlan({ building, sizeClass }) {
  const { w, d, floors, zoningLayout } = building;
  const layout = zoningLayout || buildZoningLayout(w, d, sizeClass);

  const sizeLabel = CLASS_LABELS[sizeClass] || (w > 18 ? 'XL Building' : w > 11 ? 'Large Building' : w > 6 ? 'Medium Building' : 'Small Building');

  // Scale cells — larger cells so zones read as bold blocks like the sketch
  const MAX_W = 260, MAX_H = 200;
  const cellW = Math.max(14, Math.min(32, Math.floor(MAX_W / w)));
  const cellH = Math.max(14, Math.min(32, Math.floor(MAX_H / d)));
  const svgW  = w * cellW + 2;
  const svgH  = d * cellH + 2;

  return (
    <div className="zdg-bld-card">
      <div className="zdg-bld-label">{sizeLabel} <span className="zdg-bld-floors">G+{floors - 1}</span></div>
      <svg
        className="zdg-plan-svg"
        viewBox={`0 0 ${svgW} ${svgH}`}
        width={svgW}
        height={svgH}
        style={{ display: 'block', margin: '0 auto' }}
        dangerouslySetInnerHTML={{ __html: PATTERNS + renderPlanCells(layout, cellW, cellH) }}
      />
    </div>
  );
}

function renderPlanCells(layout, cw, ch) {
  let html = '';
  const rows = layout.length;
  const cols = layout[0]?.length || 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const zone = layout[r][c];
      const x = c * cw + 1;
      const y = r * ch + 1;
      const style = ZONE_FILL[zone] || ZONE_FILL.unit;

      // Base fill rect — bold stroke, 1px gap between cells
      html += `<rect x="${x}" y="${y}" width="${cw - 1}" height="${ch - 1}" fill="${style.bg}" stroke="${style.stroke}" stroke-width="1.2" rx="0"/>`;

      // Overlay pattern for green (hatching) and semi_open (dots)
      if (zone === 'green') {
        html += `<rect x="${x}" y="${y}" width="${cw - 1}" height="${ch - 1}" fill="url(#zdg-hatch)" rx="0" opacity="0.85"/>`;
      } else if (zone === 'semi_open') {
        html += `<rect x="${x}" y="${y}" width="${cw - 1}" height="${ch - 1}" fill="url(#zdg-dots)" rx="0"/>`;
      }
    }
  }

  // Outer border — bold like sketch outline
  html += `<rect x="1" y="1" width="${cols * cw - 1}" height="${rows * ch - 1}" fill="none" stroke="rgba(220,215,200,0.55)" stroke-width="2.0" rx="0"/>`;

  return html;
}

// ── Legend matching the sketch exactly ───────────────────────────────
function Legend() {
  return (
    <div className="zdg-legend">
      {Object.entries(ZONE_FILL).map(([key, s]) => (
        <div key={key} className="zdg-legend-row">
          <span className="zdg-swatch" style={{
            background: s.bg,
            borderColor: s.stroke,
            position: 'relative',
            overflow: 'hidden',
          }}>
            {key === 'green' && (
              <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
                <defs>
                  <pattern id={`leg-hatch`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <line x1="0" y1="0" x2="0" y2="4" stroke="rgba(90,160,90,0.9)" strokeWidth="1.2"/>
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#leg-hatch)"/>
              </svg>
            )}
            {key === 'semi_open' && (
              <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
                <defs>
                  <pattern id={`leg-dots`} width="4" height="4" patternUnits="userSpaceOnUse">
                    <circle cx="2" cy="2" r="0.8" fill="rgba(200,190,160,0.8)"/>
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#leg-dots)"/>
              </svg>
            )}
          </span>
          <span>{s.label}</span>
        </div>
      ))}
    </div>
  );
}
