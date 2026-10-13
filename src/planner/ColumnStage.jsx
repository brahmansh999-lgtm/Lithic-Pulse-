import { useEffect, useMemo, useState } from 'react';
import { buildColumnGrid } from './structuralGrid';
import { CELL } from './masterplanGenerator';
import { boxFaces, pts, fitViewBox } from './isoEngine';
import './MassingStage.css';
import './ColumnStage.css';

// Step 02c / Columns — places columns at the REAL positions measured from
// the matched bldg_gl precedent (chosen.matchedGLB.columnPositions,
// extracted by scripts/extractZoning.mjs from the actual GLB geometry),
// mapped onto the chosen massing's real building footprints — not a
// synthetic uniform grid. This is the literal "based on the final GLB
// model" placement the architect asked for: every column you see here
// came from a real measured column in a real finished building, scaled
// onto this massing's footprint(s). Falls back to a uniform grid
// (buildColumnGrid, spec.targetColumnGridM) only when no matched GLB has
// usable column data (e.g. picked precedent's geometry didn't classify
// any "column"-named group). Columns animate in one-by-one ("popping up")
// rather than appearing all at once, so the structural layout reads as a
// real placement decision happening, not a static diagram.

const FLOOR_TO_FLOOR_M = 3.2;
const COLUMN_W = 0.45; // visual column cross-section, metres

// Maps the matched GLB's real normalised column positions (0..1 in its OWN
// footprint) onto one building's real-world footprint — same idea as
// scaling a structural drawing onto a different-sized plate. Snapped to
// the building's own grid cells so columns land at sane coordinates.
function realColumnsForBuilding(building, columnPositions) {
  return columnPositions.map(({ x, z }) => ({
    col: building.col + Math.round(x * building.w),
    row: building.row + Math.round(z * building.d),
  }));
}

function buildScene(plan, gridPitchM, matchedGLB) {
  const buildings = (plan?.buildings || []).filter(b => b.units?.length > 0);
  if (!buildings.length) return null;

  const realPositions = matchedGLB?.columnPositions;
  const usingRealGLBColumns = Array.isArray(realPositions) && realPositions.length >= 4;

  const columnsByBuilding = buildings.map(b =>
    usingRealGLBColumns ? realColumnsForBuilding(b, realPositions) : buildColumnGrid(b, gridPitchM)
  );

  const boxes = buildings.map(b => ({
    x0: b.col * CELL, x1: (b.col + b.w) * CELL,
    z0: b.row * CELL, z1: (b.row + b.d) * CELL,
    h: Math.max(1, b.floors) * FLOOR_TO_FLOOR_M,
  }));

  const columns = buildings.flatMap((b, i) => {
    const h = Math.max(1, b.floors) * FLOOR_TO_FLOOR_M;
    return columnsByBuilding[i].map(c => ({ x: c.col * CELL, z: c.row * CELL, h }));
  });

  // Ground plane = the bounding footprint of all buildings, drawn flat at y=0
  // so the columns read as standing on a real floor slab, not floating.
  const gx0 = Math.min(...boxes.map(b => b.x0)), gx1 = Math.max(...boxes.map(b => b.x1));
  const gz0 = Math.min(...boxes.map(b => b.z0)), gz1 = Math.max(...boxes.map(b => b.z1));
  const gm = Math.max((gx1 - gx0), (gz1 - gz0)) * 0.06; // small margin
  const ground = boxFaces(gx0 - gm, gx1 + gm, 0, 0.001, gz0 - gm, gz1 + gm).top;

  const allPts = boxes.flatMap(b => {
    const f = boxFaces(b.x0, b.x1, 0, b.h, b.z0, b.z1);
    return [...f.top, ...f.left, ...f.right];
  });
  const viewBox = fitViewBox(allPts, 0.08, 3);

  return { boxes, columns, ground, viewBox, usingRealGLBColumns };
}

// Stagger delay per column, capped so a 300-column building doesn't take
// forever to finish popping in — fast for few columns, snappy ceiling for many.
const POP_TOTAL_MS = 1400;
const POP_MIN_STEP_MS = 12;

export default function ColumnStage({ chosen, spec, matchedGLBName, onBack, onContinue }) {
  const gridPitchM = spec?.targetColumnGridM ?? 4.5;
  const scene = useMemo(() => buildScene(chosen?.plan, gridPitchM, chosen?.matchedGLB), [chosen, gridPitchM]);

  return (
    // Keyed on the chosen candidate's seed so switching massing variations
    // (Back -> pick a different one -> forward) remounts the pop-in counter
    // fresh instead of needing an effect to manually reset it.
    <ColumnStageBody key={chosen?.seed ?? 'none'} scene={scene} chosen={chosen} spec={spec} matchedGLBName={matchedGLBName} onBack={onBack} onContinue={onContinue} gridPitchM={gridPitchM} />
  );
}

function ColumnStageBody({ scene, chosen, spec, matchedGLBName, onBack, onContinue, gridPitchM }) {
  const [poppedCount, setPoppedCount] = useState(0);

  useEffect(() => {
    if (!scene?.columns.length) return;
    const stepMs = Math.max(POP_MIN_STEP_MS, POP_TOTAL_MS / scene.columns.length);
    const id = setInterval(() => {
      setPoppedCount(n => {
        if (n >= scene.columns.length) { clearInterval(id); return n; }
        return n + 1;
      });
    }, stepMs);
    return () => clearInterval(id);
  }, [scene]);

  const allPopped = scene && poppedCount >= scene.columns.length;

  return (
    <div className="msg-root">
      <div className="msg-header">
        <button className="msg-back" onClick={onBack}>← Massing</button>
        <div className="msg-header-title">
          <span className="msg-header-step">02c / Columns</span>
          <span className="msg-header-sub">
            {scene
              ? scene.usingRealGLBColumns
                ? `${scene.columns.length} columns placed from ${matchedGLBName ?? 'the matched precedent'}'s real structural layout`
                : `${scene.columns.length} columns · ${gridPitchM}m grid fitted to ${chosen?.variationLabel ?? 'the chosen massing'}`
              : 'no massing selected'}
          </span>
        </div>
        {chosen?.glbScore != null && (
          <div className="cs-converge-badge" title="How closely this massing + column layout matches the locked building GLB">
            <span className="cs-converge-pct">{chosen.glbScore}%</span>
            <span className="cs-converge-label">match to<br/>{matchedGLBName ?? 'building'}</span>
          </div>
        )}
        <button className="msg-continue" disabled={!scene} onClick={onContinue}>
          Generate Building →
        </button>
      </div>

      {matchedGLBName && (
        <div className="msg-glb-callout">
          {scene?.usingRealGLBColumns ? (
            <>Columns shown here are the <strong>real measured positions</strong> from <strong>{matchedGLBName}</strong>,
            mapped onto this massing (<strong>{chosen?.variationLabel}</strong>) — not a generic grid.</>
          ) : (
            <>Based on this massing (<strong>{chosen?.variationLabel}</strong>, converging toward <strong>{matchedGLBName}</strong>)
            and the column placement fitted to it, this is how the building was designed.</>
          )}
        </div>
      )}

      <div className="msg-grid-body cs-body">
        {!scene ? (
          <div className="msg-no-data">No massing selected — go back and pick an iteration.</div>
        ) : (
          <>
            <div className="cs-canvas">
              <svg viewBox={scene.viewBox} className="msg-box-preview-svg" preserveAspectRatio="xMidYMid meet">
                <defs>
                  <filter id="cs-col-glow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="0.18" result="b" />
                    <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                </defs>
                {scene.ground && (
                  <polygon points={pts(scene.ground)} className="cs-ground-plane" />
                )}
                {scene.boxes.map((b, i) => {
                  const f = boxFaces(b.x0, b.x1, 0, b.h, b.z0, b.z1);
                  return (
                    <g key={`b${i}`} opacity="0.5">
                      <polygon points={pts(f.left)}  fill="#5a564c" stroke="#0a0a0a" strokeWidth="0.3" />
                      <polygon points={pts(f.right)} fill="#6e6a5c" stroke="#0a0a0a" strokeWidth="0.3" />
                      <polygon points={pts(f.top)}   fill="#86816e" stroke="#0a0a0a" strokeWidth="0.3" />
                    </g>
                  );
                })}
                {scene.columns.map((c, i) => {
                  if (i >= poppedCount) return null;
                  const f = boxFaces(c.x - COLUMN_W / 2, c.x + COLUMN_W / 2, 0, c.h, c.z - COLUMN_W / 2, c.z + COLUMN_W / 2);
                  return (
                    <g key={`c${i}`} className="cs-column-pop" filter={scene.usingRealGLBColumns ? 'url(#cs-col-glow)' : undefined}>
                      <polygon points={pts(f.left)}  fill="#d8d4ca" />
                      <polygon points={pts(f.right)} fill="#f0ece0" />
                      <polygon points={pts(f.top)}   fill="#fff" />
                    </g>
                  );
                })}
              </svg>
            </div>

            <div className="msg-legend">
              <div className="msg-legend-title">Structural Grid</div>
              <div className="msg-legend-sub">
                {scene.usingRealGLBColumns ? `real layout from ${matchedGLBName}` : `fitted to ${chosen?.variationLabel}`}
              </div>
              <div className="cs-stats">
                <div className="cs-stat-row"><span>Source</span><span>{scene.usingRealGLBColumns ? 'Measured GLB' : 'Computed grid'}</span></div>
                {!scene.usingRealGLBColumns && <div className="cs-stat-row"><span>Grid pitch</span><span>{gridPitchM}m</span></div>}
                <div className="cs-stat-row"><span>Columns</span><span>{allPopped ? scene.columns.length : `${poppedCount} / ${scene.columns.length}`}</span></div>
                <div className="cs-stat-row"><span>Buildings</span><span>{scene.boxes.length}</span></div>
                {spec && <div className="cs-stat-row"><span>Target floors</span><span>{spec.targetFloorCount}</span></div>}
              </div>
              <div className="cs-note">
                {scene.usingRealGLBColumns
                  ? `Column lines are the real measured positions from ${matchedGLBName}'s structural geometry, scaled onto this massing's real building footprints — every floor's unit, amenity and circulation layout will be generated to conform to this grid.`
                  : 'Column lines are derived from the chosen massing\'s real building footprints — every floor\'s unit, amenity and circulation layout will be generated to conform to this grid.'}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
