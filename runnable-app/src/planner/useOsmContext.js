// Fetches REAL surrounding building footprints + road centrelines around a
// site from the public Overpass API (OpenStreetMap), and converts them into
// WORLD METRES relative to the site's own bounding-box origin — so they can
// be rendered in MasterplanViewer as flat pale context massing + real road
// lines around the designed plan, instead of either nothing or fake
// procedural geometry.
//
// IMPORTANT — do NOT reuse sitePolygon's normalised 0..1 space for this.
// That space is calibrated so the SITE's own (tiny) footprint exactly fills
// 0..1; real OSM context buildings extend ~180m beyond the site in every
// direction (CONTEXT_PAD_DEG), which is usually many times wider than the
// site itself. Forcing them through the site's 0..1 normalisation and then
// multiplying by the site's own small grid width put real neighbouring
// buildings at wildly out-of-place world coordinates — scattered across and
// beyond the scene rather than sitting around the site. (Caught via a user
// screenshot showing chaotic floating geometry — this was that bug.)
// Converting via metres-per-degree directly, independent of the site's grid
// size, is what keeps context buildings at their true real-world distance
// and bearing from the site, however large or small the site's own grid is.
//
// This is genuinely live network data: no offline fallback dataset exists in
// this app for neighbouring buildings (brownfield_london.geojson only has
// the curated DEVELOPMENT sites themselves, not their surroundings). A
// failed/slow fetch must never block the masterplan from rendering — it's
// decorative context, so errors resolve to empty arrays, not thrown.

import { useEffect, useState } from 'react';

// Multiple public Overpass mirrors, tried in order — the main instance
// occasionally rejects requests from some client/network combinations
// (seen as a 406 from certain server-side fetch clients during dev/testing,
// even though the exact same query succeeds via curl/browser), and mirrors
// can also just be temporarily down. This is decorative context data, so
// resilience matters more than picking one "correct" endpoint.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

// How far around the site to pull context, in degrees — ~180m at London's
// latitude, enough to read "the site sits in a city block" without pulling
// in an expensive wide-area query.
const CONTEXT_PAD_DEG = 0.0016;

function buildQuery(minLat, minLng, maxLat, maxLng) {
  const bbox = `${minLat - CONTEXT_PAD_DEG},${minLng - CONTEXT_PAD_DEG},${maxLat + CONTEXT_PAD_DEG},${maxLng + CONTEXT_PAD_DEG}`;
  return `
    [out:json][timeout:15];
    (
      way["building"](${bbox});
      way["highway"](${bbox});
    );
    out geom;
  `;
}

const EARTH_R_M = 6371000;

// Converts a lat/lng to METRES east/north of the site's own bounding-box
// origin (geoRef.minLat/minLng) — equirectangular approximation, accurate
// enough at the ~200m scale this context covers. Independent of the site's
// own grid size/CELL — that's the actual fix (see header comment).
function toMetresXZ(lat, lng, geoRef) {
  const lngScale = geoRef.lngScale ?? Math.cos((geoRef.minLat * Math.PI) / 180);
  return {
    xM: (lng - geoRef.minLng) * lngScale * EARTH_R_M * (Math.PI / 180),
    zM: (lat - geoRef.minLat) * EARTH_R_M * (Math.PI / 180),
  };
}

// Tries each mirror in order until one returns valid JSON. body is sent as
// application/x-www-form-urlencoded `data=<query>` — matches the form
// Overpass's own examples and curl --data-urlencode use.
async function fetchFromAnyMirror(query, signal) {
  let lastError;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal,
      });
      if (!r.ok) { lastError = new Error(`Overpass ${r.status}`); continue; }
      return await r.json();
    } catch (e) {
      if (signal?.aborted) throw e;
      lastError = e;
    }
  }
  throw lastError || new Error('All Overpass mirrors failed');
}

// useOsmContext(geoRef) → { buildings: [{points:[{xM,zM}], levels}], roads: [{points:[{xM,zM}]}], loading }
// Coordinates are METRES east(xM)/north(zM) of geoRef's own bounding-box
// origin (minLng/minLat) — NOT the sitePolygon 0..1 normalised space (see
// header comment for why that was wrong). The renderer must offset these by
// wherever the site polygon's own origin sits in world space, then use them
// directly as world metres — no further normalisation/rescaling.
export function useOsmContext(geoRef) {
  const [data, setData] = useState({ buildings: [], roads: [], loading: false });

  useEffect(() => {
    if (!geoRef) { setData({ buildings: [], roads: [], loading: false }); return; }
    const controller = new AbortController();
    setData(d => ({ ...d, loading: true }));

    const query = buildQuery(geoRef.minLat, geoRef.minLng, geoRef.maxLat, geoRef.maxLng);
    fetchFromAnyMirror(query, controller.signal)
      .then(json => {
        const buildings = [];
        const roads = [];
        for (const el of json.elements || []) {
          if (!el.geometry || el.geometry.length < 2) continue;
          const points = el.geometry
            .filter(g => g && g.lat != null && g.lon != null)
            .map(g => toMetresXZ(g.lat, g.lon, geoRef));
          if (points.length < 2) continue;

          if (el.tags?.building) {
            if (points.length >= 3) {
              const levels = parseInt(el.tags['building:levels'], 10);
              buildings.push({ points, levels: Number.isFinite(levels) ? levels : null });
            }
          } else if (el.tags?.highway) {
            roads.push({ points });
          }
        }
        setData({ buildings, roads, loading: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setData({ buildings: [], roads: [], loading: false });
      });

    return () => controller.abort();
  }, [geoRef]);

  return data;
}
