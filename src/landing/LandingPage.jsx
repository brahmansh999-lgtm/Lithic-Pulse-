import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import './LandingPage.css';

// Fix leaflet default icon paths (Vite/webpack asset issue)
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl:       'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl:     'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// ── Scroll reveal ─────────────────────────────────────────────────
function useReveal(delay = 0) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setTimeout(() => el.classList.add('lp-in'), delay); io.disconnect(); }
    }, { threshold: 0.1 });
    io.observe(el);
    return () => io.disconnect();
  }, [delay]);
  return ref;
}

// ── Animated counter ──────────────────────────────────────────────
function Counter({ to }) {
  const numeric = parseFloat(to);
  const isNum = !isNaN(numeric) && /^\d/.test(String(to));
  const [val, setVal] = useState(isNum ? 0 : to);
  const ref = useRef(null);
  useEffect(() => {
    if (!isNum) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        const start = performance.now();
        const dur = 1400;
        const step = (now) => {
          const k = Math.min(1, (now - start) / dur);
          const eased = 1 - Math.pow(1 - k, 3);
          setVal(numeric % 1 === 0 ? Math.round(eased * numeric) : (eased * numeric).toFixed(1));
          if (k < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
        io.disconnect();
      }
    }, { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, [isNum, numeric]);
  return <span ref={ref}>{val}</span>;
}

// ── Active-section tracking for the nav pills — real scroll-spy rather
// than a static list, so the nav reads current position like a drawing
// index rather than a decorative menu.
const NAV_SECTION_IDS = ['who', 'features', 'sites', 'pipeline', 'workflow'];
function useActiveSection(ids) {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    const observers = ids.map((id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const io = new IntersectionObserver(
        ([e]) => { if (e.isIntersecting) setActive(id); },
        { rootMargin: '-35% 0px -55% 0px', threshold: 0 }
      );
      io.observe(el);
      return io;
    });
    return () => observers.forEach((io) => io && io.disconnect());
  }, [ids]);
  return active;
}

// ── Ticker strip ──────────────────────────────────────────────────
function Ticker() {
  const items = [
    'Masterplanning', 'Unit Configurator', 'Bill of Materials',
    'Live OSM Sites', 'Architect Collaboration', 'AI Iteration',
    'Interior Design', 'Real Materials', 'Transparent Workflow',
  ];
  return (
    <div className="lp-ticker">
      <div className="lp-ticker-track">
        {[0, 1].map(k => (
          <span key={k}>
            {items.map(t => (
              <span key={t} className="lp-ticker-item">{t} <em>/</em></span>
            ))}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Brand mark — a tiny site-plan/massing-block cluster rendered as
// static inline SVG. Replaces the placeholder bordered-square-with-
// inner-square mark.
function BrandMark() {
  return (
    <svg className="lp-brand-mark" viewBox="0 0 26 26" width="26" height="26" aria-hidden="true">
      <rect x="0.5" y="0.5" width="25" height="25" fill="none" stroke="var(--accent)" strokeWidth="1" />
      {/* Asymmetric cluster of massing blocks, like a tiny site plan */}
      <rect x="4" y="14" width="6" height="8" fill="var(--accent)" opacity="0.85" />
      <rect x="11" y="9" width="5" height="13" fill="var(--accent)" opacity="0.55" />
      <rect x="17" y="16" width="5" height="6" fill="var(--accent)" opacity="0.3" />
      {/* Scan line accent */}
      <line x1="2" y1="6" x2="24" y2="6" stroke="var(--accent)" strokeWidth="0.75" opacity="0.4" />
    </svg>
  );
}

// ── London live project sites on OSM map ─────────────────────────
const LONDON_SITES = [
  { id: 1, lat: 51.5074, lng: -0.1278, name: 'Central London', borough: 'City of Westminster', type: 'Superblock', status: 'Planning', units: 48, colour: '#f0ece2' },
  { id: 2, lat: 51.5155, lng: -0.0922, name: 'Shoreditch', borough: 'Hackney', type: 'Corner Block', status: 'Design', units: 24, colour: '#7ec8a4' },
  { id: 3, lat: 51.4994, lng: -0.1726, name: 'Kensington', borough: 'RBKC', type: 'Infill Parcel', status: 'Construction', units: 16, colour: '#9b8ec4' },
  { id: 4, lat: 51.5246, lng: -0.0856, name: 'Hackney Wick', borough: 'Hackney', type: 'L-Shaped Block', status: 'Live', units: 62, colour: '#e07c6a' },
  { id: 5, lat: 51.4851, lng: -0.0619, name: 'Peckham', borough: 'Southwark', type: 'Wedge Lot', status: 'Design', units: 32, colour: '#5db8d4' },
  { id: 6, lat: 51.5416, lng: -0.1425, name: 'Islington', borough: 'Islington', type: 'Infill Parcel', status: 'Planning', units: 19, colour: '#f0ece2' },
];

const STATUS_COLOUR = { Live: '#8dab80', Construction: '#e0a060', Design: '#f0ece2', Planning: '#5a5750' };

function createSiteIcon(colour, status) {
  const outer = status === 'Live' ? '#8dab80' : colour;
  return L.divIcon({
    className: '',
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${outer};border:2px solid rgba(10,10,10,0.9);box-shadow:0 0 8px ${outer}88;"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -12],
  });
}

function OSMProjectMap({ onOpenPlanner }) {
  return (
    <div className="lp-osm-wrap">
      <div className="lp-osm-header">
        <span className="lp-live-dot lp-live-green" />
        <span>Live Project Sites — Greater London</span>
        <span className="lp-osm-count">{LONDON_SITES.length} active sites</span>
        <span className="lp-osm-click-hint">Click any site → Open in Planner</span>
      </div>
      <div className="lp-osm-map">
        <MapContainer
          center={[51.505, -0.09]}
          zoom={11}
          style={{ width: '100%', height: '100%' }}
          zoomControl={true}
          scrollWheelZoom={false}
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          />
          {LONDON_SITES.map(site => (
            <Marker
              key={site.id}
              position={[site.lat, site.lng]}
              icon={createSiteIcon(site.colour, site.status)}
            >
              <Popup className="lp-osm-popup">
                <div className="lp-popup-inner">
                  <div className="lp-popup-name">{site.name}</div>
                  <div className="lp-popup-borough">{site.borough}</div>
                  <div className="lp-popup-row">
                    <span className="lp-popup-type">{site.type}</span>
                    <span className="lp-popup-status" style={{ color: STATUS_COLOUR[site.status] }}>
                      {site.status}
                    </span>
                  </div>
                  <div className="lp-popup-units">{site.units} units planned</div>
                  <button className="lp-popup-open-btn" onClick={onOpenPlanner}>
                    Open in Masterplanner →
                  </button>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
      <div className="lp-osm-legend">
        {Object.entries(STATUS_COLOUR).map(([s, c]) => (
          <div key={s} className="lp-legend-item">
            <div className="lp-legend-dot" style={{ background: c }} />
            <span>{s}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Pipeline workflow diagram ─────────────────────────────────────
const PIPELINE_STEPS = [
  { num: '01', label: 'Site',         sub: 'Click map or OSM boundary', accent: '#f0ece2' },
  { num: '02', label: 'Masterplan',   sub: 'Algorithm generates layout + unit mix', accent: '#8dab80' },
  { num: '03', label: 'Configure',    sub: 'Furniture · materials · finishes', accent: '#88aacc' },
  { num: '04', label: 'Manufacture',  sub: 'Bill of materials · casting schedule', accent: '#e8e4da' },
  { num: '05', label: 'Export',       sub: 'Specification · delivery · handover', accent: '#a8a4a0' },
];

function PipelineDiagram({ onOpenPlanner }) {
  const ref = useReveal(0);
  return (
    <div className="lp-pipeline lp-reveal" ref={ref}>
      <div className="lp-pipeline-track">
        {PIPELINE_STEPS.map((s, i) => (
          <div key={s.num} className="lp-pipeline-step" onClick={onOpenPlanner} style={{ '--step-accent': s.accent }}>
            <div className="lp-pipeline-num">{s.num}</div>
            <div className="lp-pipeline-connector" aria-hidden="true">
              {i < PIPELINE_STEPS.length - 1 && <div className="lp-pipeline-arrow" />}
            </div>
            <div className="lp-pipeline-label">{s.label}</div>
            <div className="lp-pipeline-sub">{s.sub}</div>
            <div className="lp-pipeline-dot" style={{ background: s.accent }} />
          </div>
        ))}
      </div>
      <div className="lp-pipeline-cta">
        <button className="lp-btn-primary" onClick={onOpenPlanner}>
          Start with Site Selection →
        </button>
        <span className="lp-pipeline-note">No signup · free to use · runs in browser</span>
      </div>
    </div>
  );
}

// ── AI Interior Iteration Panel ───────────────────────────────────
const AI_INTERIOR_OPTIONS = [
  {
    id: 'opt_a',
    label: 'Option A — Warm Minimal',
    score: 92,
    tags: ['Walnut floors', 'Plaster walls', 'Natural light'],
    thumb: { bg: '#2a2018', accent: '#e8e4da', wall: '#ede9e0' },
    aiNote: 'Maximises perceived volume through light tonal palette. High biophilic score.',
  },
  {
    id: 'opt_b',
    label: 'Option B — Industrial Raw',
    score: 85,
    tags: ['Polished concrete', 'Exposed rebar', 'Dark steel'],
    thumb: { bg: '#1a1a22', accent: '#00e5cc', wall: '#2c2c3a' },
    aiNote: 'Appeals to young professional demographic. Lower material cost, high design impact.',
  },
  {
    id: 'opt_c',
    label: 'Option C — Scandinavian Light',
    score: 88,
    tags: ['White plaster', 'Oak accents', 'Terrazzo'],
    thumb: { bg: '#f5f0e8', accent: '#9b8ec4', wall: '#ffffff' },
    aiNote: 'Broadest market appeal. Neutral base allows personalisation by buyer.',
  },
];

function AIInteriorCard({ opt, selected, onSelect, architectPick }) {
  const ref = useReveal(0);
  return (
    <div
      className={`lp-ai-card lp-reveal ${selected ? 'lp-ai-card--selected' : ''} ${architectPick === opt.id ? 'lp-ai-card--architect' : ''}`}
      ref={ref}
      onClick={() => onSelect(opt.id)}
    >
      <div className="lp-ai-card-thumb" style={{ background: opt.thumb.bg }}>
        <div className="lp-ai-thumb-floor" style={{ background: opt.thumb.accent, opacity: 0.4 }} />
        <div className="lp-ai-thumb-wall"  style={{ background: opt.thumb.wall,   opacity: 0.15 }} />
        <div className="lp-ai-thumb-score">{opt.score}<span>/100</span></div>
      </div>
      <div className="lp-ai-card-body">
        <div className="lp-ai-card-label">{opt.label}</div>
        <div className="lp-ai-card-tags">
          {opt.tags.map(t => <span key={t} className="lp-ai-tag">{t}</span>)}
        </div>
        <p className="lp-ai-card-note">{opt.aiNote}</p>
        {architectPick === opt.id && (
          <div className="lp-ai-architect-badge">
            <span>✓</span> Architect's Choice
          </div>
        )}
      </div>
    </div>
  );
}

// Thumbnail palettes assigned to AI-generated options (the LLM returns
// materials + reasoning, not colours, so we theme the cards from this set).
const AI_THUMB_PALETTE = [
  { bg: '#2a2018', accent: '#e8e4da', wall: '#ede9e0' },
  { bg: '#1a1a22', accent: '#00e5cc', wall: '#2c2c3a' },
  { bg: '#f5f0e8', accent: '#9b8ec4', wall: '#ffffff' },
];

// Enumerable design directions — the same set the old free-text placeholder
// hinted at, now selectable directly so the control reads as choosing from a
// brief, not typing into a chat window.
const AI_DIRECTIONS = [
  'Warm industrial loft',
  'Japandi minimalism',
  'Bright family home',
  'Coastal modern',
  'Mid-century warm',
];

function ArchitectAIPanel({ onEnter }) {
  const [selectedOpt, setSelectedOpt] = useState(null);
  const [architectPick, setArchitectPick] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [direction, setDirection] = useState(null);
  const [refinement, setRefinement] = useState('');
  const [generatedOptions, setGeneratedOptions] = useState(AI_INTERIOR_OPTIONS);
  const [aiError, setAiError] = useState(null);
  const headerRef = useReveal(0);

  const handleGenerate = async () => {
    if (!direction || generating) return;
    const brief = refinement.trim() ? `${direction} — ${refinement.trim()}` : direction;
    setGenerating(true);
    setAiError(null);
    try {
      const resp = await fetch('/api/ai-design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `Request failed (${resp.status})`);
      // Map AI options into the card shape (add a thumbnail palette).
      const mapped = data.options.map((o, i) => ({
        ...o,
        thumb: AI_THUMB_PALETTE[i % AI_THUMB_PALETTE.length],
      }));
      setGeneratedOptions(mapped);
      setSelectedOpt(null);
      setArchitectPick(null);
    } catch (err) {
      setAiError(err?.message || String(err));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <section className="lp-architect" id="architect">
      <div className="lp-architect-header lp-reveal" ref={headerRef}>
        <div className="lp-kicker">04 / Architect View</div>
        <h2 className="lp-section-h">
          AI generates.<br /><em>Architects decide.</em>
        </h2>
        <p className="lp-section-body">
          The AI produces multiple interior configurations for each unit typology — material palettes,
          furniture layouts, environmental scores. Architects review every option and approve the direction.
        </p>
      </div>

      <div className="lp-ai-prompt-row">
        <div className="lp-ai-prompt-label">
          <span className="lp-live-dot" />
          Choose a design direction
        </div>
        <div className="lp-ai-chip-row">
          {AI_DIRECTIONS.map(d => (
            <button
              key={d}
              className={`lp-ai-chip ${direction === d ? 'lp-ai-chip--active' : ''}`}
              onClick={() => setDirection(d)}
            >{d}</button>
          ))}
        </div>
        <div className="lp-ai-prompt-input-wrap">
          <input
            className="lp-ai-prompt-input"
            type="text"
            placeholder="Optional refinement — materials, mood, constraints…"
            value={refinement}
            onChange={e => setRefinement(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleGenerate()}
          />
          <button
            className="lp-ai-generate-btn"
            onClick={handleGenerate}
            disabled={generating || !direction}
          >
            {generating ? 'Generating…' : 'Generate Options →'}
          </button>
        </div>
        {aiError && (
          <div style={{ marginTop: 8, fontSize: '0.72rem', color: '#e0806a' }}>
            {aiError}
          </div>
        )}
      </div>

      <div className="lp-ai-cards">
        {generatedOptions.map(opt => (
          <AIInteriorCard
            key={opt.id}
            opt={opt}
            selected={selectedOpt === opt.id}
            onSelect={setSelectedOpt}
            architectPick={architectPick}
          />
        ))}
      </div>

      <div className="lp-ai-approve-row">
        {selectedOpt ? (
          <>
            <div className="lp-ai-approve-hint">
              You've selected <strong>{generatedOptions.find(o => o.id === selectedOpt)?.label}</strong>.
              Approve as the architect to set it as the project configuration.
            </div>
            <button
              className="lp-ai-approve-btn"
              onClick={() => setArchitectPick(selectedOpt)}
            >
              ✓ Approve as Architect's Choice
            </button>
          </>
        ) : (
          <div className="lp-ai-approve-hint">
            Click an option above to select it, then approve as architect.
          </div>
        )}
        {architectPick && (
          <div className="lp-ai-approved-badge">
            <span className="lp-live-dot lp-live-green" />
            Configuration locked — {generatedOptions.find(o => o.id === architectPick)?.label}
          </div>
        )}
        <button className="lp-role-open-btn" onClick={() => onEnter('architect')}>
          Open Architect View in Planner →
        </button>
      </div>
    </section>
  );
}

// ── Home Owner Dashboard Panel ─────────────────────────────────────
const HOMEOWNER_UNITS = [
  { site: 'Hackney Wick',  unit: 'B-04 · 2B4P', status: 'Configuring',  pct: 65, colour: '#8dab80' },
  { site: 'Canada Water',  unit: 'A-12 · 1B2P', status: 'Reserved',     pct: 100, colour: '#f0ece2' },
  { site: 'Canning Town',  unit: 'C-07 · 3B5P', status: 'In Design',    pct: 30, colour: '#60a5fa' },
  { site: 'Woolwich',      unit: 'D-02 · 2B3P', status: 'Under Offer',  pct: 80, colour: '#e0a060' },
  { site: 'Nine Elms',     unit: 'A-19 · 1B1P', status: 'Enquiry',      pct: 10, colour: '#5a5750' },
];

function HomeOwnerPanel({ onEnter }) {
  const ref = useReveal(0);
  return (
    <section className="lp-role-section lp-reveal" id="homeowners" ref={ref}>
      <div className="lp-role-header">
        <div className="lp-kicker">05 / Home Owner View</div>
        <h2 className="lp-section-h">Your home,<br /><em>your decisions.</em></h2>
        <p className="lp-section-body">
          Browse real units on real sites. Configure your layout, choose your materials,
          and see exactly what you're buying — before anything is built.
        </p>
      </div>
      <div className="lp-role-panel">
        <div className="lp-role-panel-header">
          <span className="lp-live-dot lp-live-green" />
          Your Units
          <span className="lp-role-panel-count">{HOMEOWNER_UNITS.length} properties</span>
        </div>
        <div className="lp-role-table">
          <div className="lp-role-table-head">
            <span>Site</span><span>Unit</span><span>Status</span><span>Progress</span>
          </div>
          {HOMEOWNER_UNITS.map(s => (
            <div key={s.unit} className="lp-role-table-row">
              <span className="lp-role-site">{s.site}</span>
              <span className="lp-role-units" style={{ fontFamily: 'var(--mono)', fontSize: '0.62rem' }}>{s.unit}</span>
              <span className="lp-role-status" style={{ color: s.colour }}>{s.status}</span>
              <div className="lp-role-bar-wrap">
                <div className="lp-role-bar" style={{ width: `${s.pct}%`, background: s.colour }} />
                <span className="lp-role-bar-pct">{s.pct}%</span>
              </div>
            </div>
          ))}
        </div>
        <div className="lp-role-panel-foot">
          <button className="lp-role-open-btn" onClick={() => onEnter('homeowner')}>Configure Your Home →</button>
          <span className="lp-pipeline-note">Floor plan · Materials · Finishes · Live pricing</span>
        </div>
      </div>
    </section>
  );
}

// ── Manufacturer Dashboard Panel ───────────────────────────────────
const MFG_ITEMS = [
  { part: 'Column Shaft (COLMOL0-A)', qty: 144, ready: 112, unit: 'no.', colour: '#a8a4a0' },
  { part: 'Slab Deck Panel',          qty: 576, ready: 440, unit: 'no.', colour: '#c8c4be' },
  { part: 'Solid Wall Panel',         qty: 432, ready: 310, unit: 'no.', colour: '#c8c4be' },
  { part: 'Glazed Window Panel',      qty: 288, ready: 180, unit: 'no.', colour: '#88aacc' },
  { part: 'Marble Dust',              qty: 9840, ready: 7200, unit: 'kg', colour: '#e8e4da' },
  { part: 'GGBS Binder',             qty: 3936, ready: 2900, unit: 'kg', colour: '#8898b0' },
];

function ManufacturerPanel({ onEnter }) {
  const ref = useReveal(0);
  return (
    <section className="lp-role-section lp-reveal" id="manufacturers" ref={ref}>
      <div className="lp-role-header">
        <div className="lp-kicker">06 / Manufacturer View</div>
        <h2 className="lp-section-h">Live quantities.<br /><em>Zero estimation.</em></h2>
        <p className="lp-section-body">
          The bill of materials updates the moment an architect finalises a unit. Precast components,
          geopolymer mix ratios, casting schedules — all calculated from real design data.
        </p>
      </div>
      <div className="lp-role-panel">
        <div className="lp-role-panel-header">
          <span className="lp-live-dot" style={{ background: '#e8e4da' }} />
          Production Status — All Sites
          <span className="lp-role-panel-count">6 component types</span>
        </div>
        <div className="lp-role-table">
          <div className="lp-role-table-head">
            <span>Component</span><span>Required</span><span>Cast</span><span>Completion</span>
          </div>
          {MFG_ITEMS.map(m => {
            const pct = Math.round((m.ready / m.qty) * 100);
            return (
              <div key={m.part} className="lp-role-table-row">
                <span className="lp-role-site" style={{ color: m.colour }}>{m.part}</span>
                <span className="lp-role-units">{m.qty} {m.unit}</span>
                <span className="lp-role-units" style={{ color: m.colour }}>{m.ready}</span>
                <div className="lp-role-bar-wrap">
                  <div className="lp-role-bar" style={{ width: `${pct}%`, background: m.colour }} />
                  <span className="lp-role-bar-pct">{pct}%</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="lp-role-panel-foot">
          <button className="lp-role-open-btn" onClick={() => onEnter('manufacturer')}>Open Manufacturer Dashboard →</button>
          <span className="lp-pipeline-note">Geopolymer mix · Mould schedule · Delivery order</span>
        </div>
      </div>
    </section>
  );
}

// ── Data ──────────────────────────────────────────────────────────
const STATS = [
  { num: '7',   label: 'Unit typologies' },
  { num: '70',  label: 'Furniture items', suffix: '+' },
  { num: '4',   label: 'Live London sites' },
  { num: '∞',   label: 'Plan variations' },
];

const FEATURES = [
  {
    num: '01', label: 'Masterplanning',
    title: 'Generate a full site layout in seconds.',
    body: 'Drop a site boundary. The algorithm generates an optimised building layout with unit mix, floor counts, and solar orientation — instantly. Adjust any parameter and the plan updates in real time.',
    pills: ['5 site shapes', 'Auto unit mix', 'Solar analysis', 'Unlimited seeds'],
    glyph: '⬡',
  },
  {
    num: '02', label: 'Unit Configurator',
    title: 'Configure every room. Every detail.',
    body: 'Drag and drop 70+ furniture items. Choose real materials and finishes. See exactly how each unit looks before anything is built. Then hand it straight to your builder.',
    pills: ['8 typologies', '70+ items', 'Real finishes', 'Drag & drop'],
    glyph: '⊞',
  },
  {
    num: '03', label: 'Bill of Materials',
    title: 'Know exactly what you need to build.',
    body: 'Every design decision feeds a live bill of materials. Cement, basalt fibre, marble dust, water — calculated automatically. No estimates. No surprises.',
    pills: ['Live quantities', 'Material composition', 'Assembly sequence', 'Export ready'],
    glyph: '≡',
  },
];

const STEPS = [
  { num: '01', title: 'Find your site', body: 'See active project sites across London on the live map. Pick a real boundary or define your own.' },
  { num: '02', title: 'Generate the masterplan', body: 'The algorithm instantly produces an optimised layout with unit mix and floor count.' },
  { num: '03', title: 'AI interior iterations', body: 'AI proposes multiple interior options. Architects review and approve the direction.' },
  { num: '04', title: 'Configure each unit', body: 'Open any unit, place furniture, choose materials, see the real thing.' },
  { num: '05', title: 'Share with your team', body: 'Builder and manufacturer see the same data — live, transparent, no middleman.' },
];

// ── SVG architectural diagrams for Feature section ────────────────
function DiagramSiteGrid() {
  const cols = 8, rows = 5;
  const cw = 44, rh = 36;
  const W = cols * cw, H = rows * rh;
  // Building footprints
  const buildings = [
    { x: 0, y: 0, w: 3, h: 2, type: 'tower' },
    { x: 4, y: 0, w: 4, h: 1, type: 'lr' },
    { x: 0, y: 3, w: 2, h: 2, type: 'lr' },
    { x: 3, y: 2, w: 3, h: 3, type: 'tower' },
    { x: 6, y: 2, w: 2, h: 2, type: 'lr' },
    { x: 4, y: 1, w: 2, h: 1, type: 'lr' },
  ];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="lp-diagram" xmlns="http://www.w3.org/2000/svg">
      {/* Grid */}
      {Array.from({ length: cols + 1 }).map((_, i) => (
        <line key={`vc${i}`} x1={i * cw} y1={0} x2={i * cw} y2={H} stroke="rgba(10,10,10,0.07)" strokeWidth="0.5" />
      ))}
      {Array.from({ length: rows + 1 }).map((_, i) => (
        <line key={`hr${i}`} x1={0} y1={i * rh} x2={W} y2={i * rh} stroke="rgba(10,10,10,0.07)" strokeWidth="0.5" />
      ))}
      {/* Buildings */}
      {buildings.map((b, i) => (
        <g key={i}>
          <rect
            x={b.x * cw + 2} y={b.y * rh + 2}
            width={b.w * cw - 4} height={b.h * rh - 4}
            fill={b.type === 'tower' ? 'rgba(10,10,10,0.14)' : 'rgba(10,10,10,0.07)'}
            stroke={b.type === 'tower' ? 'rgba(10,10,10,0.7)' : 'rgba(10,10,10,0.35)'}
            strokeWidth="0.8"
          />
          {b.type === 'tower' && (
            <text
              x={b.x * cw + b.w * cw / 2} y={b.y * rh + b.h * rh / 2 + 4}
              textAnchor="middle" fill="rgba(10,10,10,0.5)"
              fontSize="9" fontFamily="monospace" letterSpacing="1"
            >T{i + 1}</text>
          )}
        </g>
      ))}
      {/* Road axis */}
      <line x1={2 * cw} y1={0} x2={2 * cw} y2={H} stroke="rgba(10,10,10,0.18)" strokeWidth="1" strokeDasharray="4 4" />
      <line x1={0} y1={2 * rh} x2={W} y2={2 * rh} stroke="rgba(10,10,10,0.18)" strokeWidth="1" strokeDasharray="4 4" />
      {/* North indicator */}
      <text x={W - 14} y={14} textAnchor="middle" fill="rgba(10,10,10,0.6)" fontSize="9" fontFamily="monospace">N</text>
      <line x1={W - 14} y1={17} x2={W - 14} y2={26} stroke="rgba(10,10,10,0.6)" strokeWidth="1" />
    </svg>
  );
}

function DiagramFloorPlan() {
  const W = 352, H = 220;
  const rooms = [
    { x: 8, y: 8, w: 160, h: 100, label: 'Living / Dining' },
    { x: 176, y: 8, w: 80, h: 100, label: 'Kitchen' },
    { x: 264, y: 8, w: 80, h: 100, label: 'Bed 1' },
    { x: 8, y: 116, w: 120, h: 96, label: 'Bed 2' },
    { x: 136, y: 116, w: 80, h: 96, label: 'Bath' },
    { x: 224, y: 116, w: 120, h: 96, label: 'Study' },
  ];
  // Furniture sketches
  const furniture = [
    { x: 16, y: 20, w: 64, h: 38, label: 'Sofa' },
    { x: 88, y: 28, w: 48, h: 28, label: 'Table' },
    { x: 272, y: 20, w: 60, h: 44, label: 'Bed' },
    { x: 16, y: 130, w: 60, h: 44, label: 'Bed' },
  ];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="lp-diagram" xmlns="http://www.w3.org/2000/svg">
      {/* Rooms */}
      {rooms.map((r, i) => (
        <g key={i}>
          <rect x={r.x} y={r.y} width={r.w} height={r.h}
            fill="rgba(10,10,10,0.04)" stroke="rgba(10,10,10,0.5)" strokeWidth="1" />
          <text x={r.x + r.w / 2} y={r.y + 13}
            textAnchor="middle" fill="rgba(10,10,10,0.4)"
            fontSize="8" fontFamily="monospace" letterSpacing="0.5">{r.label}</text>
        </g>
      ))}
      {/* Furniture */}
      {furniture.map((f, i) => (
        <rect key={i} x={f.x} y={f.y} width={f.w} height={f.h}
          fill="rgba(10,10,10,0.05)" stroke="rgba(10,10,10,0.2)" strokeWidth="0.6" rx="1" />
      ))}
      {/* Door swings */}
      <path d="M 176 116 A 20 20 0 0 1 196 96" fill="none" stroke="rgba(10,10,10,0.3)" strokeWidth="0.6" />
      <path d="M 136 116 A 20 20 0 0 0 116 96" fill="none" stroke="rgba(10,10,10,0.3)" strokeWidth="0.6" />
    </svg>
  );
}

function DiagramBOM() {
  const rows = [
    { cat: 'Structural', item: 'Column shaft (COLMOL0-A)', qty: '12', unit: 'no.' },
    { cat: 'Structural', item: 'Slab deck panel',          qty: '48', unit: 'no.' },
    { cat: 'Envelope',   item: 'Solid wall panel',         qty: '36', unit: 'no.' },
    { cat: 'Envelope',   item: 'Window panel (glazed)',    qty: '24', unit: 'no.' },
    { cat: 'Openings',   item: 'Door panel',               qty: '8',  unit: 'no.' },
    { cat: 'Fitout',     item: 'Marble dust',              qty: '820', unit: 'kg' },
    { cat: 'Fitout',     item: 'GGBS binder',              qty: '328', unit: 'kg' },
  ];
  const CAT_C = { Structural: '#a8a4a0', Envelope: '#c8c4be', Openings: '#88aacc', Fitout: '#e8e4da' };
  return (
    <svg viewBox="0 0 352 220" className="lp-diagram" xmlns="http://www.w3.org/2000/svg">
      {/* Header */}
      <rect x={0} y={0} width={352} height={22} fill="rgba(10,10,10,0.04)" />
      {['Category','Component','Qty','Unit'].map((h, i) => (
        <text key={h}
          x={[8, 88, 280, 316][i]} y={14}
          fill="rgba(10,10,10,0.55)" fontSize="8" fontFamily="monospace" letterSpacing="0.8"
        >{h.toUpperCase()}</text>
      ))}
      <line x1={0} y1={22} x2={352} y2={22} stroke="rgba(10,10,10,0.12)" strokeWidth="0.5" />
      {/* Rows */}
      {rows.map((r, i) => {
        const y = 22 + i * 28;
        const c = CAT_C[r.cat] || '#e8e4da';
        return (
          <g key={i}>
            <rect x={0} y={y} width={352} height={28}
              fill={i % 2 === 0 ? 'rgba(10,10,10,0.015)' : 'transparent'} />
            <rect x={6} y={y + 10} width={4} height={8} fill={c} opacity={0.7} />
            <text x={16} y={y + 18} fill={`${c}88`} fontSize="8" fontFamily="monospace">{r.cat}</text>
            <text x={88} y={y + 18} fill="rgba(10,10,10,0.7)" fontSize="9" fontFamily="monospace">{r.item}</text>
            <text x={280} y={y + 18} fill={c} fontSize="10" fontFamily="monospace" fontWeight="bold">{r.qty}</text>
            <text x={316} y={y + 18} fill="rgba(10,10,10,0.4)" fontSize="8" fontFamily="monospace">{r.unit}</text>
            <line x1={0} y1={y + 28} x2={352} y2={y + 28} stroke="rgba(10,10,10,0.05)" strokeWidth="0.5" />
          </g>
        );
      })}
    </svg>
  );
}

const FEATURE_DIAGRAMS = [DiagramSiteGrid, DiagramFloorPlan, DiagramBOM];

function FeatureRow({ f, i }) {
  const textRef = useReveal(0);
  const visRef  = useReveal(120);
  const Diagram = FEATURE_DIAGRAMS[i] ?? DiagramSiteGrid;
  return (
    <div className={`lp-feature ${i % 2 === 1 ? 'lp-feature--flip' : ''}`}>
      <div className="lp-feature-text lp-reveal" ref={textRef}>
        <div className="lp-feature-label">
          <span className="lp-feature-idx">{f.num}</span>
          <span className="lp-feature-cat">{f.label}</span>
        </div>
        <h3 className="lp-feature-title">{f.title}</h3>
        <p className="lp-feature-body">{f.body}</p>
        <div className="lp-pills">{f.pills.map(p => <span className="lp-pill" key={p}>{p}</span>)}</div>
      </div>
      <div className="lp-feature-vis lp-reveal" ref={visRef}>
        <div className="lp-diagram-wrap">
          <Diagram />
        </div>
      </div>
    </div>
  );
}

function StepItem({ s }) {
  const ref = useReveal(0);
  return (
    <div className="lp-step lp-reveal" ref={ref}>
      <div className="lp-step-num">{s.num}</div>
      <div className="lp-step-rule" />
      <h4 className="lp-step-title">{s.title}</h4>
      <p className="lp-step-body">{s.body}</p>
    </div>
  );
}

// ── Role Cards — 4 minimal cards for main roles ──────────────
const ROLE_CARDS = [
  {
    id: 'homeowner',
    num: '01',
    label: 'Home Owner',
    title: 'Design your home\nbefore it exists.',
    desc: 'Browse real units on live London sites. Configure your floor plan, choose materials, set finishes — before a single brick is laid.',
    bullets: ['Arrange furniture in your actual floor plan', 'Pick real materials and finishes visually', 'Share your design directly with your builder'],
    status: 'Active · Live sites',
    metrics: [{ label: 'Units live', val: '24' }, { label: 'Sites', val: '6' }, { label: 'Avg session', val: '48 min' }],
    cta: 'Configure Your Home →',
  },
  {
    id: 'architect',
    num: '02',
    label: 'Architect',
    title: 'AI generates.\nYou decide.',
    desc: 'The AI produces multiple interior configurations per unit typology. Architects review every option and approve the design direction.',
    bullets: ['AI generates multiple interior options per unit', 'Approve the best fit for the brief', 'Design intent locks into every unit automatically'],
    status: 'All sites · Full access',
    metrics: [{ label: 'Active sites', val: '12' }, { label: 'Variations', val: '∞' }, { label: 'AI options', val: '3 / unit' }],
    cta: 'Open Architect View →',
  },
  {
    id: 'developer',
    num: '03',
    label: 'Developer',
    title: 'Full site.\nLive numbers.',
    desc: 'Generate masterplans across multiple sites simultaneously. Track unit mix, floor counts, and GIA in real time.',
    bullets: ['Generate and compare multiple masterplan seeds', 'Track unit mix and GIA across the site', 'Export planning-ready data at any stage'],
    status: 'All sites · Full access',
    metrics: [{ label: 'Sites tracked', val: '50' }, { label: 'Total units', val: '1,240' }, { label: 'Avg GIA', val: '8,400 m²' }],
    cta: 'Open Developer Dashboard →',
  },
  {
    id: 'manufacturer',
    num: '04',
    label: 'Manufacturer',
    title: 'Live BOM.\nZero estimation.',
    desc: 'Bill of materials updates the moment an architect finalises a unit. Precast components, mix ratios, casting schedules — from real data.',
    bullets: ['Live quantities as architects finalise units', 'Casting schedule by component type', 'Material passports for every element'],
    status: 'Live sites only',
    metrics: [{ label: 'Components', val: '576' }, { label: 'Cast', val: '440' }, { label: 'Lead time', val: '6 wk' }],
    cta: 'Open Manufacturer Dashboard →',
  },
];

function RoleCard({ card, onEnter, index }) {
  const reveal = useReveal(index * 60);
  const cardRef = useRef(null);
  const setRefs = (el) => { cardRef.current = el; reveal.current = el; };

  // Subtle cursor-tracked tilt + spotlight — the same real-3D vocabulary as
  // the hero's turning precast module, applied here as interaction rather
  // than ambient motion.
  const handleMove = (e) => {
    const el = cardRef.current;
    if (!el || window.matchMedia('(pointer: coarse)').matches) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    const rx = (0.5 - py) * 5;
    const ry = (px - 0.5) * 7;
    el.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-2px)`;
    el.style.setProperty('--mx', `${px * 100}%`);
    el.style.setProperty('--my', `${py * 100}%`);
  };
  const handleLeave = () => {
    const el = cardRef.current;
    if (el) el.style.transform = '';
  };

  return (
    <div
      className="rc-card lp-reveal"
      ref={setRefs}
      onClick={() => onEnter(card.id)}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
    >
      <div className="rc-head">
        <span className="rc-num">{card.num}</span>
        <span className="rc-status">{card.status}</span>
      </div>

      <div className="rc-label">{card.label}</div>

      <h3 className="rc-title">
        {card.title.split('\n').map((line, i, arr) => (
          <span key={i}>{line}{i < arr.length - 1 && <br />}</span>
        ))}
      </h3>

      <p className="rc-desc">{card.desc}</p>

      <div className="rc-divider" />

      <div className="rc-metrics">
        {card.metrics.map(m => (
          <div key={m.label} className="rc-metric">
            <div className="rc-metric-val">{m.val}</div>
            <div className="rc-metric-label">{m.label}</div>
          </div>
        ))}
      </div>

      <ul className="rc-bullets">
        {card.bullets.map((b, i) => (
          <li key={i} className="rc-bullet">— {b}</li>
        ))}
      </ul>

      <div className="rc-cta-wrap">
        <button className="rc-cta" onClick={e => { e.stopPropagation(); onEnter(card.id); }}>
          {card.cta}
        </button>
      </div>
    </div>
  );
}

function RoleCards({ onEnter }) {
  const headerRef = useReveal(0);
  return (
    <div className="lp-section rc-section" id="who">
      <div className="lp-section-label lp-reveal" ref={headerRef}>
        <span className="lp-section-num">01</span>
        <span className="lp-section-rule" />
        <span className="lp-section-tag">Who it's for</span>
      </div>
      <div style={{ marginBottom: 48 }}>
        <h2 className="lp-section-h2">One platform. <em>Four roles.</em></h2>
        <p className="lp-section-body" style={{ marginTop: 12 }}>
          Housing delivery is fragmented. Lithic Pulse connects every stakeholder into one live, transparent workflow.
        </p>
      </div>
      <div className="rc-grid">
        {ROLE_CARDS.map((card, i) => (
          <RoleCard key={card.id} card={card} onEnter={onEnter} index={i} />
        ))}
      </div>
    </div>
  );
}

// ── Role Picker Modal ─────────────────────────────────────────────
const ROLE_PICKER_OPTIONS = [
  {
    id: 'architect',
    label: 'Architect',
    sub: 'Generate masterplans · approve AI iterations · design full sites',
    accent: '#f0ece2',
  },
  {
    id: 'developer',
    label: 'Developer',
    sub: 'Compare plans across sites · track unit mix · export planning data',
    accent: '#8dab80',
  },
  {
    id: 'homeowner',
    label: 'Home Owner',
    sub: 'Configure your unit · pick materials · arrange furniture',
    accent: '#88aacc',
  },
  {
    id: 'manufacturer',
    label: 'Manufacturer',
    sub: 'Live BOM · casting schedules · component quantities',
    accent: '#e8a94a',
  },
  {
    id: 'resident',
    label: 'Resident',
    sub: 'Explore life in a Lithic Pulse community through resident stories',
    accent: '#9b8ec4',
  },
];

function RolePickerModal({ onEnter, onClose }) {
  return (
    <div className="rp-overlay" onClick={onClose}>
      <div className="rp-modal" onClick={e => e.stopPropagation()}>
        <button className="rp-close" onClick={onClose}>✕</button>
        <div className="rp-kicker">Select your role</div>
        <h2 className="rp-heading">Who are you?</h2>
        <p className="rp-sub">Choose your entry point — you can switch at any time.</p>
        <div className="rp-list">
          {ROLE_PICKER_OPTIONS.map(r => (
            <button
              key={r.id}
              className="rp-item"
              style={{ '--rp-accent': r.accent }}
              onClick={() => onEnter(r.id)}
            >
              <span className="rp-item-dot" />
              <div className="rp-item-body">
                <span className="rp-item-label">{r.label}</span>
                <span className="rp-item-sub">{r.sub}</span>
              </div>
              <span className="rp-item-arrow">→</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main Landing Page ─────────────────────────────────────────────
export default function LandingPage({ onEnter }) {
  const [showRolePicker, setShowRolePicker] = useState(false);
  const r1   = useReveal(0);
  const r2   = useReveal(80);
  const r3   = useReveal(160);
  const r3b  = useReveal(200);
  const r4   = useReveal(240);
  const r6   = useReveal(0);
  const r7   = useReveal(0);
  const r9   = useReveal(0);
  const r10  = useReveal(0);
  const rMap = useReveal(0);
  const activeSection = useActiveSection(NAV_SECTION_IDS);
  const navCtaRef = useRef(null);
  const heroCtaRef = useRef(null);
  const finalCtaRef = useRef(null);

  const openRolePicker = () => setShowRolePicker(true);
  const handleRoleSelect = (role) => { setShowRolePicker(false); onEnter(role); };

  return (
    <div className="lp">
      {showRolePicker && <RolePickerModal onEnter={handleRoleSelect} onClose={() => setShowRolePicker(false)} />}

      {/* ── Nav — pill tabs ── */}
      <nav className="lp-nav">
        <div className="lp-brand">
          <BrandMark />
          <div className="lp-brand-text">
            <span className="lp-brand-name">Lithic Pulse</span>
            <span className="lp-brand-tag">Masterplanner v2</span>
          </div>
        </div>
        <ul className="lp-nav-pills">
          {[
            ['who', 'Roles'],
            ['features', 'Features'],
            ['sites', 'Sites'],
            ['pipeline', 'Pipeline'],
            ['workflow', 'How it works'],
          ].map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className={activeSection === id ? 'lp-nav-pill-active' : ''}>{label}</a>
            </li>
          ))}
        </ul>
        <div className="lp-nav-right">
          <span className="lp-version-badge">01 · London · 50 sites</span>
          <button className="lp-nav-cta" ref={navCtaRef} onClick={openRolePicker}>Launch →</button>
        </div>
      </nav>

      {/* ── Hero — full-bleed marble, text column constrained inside ── */}
      <section className="lp-hero">
        <div className="lp-hero-inner">
          <div className="lp-hero-system-tag lp-reveal" ref={r1}>
            <span className="lp-dot lp-dot--red" />
            <span>Platform</span>
            <span className="lp-sys-pipe">|</span>
            <span>London Brownfield</span>
            <span className="lp-sys-pipe">|</span>
            <span>50 sites active</span>
          </div>

          <div className="lp-hero-lockup lp-reveal" ref={r2}>
            <span className="lp-hero-number-sub">Introducing the new age of stone housing</span>
            <span className="lp-hero-number">Lithic Pulse</span>
          </div>
        </div>
      </section>

      {/* ── Ticker ── */}
      <Ticker />

      {/* ── Workflow statement — moved out of the hero so the "Why cast
          stone?" line and the turning precast mark get the hero to
          themselves, and this gets its own considered moment lower down. */}
      <section className="lp-intro">
        <h1 className="lp-hero-h1 lp-reveal" ref={r3}>
          <strong>Site to specification.</strong><br />
          <em>Masterplan to handover.</em><br />
          One connected workflow.
        </h1>

        <p className="lp-hero-sub lp-reveal" ref={r3b}>
          Generate masterplans. AI proposes interiors. Architects approve.
          Home owners configure. Manufacturers produce. All in one live system.
        </p>

        <div className="lp-hero-actions lp-reveal" ref={r4}>
          <button className="lp-btn-primary" ref={heroCtaRef} onClick={openRolePicker}>
            Open Masterplanner →
          </button>
          <a className="lp-btn-ghost" href="#who">See roles ↓</a>
        </div>
      </section>

      {/* ── Data strip ── */}
      <div className="lp-data-strip lp-reveal" ref={r6}>
        {STATS.map((s) => (
          <div className="lp-data-cell" key={s.label}>
            <div className="lp-data-cell-accent" />
            <div className="lp-data-num">
              <Counter to={s.num} />
              {s.suffix && <span className="lp-data-unit">{s.suffix}</span>}
            </div>
            <div className="lp-data-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── What / How / Why ── */}
      <div className="lp-product-strip lp-reveal" ref={r7}>
        <div className="lp-product-col">
          <div className="lp-product-col-head">
            <div className="lp-product-col-icon">⬡</div>
            <span className="lp-product-col-title">What</span>
          </div>
          <p>A browser-based tool that turns a site boundary into a fully configured masterplan — every unit detailed to materials and BOM, in minutes not months.</p>
        </div>
        <div className="lp-product-col">
          <div className="lp-product-col-head">
            <div className="lp-product-col-icon">⊞</div>
            <span className="lp-product-col-title">How</span>
          </div>
          <p>Algorithm generates layout. AI proposes interiors. Architects approve. Home owners personalise. Platform keeps manufacturers in sync — live, at every stage.</p>
        </div>
        <div className="lp-product-col">
          <div className="lp-product-col-head">
            <div className="lp-product-col-icon">≡</div>
            <span className="lp-product-col-title">Why</span>
          </div>
          <p>Housing delivery is broken because every discipline works in isolation. Lithic Pulse connects all four roles into one transparent, live workflow.</p>
        </div>
      </div>

      {/* ── Role cards ── */}
      <RoleCards onEnter={onEnter} />

      {/* ── Features ── */}
      <div className="lp-section" id="features" style={{ padding: 0 }}>
        <div className="lp-section-label lp-reveal" style={{ padding: '48px 64px 0' }}>
          <span className="lp-section-num">02</span>
          <span className="lp-section-rule" />
          <span className="lp-section-tag">Core Features</span>
        </div>
        <div className="lp-features">
          {FEATURES.map((f, i) => <FeatureRow key={f.num} f={f} i={i} />)}
        </div>
      </div>

      {/* ── Live OSM Map ── */}
      <section className="lp-sites-section" id="sites">
        <div className="lp-sites-header lp-reveal" ref={rMap}>
          <div>
            <div className="lp-kicker">03 / Live Project Sites</div>
            <h2 className="lp-section-h">
              50 brownfield sites.<br /><em>All in the platform.</em>
            </h2>
            <p className="lp-section-body" style={{ marginTop: 12 }}>
              Every active Lithic Pulse project pinned on the live map. Click any site to see status,
              typology mix, and unit count — then open directly in the Planner.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--fg-dimmer)' }}>Site filter</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {['All', 'Live', 'Construction', 'Planning'].map(f => (
                <span key={f} style={{ padding: '4px 10px', border: '1px solid var(--line-b)', fontFamily: 'var(--mono)', fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--fg-dimmer)' }}>{f}</span>
              ))}
            </div>
          </div>
        </div>
        <OSMProjectMap onOpenPlanner={openRolePicker} />
      </section>

      {/* ── Pipeline ── */}
      <section className="lp-planner-section" id="pipeline">
        <div className="lp-planner-section-header lp-reveal">
          <div className="lp-section-label" style={{ marginBottom: 24 }}>
            <span className="lp-section-num">04</span>
            <span className="lp-section-rule" />
            <span className="lp-section-tag">Full pipeline</span>
          </div>
          <h2 className="lp-section-h">Five steps. <em>One platform.</em></h2>
          <p className="lp-section-body" style={{ marginTop: 12 }}>
            From empty site boundary to build-ready specification — every stage lives in the same tool, connected and live.
          </p>
        </div>
        <PipelineDiagram onOpenPlanner={openRolePicker} />
      </section>

      {/* ── Architect AI Panel ── */}
      <ArchitectAIPanel onEnter={onEnter} />

      {/* ── Home Owner Dashboard ── */}
      <HomeOwnerPanel onEnter={onEnter} />

      {/* ── Manufacturer Dashboard ── */}
      <ManufacturerPanel onEnter={onEnter} />

      {/* ── Workflow steps ── */}
      <section className="lp-workflow" id="workflow">
        <div className="lp-workflow-header lp-reveal" ref={r9}>
          <div className="lp-section-label" style={{ marginBottom: 24 }}>
            <span className="lp-section-num">05</span>
            <span className="lp-section-rule" />
            <span className="lp-section-tag">How it works</span>
          </div>
          <h2 className="lp-section-h">From empty site <em>to build-ready data.</em></h2>
        </div>
        <div className="lp-steps">
          {STEPS.map(s => <StepItem key={s.num} s={s} />)}
        </div>
      </section>

      {/* ── Impact ── */}
      <section className="lp-impact lp-reveal" ref={r10}>
        <div className="lp-impact-inner">
          <div className="lp-impact-text">
            <div className="lp-kicker">Sustainability</div>
            <h2>Built with the<br />planet in mind.</h2>
            <p>
              Complete carbon, water, and recyclability tracking — every
              decision made with full awareness of its environmental cost.
              Every material choice has a consequence. We make it visible.
            </p>
          </div>
          <div className="lp-impact-badge-wrap">
            <div className="lp-impact-badge">
              <span className="lp-dot lp-dot--green" />
              Environmental impact tracking — coming soon
            </div>
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="lp-cta">
        <h2 className="lp-cta-h">
          Ready to<br /><em>build something?</em>
        </h2>
        <p className="lp-cta-sub">No account needed. Start designing in seconds.</p>
        <button className="lp-btn-primary" ref={finalCtaRef} onClick={openRolePicker}>
          Open Masterplanner →
        </button>
        <div className="lp-cta-note">Free to use · No signup required · Works in your browser</div>
      </section>

      {/* ── Footer ── */}
      <footer className="lp-footer">
        <div className="lp-footer-brand">Lithic Pulse</div>
        <nav className="lp-footer-nav">
          <a href="#who">Roles</a>
          <a href="#features">Features</a>
          <a href="#sites">Live Sites</a>
          <a href="#pipeline">Pipeline</a>
          <a href="#architect">Architects</a>
          <a href="#homeowners">Home Owners</a>
          <a href="#manufacturers">Manufacturers</a>
          <a href="#workflow">How it works</a>
        </nav>
        <div className="lp-footer-copy">© Lithic Pulse 2026</div>
      </footer>
    </div>
  );
}
