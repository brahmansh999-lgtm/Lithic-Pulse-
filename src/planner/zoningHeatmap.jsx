import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

// Interactive contour-heatmap zoning overlay — soft glowing "heat blobs"
// centred on each zone's footprint centroid, rendered directly on the site
// polygon on the map (no side panel diagram). The architect can drag each
// blob to express zoning intent; this is visual/planning only — it does not
// feed back into the masterplan generator, it just records where the
// architect wants each zone emphasised.

const ZONE_COLOR = {
  unit:        { r: 130, g: 110, b: 200 },  // Residential — violet
  service_core:{ r: 230, g: 175, b: 70  },  // Service Core — amber
  community:   { r: 110, g: 170, b: 130 },  // Community — sage green
  balcony:     { r: 90,  g: 180, b: 190 },  // Balconies — teal
  opening:     { r: 255, g: 220, b: 100 },  // Openings/Glazing — yellow
  vehicular:   { r: 210, g: 90,  b: 60  },  // Vehicular Access — red-orange
  courtyard:   { r: 70,  g: 150, b: 90  },  // Courtyard — green
};

const ZONE_LABEL = {
  unit:         'Residential',
  service_core: 'Service Core',
  community:    'Community',
  balcony:      'Balconies',
  opening:      'Openings',
  vehicular:    'Vehicular',
  courtyard:    'Courtyard',
};

// Compute the polygon centroid in 0-100 space
function polyCentroid(poly) {
  if (!poly?.length) return { x: 50, y: 50 };
  const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
  return { x: cx, y: cy };
}

// Find the actual polygon vertex closest to a named corner of the bbox,
// then pull inward toward the centroid so the blob sits inside the shape.
function cornerToXY(corner, poly, cx, cy, inwardFrac = 0.35) {
  if (!poly?.length) {
    const m = 22;
    switch (corner) {
      case 'sw': return { x: m,       y: 100 - m };
      case 'se': return { x: 100 - m, y: 100 - m };
      case 'nw': return { x: m,       y: m };
      case 'ne': return { x: 100 - m, y: m };
      default:   return { x: 50,      y: 50 };
    }
  }
  // Target corner of the bounding box
  const tx = corner.includes('e') ? 100 : 0;
  const ty = corner.includes('s') ? 100 : 0;
  // Find the polygon vertex nearest that bbox corner
  let best = poly[0], bestD = Infinity;
  for (const p of poly) {
    const d = Math.hypot(p.x - tx, p.y - ty);
    if (d < bestD) { bestD = d; best = p; }
  }
  // Pull toward centroid so blob is inside, not on the boundary
  return {
    x: best.x + (cx - best.x) * inwardFrac,
    y: best.y + (cy - best.y) * inwardFrac,
  };
}

// Resolve azimuth to a position inside the polygon biased toward that edge.
// Shoots a ray from centroid toward the azimuth direction, stops at 70% of
// the way to the boundary so blobs stay well inside the polygon.
function azimuthToEdgeXY(azimuth, cx, cy, poly, reachFrac = 0.55) {
  const rad = (azimuth * Math.PI) / 180;
  const dx = Math.sin(rad), dy = -Math.cos(rad); // SVG y down, N=up
  // Walk outward until we'd leave the polygon, take 55% of that distance
  let reach = 0;
  for (let t = 5; t <= 60; t += 2) {
    const tx = cx + dx * t, ty = cy + dy * t;
    if (!pointInPolygon(tx, ty, poly)) { reach = t * reachFrac; break; }
    reach = t * reachFrac;
  }
  return {
    x: Math.max(5, Math.min(95, cx + dx * reach)),
    y: Math.max(5, Math.min(95, cy + dy * reach)),
  };
}

// Build zone blobs from designRules, each zone placed per the architect's
// sketch spatial logic — positions derived from the actual site polygon.
function computeBlobsFromRules(designRules, clipPolygon) {
  const poly = clipPolygon?.length >= 3 ? clipPolygon : null;
  const { x: cx, y: cy } = polyCentroid(poly);
  const rules = designRules || {};

  const noiseCorner    = rules.noiseClusterCorner || 'sw';
  const communalCorner = rules.communalCorner || noiseCorner;
  const solarAz        = rules.solarAzimuth ?? 180;       // south = openings
  const balconyAz      = rules.balconyAzimuth ?? 90;      // east = balconies
  // Quiet residential corner = opposite of noise corner
  const quietCorner = { sw:'ne', se:'nw', nw:'se', ne:'sw' }[noiseCorner] || 'ne';

  const noiseXY    = cornerToXY(noiseCorner,   poly, cx, cy, 0.28);
  const quietXY    = cornerToXY(quietCorner,   poly, cx, cy, 0.28);
  const communalXY = cornerToXY(communalCorner,poly, cx, cy, 0.38);
  const solarXY    = poly ? azimuthToEdgeXY(solarAz,   cx, cy, poly, 0.52) : { x: cx, y: cy + 22 };
  const balconyXY  = poly ? azimuthToEdgeXY(balconyAz, cx, cy, poly, 0.52) : { x: cx + 22, y: cy };

  const blobs = [
    // RESIDENTIAL — largest zone, pushed to quiet corner (away from noise/vehicular)
    { zone: 'unit',         x: quietXY.x,   y: quietXY.y,   peakR: 22 },

    // SERVICE CORE — compact, at noise corner (minimal service space)
    { zone: 'service_core', x: noiseXY.x,   y: noiseXY.y,   peakR: 11 },

    // VEHICULAR ACCESS — noise corner, concentrated there to reduce disturbance
    { zone: 'vehicular',    x: noiseXY.x * 0.6 + cx * 0.4,
                            y: noiseXY.y * 0.6 + cy * 0.4,  peakR: 10 },

    // COMMUNITY — east-biased (soft light for seating), near communal corner
    { zone: 'community',    x: communalXY.x * 0.5 + balconyXY.x * 0.5,
                            y: communalXY.y * 0.5 + balconyXY.y * 0.5, peakR: 14 },

    // COURTYARD — communal corner, max light, buffer space
    { zone: 'courtyard',    x: communalXY.x, y: communalXY.y, peakR: 15 },

    // BALCONIES — east facing (comfort light throughout day)
    { zone: 'balcony',      x: balconyXY.x,  y: balconyXY.y,  peakR: 12 },

    // OPENINGS/GLAZING — south facing (max solar gain)
    { zone: 'opening',      x: solarXY.x,    y: solarXY.y,    peakR: 11 },
  ];

  // For large building: balconies on E+W+S — add extra blobs per direction
  if (rules.balconyFacingMulti?.length > 1) {
    const COMPASS = { north: 0, east: 90, south: 180, west: 270 };
    rules.balconyFacingMulti.slice(1).forEach(dir => {
      const pos = poly ? azimuthToEdgeXY(COMPASS[dir] ?? 90, cx, cy, poly, 0.5) : { x: cx, y: cy };
      blobs.push({ zone: 'balcony', x: pos.x, y: pos.y, peakR: 9 });
    });
  }

  // Clamp every blob inside the actual polygon
  return blobs.map(b => {
    if (!poly || pointInPolygon(b.x, b.y, poly)) return b;
    const clamped = clampToPolygon(b.x, b.y, poly);
    return { ...b, x: clamped.x, y: clamped.y };
  });
}

// Point-in-polygon test (ray casting) — used to keep dragged blobs inside
// the site outline. `poly` is an array of {x,y} in the same 0-100 space.
function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Clamp a point to the nearest position inside (or on) the polygon by
// nudging toward the polygon's centroid if it falls outside.
function clampToPolygon(x, y, poly) {
  if (!poly?.length || pointInPolygon(x, y, poly)) return { x, y };
  const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
  let lo = 0, hi = 1, px = x, py = y;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    const tx = x + (cx - x) * mid;
    const ty = y + (cy - y) * mid;
    if (pointInPolygon(tx, ty, poly)) { hi = mid; px = tx; py = ty; }
    else lo = mid;
  }
  return { x: px, y: py };
}

// Stepped contour rings — discrete bands at fixed radii fractions, opacity
// increasing toward the centre (no blur filter — hard topographic bands,
// not a smooth glow). Each ring is a slightly irregular polygon (radius
// jittered per-vertex, seeded by zone) so blobs read as organic terrain
// shapes, not perfect circles — matches the architect's reference diagram.
const RING_FRACS = [1, 0.82, 0.64, 0.47, 0.31, 0.17];
const RING_ALPHA = [0.16, 0.24, 0.34, 0.46, 0.6, 0.8];
const VERTS = 16;

function seededJitter(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return h >>> 0;
}

function blobPath(cx, cy, r, seed) {
  const rng = seededJitter(seed);
  const pts = [];
  for (let i = 0; i < VERTS; i++) {
    const angle = (i / VERTS) * Math.PI * 2;
    const wobble = 0.78 + rng() * 0.44; // 0.78x .. 1.22x radius per vertex
    pts.push([cx + Math.cos(angle) * r * wobble, cy + Math.sin(angle) * r * wobble]);
  }
  let d = `M ${(pts[0][0] + pts[pts.length - 1][0]) / 2} ${(pts[0][1] + pts[pts.length - 1][1]) / 2} `;
  for (let i = 0; i < pts.length; i++) {
    const next = pts[(i + 1) % pts.length];
    const mid = [(pts[i][0] + next[0]) / 2, (pts[i][1] + next[1]) / 2];
    d += `Q ${pts[i][0]} ${pts[i][1]} ${mid[0]} ${mid[1]} `;
  }
  return d + 'Z';
}

function ContourBlob({ x, y, peakR, color, zone }) {
  const seed = hashSeed(zone);
  return (
    <>
      {RING_FRACS.map((frac, i) => (
        <path
          key={i}
          d={blobPath(x, y, peakR * frac, seed * 31 + i * 7)}
          fill={`rgba(${color.r},${color.g},${color.b},${RING_ALPHA[i]})`}
        />
      ))}
    </>
  );
}

function computeBlobs(plan) {
  const buildings = (plan.buildings || []).filter(b => b.units?.length > 0);
  if (!buildings.length) return [];

  const allX = buildings.flatMap(b => [b.col, b.col + b.w]);
  const allZ = buildings.flatMap(b => [b.row, b.row + b.d]);
  const minX = Math.min(...allX), maxX = Math.max(...allX);
  const minZ = Math.min(...allZ), maxZ = Math.max(...allZ);
  const rangeX = maxX - minX || 1;
  const rangeZ = maxZ - minZ || 1;

  const toPct = (col, row) => ({
    x: ((col - minX) / rangeX) * 100,
    y: ((row - minZ) / rangeZ) * 100,
  });

  const zoneAgg = {};
  buildings.forEach((b, i) => {
    buildingSubZones(b, i, buildings.length).forEach(({ zone, col, row, w, d }) => {
      const cx = col + w / 2, cy = row + d / 2;
      const { x, y } = toPct(cx, cy);
      const size = Math.sqrt((w / rangeX) * (d / rangeZ)) * 100;
      if (!zoneAgg[zone]) zoneAgg[zone] = { sx: 0, sy: 0, n: 0, maxSize: 0 };
      const a = zoneAgg[zone];
      a.sx += x; a.sy += y; a.n += 1;
      a.maxSize = Math.max(a.maxSize, size);
    });
  });

  const greens = [...(plan.deckGardens || []), ...(plan.greenCells || [])]
    .filter(g => g && g.col != null);
  if (greens.length) {
    const a = zoneAgg.green || (zoneAgg.green = { sx: 0, sy: 0, n: 0, maxSize: 0 });
    greens.forEach(g => {
      const cx = g.col + (g.w || 1) / 2, cy = g.row + (g.d || 1) / 2;
      const { x, y } = toPct(cx, cy);
      const size = Math.sqrt(((g.w || 1) / rangeX) * ((g.d || 1) / rangeZ)) * 100;
      a.sx += x; a.sy += y; a.n += 1;
      a.maxSize = Math.max(a.maxSize, size);
    });
  }

  return Object.entries(zoneAgg).map(([zone, a]) => ({
    zone,
    x: a.sx / a.n,
    y: a.sy / a.n,
    peakR: Math.max(8, Math.min(22, a.maxSize * 0.9 + 5)),
  }));
}

// `plan` changing (e.g. a different precedent/iteration picked) resets any
// manual drag — overridePositions is keyed by zone and only applies to the
// blob set derived from the *current* plan.
export default function ZoningHeatmap({ plan, clipPolygon, designRules, onPositionsChange }) {
  const map = useMap();
  // Use design-rules-driven placement when rules are present — blobs are
  // placed in the site polygon's 0-100 space based on where the architect
  // specified each zone should go (noise corner, communal corner, balcony
  // facing, solar facing). Falls back to plan-derived blobs when no rules.
  const baseBlobs = useMemo(() => {
    if (designRules && designRules.id !== 'none') return computeBlobsFromRules(designRules, clipPolygon);
    if (plan) return computeBlobs(plan);
    return [];
  }, [plan, designRules, clipPolygon]);
  const [overrides, setOverrides] = useState({});
  const svgRef = useRef(null);
  const dragZone = useRef(null);

  useEffect(() => { setOverrides({}); }, [plan, designRules]);

  const blobs = baseBlobs.map(b => ({ ...b, ...(overrides[b.zone] || {}) }));

  const toLocalPoint = useCallback((clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: ((clientX - rect.left) / rect.width) * 100,
      y: ((clientY - rect.top) / rect.height) * 100,
    };
  }, []);

  // Leaflet's own drag handler listens at the map-container DOM level and
  // isn't stopped by React's synthetic stopPropagation, so we also disable
  // map dragging/scroll-zoom for the duration of a blob drag.
  const handlePointerDown = useCallback((e, zone) => {
    L.DomEvent.stopPropagation(e.nativeEvent ?? e);
    e.preventDefault();
    dragZone.current = zone;
    e.target.setPointerCapture?.(e.pointerId);
    map.dragging.disable();
    map.doubleClickZoom.disable();
  }, [map]);

  const handlePointerMove = useCallback((e) => {
    const zone = dragZone.current;
    if (!zone) return;
    e.stopPropagation();
    const pt = toLocalPoint(e.clientX, e.clientY);
    if (!pt) return;
    const clamped = clampToPolygon(pt.x, pt.y, clipPolygon);
    setOverrides(o => {
      const next = { ...o, [zone]: { x: clamped.x, y: clamped.y } };
      onPositionsChange?.(next);
      return next;
    });
  }, [clipPolygon, onPositionsChange, toLocalPoint]);

  const handlePointerUp = useCallback((e) => {
    if (!dragZone.current) return;
    e.stopPropagation();
    dragZone.current = null;
    map.dragging.enable();
    map.doubleClickZoom.enable();
  }, [map]);

  if (!plan || !blobs.length) return null;

  // Label collision avoidance — on a small/single-building site,
  // buildingSubZones() packs several zone centroids within a few percent
  // of each other (entry, services, bedrooms, terrace, community all on
  // one tiny footprint), so labels rendered at a fixed offset from each
  // blob's own centre stack directly on top of each other. Cluster blobs
  // whose centres are close together and fan their labels out radially
  // around the cluster's shared centre instead, so every zone name stays
  // legible regardless of how tightly the underlying blobs overlap.
  const LABEL_CLUSTER_DIST = 9; // % of the 0-100 viewBox
  const labelClusters = [];
  for (const b of blobs) {
    let cluster = labelClusters.find(c => c.some(m => Math.hypot(m.x - b.x, m.y - b.y) < LABEL_CLUSTER_DIST));
    if (!cluster) { cluster = []; labelClusters.push(cluster); }
    cluster.push(b);
  }
  const labelPos = new Map();
  for (const cluster of labelClusters) {
    if (cluster.length === 1) {
      const b = cluster[0];
      labelPos.set(b.zone, { lx: b.x, ly: b.y - 6 });
      continue;
    }
    const cx = cluster.reduce((s, b) => s + b.x, 0) / cluster.length;
    const cy = cluster.reduce((s, b) => s + b.y, 0) / cluster.length;
    const fanR = 7 + cluster.length * 1.4;
    cluster.forEach((b, i) => {
      const angle = (i / cluster.length) * Math.PI * 2 - Math.PI / 2;
      labelPos.set(b.zone, { lx: cx + Math.cos(angle) * fanR, ly: cy + Math.sin(angle) * fanR });
    });
  }

  const clipId = 'zhm-site-clip';
  // Plain 0-100 numeric coords (not % strings — <polygon points> doesn't
  // accept percentages). The wrapping <svg viewBox="0 0 100 100"> below
  // makes these line up 1:1 with the blobs, which use the same units.
  const clipPoints = clipPolygon?.length >= 3
    ? clipPolygon.map(p => `${p.x},${p.y}`).join(' ')
    : null;

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ width: '100%', height: '100%', overflow: 'visible' }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <defs>
        {clipPoints && (
          <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
            <polygon points={clipPoints} />
          </clipPath>
        )}
      </defs>
      <g clipPath={clipPoints ? `url(#${clipId})` : undefined}>
        <g>
          {blobs.map(b => (
            <ContourBlob
              key={b.zone}
              x={b.x} y={b.y} peakR={b.peakR}
              color={ZONE_COLOR[b.zone] || ZONE_COLOR.unit}
              zone={b.zone}
            />
          ))}
        </g>
        {blobs.map(b => {
          const c = ZONE_COLOR[b.zone] || ZONE_COLOR.unit;
          const { lx, ly } = labelPos.get(b.zone);
          const displaced = Math.hypot(lx - b.x, ly - b.y) > 6.5;
          return (
            <g key={`label-${b.zone}`}>
              {displaced && (
                <line
                  x1={b.x} y1={b.y} x2={lx} y2={ly}
                  stroke="rgba(255,255,255,0.35)" strokeWidth="0.25"
                  pointerEvents="none"
                />
              )}
              <text
                x={lx} y={ly}
                textAnchor="middle" dominantBaseline="middle"
                fill="rgba(255,255,255,0.75)"
                fontSize="3.2"
                fontFamily="'Inter', 'Helvetica Neue', sans-serif"
                fontWeight="300"
                letterSpacing="0.08em"
                stroke="rgba(0,0,0,0.6)"
                strokeWidth="0.2"
                paintOrder="stroke"
                pointerEvents="none"
              >
                {(ZONE_LABEL[b.zone] || b.zone).toUpperCase()}
              </text>
              {/* Draggable handle — larger invisible hit-target around the visible dot */}
              <circle
                cx={b.x} cy={b.y} r="3.2"
                fill="transparent"
                style={{ cursor: 'grab', touchAction: 'none' }}
                onPointerDown={(e) => handlePointerDown(e, b.zone)}
              />
              <circle
                cx={b.x} cy={b.y} r="0.9"
                fill={`rgb(${c.r},${c.g},${c.b})`}
                stroke="rgba(255,255,255,0.9)" strokeWidth="0.3"
                pointerEvents="none"
              />
            </g>
          );
        })}
      </g>
    </svg>
  );
}
