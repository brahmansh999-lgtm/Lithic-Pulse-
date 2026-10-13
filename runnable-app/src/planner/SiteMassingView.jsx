/**
 * SiteMassingView — site map showing clean site boundary, then flows to
 * Zoning → Massing → GLB → Masterplan.
 */
import { useState, useEffect, Suspense, lazy } from 'react';
import { MapContainer, TileLayer, Polygon, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import MassingStage from './MassingStage';
import ZoningPlan from './ZoningPlan';
import ColumnPlacementStage from './ColumnPlacementStage';
import GLBSiteView from './GLBSiteView';

// The unit configurator opens as an overlay from the 3D-fit stage's
// "View your individual home" dashboard — 3D-fit is now the terminal
// section of the pipeline (the old post-columns masterplanner is gone),
// so home selection + configuration happens right here.
const Configurator = lazy(() => import('../configurator/Configurator'));

const BUILDING_SIZES = {
  small:  { wM: 27, dM: 45, floors: 4, label: 'Small'  },
  medium: { wM: 52, dM: 44, floors: 6, label: 'Medium' },
  large:  { wM: 57, dM: 60, floors: 6, label: 'Large'  },
  xl:     { wM: 57, dM: 120,floors: 6, label: 'XL'     },
};

// Per-building-type programme footprint (plan view), derived from hand-drawn sketches.
// nx/nz = centre offset as fraction of building width/depth (+x=east, +z=north)
// nw/nd = box width/depth as fraction of building width/depth
const PROG_BOXES = {
  // ── MEDIUM: L-shaped units left+bottom, green top-right, semi-open centre-right, service core centre-left
  medium: [
    { type: 'units',    nx: -0.32, nz:  0.15, nw: 0.26, nd: 0.55 },  // left column, upper
    { type: 'units',    nx: -0.32, nz: -0.28, nw: 0.26, nd: 0.28 },  // left column, lower
    { type: 'units',    nx:  0.08, nz: -0.28, nw: 0.38, nd: 0.28 },  // bottom row, right
    { type: 'units',    nx: -0.08, nz: -0.28, nw: 0.14, nd: 0.28 },  // bottom row, centre
    { type: 'green',    nx:  0.28, nz:  0.22, nw: 0.30, nd: 0.40 },  // top-right communal/green
    { type: 'semiopen', nx:  0.22, nz: -0.04, nw: 0.20, nd: 0.22 },  // centre-right semi-open pocket
    { type: 'services', nx: -0.06, nz:  0.04, nw: 0.08, nd: 0.12 },  // service core centre-left
  ],

  // ── LARGE: corner units, large central green, 2 semi-open pockets, 2 service cores
  large: [
    { type: 'units',    nx: -0.35, nz:  0.32, nw: 0.26, nd: 0.30 },  // top-left unit block
    { type: 'units',    nx:  0.35, nz:  0.32, nw: 0.26, nd: 0.30 },  // top-right unit block
    { type: 'units',    nx: -0.35, nz: -0.32, nw: 0.26, nd: 0.30 },  // bottom-left unit block
    { type: 'units',    nx:  0.35, nz: -0.32, nw: 0.26, nd: 0.30 },  // bottom-right unit block
    { type: 'green',    nx: -0.08, nz:  0.08, nw: 0.38, nd: 0.50 },  // large central green (left-biased)
    { type: 'semiopen', nx:  0.12, nz:  0.25, nw: 0.16, nd: 0.16 },  // semi-open pocket top-centre
    { type: 'semiopen', nx:  0.12, nz: -0.10, nw: 0.16, nd: 0.16 },  // semi-open pocket mid-centre
    { type: 'services', nx: -0.35, nz:  0.08, nw: 0.07, nd: 0.10 },  // service core top-left edge
    { type: 'services', nx:  0.20, nz: -0.05, nw: 0.07, nd: 0.10 },  // service core centre-right
  ],

  // ── SMALL: compact linear — units either side, green strip centre, semi-open ends
  small: [
    { type: 'units',    nx: -0.30, nz:  0.00, nw: 0.32, nd: 0.70 },  // left block
    { type: 'units',    nx:  0.30, nz:  0.00, nw: 0.32, nd: 0.70 },  // right block
    { type: 'green',    nx:  0.00, nz:  0.10, nw: 0.22, nd: 0.45 },  // central green strip
    { type: 'semiopen', nx:  0.00, nz: -0.33, nw: 0.22, nd: 0.16 },  // semi-open south end
    { type: 'services', nx:  0.00, nz:  0.36, nw: 0.10, nd: 0.10 },  // service core north
  ],

  // ── XL: extended version of large — 6 unit blocks, wide central green spine, 3 cores
  xl: [
    { type: 'units',    nx: -0.35, nz:  0.40, nw: 0.26, nd: 0.18 },
    { type: 'units',    nx:  0.35, nz:  0.40, nw: 0.26, nd: 0.18 },
    { type: 'units',    nx: -0.35, nz:  0.00, nw: 0.26, nd: 0.28 },
    { type: 'units',    nx:  0.35, nz:  0.00, nw: 0.26, nd: 0.28 },
    { type: 'units',    nx: -0.35, nz: -0.38, nw: 0.26, nd: 0.18 },
    { type: 'units',    nx:  0.35, nz: -0.38, nw: 0.26, nd: 0.18 },
    { type: 'green',    nx:  0.00, nz:  0.20, nw: 0.36, nd: 0.40 },  // upper green court
    { type: 'green',    nx:  0.00, nz: -0.20, nw: 0.36, nd: 0.28 },  // lower green court
    { type: 'semiopen', nx:  0.00, nz:  0.42, nw: 0.20, nd: 0.10 },
    { type: 'semiopen', nx:  0.00, nz: -0.40, nw: 0.20, nd: 0.10 },
    { type: 'services', nx: -0.35, nz:  0.20, nw: 0.07, nd: 0.08 },
    { type: 'services', nx:  0.35, nz: -0.18, nw: 0.07, nd: 0.08 },
    { type: 'services', nx:  0.00, nz:  0.00, nw: 0.07, nd: 0.08 },
  ],
};

function pickBuildingType(widthM, depthM) {
  const area = widthM * depthM;
  if (area < 2500)  return 'small';
  if (area < 5000)  return 'medium';
  if (area < 10000) return 'large';
  return 'xl';
}

function MapFlyTo({ coords }) {
  const map = useMap();
  useEffect(() => {
    if (coords?.length >= 2) {
      map.flyToBounds(coords, { padding: [60, 60], duration: 0.9, maxZoom: 19 });
    }
  }, [coords, map]);
  return null;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function SiteMassingView({ site, siteBounds, buildingType: buildingTypeProp, onBack, onContinue }) {
  const [mode, setMode] = useState('map');
  const [configuratorOpen, setConfiguratorOpen] = useState(false);

  const coords = site?.coords ?? [];
  const buildingType = buildingTypeProp
    ?? (siteBounds ? pickBuildingType(siteBounds.widthM, siteBounds.depthM) : 'medium');
  const bld = BUILDING_SIZES[buildingType];

  const cLat = coords.length
    ? (Math.min(...coords.map(p => p[0])) + Math.max(...coords.map(p => p[0]))) / 2
    : 51.505;
  const cLng = coords.length
    ? (Math.min(...coords.map(p => p[1])) + Math.max(...coords.map(p => p[1]))) / 2
    : -0.09;

  if (mode === 'zoning') {
    return (
      <ZoningPlan
        buildingType={buildingType}
        siteName={site?.name}
        siteBounds={siteBounds}
        site={site}
        onBack={() => setMode('map')}
        onNext={() => setMode('3d')}
      />
    );
  }

  if (mode === '3d') {
    return (
      <MassingStage
        site={site}
        buildingType={buildingType}
        onBack={() => setMode('zoning')}
        onContinue={() => setMode('columns')}
      />
    );
  }

  if (mode === 'columns') {
    return (
      <ColumnPlacementStage
        site={site}
        buildingType={buildingType}
        onBack={() => setMode('3d')}
        onContinue={() => setMode('glb')}
      />
    );
  }

  if (mode === 'glb') {
    return (
      <>
        <GLBSiteView
          buildingType={buildingType}
          siteName={site?.name}
          site={site}
          siteBounds={siteBounds}
          onBack={() => setMode('columns')}
          onViewHome={() => setConfiguratorOpen(true)}
        />
        {configuratorOpen && (
          <Suspense fallback={null}>
            {/* Opened from "View your individual home" after 3D-Fit — skip the
                "Select Your Role" landing (step 0) and go straight to Configure
                with a default typology. */}
            <Configurator skipRoleSelect onClose={() => setConfiguratorOpen(false)} />
          </Suspense>
        )}
      </>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)', display: 'flex', flexDirection: 'column', zIndex: 800 }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        padding: '0.85rem 1.1rem',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        flexShrink: 0, background: 'var(--bg)', zIndex: 900,
      }}>
        <button onClick={onBack} style={{
          background: 'none', border: '1px solid rgba(255,255,255,0.18)',
          color: 'rgba(240,236,226,0.7)', fontFamily: 'JetBrains Mono, monospace',
          fontSize: '0.72rem', padding: '0.35rem 0.7rem', cursor: 'pointer', letterSpacing: '0.05em',
        }}>← BACK</button>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.08rem' }}>
          <span style={{ fontSize: '0.58rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(240,236,226,0.3)', fontFamily: 'JetBrains Mono, monospace' }}>
            01 / Site
          </span>
          <span style={{ fontSize: '0.82rem', color: 'var(--fg)', fontWeight: 400, fontFamily: 'JetBrains Mono, monospace' }}>
            {site?.name ?? 'Site'}&nbsp;
            <span style={{ color: 'rgba(240,236,226,0.35)', fontSize: '0.72rem' }}>
              · {siteBounds?.widthM ?? '?'}m × {siteBounds?.depthM ?? '?'}m
            </span>
          </span>
        </div>

        {/* Step trail — pipeline ends at Masterplanner (the 3D-fit stage, renamed) */}
        {['Site', 'Zoning', 'Massing', 'Columns', 'Masterplanner'].map((s, i) => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            {i > 0 && <div style={{ width: 16, height: 1, background: 'rgba(255,255,255,0.1)' }} />}
            <span style={{
              fontSize: '0.57rem', letterSpacing: '0.08em', textTransform: 'uppercase',
              fontFamily: 'JetBrains Mono, monospace',
              color: i === 0 ? 'var(--accent)' : 'rgba(240,236,226,0.22)',
              fontWeight: i === 0 ? 700 : 400,
              borderBottom: i === 0 ? '1px solid var(--accent)' : 'none',
              paddingBottom: i === 0 ? '1px' : '0',
            }}>{s}</span>
          </div>
        ))}

        <button onClick={() => setMode('zoning')} style={{
          background: 'var(--accent)', color: 'var(--bg)', border: 'none',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em',
          padding: '0.5rem 1rem', cursor: 'pointer', textTransform: 'uppercase',
        }}>ZONING →</button>
      </div>

      {/* Map — clean site boundary only */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <MapContainer
          center={[cLat, cLng]}
          zoom={16}
          style={{ width: '100%', height: '100%' }}
          zoomControl={false}
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
            maxZoom={22}
          />
          {coords.length >= 3 && (
            <Polygon
              positions={coords}
              pathOptions={{
                color: '#78c8a4', weight: 2.5, opacity: 0.9,
                fillColor: '#78c8a4', fillOpacity: 0.08,
              }}
            />
          )}
          <MapFlyTo coords={coords} />
        </MapContainer>

        {/* Site info badge */}
        <div style={{
          position: 'absolute', bottom: 24, left: 24, zIndex: 700,
          background: 'var(--bg-glass)', border: '1px solid rgba(255,255,255,0.10)',
          padding: '0.75rem 1rem', fontFamily: 'JetBrains Mono, monospace',
          backdropFilter: 'blur(8px)',
        }}>
          <div style={{ fontSize: '0.55rem', letterSpacing: '0.14em', color: 'rgba(240,236,226,0.3)', textTransform: 'uppercase', marginBottom: '0.35rem' }}>Selected Site</div>
          <div style={{ fontSize: '0.95rem', color: 'var(--fg)', fontWeight: 600 }}>{site?.name ?? '—'}</div>
          <div style={{ fontSize: '0.68rem', color: 'rgba(240,236,226,0.45)', marginTop: '0.2rem' }}>
            {siteBounds?.widthM ?? '?'}m × {siteBounds?.depthM ?? '?'}m · {bld.label} building
          </div>
        </div>
      </div>
    </div>
  );
}
