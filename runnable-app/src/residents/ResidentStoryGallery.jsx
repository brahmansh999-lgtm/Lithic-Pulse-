import { useState, lazy, Suspense } from 'react';
import { ROOMS_META } from '../configurator/RoomConfigurator';
import { PERSONAS, getPersonaUnit } from './personas';
import './ResidentStoryGallery.css';

const RoomHeroView = lazy(() => import('../configurator/RoomHeroView'));

// ROOMS_META only carries a typology label ('1-BHK'/'2-BHK'/'3-BHK'/'Cluster'),
// not a numeric bed count — derive the real count per persona's actual unit
// instead of a fixed guess, since this flows into the AI renderer's reference
// photo selection (getReferenceImagePath in aiRenderMiddleware.js buckets on
// beds === 4 vs not).
const BEDS_BY_TYPOLOGY = { '1-BHK': 1, '2-BHK': 2, '3-BHK': 3, 'Cluster': 4 };

// Resident Story Mode — a standalone gallery, not a configurator step. The
// point is the human story: who lives in these units, what their day looks
// like, and why this specific layout serves them. Each persona links to a
// REAL unit typology and a REAL furniture layout (built from the actual
// catalogue/GLTF models), rendered through the same RoomHeroView used by
// View Your Home — so the room shown is the actual designed space, not an
// illustration.
export default function ResidentStoryGallery({ onBack }) {
  const [activeId, setActiveId] = useState(null);
  const active = PERSONAS.find(p => p.id === activeId) || null;

  if (active) {
    const unit = getPersonaUnit(active, ROOMS_META);
    return (
      <div className="rsg-view rsg-view--detail">
        <button className="rsg-back" onClick={() => setActiveId(null)}>← All residents</button>

        <div className="rsg-detail-layout">
          <div className="rsg-detail-story">
            <div className="rsg-detail-kicker">{active.household}{active.age ? ` · Age ${active.age}` : ''}</div>
            <h1 className="rsg-detail-name">{active.name}</h1>
            <div className="rsg-detail-occ">{active.occupation}</div>
            <p className="rsg-detail-tagline">"{active.tagline}"</p>

            <div className="rsg-detail-section">
              <h2>A day in the life</h2>
              <ul className="rsg-detail-routine">
                {active.routine.map((line, i) => <li key={i}>{line}</li>)}
              </ul>
            </div>

            <div className="rsg-detail-section">
              <h2>What this home has to do</h2>
              <ul className="rsg-detail-needs">
                {active.needs.map((line, i) => <li key={i}>{line}</li>)}
              </ul>
            </div>

            <div className="rsg-detail-section rsg-detail-why">
              <h2>Why {unit?.label ?? 'this unit'}</h2>
              <p>{active.whyThisUnit}</p>
            </div>
          </div>

          <div className="rsg-detail-room">
            <Suspense fallback={<div className="rsg-room-loading">Loading {unit?.label}…</div>}>
              {unit && (
                <RoomHeroView
                  typology={{ glb: unit.file, label: unit.label, areaM2: 0, beds: BEDS_BY_TYPOLOGY[unit.typology] || 1 }}
                  placedFurniture={active.furniture}
                />
              )}
            </Suspense>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rsg-view">
      {onBack && <button className="rsg-back" onClick={onBack}>← Back</button>}
      <div className="rsg-header">
        <h1>Who actually lives here</h1>
        <p>
          Four real households, four real units. Not a render of an empty room —
          the furniture, the daylight, the layout, tested against how someone
          would actually use it every day.
        </p>
      </div>

      <div className="rsg-grid">
        {PERSONAS.map(p => {
          const unit = getPersonaUnit(p, ROOMS_META);
          return (
            <button key={p.id} className="rsg-card" onClick={() => setActiveId(p.id)}>
              <div className="rsg-card-unit">{unit?.label} · {unit?.typology}</div>
              <div className="rsg-card-name">{p.name}</div>
              <div className="rsg-card-occ">{p.occupation}</div>
              <div className="rsg-card-household">{p.household}</div>
              <p className="rsg-card-tagline">"{p.tagline}"</p>
              <div className="rsg-card-cta">See their home →</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
