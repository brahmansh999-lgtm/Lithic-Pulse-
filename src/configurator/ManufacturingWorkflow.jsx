import { useState, useMemo, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { computeBOM, bomSummary, CATEGORIES } from './utils/computeBOM';
import layouts from './data/roomLayouts.json';
import './ManufacturingWorkflow.css';

const CAT_COLOR = {
  [CATEGORIES.STRUCTURAL]: '#a8a4a0',
  [CATEGORIES.ENVELOPE]:   '#c8c4be',
  [CATEGORIES.OPENINGS]:   '#88aacc',
  [CATEGORIES.FITOUT]:     '#e8e4da',
};

// ── GLB preview component ─────────────────────────────────────────────────────

function MouldModel({ file }) {
  const { scene } = useGLTF(file);
  const cloned = useMemo(() => {
    const c = scene.clone(true);
    // auto-center
    const box = new THREE.Box3().setFromObject(c);
    const center = box.getCenter(new THREE.Vector3());
    c.position.sub(center);
    // apply a light concrete material
    c.traverse(n => {
      if (!n.isMesh) return;
      n.material = new THREE.MeshStandardMaterial({
        color: '#d4d0cb',
        roughness: 0.55,
        metalness: 0.18,
        envMapIntensity: 1.2,
      });
      n.castShadow = true;
    });
    return c;
  }, [scene]);

  return <primitive object={cloned} />;
}

// ── Assembly clusters ──────────────────────────────────────────────────────
// Instead of flattening every part into an equal grid card, group the parts
// that come from ONE real physical assembly (a column, a wall, a slab) into
// one cluster — the repeat structure (1 column = 4 parts, 1 wall = 2 parts,
// 1 slab = 3 parts) is shown once per cluster, not re-stated on every card.
// One-off parts (door, window, wet pod) get their own single-part cluster.
// Each entry's partIds must all scale off the SAME unit count — external and
// internal walls are physically different populations (different counts),
// same for floor vs roof slabs, so each gets its own cluster rather than being
// merged into one with a meaningless averaged "unit count." splitFactor is
// how many identical cast pieces ONE physical unit was divided into in
// computeBOM (e.g. a wall is split into 2 halves, a slab into 3 thirds) —
// used to recover the real physical unit count from the BOM's already-split
// qty, the same way Column's multi-part shape does it implicitly.
const ASSEMBLIES = [
  { id: 'column',    label: 'Column',        unitNoun: 'column',  partIds: ['COL_BASE', 'COL_SHAFT', 'COL_CAPITAL'] },
  { id: 'wall_ext',   label: 'External Wall', unitNoun: 'wall',    partIds: ['WALL_EXT'],   splitFactor: 2 },
  { id: 'wall_int',   label: 'Internal Wall', unitNoun: 'wall',    partIds: ['WALL_INT'],   splitFactor: 2 },
  { id: 'slab_floor', label: 'Floor Slab',    unitNoun: 'slab',    partIds: ['SLAB_FLOOR'], splitFactor: 3 },
  { id: 'slab_roof',  label: 'Roof Slab',      unitNoun: 'slab',    partIds: ['SLAB_ROOF'],  splitFactor: 3 },
  { id: 'balcony',    label: 'Balcony',       unitNoun: 'balcony', partIds: ['BAL_SLAB'] },
  { id: 'window',     label: 'Window',        unitNoun: 'window',  partIds: ['WIN_FRAME'] },
  { id: 'door',       label: 'Door',          unitNoun: 'door',    partIds: ['DOOR_ENTRY'] },
  { id: 'wetpod',     label: 'Wet Zone',      unitNoun: 'pod',     partIds: ['WET_POD'] },
];

// Aggregates one BOM per distinct typology actually present on the site,
// each scaled by config (the SAME configure choices the user picked for the
// unit they're currently editing — every unit of every typology on a real
// build uses the same kit-of-parts choices) and multiplied by how many of
// that typology really exist in the generated masterplan, then merges by
// part id so e.g. all typologies' COL_BASE rows become one combined row.
function computeSiteBOM(allTypologies, siteTypologyCounts, config) {
  const merged = new Map(); // id -> part (qty/weightKgTotal accumulated)
  Object.entries(siteTypologyCounts).forEach(([typologyId, count]) => {
    if (!count) return;
    const t = allTypologies.find(t => t.id === typologyId);
    if (!t) return;
    const unitParts = computeBOM(t, config, layouts);
    unitParts.forEach(p => {
      if (p.isSummary) return;
      const existing = merged.get(p.id);
      if (existing) {
        existing.qty += p.qty * count;
        existing.weightKgTotal += p.weightKgTotal * count;
      } else {
        merged.set(p.id, { ...p, qty: p.qty * count, weightKgTotal: p.weightKgTotal * count });
      }
    });
  });
  return Array.from(merged.values());
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ManufacturingWorkflow({ typology, config, allTypologies, siteTypologyCounts, onNext }) {
  const [scope, setScope] = useState('unit'); // 'unit' | 'site'
  const [selectedPart, setSelectedPart] = useState(null);
  const [openAssembly, setOpenAssembly] = useState('column');

  const unitBom = useMemo(() => typology ? computeBOM(typology, config, layouts) : [], [typology, config]);

  const siteUnitCount = useMemo(
    () => Object.values(siteTypologyCounts || {}).reduce((s, n) => s + n, 0),
    [siteTypologyCounts]
  );
  const hasSiteData = !!allTypologies && siteUnitCount > 0;

  const siteBom = useMemo(() => {
    if (!hasSiteData) return [];
    return computeSiteBOM(allTypologies, siteTypologyCounts, config);
  }, [hasSiteData, allTypologies, siteTypologyCounts, config]);

  // 'site' scope only applies if we actually have a generated masterplan with
  // real unit counts — otherwise silently fall back to the single unit's BOM
  // (e.g. opening Manufacture before ever generating a site).
  const bom     = scope === 'site' && hasSiteData ? siteBom : unitBom;
  const summary = useMemo(() => bomSummary(bom), [bom]);
  const totalWeightKg = useMemo(() => bom.filter(p => !p.isSummary).reduce((s, p) => s + p.weightKgTotal, 0), [bom]);

  // Build one cluster per assembly that actually has parts in this BOM —
  // each cluster carries its repeat-per-unit count (parts.length), how many
  // physical units exist (derived from the smallest qty among its parts,
  // i.e. the base/least-repeated part = the unit count), and its share of
  // total tonnage for the weight bar.
  const clusters = useMemo(() => {
    return ASSEMBLIES.map(asm => {
      const parts = asm.partIds
        .map(id => bom.find(p => p.id === id && !p.isSummary))
        .filter(Boolean);
      if (parts.length === 0) return null;
      const clusterWeightKg = parts.reduce((s, p) => s + p.weightKgTotal, 0);
      // Unit count = the lowest qty among the cluster's parts (e.g. COL_BASE's
      // qty IS the column count; COL_CAPITAL's qty is columns×2, not the unit
      // count) — taking the min always recovers the true number of physical
      // assemblies regardless of how many sub-parts each one explodes into.
      // For single-part clusters (walls/slabs) the BOM row is ALREADY the
      // split pieces (e.g. WALL_EXT's qty is half-panels, not whole walls), so
      // divide by the explicit splitFactor to recover the real unit count.
      const rawMin = Math.min(...parts.map(p => p.qty)) || parts[0].qty;
      const unitCount = asm.splitFactor ? Math.round(rawMin / asm.splitFactor) : rawMin;
      return {
        ...asm,
        parts,
        unitCount,
        partsPerUnit: parts.reduce((s, p) => s + Math.round(p.qty / (unitCount || 1)), 0),
        weightKg: clusterWeightKg,
        weightShare: totalWeightKg > 0 ? clusterWeightKg / totalWeightKg : 0,
      };
    }).filter(Boolean);
  }, [bom, totalWeightKg]);

  return (
    <div className="mfg-root">

      {/* ── Top header bar ── */}
      <div className="mfg-topbar">
        <div className="mfg-topbar-left">
          <div className="mfg-topbar-eyebrow">
            Parts Catalogue · {scope === 'site' ? `${siteUnitCount} units on site` : typology.label}
          </div>
          <div className="mfg-topbar-title">
            {scope === 'site' ? 'Entire Site' : `${typology.areaM2} m² Unit`}
          </div>
        </div>
        <div className="mfg-topbar-stats">
          <div className="mfg-stat-pill">
            <span className="mfg-stat-val">{summary.totalPieces}</span>
            <span className="mfg-stat-key">Pieces</span>
          </div>
          <div className="mfg-stat-pill">
            <span className="mfg-stat-val">{summary.totalWeightT}</span>
            <span className="mfg-stat-key">Tonnes</span>
          </div>
        </div>
        <div className="mfg-topbar-toggle">
          <button
            className={`mfg-toggle-btn${scope === 'unit' ? ' active' : ''}`}
            onClick={() => setScope('unit')}
          >This Unit</button>
          <button
            className={`mfg-toggle-btn${scope === 'site' ? ' active' : ''}`}
            onClick={() => hasSiteData && setScope('site')}
            disabled={!hasSiteData}
            title={hasSiteData ? undefined : 'Generate a masterplan first to see site-wide totals'}
          >Entire Site</button>
        </div>
      </div>

      {/* ── Assembly cluster stack ── */}
      <div className="mfg-catalogue mfg-catalogue--stack">
        {clusters.map(cluster => (
          <AssemblyCluster
            key={cluster.id}
            cluster={cluster}
            isOpen={openAssembly === cluster.id}
            onToggle={() => setOpenAssembly(openAssembly === cluster.id ? null : cluster.id)}
            selectedPart={selectedPart}
            onSelectPart={setSelectedPart}
          />
        ))}
      </div>

      {/* ── Selected part flyout ── */}
      {selectedPart && (
        <div className="mfg-flyout">
          <button className="mfg-flyout-close" onClick={() => setSelectedPart(null)}>✕</button>
          <div className="mfg-flyout-cat" style={{ color: CAT_COLOR[selectedPart.category] }}>{selectedPart.category}</div>
          <div className="mfg-flyout-name">{selectedPart.label}</div>
          <div className="mfg-flyout-desc">{selectedPart.desc}</div>
          <div className="mfg-flyout-rows">
            <div className="mfg-flyout-row">
              <span className="mfg-flyout-key">Qty</span>
              <span className="mfg-flyout-val">{selectedPart.qty} {selectedPart.unit}</span>
            </div>
            <div className="mfg-flyout-row">
              <span className="mfg-flyout-key">Dims</span>
              <span className="mfg-flyout-val">{selectedPart.dimLabel}</span>
            </div>
            <div className="mfg-flyout-row">
              <span className="mfg-flyout-key">Material</span>
              <span className="mfg-flyout-val">{selectedPart.material}</span>
            </div>
            <div className="mfg-flyout-row">
              <span className="mfg-flyout-key">Weight</span>
              <span className="mfg-flyout-val">{selectedPart.weightKgEach} kg ea · {(selectedPart.weightKgTotal / 1000).toFixed(2)} t total</span>
            </div>
            {selectedPart.mouldType && (
              <div className="mfg-flyout-row">
                <span className="mfg-flyout-key">Mould</span>
                <span className="mfg-flyout-val">{selectedPart.uniqueMoulds} × {selectedPart.mouldType}-form</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Footer ── */}
      <div className="mfg-footer">
        <button className="mfg-next-btn" onClick={onNext}>
          Proceed to Assembly
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M2.5 6.5h8M8 3.5l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

// One physical assembly (a column, a wall, a slab...) shown as a single
// collapsed header row — name, how many of these exist, how many discrete
// cast parts each one explodes into, and a weight-share bar against the
// whole unit's tonnage. Expanding it reveals the exploded part stack.
function AssemblyCluster({ cluster, isOpen, onToggle, selectedPart, onSelectPart }) {
  const { label, unitNoun, parts, unitCount, partsPerUnit, weightKg, weightShare } = cluster;
  const color = CAT_COLOR[parts[0].category];
  return (
    <div className={`mfg-cluster${isOpen ? ' open' : ''}`}>
      <button className="mfg-cluster-head" onClick={onToggle}>
        <span className="mfg-cluster-chevron" style={{ color }}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2.5 1.5L7 5l-4.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
        <span className="mfg-cluster-dot" style={{ background: color }} />
        <span className="mfg-cluster-name">{label}</span>
        <span className="mfg-cluster-formula">
          {unitCount} {unitNoun}{unitCount !== 1 ? 's' : ''} <span className="mfg-cluster-x">×</span> {partsPerUnit} part{partsPerUnit !== 1 ? 's' : ''} <span className="mfg-cluster-x">=</span> {unitCount * partsPerUnit} casts
        </span>
        <span className="mfg-cluster-weight">{(weightKg / 1000).toFixed(1)} t</span>
        <div className="mfg-cluster-bar-track">
          <div className="mfg-cluster-bar-fill" style={{ width: `${Math.max(2, weightShare * 100)}%`, background: color }} />
        </div>
        <span className="mfg-cluster-share">{(weightShare * 100).toFixed(0)}%</span>
      </button>

      {isOpen && (
        <div className="mfg-cluster-exploded">
          {parts.map((part, i) => (
            <div key={part.id} className="mfg-exploded-part-wrap">
              {i > 0 && <div className="mfg-exploded-plus">+</div>}
              <button
                className={`mfg-exploded-part${selectedPart?.id === part.id ? ' active' : ''}`}
                onClick={() => onSelectPart(selectedPart?.id === part.id ? null : part)}
              >
                {part.image ? (
                  <div className="mfg-part-card-img">
                    <Suspense fallback={<div className="mfg-part-img-placeholder" />}>
                      <Canvas
                        className="mfg-part-mini-canvas"
                        camera={{ position: [2, 1.5, 2], fov: 42 }}
                        gl={{ antialias: true, alpha: true }}
                        dpr={Math.min(window.devicePixelRatio, 2)}
                        frameloop="demand"
                      >
                        <ambientLight intensity={0.6} />
                        <directionalLight position={[3, 5, 3]} intensity={1.4} color="#fff5e8" />
                        <Suspense fallback={null}>
                          <MouldModel file={part.image} />
                        </Suspense>
                      </Canvas>
                    </Suspense>
                  </div>
                ) : (
                  <div className="mfg-part-card-img mfg-part-img-placeholder">
                    <svg viewBox="0 0 48 48" fill="none" width="32" height="32" opacity="0.18">
                      <rect x="6" y="6" width="36" height="36" rx="3" stroke="currentColor" strokeWidth="1.5"/>
                      <path d="M6 32l10-10 8 8 6-6 12 12" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                      <circle cx="17" cy="19" r="3" stroke="currentColor" strokeWidth="1.2"/>
                    </svg>
                  </div>
                )}
                <div className="mfg-part-card-top">
                  <div className="mfg-part-card-name">{part.label}</div>
                  <div className="mfg-part-card-qty">
                    <span className="mfg-part-qty-val">{part.qty}</span>
                    <span className="mfg-part-qty-unit">{part.unit}</span>
                  </div>
                </div>
                <div className="mfg-part-card-dims">{part.dimLabel}</div>
                <div className="mfg-part-card-bottom">
                  <span className="mfg-part-card-weight">{part.weightKgEach} kg ea</span>
                  {part.mouldType && <span className="mfg-part-card-mould">cast-stone form</span>}
                </div>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
