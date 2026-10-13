/**
 * ColumnPlacementStage — 04 / Columns. Renders the massing that was just
 * generated, then overlays the REAL measured column grid from the actual
 * GLB for this site's class, run through the exact same site-fit transform
 * (see useMassingViewer's showColumns path) as the massing itself — so the
 * columns are mathematically guaranteed to land on the massing footprint,
 * not just visually eyeballed into place. This is the "yes, this is the
 * correct GLB for this site" verification step.
 */
import { useMemo, useRef } from 'react';
import {
  getMassingData, useMassingViewer, generateMassingIterations, MASSING_ITERATION_COUNT,
} from './MassingStage';

export default function ColumnPlacementStage({ site, buildingType, onBack, onContinue }) {
  const canvasRef = useRef(null);

  // The massing that was generated — the top-scored iteration, same one
  // MassingStage defaults to. This stage isn't for exploring alternatives,
  // it's for confirming the resolved massing and its real column grid agree.
  const massingData = useMemo(() => getMassingData(buildingType), [buildingType]);
  const iterations = useMemo(
    () => generateMassingIterations(MASSING_ITERATION_COUNT, massingData.floors),
    [massingData]
  );
  const variation = iterations[0];

  useMassingViewer(canvasRef, site, variation, buildingType, /* showColumns */ true);

  const totalUnits = massingData.floors.reduce((s, f) => s + f.boxes.filter(b => b.type === 'units').length, 0);

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        padding: '0.85rem 1.1rem',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        flexShrink: 0,
        background: 'var(--bg-glass)',
        backdropFilter: 'blur(12px)',
      }}>
        <button onClick={onBack} style={{
          background: 'none', border: '1px solid rgba(255,255,255,0.18)',
          color: 'rgba(240,236,226,0.7)', fontFamily: 'var(--mono)',
          fontSize: '0.7rem', padding: '0.35rem 0.7rem', cursor: 'pointer',
          letterSpacing: '0.05em',
        }}>← Massing</button>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.08rem' }}>
          <span style={{ fontSize: '0.58rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(240,236,226,0.3)', fontFamily: 'var(--mono)' }}>
            04 / Columns
          </span>
          <span style={{ fontSize: '0.8rem', color: 'var(--fg)', fontWeight: 400, fontFamily: 'var(--sans)' }}>
            {massingData.label} · real column grid fitted to this massing
            <span style={{ color: 'rgba(240,236,226,0.38)', fontSize: '0.72rem' }}> · {totalUnits} units · scroll to zoom</span>
          </span>
        </div>

        {['Site', 'Zoning', 'Massing', 'Columns', 'Masterplanner'].map((s, i) => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            {i > 0 && <div style={{ width: 16, height: 1, background: 'rgba(255,255,255,0.1)' }} />}
            <span style={{
              fontSize: '0.57rem', letterSpacing: '0.08em', textTransform: 'uppercase',
              fontFamily: 'var(--mono)',
              color: i === 3 ? 'var(--accent)' : 'rgba(240,236,226,0.22)',
              fontWeight: i === 3 ? 700 : 400,
              borderBottom: i === 3 ? '1px solid var(--accent)' : 'none',
              paddingBottom: i === 3 ? '1px' : '0',
            }}>{s}</span>
          </div>
        ))}

        <button onClick={() => onContinue?.()} style={{
          background: 'var(--accent)', color: 'var(--bg)', border: 'none',
          fontFamily: 'var(--mono)',
          fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em',
          padding: '0.5rem 1rem', cursor: 'pointer', textTransform: 'uppercase',
        }}>Masterplanner →</button>
      </div>

      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <canvas
          ref={canvasRef}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
        />

        {/* Legend */}
        <div style={{
          position: 'absolute', bottom: 24, left: 24, zIndex: 10,
          background: 'var(--bg-glass)', border: '1px solid rgba(255,255,255,0.08)',
          padding: '0.75rem 1rem',
          backdropFilter: 'blur(8px)',
          fontFamily: 'var(--mono)', fontSize: '10px',
          lineHeight: 2.2, pointerEvents: 'none',
        }}>
          {[
            { label: 'Residential Units',     color: '#b8d4c8' },
            { label: 'Services / Core',       color: '#d4a96a' },
            { label: 'Community / Podium',    color: '#5b9fd4' },
            { label: 'Balconies',             color: '#e8a8cc' },
            { label: 'Circulation',           color: '#9b6fd4' },
            { label: 'Site Boundary',         color: '#78c8a4' },
            { label: 'Real GLB Columns',      color: '#ff5a3c' },
          ].map(({ label, color }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: 10, height: 10, background: color, flexShrink: 0 }} />
              <span style={{ color: 'rgba(240,236,226,0.65)' }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
