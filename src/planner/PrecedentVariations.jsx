import { useMemo, useState } from 'react';
import MasterplanViewer from './MasterplanViewer';
import { generatePrecedentFittedIterations } from './zoningTargets';
import './PrecedentVariations.css';

// Shown after the architect approves a zoningSpec (ArchitectZoningGate).
// Sweeps all 9 massing concepts against the approved targets and shows ONLY
// the ones that pass the zoning gate — labelled "Variation A/B/C...", never
// by concept name (courtyard_block, mountain_cascade, etc. are internal
// implementation detail, not a vocabulary the architect should have to
// reason in). A plan that doesn't meet the approved zoning never reaches
// this screen at all; it was filtered out before generation finished.
export default function PrecedentVariations({ siteBounds, sitePolygon, siteContext, analysis, zoningSpec, onOpenVariation, onBack }) {
  const [selected, setSelected] = useState(null);

  const baseOptions = useMemo(() => ({
    siteContext,
    solarAzimuth: analysis?.solarAzimuth,
    windAzimuth:  analysis?.windAzimuth,
    accessEdges:  analysis?.accessEdges,
  }), [siteContext, analysis]);

  const { variations, feasibilityWarning } = useMemo(
    () => generatePrecedentFittedIterations(siteBounds, sitePolygon, zoningSpec, baseOptions, { keep: 12 }),
    [siteBounds, sitePolygon, zoningSpec, baseOptions]
  );

  return (
    <div className="pcv-root">
      <div className="pcv-header">
        {onBack && <button className="pcv-back" onClick={onBack}>← Back to Zoning</button>}
        <div className="pcv-title">
          <h2>Matching Variations</h2>
          <p>
            {feasibilityWarning
              ? feasibilityWarning
              : variations.length
                ? `${variations.length} variation${variations.length === 1 ? '' : 's'} meet the approved zoning for ${zoningSpec.sourceName}.`
                : `No variation met the approved zoning for ${zoningSpec.sourceName} — try adjusting the targets.`}
          </p>
        </div>
      </div>

      <div className="pcv-grid">
        {variations.map(({ seed, plan, score, variationLabel }) => {
          const isSelected = seed === selected;
          return (
            <div
              key={seed}
              className={`pcv-card ${isSelected ? 'pcv-card--selected' : ''}`}
              onClick={() => setSelected(seed)}
            >
              <div className="pcv-card-thumb">
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
              <div className="pcv-card-meta">
                <span className="pcv-card-label">{variationLabel}</span>
                <span className="pcv-card-score">fit {score}</span>
              </div>
              <div className="pcv-card-stats">
                <span>{plan.totalUnits} homes</span>
                <span>{plan.greenPercent}% green</span>
                <span>{plan.floors.max} floors</span>
              </div>
              <button
                className="pcv-card-open"
                onClick={(e) => { e.stopPropagation(); onOpenVariation?.(seed, plan); }}
              >
                Open in editor →
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
