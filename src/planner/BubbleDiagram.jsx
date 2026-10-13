// BubbleDiagram — the bubble diagram that actually DRIVES the massing above
// it, not an illustration of it. It draws the real relaxed zone graph
// (bubbleLayout.relaxGraph's converged node positions) inside the real site
// polygon, plus the site facts those positions were derived from (road-facing
// entry, sun aspect). Dialing a fact's influence re-runs the layout, so the
// 3D massing changes with it.
//
// All geometry arrives in Frame L (local-fit metres, same frame
// siteToLocalPolygon/siteGrid/bubbleLayout use); this only maps Frame L -> SVG
// viewport, so the diagram and the massing can never disagree about where a
// zone is.
//
// TWO-LEVEL hierarchy: the housing mass is real spatial WINGS (wing_0..N-1,
// N computed per site in MassingStage.jsx from real buildable area — see
// zoningGraph.js's wingAdjacency), not one blob and not four flat bed-count
// bubbles. Wings are shown collapsed by default; clicking one OPENS it,
// revealing its own real, independently-solved 1B/2B/3B/4B sub-bubbles
// (diagram.wings[i].bedNodes — a real nested relax + cell assignment
// MassingStage.jsx already ran, not a redraw). Click the open wing's outline
// to collapse it back. Only one wing is open at a time.
//
// Bubbles are draggable in two independent ways, split by what makes sense:
//  - MOVABLE (wing_0..N-1, green, services): dragging the bubble BODY moves
//    it — sets a live target position that becomes a relaxGraph biasForce
//    (the same mechanism the entry/sun facts already use — see
//    MassingStage.jsx's floorsFromBubbleLayout), so a dragged bubble is a
//    strong preference the layout settles toward, not a teleport that can
//    overlap another zone or leave the site. A SMALL movement on a wing is
//    read as a CLICK (open/close) instead of a drag — see ZoneBubble's
//    CLICK_THRESHOLD.
//  - RESIZABLE (green, services only): dragging the small square HANDLE at
//    the edge resizes it, setting a live multiplier on that zone's REAL
//    measured area (the mechanism PROGRAMME_BRIEFS already uses, see
//    MassingStage.jsx's scaled()), clamped to 0.6-1.6x so dragging can
//    redistribute area but never invent area the building does not have.
//    Wings and their bed-group children are NOT independently resizable —
//    a wing's size comes from its real position in the size gradient
//    (zoningGraph.WING_SIZE_DECAY) and a bed group's from the Unit-mix
//    sliders in the metrics panel; a resize handle here would just be a
//    second control fighting over the same number.
// entry/semiopen have no area budget or position bias wired up, so they stay
// fixed (not draggable). Bed-group bubbles (shown only inside an open wing)
// are view-only — real positions/sizes, but not yet independently
// draggable; see MEMORY for why that scope was deliberately cut for now.
import { useEffect, useRef, useState } from 'react';
import SustainabilityMatrix from '../shared/SustainabilityMatrix';

// Exported so MassingStage.jsx's floorsFromBubbleLayout can restrict
// positionOverrides to the same zones this diagram lets the user drag — one
// source of truth for "which zones are user-movable" vs "user-resizable".
// Functions, not Sets, because wing types are dynamic (wing_0..wing_{N-1},
// N varies per site).
export function isMovableZone(type) {
  return type === 'green' || type === 'services' || /^wing_\d+$/.test(type);
}
export function isResizableZone(type) {
  return type === 'green' || type === 'services';
}
const OVERRIDE_MIN = 0.6, OVERRIDE_MAX = 1.6;
const CLICK_THRESHOLD = 5; // px — below this, a wing body press is a CLICK (toggle open), not a drag

// Same 1B->4B ramp as MassingStage.jsx's BED_PALETTE (kept as a duplicated
// literal, not an import, to avoid a circular import — MassingStage already
// imports this file) — so a bed-group bubble here is the same colour as the
// dwellings it produces in the 3D massing.
const BED_GROUP_STYLE = {
  units_1b: { fill: '#e8d43f', edge: '#8a7a1f', label: '1B' },
  units_2b: { fill: '#4a6fd4', edge: '#1f2f7a', label: '2B' },
  units_3b: { fill: '#d1453f', edge: '#7a1f1a', label: '3B' },
  units_4b: { fill: '#8b3fa8', edge: '#4a1f5c', label: '4B' },
  // Same rule-based-estimate colours as MassingStage.jsx's PALETTE.core_stair/
  // core_lift — see zoningGraph.js's CORE_ZONE_TYPES note (not measured GLB
  // geometry, unlike every other bubble here).
  core_stair: { fill: '#8a8a8a', edge: '#333333', label: 'Stair' },
  core_lift:  { fill: '#6a90b8', edge: '#1f4060', label: 'Lift' },
};
// Wings share one hue family (distinct from green/services/entry/beds) so
// they read as "the housing mass, viewed from further out" — a soft warm
// grey-blue, darkening slightly per wing index just so adjacent wings stay
// visually distinguishable even before you open one.
const WING_FILLS = ['#b9c2c9', '#a7b3bc', '#96a5b0', '#8698a5'];
function wingStyle(i) {
  return { fill: WING_FILLS[i % WING_FILLS.length], label: `Wing ${i + 1}` };
}
const ZONE_STYLE = {
  green:       { fill: '#8fc98a', label: 'Green' },
  community:   { fill: '#8fbcd4', label: 'Community' },
  services:    { fill: '#d4a96a', label: 'Services' },
  entry:       { fill: '#c8734f', label: 'Entry' },
  semiopen:    { fill: '#cfd8d2', label: 'Semi-open' },
};
// Fixed categories, not one row per instance (a 2-wing site would otherwise
// need two near-identical "Wing" rows) — matches a real architectural
// spatial-adjacency diagram's legend.
const LEGEND_ITEMS = [
  { fill: WING_FILLS[0], label: 'Housing' },
  { fill: ZONE_STYLE.green.fill, label: 'Green terrace' },
  { fill: ZONE_STYLE.services.fill, label: 'Services' },
  { fill: ZONE_STYLE.entry.fill, label: 'Entry' },
  { fill: ZONE_STYLE.semiopen.fill, label: 'Semi-open (void)' },
];

// Shrunk again (was 640x400, then 440x260) — the massing view above this
// should dominate the page; this diagram is a compact reference strip, not
// a co-equal panel. Still large enough to read every bubble/label.
const VW = 340, VH = 150, PAD = 14;

// Frame L -> SVG, preserving aspect (never stretch — a stretched plan would
// misrepresent the real site proportions).
function makeProjection(poly) {
  if (!poly?.length) return null;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
  }
  const w = Math.max(1e-6, maxX - minX), h = Math.max(1e-6, maxZ - minZ);
  const s = Math.min((VW - PAD * 2) / w, (VH - PAD * 2) / h);
  const ox = (VW - w * s) / 2 - minX * s;
  const oy = (VH - h * s) / 2 - minZ * s;
  return { s, toX: (x) => x * s + ox, toY: (z) => z * s + oy };
}

function FactSlider({ id, label, hint, value, onChange, disabled, compact }) {
  return (
    <label
      title={compact ? hint : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: compact ? '0.4rem' : '0.6rem',
        opacity: disabled ? 0.4 : 1, cursor: disabled ? 'default' : 'pointer',
      }}
    >
      <span style={{ minWidth: compact ? 62 : 92, fontWeight: 700, letterSpacing: '0.04em' }}>{label}</span>
      <input
        id={id}
        type="range" min={0} max={100} step={5}
        value={Math.round(value * 100)}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        style={{ flex: 1, minWidth: compact ? 60 : undefined, accentColor: 'var(--accent)', cursor: disabled ? 'default' : 'pointer' }}
      />
      <span style={{ minWidth: 30, textAlign: 'right', color: 'var(--fg)' }}>
        {Math.round(value * 100)}%
      </span>
      {!compact && <span style={{ minWidth: 118, color: 'rgba(20,20,15,0.4)' }}>{hint}</span>}
    </label>
  );
}

// A collapsed WING or a plain zone (green/services/entry/semiopen) — every
// node in the top-level graph goes through this. `onToggle` is only
// meaningful for wing_* types (see isMovableZone) and is called on a
// short/no-movement press; anything past CLICK_THRESHOLD is read as a drag.
function ZoneBubble({ n, style, proj, override, onOverrideChange, moved, onPositionChange, onToggle, dimmed }) {
  const resizable = isResizableZone(n.type) && !!onOverrideChange;
  const movable = isMovableZone(n.type) && !!onPositionChange;
  const clickable = /^wing_\d+$/.test(n.type) && !!onToggle;
  const mult = override ?? 1;
  const cx = proj.toX(n.x), cz = proj.toY(n.z);
  // Floor raised well above the raw projected radius (was 4px) — a real
  // architectural adjacency diagram (see the reference this was redrawn
  // toward) reads each space as a substantial labelled circle, not a dot;
  // small real zones would otherwise be too small to hold their own label.
  const r = Math.max(16, n.radius * proj.s * 1.15);

  // Body press: if it moves past CLICK_THRESHOLD, it's a MOVE (continuous
  // reposition, same as before); if it releases without much movement and
  // the node is a wing, it's a CLICK (toggle open/closed).
  const press = useRef(null);
  const onBodyPointerDown = (e) => {
    if (!movable && !clickable) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { startClientX: e.clientX, startClientY: e.clientY, startX: n.x, startZ: n.z, dragging: false };
  };
  const onBodyPointerMove = (e) => {
    if (!press.current) return;
    const { startClientX, startClientY, startX, startZ } = press.current;
    const dx = e.clientX - startClientX, dz = e.clientY - startClientY;
    if (!press.current.dragging && Math.hypot(dx, dz) > CLICK_THRESHOLD) press.current.dragging = true;
    if (movable && press.current.dragging) {
      onPositionChange(n.type, { x: startX + dx / proj.s, z: startZ + dz / proj.s });
    }
  };
  const onBodyPointerUp = (e) => {
    if (!press.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (!press.current.dragging && clickable) onToggle(n.type);
    press.current = null;
  };
  const onBodyDoubleClick = () => { if (movable) onPositionChange(n.type, null); };

  // Small edge handle drag = resize (dragging UP means bigger).
  const resizeDrag = useRef(null);
  const onHandlePointerDown = (e) => {
    if (!resizable) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeDrag.current = { startY: e.clientY, startMult: mult };
  };
  const onHandlePointerMove = (e) => {
    if (!resizable || !resizeDrag.current) return;
    const dy = resizeDrag.current.startY - e.clientY;
    const next = resizeDrag.current.startMult + dy / 120;
    onOverrideChange(n.type, Math.min(OVERRIDE_MAX, Math.max(OVERRIDE_MIN, next)));
  };
  const onHandlePointerUp = (e) => {
    if (!resizable) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    resizeDrag.current = null;
  };
  const onHandleDoubleClick = (e) => { e.stopPropagation(); if (resizable) onOverrideChange(n.type, 1); };

  const handleOffset = r * 0.7071; // 45° — bottom-right of the bubble
  const hx = cx + handleOffset, hz = cz + handleOffset;

  return (
    <g opacity={dimmed ? 0.35 : 1}>
      <circle
        cx={cx} cy={cz} r={r}
        fill={style.fill} fillOpacity="0.85"
        stroke={moved ? '#c8734f' : 'rgba(20,20,15,0.4)'} strokeWidth={moved ? 2.5 : 1.5}
        onPointerDown={onBodyPointerDown} onPointerMove={onBodyPointerMove} onPointerUp={onBodyPointerUp}
        onDoubleClick={onBodyDoubleClick}
        style={{ cursor: movable ? 'grab' : (clickable ? 'pointer' : 'default'), touchAction: (movable || clickable) ? 'none' : 'auto' }}
      />
      <text
        x={cx} y={cz + 4}
        textAnchor="middle" fontSize="10" fontWeight="700" fill="rgba(20,20,15,0.82)"
        style={{ pointerEvents: 'none' }}
      >
        {style.label}{resizable && Math.abs(mult - 1) > 0.02 ? ` ${Math.round(mult * 100)}%` : ''}
      </text>
      {resizable && (
        <rect
          x={hx - 5} y={hz - 5} width="10" height="10"
          fill="var(--bg)" stroke="rgba(20,20,15,0.55)" strokeWidth="1.2"
          onPointerDown={onHandlePointerDown} onPointerMove={onHandlePointerMove} onPointerUp={onHandlePointerUp}
          onDoubleClick={onHandleDoubleClick}
          style={{ cursor: 'ns-resize', touchAction: 'none' }}
        />
      )}
    </g>
  );
}

// ── Wing detail panel — an enlarged, dedicated view of ONE wing's real
// 1B/2B/3B/4B unit connections, replacing the old "Site facts → massing"
// text column so the unit-level breakdown gets real room instead of being
// a tiny inset inside the small overview diagram.
//
// Everything drawn here is real: node position/radius come from
// MassingStage's nested per-wing relax solve (same data BedGroupBubble
// already drew, just zoomed to fill this panel instead of a few pixels
// inside the whole-site diagram), and the connecting lines are the real
// bedGroupAdjacency() spring edges that solve used — not invented
// circulation. There is deliberately no drawn "staircase/core" node inside
// the wing itself: zoningGraph.js's own comment explains why circulation
// has no measured area and is not laid out at all. What IS real and shown
// instead is the true compass direction from this wing toward the site's
// actual Services/Core zone (a real top-level node with real position),
// labelled as a direction, not a to-scale distance.
function wingDetailProjection(nodes, W, H, pad) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  nodes.forEach(n => {
    minX = Math.min(minX, n.x - n.radius); maxX = Math.max(maxX, n.x + n.radius);
    minZ = Math.min(minZ, n.z - n.radius); maxZ = Math.max(maxZ, n.z + n.radius);
  });
  const w = Math.max(1e-6, maxX - minX), h = Math.max(1e-6, maxZ - minZ);
  const s = Math.min((W - pad * 2) / w, (H - pad * 2) / h);
  const ox = (W - w * s) / 2 - minX * s;
  const oz = (H - h * s) / 2 - minZ * s;
  return { s, toX: (x) => x * s + ox, toZ: (z) => z * s + oz };
}

const COMPASS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
function compassLabel(deg) {
  // atan2 gives 0deg = +X (east in this local frame), increasing toward +Z.
  const idx = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return COMPASS[idx];
}

function WingDetailPanel({ openWing, servicesNode, panelW, panelH }) {
  if (!openWing || !openWing.bedNodes?.length) {
    return (
      <div style={{ color: 'rgba(20,20,15,0.4)', fontSize: 10, lineHeight: 1.6, maxWidth: panelW }}>
        Click a wing in the diagram on the left to see its real 1B/2B/3B/4B
        unit mix and how those groups connect to each other.
      </div>
    );
  }
  const nodes = openWing.bedNodes;
  const adjacency = openWing.bedAdjacency;
  // HTML text in this specific panel was intermittently failing to paint in
  // this environment (box/outline rendered, computed style looked normal,
  // glyphs never composited — isolated across multiple property changes).
  // The SVG <text> labels elsewhere in this diagram never showed the same
  // issue, so the header lives in the SVG's own coordinate space too rather
  // than as a sibling HTML block.
  const HEADER_H = 18;
  const proj = wingDetailProjection(nodes, panelW, panelH - HEADER_H, 22);
  const ty = (z) => proj.toZ(z) + HEADER_H;

  let coreLabel = null;
  if (servicesNode) {
    const dx = servicesNode.x - openWing.node.x, dz = servicesNode.z - openWing.node.z;
    coreLabel = compassLabel(Math.atan2(dz, dx) * 180 / Math.PI);
  }

  return (
    <div>
      <svg width={panelW} height={panelH} aria-label="Wing unit connections">
        <text x={0} y={11} fontSize="10" fontWeight="700" fill="#14140f" letterSpacing="0.04em">
          WING {openWing.wingIndex + 1} UNIT CONNECTIONS
        </text>
        {coreLabel && (
          <text x={panelW} y={11} textAnchor="end" fontSize="9" fill="rgba(20,20,15,0.4)">
            Services/Core is {coreLabel} of this wing (real direction)
          </text>
        )}

        {/* Real bedGroupAdjacency() spring edges — why these groups sit
            where they do, not a decorative connector. */}
        {adjacency && nodes.map((n, i) => {
          const edges = adjacency.get(n.type) || [];
          return edges.map(({ other, weight }) => {
            const j = nodes.findIndex(m => m.type === other);
            if (j <= i) return null;
            const m = nodes[j];
            return (
              <line
                key={`${n.type}-${other}`}
                x1={proj.toX(n.x)} y1={ty(n.z)}
                x2={proj.toX(m.x)} y2={ty(m.z)}
                stroke={weight >= 0 ? 'rgba(20,20,15,0.3)' : 'rgba(200,80,60,0.4)'}
                strokeWidth={weight >= 0 ? 1.3 : 1.5}
                strokeDasharray={weight >= 0 ? undefined : '4 3'}
              />
            );
          });
        })}
        {nodes.map(n => {
          const st = BED_GROUP_STYLE[n.type] ?? { fill: '#ccc', edge: '#888', label: n.type };
          const r = Math.max(15, n.radius * proj.s * 1.2);
          const cx = proj.toX(n.x), cz = ty(n.z);
          return (
            <g key={n.type}>
              <circle cx={cx} cy={cz} r={r} fill={st.fill} fillOpacity="0.85" stroke={st.edge} strokeWidth="1.4" />
              <text x={cx} y={cz + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="rgba(20,20,15,0.85)">
                {st.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// A real bed-group sub-bubble, shown only while its parent wing is open.
// View-only — real position/size from MassingStage's nested per-wing solve,
// but not independently draggable (see file header).
function BedGroupBubble({ n, proj }) {
  const st = BED_GROUP_STYLE[n.type] ?? { fill: '#ccc', edge: '#888', label: n.type };
  const cx = proj.toX(n.x), cz = proj.toY(n.z);
  const r = Math.max(3, n.radius * proj.s);
  return (
    <g style={{ pointerEvents: 'none' }}>
      <circle cx={cx} cy={cz} r={r} fill={st.fill} fillOpacity="0.85" stroke={st.edge} strokeWidth="1.2" />
      <text x={cx} y={cz + 3} textAnchor="middle" fontSize="7.5" fontWeight="700" fill="rgba(20,20,15,0.8)">
        {st.label}
      </text>
    </g>
  );
}

export default function BubbleDiagram({ diagram, weights, onWeightsChange, zoneOverrides, onZoneOverridesChange, positionOverrides, onPositionOverridesChange }) {
  const poly = diagram?.poly;
  const floorDiagrams = diagram?.floorDiagrams ?? [];

  // Floor selector — every floor has its own REAL zone graph (ground floor
  // carries entry/green/services/wings per wingFloorTierNodes; upper floors
  // are units-only, or units+green on whichever floors assignTerraceFloors
  // gave a connecting terrace to), not a copy of floor 0. Reset back to
  // ground whenever the floor count shrinks below the current selection
  // (e.g. switching to a variation/style with fewer floors).
  const [activeFloor, setActiveFloor] = useState(0);
  useEffect(() => {
    if (activeFloor >= floorDiagrams.length) setActiveFloor(0);
  }, [floorDiagrams.length, activeFloor]);

  const floorData = floorDiagrams[activeFloor];
  const nodes = floorData?.graph?.nodes ?? diagram?.graph?.nodes ?? [];
  const adjacency = floorData?.graph?.adjacency ?? diagram?.graph?.adjacency;
  const wings = floorData?.wings ?? diagram?.wings ?? [];
  // Entry/sun facts are real ground-floor-only inputs (roadBiasForce/sun
  // only ever bias fi===0's relaxation — see floorsFromBubbleLayout) so
  // they're only meaningful to show on that floor's diagram.
  const facts = activeFloor === 0 ? (diagram?.facts ?? {}) : {};
  const proj = makeProjection(poly);

  // Only one wing open at a time — reset whenever the diagram's own wing set
  // changes shape (e.g. switching floor/variation to a different wing count)
  // so a stale index can never point at a wing that no longer exists.
  const [openWingType, setOpenWingType] = useState(null);
  const openWing = openWingType ? wings.find(w => w.node.type === openWingType) : null;

  // The unit-connections panel replaced a static text block, so it needs
  // something to show by default rather than sitting empty until the user
  // happens to click a wing — auto-open the first one whenever the current
  // selection is missing or no longer valid for this diagram's wing set.
  useEffect(() => {
    if (!wings.length) { if (openWingType) setOpenWingType(null); return; }
    if (!wings.some(w => w.node.type === openWingType)) setOpenWingType(wings[0].node.type);
  }, [wings, openWingType]);

  const onToggle = (type) => setOpenWingType(cur => (cur === type ? null : type));
  const servicesNode = nodes.find(n => n.type === 'services') ?? null;

  return (
    <div style={{ borderTop: '1px solid rgba(20,20,15,0.1)', background: 'var(--bg)', flexShrink: 0 }}>
      {/* Floor selector — each tab is a real floor with its OWN relaxed zone
          graph (see floorDiagrams in MassingStage.jsx), not a filter over
          one shared graph. Only shown once there's more than one floor to
          switch between. */}
      {floorDiagrams.length > 1 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.3rem',
          padding: '0.3rem 1rem 0', fontFamily: 'var(--mono)', fontSize: '9px',
        }}>
          <span style={{ color: 'rgba(20,20,15,0.35)', letterSpacing: '0.08em', marginRight: '0.2rem' }}>FLOOR</span>
          {floorDiagrams.map((fd, i) => (
            <button
              key={i}
              onClick={() => setActiveFloor(i)}
              style={{
                minWidth: 22, height: 20, padding: '0 6px',
                background: activeFloor === i ? '#14140f' : 'transparent',
                color: activeFloor === i ? '#fff' : 'rgba(20,20,15,0.55)',
                border: '1px solid rgba(20,20,15,0.18)',
                fontFamily: 'var(--mono)', fontSize: '9px', fontWeight: 700,
                cursor: 'pointer',
              }}
              title={i === 0 ? 'Ground floor — entry, green, services, wings' : `Floor ${i} — units-only${fd.wings?.some(w => w) ? '' : ''}`}
            >
              {i === 0 ? 'GF' : i}
            </button>
          ))}
        </div>
      )}

    <div style={{
      display: 'flex', gap: '0.85rem', alignItems: 'center',
      padding: '0.4rem 1rem',
      background: 'var(--bg)',
      fontFamily: 'var(--mono)', fontSize: '10px',
    }}>
      <svg width={VW} height={VH} style={{ flexShrink: 0 }} aria-label="Bubble diagram">
        {proj && poly && (
          <polygon
            points={poly.map(p => `${proj.toX(p.x)},${proj.toY(p.z)}`).join(' ')}
            fill="rgba(120,200,164,0.07)" stroke="#78c8a4" strokeWidth="1.2"
          />
        )}

        {/* Adjacency edges first, so bubbles sit on top of them. These are the
            real spring relationships relaxGraph solved, so the diagram shows
            WHY zones ended up where they did. */}
        {proj && adjacency && nodes.map((n, i) => {
          const edges = adjacency.get(n.type) || [];
          return edges.map(({ other, weight }) => {
            const j = nodes.findIndex(m => m.type === other);
            if (j <= i) return null; // draw each undirected pair once
            const m = nodes[j];
            return (
              <line
                key={`${n.type}-${other}`}
                x1={proj.toX(n.x)} y1={proj.toY(n.z)}
                x2={proj.toX(m.x)} y2={proj.toY(m.z)}
                stroke={weight >= 0 ? 'rgba(20,20,15,0.32)' : 'rgba(200,80,60,0.4)'}
                strokeWidth={weight >= 0 ? 1.4 : 1.6}
                strokeDasharray={weight >= 0 ? undefined : '4 3'}
              />
            );
          });
        })}

        {/* The real site-boundary edge nearest an actual OSM road — the
            genuine frontage entryBiasFromRoads matched, not just an abstract
            dot. Drawn UNDER the fact markers/bubbles so it reads as "this
            side of the boundary", same idea as the adjacency edges above. */}
        {proj && facts.entry?.edgeA && facts.entry?.edgeB && (
          <line
            x1={proj.toX(facts.entry.edgeA.x)} y1={proj.toY(facts.entry.edgeA.z)}
            x2={proj.toX(facts.entry.edgeB.x)} y2={proj.toY(facts.entry.edgeB.z)}
            stroke="#c8734f" strokeWidth="3.5" strokeLinecap="round"
          />
        )}

        {/* Fact markers — the real inputs, drawn where they actually act. */}
        {proj && facts.entry && (
          <g>
            <circle cx={proj.toX(facts.entry.x)} cy={proj.toY(facts.entry.z)} r="4"
              fill="#c8734f" stroke="var(--bg)" strokeWidth="1.5" />
            <text x={proj.toX(facts.entry.x)} y={proj.toY(facts.entry.z) - 8}
              textAnchor="middle" fill="#c8734f" fontSize="9" fontWeight="700">ENTRY</text>
          </g>
        )}
        {/* No real OSM road data for this site — say so plainly on the
            diagram itself, not just via the greyed-out slider hint below,
            which is easy to miss. Ground floor only: on upper floors entry
            genuinely doesn't apply (not just missing data), so this would
            be misleading there. */}
        {proj && activeFloor === 0 && !facts.entry && (
          <text x={VW / 2} y={VH - 10} textAnchor="middle" fill="rgba(200,80,60,0.55)" fontSize="9" fontWeight="700">
            NO REAL ROAD DATA — entry is unconstrained
          </text>
        )}
        {proj && facts.sun && (
          <g>
            <circle cx={proj.toX(facts.sun.x)} cy={proj.toY(facts.sun.z)} r="4"
              fill="#d9a441" stroke="var(--bg)" strokeWidth="1.5" />
            <text x={proj.toX(facts.sun.x)} y={proj.toY(facts.sun.z) - 8}
              textAnchor="middle" fill="#b8860b" fontSize="9" fontWeight="700">SUN</text>
          </g>
        )}

        {/* Every top-level node: a wing (click to open, drag to move), or a
            plain zone (green/services/entry/semiopen). The currently-open
            wing is dimmed instead of hidden — its real position is still
            "there", just standing in for its own children below. */}
        {proj && nodes.map((n) => {
          const isWing = /^wing_\d+$/.test(n.type);
          const wingIdx = isWing ? Number(n.type.slice(5)) : -1;
          const style = isWing ? wingStyle(wingIdx) : (ZONE_STYLE[n.type] ?? { fill: '#ccc', label: n.type });
          return (
            <ZoneBubble
              key={n.type} n={n} style={style} proj={proj}
              override={zoneOverrides?.[n.type]}
              onOverrideChange={onZoneOverridesChange ? (type, v) => onZoneOverridesChange({ ...zoneOverrides, [type]: v }) : null}
              moved={!!positionOverrides?.[n.type]}
              onPositionChange={onPositionOverridesChange ? (type, p) => {
                // p === null is the double-click reset — drop the key entirely
                // so the zone reverts to its natural relaxed position instead
                // of staying pinned at some fixed spot with no bias.
                const next = { ...positionOverrides };
                if (p == null) delete next[type]; else next[type] = p;
                onPositionOverridesChange(next);
              } : null}
              onToggle={isWing ? onToggle : null}
              dimmed={openWingType === n.type}
            />
          );
        })}

        {/* The open wing's own real 1B/2B/3B/4B sub-bubbles — a real nested
            solve MassingStage.jsx already ran (its own claimed cells split
            by the real bed-count mix), not a decorative redraw. */}
        {proj && openWing?.bedNodes?.map(bn => (
          <BedGroupBubble key={`${openWing.node.type}:${bn.type}`} n={bn} proj={proj} />
        ))}

        {/* Colour-swatch legend, bottom-left of the canvas — same fixed
            categories every diagram uses, styled after a real architectural
            spatial-adjacency diagram (swatch + label list). */}
        {proj && (
          <g transform={`translate(${PAD}, ${VH - PAD - LEGEND_ITEMS.length * 14 - 2})`}>
            {LEGEND_ITEMS.map(({ fill, label }, i) => (
              <g key={label} transform={`translate(0, ${i * 14})`}>
                <rect width="9" height="9" rx="2" fill={fill} fillOpacity="0.85" stroke="rgba(20,20,15,0.35)" strokeWidth="1" />
                <text x="14" y="8.5" fontSize="8.5" fill="rgba(20,20,15,0.65)">{label}</text>
              </g>
            ))}
          </g>
        )}

        {!proj && (
          <text x={VW / 2} y={VH / 2} textAnchor="middle" fill="rgba(20,20,15,0.35)" fontSize="11">
            No site polygon
          </text>
        )}
      </svg>

      {/* Compact site-fact sliders — kept, but shrunk to single-line rows
          with hint text moved into a title tooltip, since the enlarged
          unit-connections panel now owns most of this row's width. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', width: 150, flexShrink: 0 }}>
        <FactSlider
          id="fact-entry" label="Entry" compact
          hint={facts.entry ? 'real OSM frontage' : (activeFloor === 0 ? 'no road data' : 'ground floor only')}
          disabled={!facts.entry}
          value={weights.entry} onChange={(v) => onWeightsChange({ ...weights, entry: v })}
        />
        <FactSlider
          id="fact-sun" label="Sun" compact
          hint={facts.sun ? 'south-facing edge' : (activeFloor === 0 ? 'unavailable' : 'ground floor only')}
          disabled={!facts.sun}
          value={weights.sun} onChange={(v) => onWeightsChange({ ...weights, sun: v })}
        />
        <div style={{ color: 'rgba(20,20,15,0.32)', lineHeight: 1.4, fontSize: 8.5 }}>
          Site facts → massing. Drag a bubble to reposition it.
        </div>
      </div>

      {/* Enlarged unit-connections view — replaces the old static
          description block. Shows the currently open wing's real
          1B/2B/3B/4B groups at a size actually big enough to read, plus
          their real adjacency edges. See WingDetailPanel above for what is
          and isn't invented here. */}
      <div style={{ flex: 1, minWidth: 280, overflowX: 'auto' }}>
        <WingDetailPanel openWing={openWing} servicesNode={servicesNode} panelW={440} panelH={VH} />
      </div>

      {/* Sustainability matrix — same cited cast-stone-vs-concrete source
          figures as the Embodied Carbon card in MassingStage's right panel,
          just broken into rows instead of one bar chart. Sits in the row's
          remaining width next to the unit-connections panel. */}
      <div style={{ flexShrink: 0 }}>
        <SustainabilityMatrix />
      </div>
    </div>
    </div>
  );
}
