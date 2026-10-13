import { useMemo, useState } from 'react';
import MasterplanViewer from './MasterplanViewer';
import { generateCuratedIterations } from './planScoring';
import { FINALISED_SEED_BY_SITE } from './curatedSites';
import './IterationGallery.css';

// Shows the best 20 of a larger seed sweep for one curated site — lets every
// role see how much exploration happened before one plan was finalised.
// Read-only by default (no controls leak in); Architect/Developer flow opts
// into `onOpenSeed` to jump into the normal editable MasterplanViewer/PlanControls.
export default function IterationGallery({ siteId, siteBounds, sitePolygon, siteContext, analysis, onOpenSeed, onBack, readOnly = false }) {
  const [selectedSeed, setSelectedSeed] = useState(null);

  const options = useMemo(() => ({
    siteContext,
    solarAzimuth: analysis?.solarAzimuth,
    windAzimuth:  analysis?.windAzimuth,
    accessEdges:  analysis?.accessEdges,
  }), [siteContext, analysis]);

  const iterations = useMemo(
    () => generateCuratedIterations(siteBounds, sitePolygon, options, { sweepCount: 60, keep: 20 }),
    [siteBounds, sitePolygon, options]
  );

  const finalisedSeed = FINALISED_SEED_BY_SITE[siteId];

  return (
    <div className="iter-gallery">
      <div className="iter-gallery-header">
        {onBack && <button className="iter-gallery-back" onClick={onBack}>← Back</button>}
        <div className="iter-gallery-title">
          <h2>Design Exploration</h2>
          <p>{iterations.length} curated options, narrowed down from a wider sweep of the site's massing possibilities.</p>
        </div>
      </div>

      <div className="iter-gallery-grid">
        {iterations.map(({ seed, plan, score }) => {
          const isFinalised = seed === finalisedSeed;
          const isSelected = seed === selectedSeed;
          return (
            <div
              key={seed}
              className={`iter-card${isFinalised ? ' iter-card--finalised' : ''}${isSelected ? ' iter-card--selected' : ''}`}
              onClick={() => setSelectedSeed(seed)}
            >
              <div className="iter-card-thumb">
                <MasterplanViewer
                  plan={plan}
                  maxFloor={plan.floors.max}
                  stage="boxes"
                  selectedUnit={null}
                  onSelectUnit={() => {}}
                  filterTypology={null}
                  hoverTypology={null}
                  showSolar={false}
                />
              </div>
              <div className="iter-card-meta">
                <span className="iter-card-concept">{plan.conceptLabel}</span>
                {isFinalised && <span className="iter-card-badge">Finalised</span>}
              </div>
              <div className="iter-card-stats">
                <span>{plan.totalUnits} homes</span>
                <span>{plan.greenPercent}% green</span>
                <span>score {score.toFixed(0)}</span>
              </div>
              {!readOnly && (
                <button
                  className="iter-card-open"
                  onClick={(e) => { e.stopPropagation(); onOpenSeed?.(seed); }}
                >
                  Open in editor →
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
