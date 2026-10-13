import { useMemo, useState, lazy, Suspense } from 'react';
import { useBrownfieldData } from '../planner/useBrownfieldData';
import { siteToMasterplanInput } from '../planner/SitePicker';
import GLBSiteView from '../planner/GLBSiteView';
import { CURATED_SITE_IDS, SITE_GLB } from '../planner/curatedSites';
import './HomeOwnerView.css';

const Configurator = lazy(() => import('../configurator/Configurator'));

// Home Owner: pick one of the curated sites, see the finalised building in
// 3D (the real class GLB fitted to the site), then "View your individual
// home" → the 5-unit picker → configure. The old generated-masterplan layer
// (MasterplanViewer + iteration gallery) has been removed everywhere — the
// terminal experience is the 3D building + individual-home configuration,
// same as the architect/developer pipeline (see SiteMassingView).
export default function HomeOwnerView({ onBack }) {
  const { sites, loading } = useBrownfieldData();
  const [siteId, setSiteId] = useState(null);
  const [configuratorOpen, setConfiguratorOpen] = useState(false);

  const curatedSites = useMemo(
    () => sites.filter(s => CURATED_SITE_IDS.includes(s.id)),
    [sites]
  );

  const selectedSite = useMemo(
    () => curatedSites.find(s => s.id === siteId) || null,
    [curatedSites, siteId]
  );

  const input = useMemo(
    () => selectedSite ? siteToMasterplanInput(selectedSite) : null,
    [selectedSite]
  );

  const buildingType = SITE_GLB[siteId]?.buildingType ?? 'medium';

  // ── Site list ──────────────────────────────────────────────────
  if (!selectedSite) {
    return (
      <div className="ho-view">
        {onBack && <button className="ho-back" onClick={onBack}>← Back</button>}
        <div className="ho-header">
          <h1>Choose your site</h1>
          <p>Real London regeneration sites are ready for home owners today.</p>
        </div>
        {loading && <div className="ho-loading">Loading sites…</div>}
        <div className="ho-site-grid">
          {curatedSites.map(s => (
            <button key={s.id} className="ho-site-card" onClick={() => setSiteId(s.id)}>
              <div className="ho-site-card-name">{s.name}</div>
              <div className="ho-site-card-meta">{s.borough} · {s.area}</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Finalised building in 3D → "View your individual home" ─────
  return (
    <>
      <GLBSiteView
        buildingType={buildingType}
        siteName={selectedSite.name}
        siteBounds={input?.siteBounds}
        onBack={() => setSiteId(null)}
        onViewHome={() => setConfiguratorOpen(true)}
      />
      {configuratorOpen && (
        <Suspense fallback={null}>
          {/* No initialTypologyId → opens the 5-unit picker, then configure. */}
          <Configurator onClose={() => setConfiguratorOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
