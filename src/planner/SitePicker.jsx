import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polygon, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import './SitePicker.css';
import { useBrownfieldData } from './useBrownfieldData';
import { CURATED_SITE_IDS, SITE_GLB } from './curatedSites';
import MassingStage from './MassingStage';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl:       'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl:     'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// ── Community scale tiers ─────────────────────────────────────────
// Based on gross site area (m²). Quarter/District (>2.5 ha) tiers were
// removed from selection 2026-06-29 — the platform now only targets
// Pocket and Village scale, matching what the reverse-engineering precedent
// pipeline (zoningTargets.js) is calibrated against.
function getSiteTier(areaSqM) {
  if (areaSqM < 5000)   return { id: 'pocket',    label: 'Pocket',    sub: '< 0.5 ha',  desc: 'Intimate infill — boutique community of 8–24 homes tucked into the city grain.',       accent: '#7ec8a4' };
  return                       { id: 'village',   label: 'Village',   sub: '0.5–2.6 ha',desc: 'Neighbourhood scale — a self-contained village with shared courts and amenity.',      accent: '#b8935a' };
}

// ── Compute polygon area (Shoelace, metres²) ─────────────────────
function polyAreaSqM(latLngs) {
  const R = 6371000;
  let area = 0;
  const n = latLngs.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const xi = (latLngs[i][1] * Math.PI / 180) * R * Math.cos(latLngs[i][0] * Math.PI / 180);
    const yi =  latLngs[i][0] * Math.PI / 180  * R;
    const xj = (latLngs[j][1] * Math.PI / 180) * R * Math.cos(latLngs[j][0] * Math.PI / 180);
    const yj =  latLngs[j][0] * Math.PI / 180  * R;
    area += xi * yj - xj * yi;
  }
  return Math.abs(area / 2);
}

// Tertile-based size label, only needed for the small-dataset fallback path
// (when there are already <= CURATED_TARGET permissioned sites and every
// one of them is kept — still want a consistent small/medium/big label).
function sizeTierOf(hectares, pool) {
  const sorted = pool.slice().sort((a, b) => a.hectares - b.hectares);
  const p1 = sorted[Math.floor(sorted.length / 3)]?.hectares ?? 0;
  const p2 = sorted[Math.floor(sorted.length * 2 / 3)]?.hectares ?? Infinity;
  if (hectares < p1) return 'small';
  if (hectares < p2) return 'medium';
  return 'big';
}

// ── Bounding box → widthM / depthM ───────────────────────────────
function polyBounds(latLngs) {
  const lats = latLngs.map(p => p[0]);
  const lngs = latLngs.map(p => p[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const midLat = (minLat + maxLat) / 2;
  const R = 6371000;
  const widthM = Math.abs(maxLng - minLng) * Math.PI / 180 * R * Math.cos(midLat * Math.PI / 180);
  const depthM = Math.abs(maxLat - minLat) * Math.PI / 180 * R;
  return { widthM: Math.round(widthM), depthM: Math.round(depthM) };
}

// ── Shared site → generator-input conversion ─────────────────────
// Takes a raw useBrownfieldData() site object and returns everything
// generateMasterplan() needs: siteBounds, sitePolygon (normalised [0..1]
// grid coords, longitude-corrected — see handleConfirm below for why),
// siteContext, env analysis, and the site's id. Used by SitePicker's own
// confirm flow and by the restricted Home Owner / Manufacturer views,
// which skip the map UI but need the exact same geometry conversion.
export function siteToMasterplanInput(site) {
  const coords = site.coords;
  const bounds = polyBounds(coords);
  const w = Math.min(2500, Math.max(24, bounds.widthM || 100));
  const d = Math.min(2500, Math.max(24, bounds.depthM || 100));

  let sitePolygon = null;
  if (coords?.length >= 3) {
    const lats = coords.map(p => p[0]);
    const lngs = coords.map(p => p[1]);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const midLat = (minLat + maxLat) / 2;
    const lngScale = Math.cos(midLat * Math.PI / 180);
    const rLat = (maxLat - minLat) || 1;
    const rLng = ((maxLng - minLng) * lngScale) || 1;
    sitePolygon = coords.map(([lat, lng]) => ({
      x: ((lng - minLng) * lngScale) / rLng,
      z: (lat - minLat) / rLat,
    }));
  }

  return {
    siteId: site.id,
    siteBounds: { widthM: w, depthM: d },
    sitePolygon,
    siteContext: site.siteContext || null,
    analysis: analyseSiteEnv(site.lat, site.lng, coords),
  };
}


// ── Point-in-polygon (ray casting) ───────────────────────────────
function pointInPoly([lat, lng], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}


// ── Real solar geometry (NOAA solar position algorithm, simplified) ──
// Computes the sun's azimuth at solar noon on the summer solstice for a
// given lat/lng — the orientation that matters most for solar-access
// massing decisions (longest, highest sun path of the year).
function solarNoonAzimuth(lat, lng) {
  const rad = Math.PI / 180, deg = 180 / Math.PI;
  const dayOfYear = 172; // June 21 (summer solstice, day-of-year, non-leap)
  // Solar declination (degrees) via Cooper's equation.
  const decl = 23.45 * Math.sin(rad * (360 / 365) * (dayOfYear - 81));
  // True solar noon in UTC: longitude shifts noon by 4 min per degree;
  // ignore the equation-of-time correction (~±16min) — negligible for azimuth at noon.
  const hourAngle = -lng; // degrees from local solar noon, west-negative convention flipped for east-positive lng
  const latR = lat * rad, declR = decl * rad, haR = hourAngle * rad;
  const elevation = Math.asin(
    Math.sin(latR) * Math.sin(declR) + Math.cos(latR) * Math.cos(declR) * Math.cos(haR)
  );
  let cosAz = (Math.sin(declR) - Math.sin(latR) * Math.sin(elevation)) /
              (Math.cos(latR) * Math.cos(elevation));
  cosAz = Math.max(-1, Math.min(1, cosAz));
  let azimuth = Math.acos(cosAz) * deg;
  if (hourAngle > 0) azimuth = 360 - azimuth; // afternoon mirrors east/west
  return azimuth;
}

// ── Road-geometry-derived access edges + noise ────────────────────
// Given the site's polygon, finds the longest boundary edge and classifies
// which compass side it faces — the long street-frontage edge is the most
// likely primary road frontage in an urban block. Noise is derived from
// how much of the perimeter sits on edges facing the site's two longest
// (most road-like) sides, normalised 0..1 — a proxy for total road exposure
// rather than guessing from distance to a fixed city-centre point.
function roadEdgesFromPolygon(coords) {
  const R = 6371000;
  const midLat = coords.reduce((s, p) => s + p[0], 0) / coords.length;
  const lngScale = Math.cos(midLat * Math.PI / 180);
  const pts = coords.map(([lat, lng]) => ({
    x: lng * lngScale * R * Math.PI / 180,
    y: lat * R * Math.PI / 180,
  }));

  const edges = pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length];
    const dx = q.x - p.x, dy = q.y - p.y;
    const length = Math.hypot(dx, dy);
    const angle = ((Math.atan2(dx, dy) * 180 / Math.PI) + 360) % 360; // 0=N,90=E,180=S,270=W
    let side;
    if (angle >= 45 && angle < 135) side = 'east';
    else if (angle >= 135 && angle < 225) side = 'south';
    else if (angle >= 225 && angle < 315) side = 'west';
    else side = 'north';
    return { side, length };
  });

  const bySide = { north: 0, east: 0, south: 0, west: 0 };
  let perimeter = 0;
  for (const e of edges) { bySide[e.side] += e.length; perimeter += e.length; }

  const ranked = Object.entries(bySide).sort((a, b) => b[1] - a[1]);
  const accessEdges = ranked.filter(([, len]) => len > 0).slice(0, 2).map(([side]) => side);
  // Road exposure: fraction of perimeter on the two dominant (most road-like) edges.
  const noiseLevel = perimeter > 0
    ? Math.max(0, Math.min(1, (ranked[0][1] + (ranked[1]?.[1] || 0)) / perimeter))
    : 0.5;

  return { accessEdges: accessEdges.length ? accessEdges : ['south', 'east'], noiseLevel };
}

// ── Site environmental analysis ───────────────────────────────────
// Solar azimuth uses real solstice solar-position astronomy for the site's
// actual lat/lng. Wind stays a London-prevailing-SW heuristic (no live
// weather-station data source wired up). Road access + noise are derived
// from the site's own boundary geometry rather than distance-to-centroid.
function analyseSiteEnv(lat, lng, coords = null) {
  const solarAzimuth = solarNoonAzimuth(lat, lng);

  // Prevailing wind in London is SW (225°). Local topography creates subtle
  // variation — Thames corridor sites get more westerly, northern sites more SW.
  const windBase = 225;
  const windAzimuth = windBase + (lat - 51.5) * 20 + (lng + 0.1) * 8;

  const { accessEdges, noiseLevel } = coords && coords.length >= 3
    ? roadEdgesFromPolygon(coords)
    : { accessEdges: lat < 51.505 ? ['north', 'east'] : ['south', 'east'], noiseLevel: 0.5 };

  return {
    solarAzimuth: Math.round(solarAzimuth),
    windAzimuth:  Math.round(((windAzimuth % 360) + 360) % 360),
    accessEdges,
    noiseLevel,
  };
}

// ── Status colours (matches useBrownfieldData) ───────────────────
const STATUS_COLORS = {
  'Permissioned':     '#4ade80',
  'Pending':          '#60a5fa',
  'Allocation':       '#a78bfa',
  'Not permissioned': '#f59e0b',
};

// ── Marker icon ───────────────────────────────────────────────────
function createSiteIcon(colour, active) {
  const r  = active ? 6  : 4;
  const r2 = active ? 12 : 8;
  const ring = active
    ? `<circle cx="12" cy="12" r="10" fill="none" stroke="${colour}" stroke-width="1.5" opacity="0.45"/>`
    : '';
  return L.divIcon({
    className: '',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -14],
    html: `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      ${ring}
      <circle cx="12" cy="12" r="${r}" fill="${colour}"/>
      <circle cx="12" cy="12" r="${r}" fill="${colour}" opacity="0.4">
        <animate attributeName="r"       from="${r}"  to="${r2}" dur="2.2s" repeatCount="indefinite"/>
        <animate attributeName="opacity" from="0.4" to="0"    dur="2.2s" repeatCount="indefinite"/>
      </circle>
    </svg>`,
  });
}

// ── Map controller — fly to site + expose closePopups ─────────────
function MapController({ target, mapRef, fitToCoords }) {
  const map = useMap();
  useEffect(() => {
    if (mapRef) mapRef.current = map;
  }, [map, mapRef]);
  useEffect(() => {
    if (target?.lat) map.flyTo([target.lat, target.lng], 15, { duration: 1.4 });
  }, [target, map]);
  // Zoning gate (step 02) — tightly frame the site polygon so the heatmap
  // overlay (drawn on the polygon's lat/lng bounds) fills most of the
  // screen instead of leaving a lot of empty surrounding map visible.
  useEffect(() => {
    if (fitToCoords?.length) {
      map.flyToBounds(fitToCoords, { padding: [20, 20], duration: 0.9, maxZoom: 19 });
    }
  }, [fitToCoords, map]);
  return null;
}

// ── Wind compass rose ─────────────────────────────────────────────
function WindRose({ azimuth }) {
  const rad = (azimuth - 90) * Math.PI / 180;
  const cx = 28, cy = 28, r = 20;
  const ax = cx + Math.cos(rad) * r, ay = cy + Math.sin(rad) * r;
  const bx = cx - Math.cos(rad) * r, by = cy - Math.sin(rad) * r;
  const dirs = [['N',28,6],['E',50,30],['S',28,54],['W',6,30]];
  return (
    <svg width="56" height="56" viewBox="0 0 56 56">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#2e2c28" strokeWidth="1"/>
      <circle cx={cx} cy={cy} r={r*0.5} fill="none" stroke="#2e2c28" strokeWidth="0.5" strokeDasharray="2 2"/>
      {dirs.map(([d,x,y]) => (
        <text key={d} x={x} y={y} textAnchor="middle" dominantBaseline="middle"
          fill="#5a5750" fontSize="7" fontFamily="JetBrains Mono, monospace">{d}</text>
      ))}
      <line x1={bx} y1={by} x2={ax} y2={ay} stroke="#2f74a3" strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx={ax} cy={ay} r="3" fill="#2f74a3"/>
      <circle cx={cx} cy={cy} r="2" fill="#3a3830"/>
    </svg>
  );
}

// ── Sun arc diagram ───────────────────────────────────────────────
function SunArc({ azimuth }) {
  const cx = 36, cy = 44, r = 30;
  // Arc from E(90°) to W(270°) — sun path across the sky
  const arcPath = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  // Sun position dot at given azimuth (0=N,90=E,180=S,270=W)
  const normAz = ((azimuth - 90) % 180) / 180; // 0=E, 0.5=S, 1=W
  const angle = normAz * Math.PI; // 0 to PI across the arc
  const sx = cx - r + r * 2 * normAz;
  const sy = cy - Math.sin(angle) * r * 0.85;
  return (
    <svg width="72" height="50" viewBox="0 0 72 50">
      <line x1={cx-r-2} y1={cy} x2={cx+r+2} y2={cy} stroke="#2e2c28" strokeWidth="1"/>
      <path d={arcPath} fill="none" stroke="#2e2c28" strokeWidth="1" strokeDasharray="3 2"/>
      <path d={`M ${cx-r} ${cy} A ${r} ${r} 0 0 1 ${sx} ${sy}`}
        fill="none" stroke="#e8e4da" strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx={sx} cy={sy} r="4" fill="#e8e4da" opacity="0.9"/>
      <circle cx={sx} cy={sy} r="7" fill="#e8e4da" opacity="0.15"/>
      {[['E',cx-r,cy+10],['S',cx,cy+10],['W',cx+r,cy+10]].map(([l,x,y])=>(
        <text key={l} x={x} y={y} textAnchor="middle" fill="#5a5750" fontSize="7"
          fontFamily="JetBrains Mono, monospace">{l}</text>
      ))}
    </svg>
  );
}

// ── Site analysis panel ───────────────────────────────────────────
function SiteAnalysisPanel({ analysis }) {
  if (!analysis) return null;
  const { solarAzimuth, windAzimuth, accessEdges, noiseLevel } = analysis;
  const windDirName = ['N','NE','E','SE','S','SW','W','NW'][Math.round(windAzimuth/45)%8];
  return (
    <div className="sp-analysis">
      <div className="sp-analysis-title">Site Analysis</div>
      <div className="sp-analysis-grid">
        <div className="sp-analysis-cell">
          <div className="sp-analysis-label">Solar Path</div>
          <SunArc azimuth={solarAzimuth} />
          <div className="sp-analysis-val">{solarAzimuth}° azimuth</div>
        </div>
        <div className="sp-analysis-cell">
          <div className="sp-analysis-label">Prevailing Wind</div>
          <WindRose azimuth={windAzimuth} />
          <div className="sp-analysis-val">{windDirName} · {windAzimuth}°</div>
        </div>
        <div className="sp-analysis-cell sp-analysis-cell--wide">
          <div className="sp-analysis-label">Road Access</div>
          <div className="sp-access-diagram">
            {['north','east','south','west'].map(edge => (
              <div key={edge} className={`sp-access-edge sp-access-edge--${edge} ${accessEdges.includes(edge) ? 'sp-access-edge--active' : ''}`}/>
            ))}
            <div className="sp-access-site"/>
          </div>
          <div className="sp-analysis-val">{accessEdges.join(' · ')} edge{accessEdges.length > 1 ? 's' : ''}</div>
        </div>
        <div className="sp-analysis-cell sp-analysis-cell--wide">
          <div className="sp-analysis-label">Noise Exposure</div>
          <div className="sp-noise-bar">
            <div className="sp-noise-fill" style={{ width: `${noiseLevel * 100}%` }}/>
          </div>
          <div className="sp-analysis-val">{noiseLevel > 0.6 ? 'High — acoustic buffer needed' : noiseLevel > 0.3 ? 'Moderate' : 'Low'}</div>
        </div>
      </div>
      <div className="sp-analysis-note">Analysis informs masterplan orientation · massing · podium entries</div>
    </div>
  );
}

// ── Tier badge ────────────────────────────────────────────────────
function TierBadge({ tier }) {
  return (
    <div className="sp-tier-badge" style={{ '--tier-accent': tier.accent }}>
      <div className="sp-tier-label">{tier.label}</div>
      <div className="sp-tier-sub">{tier.sub}</div>
      <div className="sp-tier-desc">{tier.desc}</div>
    </div>
  );
}

// Memoized so clicking a site (which changes `isActive` for just one polygon
// out of 1720) only re-renders that one Polygon instead of all 1720 — same
// boundaries, same styling, just without re-evaluating the whole list every click.
const SitePolygon = memo(function SitePolygon({ site, isActive, onSelect }) {
  return (
    <Polygon
      positions={site.coords}
      pathOptions={{
        color:       site.colour,
        weight:      isActive ? 3   : 1.5,
        opacity:     isActive ? 1   : 0.65,
        fillColor:   site.colour,
        fillOpacity: isActive ? 0.22 : 0.08,
        dashArray:   isActive ? null : '4 3',
      }}
      eventHandlers={{
        click:     (e) => { L.DomEvent.stopPropagation(e); onSelect(site); },
        mouseover: (e) => { e.target.setStyle({ fillOpacity: 0.25, weight: 2.5 }); },
        mouseout:  (e) => { if (!isActive) e.target.setStyle({ fillOpacity: 0.08, weight: 1.5 }); },
      }}
    />
  );
});

export default function SitePicker({ onConfirm, onBack, role }) {
  const [activeSeed, setActiveSeed]     = useState(null);
  const [clickedSite, setClickedSite]   = useState(null);
  const [siteAnalysis, setSiteAnalysis] = useState(null);
  const [tierFilter, setTierFilter]     = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  // Non-permissioned sites stay off the map until explicitly opened from the
  // list — this is what keeps the map from rendering 1720 polygons at once.
  const [revealedIds, setRevealedIds]   = useState(() => new Set());
  const mapRef = useRef(null);

  const { sites: allSitesRaw, loading: dataLoading } = useBrownfieldData();

  // Pocket + Village only (< 3.0 ha) — Quarter/District sites are excluded
  // entirely from selection, not just hidden behind a filter button. Raised
  // from 2.5 to 2.6 on 2026-06-30 to admit Royal Albert Dock (2.566 ha,
  // curated site 1723). Raised again to 3.0 on 2026-08-15 — the `large`
  // class's own curated site (1550, Dover Court Estate, 2.9 ha) was silently
  // excluded by the 2.6ha cutoff despite being hardcoded into
  // CURATED_SITE_IDS/SITE_GLB, making the `large` building class effectively
  // unselectable in the live UI. Found while re-verifying every existing
  // class still works after adding new ones — a real pre-existing bug, not
  // introduced by that work.
  const allSitesInScope = useMemo(() => allSitesRaw.filter(s => s.hectares < 3.0), [allSitesRaw]);

  // Backdrop context — ~55 non-permissioned sites (their REAL status —
  // Pending / Allocation / Not permissioned — and real colour, so the map
  // shows a realistic yellow/blue/purple spread instead of only 4 dots)
  // shown alongside the 4 workable ones. Sampled spread-out across the
  // dataset (every Nth site, not the first N) so it covers boroughs across
  // London instead of clustering wherever the GeoJSON happens to start.
  // These sites are NOT selectable into the pipeline — only their real
  // status is preserved for colour; canConfirm below still requires
  // CURATED_SITE_IDS membership regardless of what status they show.
  const BACKDROP_TARGET = 55;
  const backdropIds = useMemo(() => {
    const others = allSitesInScope.filter(s => !CURATED_SITE_IDS.includes(s.id) && s.status !== 'Permissioned');
    if (others.length <= BACKDROP_TARGET) return new Set(others.map(s => s.id));
    const step = others.length / BACKDROP_TARGET;
    const picked = [];
    for (let i = 0; i < BACKDROP_TARGET; i++) picked.push(others[Math.floor(i * step)]);
    return new Set(picked.map(s => s.id));
  }, [allSitesInScope]);

  // Only the 4 curated sites (CURATED_SITE_IDS) are treated as workable —
  // every OTHER real-"Permissioned" site's status is forced to "Not
  // permissioned" here (so the architect can't accidentally pick one of
  // the ~900 other real-permissioned sites), but backdrop-sample sites
  // keep their own real status/colour untouched for visual variety.
  const allSites = useMemo(
    () => allSitesInScope.map(s => {
      if (CURATED_SITE_IDS.includes(s.id)) return s;
      if (s.status !== 'Permissioned') return s; // already non-permissioned — keep real status/colour
      return { ...s, status: 'Not permissioned', colour: '#9e9a91' };
    }),
    [allSitesInScope]
  );

  // curatedIds = the 4 workable Permissioned sites — always shown.
  const { curatedIds, sizeTierById } = useMemo(() => {
    const permissioned = allSites.filter(s => s.status === 'Permissioned');
    const tierById = new Map();
    permissioned.forEach(s => tierById.set(s.id, sizeTierOf(s.hectares, permissioned)));
    return { curatedIds: new Set(permissioned.map(s => s.id)), sizeTierById: tierById };
  }, [allSites]);

  // Memoized so this 1720-site filter only re-runs when the filters or the
  // underlying data actually change, not on every unrelated re-render.
  const visibleSites = useMemo(() => allSites.filter(s => {
    if (statusFilter !== 'all' && s.status !== statusFilter) return false;
    if (tierFilter !== 'all') {
      const ha = s.hectares;
      if (tierFilter === 'pocket'   && ha >= 0.5)  return false;
      if (tierFilter === 'village'  && ha < 0.5)   return false;
    }
    return true;
  }), [allSites, statusFilter, tierFilter]);

  // What actually gets drawn as a map polygon: the 4 workable Permissioned
  // sites + the non-permissioned backdrop sample (real status colours, not
  // clickable into the pipeline), plus any other site the user has
  // explicitly opened from the list. Everything else stays list-only.
  const mapPolygonSites = useMemo(
    () => visibleSites.filter(s => curatedIds.has(s.id) || backdropIds.has(s.id) || revealedIds.has(s.id)),
    [visibleSites, curatedIds, backdropIds, revealedIds]
  );

  const handleSeedClick = useCallback((s) => {
    mapRef.current?.closePopup();
    setActiveSeed(s.id);
    if (!curatedIds.has(s.id)) {
      setRevealedIds(prev => prev.has(s.id) ? prev : new Set(prev).add(s.id));
    }

    const coords  = s.coords;
    const areaSqM = polyAreaSqM(coords);
    const bounds  = polyBounds(coords);
    const tier    = getSiteTier(areaSqM);

    setClickedSite({
      id: s.id,
      lat: s.lat, lng: s.lng,
      name: s.name, borough: s.borough,
      status: s.status,
      coords, areaSqM, tier,
      widthM: bounds.widthM,
      depthM: bounds.depthM,
      siteContext: s.siteContext || null,
    });
    setSiteAnalysis(analyseSiteEnv(s.lat, s.lng, coords));
  }, [curatedIds]);

  // ── Confirm ───────────────────────────────────────────────────
  // Only permissioned sites can proceed to masterplanning — others can be
  // viewed (polygon shown, details panel open) but not selected, since
  // there's no active consent to build on them yet.
  const canConfirm = !!clickedSite && clickedSite.status === 'Permissioned';
  const buildConfirmPayload = () => {
    if (!clickedSite) return null;
    const w = Math.min(2500, Math.max(24, clickedSite.widthM || 100));
    const d = Math.min(2500, Math.max(24, clickedSite.depthM || 100));
    let normPoly = null;
    let geoRef = null;
    if (clickedSite.coords?.length >= 3) {
      const lats = clickedSite.coords.map(p => p[0]);
      const lngs = clickedSite.coords.map(p => p[1]);
      const minLat = Math.min(...lats), maxLat = Math.max(...lats);
      const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
      const midLat = (minLat + maxLat) / 2;
      const lngScale = Math.cos(midLat * Math.PI / 180);
      const rLat = (maxLat - minLat) || 1;
      const rLng = ((maxLng - minLng) * lngScale) || 1;
      normPoly = clickedSite.coords.map(([lat, lng]) => ({
        x: ((lng - minLng) * lngScale) / rLng,
        z: (lat - minLat) / rLat,
      }));
      geoRef = { minLat, maxLat, minLng, maxLng, lngScale, rLat, rLng };
    }
    const siteGlbInfo = SITE_GLB[clickedSite.id] ?? null;
    return { widthM: w, depthM: d, glb: siteGlbInfo?.glb ?? null, buildingType: siteGlbInfo?.buildingType ?? null, sitePolygon: normPoly, analysis: siteAnalysis, siteContext: clickedSite.siteContext || null, siteId: clickedSite.id, geoRef, siteLat: clickedSite.lat, siteLng: clickedSite.lng, _rawSite: clickedSite };
  };

  const handleConfirm = () => {
    if (!canConfirm) return;
    const payload = buildConfirmPayload();
    if (!payload) return;
    // Go directly to App — SiteMassingView handles the map+massing step
    onConfirm(payload);
  };

  const activeSite = clickedSite || null;
  const hasSite = !!activeSite;


  return (
    <div className="site-picker sp-osm">
      <div className="sp-grain" />

      {/* Header — collapsed when site is selected */}
      <div className={`sp-top${clickedSite ? ' sp-top--collapsed' : ''}`}>
        {onBack && (
          <button className="sp-back-btn" onClick={onBack}>← Back to Overview</button>
        )}
        {!clickedSite && (
          <>
            <div className="sp-header">
              <div className="sp-header-kicker">01 / Select Site</div>
              <h1>Select a <em>brownfield site</em> in London</h1>
              <p>50 real brownfield sites · Instant offline boundaries · Scale classification</p>
            </div>

            {/* Status + scale filter */}
            <div className="sp-filters-row">
              <div className="sp-role-tabs">
                {[
                  { id: 'all',              label: 'All',             sub: `${allSites.length} sites` },
                  { id: 'Permissioned',     label: 'Permissioned',    sub: 'Active consent' },
                  { id: 'Pending',          label: 'Pending',         sub: 'In decision' },
                  { id: 'Not permissioned', label: 'No permission',   sub: 'Allocated' },
                  { id: 'Allocation',       label: 'Allocation',      sub: 'Plan-led' },
                ].map(r => (
                  <button
                    key={r.id}
                    className={`sp-role-tab ${statusFilter === r.id ? 'sp-role-tab--active' : ''}`}
                    style={{ '--role-colour': STATUS_COLORS[r.id] || '#f0ece2' }}
                    onClick={() => setStatusFilter(r.id)}
                  >
                    <span className="sp-role-tab-label">{r.label}</span>
                    <span className="sp-role-tab-sub">{r.sub}</span>
                  </button>
                ))}
              </div>
              <div className="sp-tier-filter">
                {[
                  { id: 'all',      label: 'All Scales' },
                  { id: 'pocket',   label: 'Pocket',   sub: '< 0.5 ha' },
                  { id: 'village',  label: 'Village',  sub: '0.5–2.5 ha' },
                ].map(t => (
                  <button
                    key={t.id}
                    className={`sp-tier-btn ${tierFilter === t.id ? 'sp-tier-btn--active' : ''}`}
                    onClick={() => setTierFilter(t.id)}
                  >
                    {t.label}
                    {t.sub && <span className="sp-tier-btn-sub">{t.sub}</span>}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Main content */}
      <div className="sp-body">

        {/* Map */}
        <div className="sp-map-wrap">
          <MapContainer
            center={[51.510, -0.060]}
            zoom={10}
            zoomControl={true}
            className="sp-osm-map"
            // Render the 100 site polygons on a single Canvas instead of 100
            // separate SVG DOM nodes — Leaflet redraws a canvas far cheaper
            // than reflowing/repainting hundreds of <path> elements on every
            // pan/zoom. Same visuals, dramatically smoother map interaction.
            preferCanvas={true}
          >
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
              maxZoom={19}
            />

            {/* Curated top-100 permissioned sites (25% small / 50% medium /
                25% big by area) + anything explicitly revealed from the list.
                Was all 1720 sites — that's what made the map laggy. */}
            {mapPolygonSites.map(s => (
              <SitePolygon
                key={s.id}
                site={s}
                isActive={activeSeed === s.id}
                onSelect={handleSeedClick}
              />
            ))}

            {/* Markers only for the same curated/revealed set */}
            {mapPolygonSites.map(s => (
              <Marker
                key={`m-${s.id}`}
                position={[s.lat, s.lng]}
                icon={createSiteIcon(s.colour, activeSeed === s.id)}
                eventHandlers={{ click: (e) => { L.DomEvent.stopPropagation(e); handleSeedClick(s); } }}
              >
                <Popup className="sp-popup">
                  <div className="sp-popup-inner">
                    <div className="sp-popup-name">{s.name}</div>
                    <div className="sp-popup-borough">{s.borough}</div>
                    <div className="sp-popup-row">
                      <span className="sp-popup-status" style={{ color: STATUS_COLORS[s.status] }}>{s.status}</span>
                      <span className="sp-popup-type">{s.area}</span>
                    </div>
                    <button
                      className="sp-popup-select"
                      style={{ borderColor: s.colour, color: s.colour }}
                      onClick={(e) => { e.stopPropagation(); handleSeedClick(s); }}
                    >
                      Select site →
                    </button>
                  </div>
                </Popup>
              </Marker>
            ))}

            <MapController target={activeSite} mapRef={mapRef} />

          </MapContainer>

          {/* Data loading overlay */}
          {dataLoading && (
            <div className="sp-click-hint">
              <div className="sp-click-hint-inner">
                <div>Loading 1,720 real brownfield sites from GLA register…</div>
              </div>
            </div>
          )}

          {/* Click hint */}
          {!hasSite && !dataLoading && (
            <div className="sp-click-hint">
              <div className="sp-click-hint-inner">
                <div>Click a site polygon on the map or select from the list →</div>
              </div>
            </div>
          )}

          {/* Legend */}
          <div className="sp-map-legend">
            {Object.entries(STATUS_COLORS).map(([label, color]) => (
              <div key={label} className="sp-legend-item">
                <span className="sp-legend-dot" style={{ background: color }} />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="sp-site-list">
          {clickedSite ? (
            /* ── Site selected: show confirm panel only ── */
            <div className="sp-confirm-panel">
              <button className="sp-confirm-back" onClick={() => setClickedSite(null)}>
                ← All sites
              </button>
              <div className="sp-confirm-scroll">
                <TierBadge tier={clickedSite.tier} />
                <div className="sp-confirm-info">
                  <div className="sp-confirm-name" style={{ color: clickedSite.tier.accent }}>
                    {clickedSite.name}
                  </div>
                  {clickedSite.borough && (
                    <div className="sp-confirm-borough">{clickedSite.borough}</div>
                  )}
                  <div className="sp-confirm-dims">
                    <span>{clickedSite.widthM}m × {clickedSite.depthM}m</span>
                    <span className="sp-confirm-dims-sep">·</span>
                    <span>{(clickedSite.areaSqM / 10000).toFixed(2)} ha</span>
                  </div>
                </div>
                <SiteAnalysisPanel analysis={siteAnalysis} />
                {!canConfirm && (
                  <div className="sp-confirm-blocked">
                    {clickedSite.status} — no active planning consent yet. This site can't be opened for masterplanning until permissioned.
                  </div>
                )}
              </div>
              <button
                className="sp-generate"
                onClick={handleConfirm}
                disabled={!canConfirm}
                title={canConfirm ? undefined : 'Only permissioned sites can be opened for masterplanning'}
              >
                {canConfirm ? 'Generate Masterplan →' : 'Not permissioned'}
              </button>
            </div>
          ) : (
            /* ── No site selected: show list ── */
            <>
              <div className="sp-list-header">
                <span className="sp-list-kicker">Brownfield Sites</span>
                <span className="sp-list-count">
                  {dataLoading ? '…' : `${mapPolygonSites.length} on map · ${visibleSites.length} / ${allSites.length} total`}
                </span>
              </div>
              <div className="sp-list-scroll">
                {dataLoading ? (
                  <div className="sp-list-loading">Loading GLA brownfield register…</div>
                ) : visibleSites.map((s, i) => {
                  const onMap = curatedIds.has(s.id) || revealedIds.has(s.id);
                  const tier = sizeTierById.get(s.id);
                  return (
                  <button
                    key={s.id}
                    className={`sp-list-item ${activeSeed === s.id ? 'sp-list-item--active' : ''} ${onMap ? '' : 'sp-list-item--inactive'}`}
                    style={{ '--site-colour': s.colour }}
                    onClick={() => handleSeedClick(s)}
                  >
                    <div className="sp-list-num">{String(i + 1).padStart(2, '0')}</div>
                    <div className="sp-list-body">
                      <div className="sp-list-name">{s.name}</div>
                      <div className="sp-list-borough">{s.borough}</div>
                      <div className="sp-list-meta">
                        <span className="sp-list-status" style={{ color: STATUS_COLORS[s.status] }}>{s.status}</span>
                        <span className="sp-list-dot">·</span>
                        <span className="sp-list-area">{s.area}</span>
                        {tier && (<><span className="sp-list-dot">·</span><span className="sp-list-tier">{tier}</span></>)}
                        {!onMap && (<><span className="sp-list-dot">·</span><span className="sp-list-not-on-map">not on map yet</span></>)}
                      </div>
                    </div>
                    <div className="sp-list-arrow">→</div>
                  </button>
                  );
                })}
              </div>
              <div className="sp-list-hint">
                {mapPolygonSites.length} curated sites shown on the map · click any list row to reveal more
              </div>
            </>
          )}
        </div>
      </div>

      {/* Massing step is now handled by SiteMassingView in App.jsx */}
    </div>
  );
}
