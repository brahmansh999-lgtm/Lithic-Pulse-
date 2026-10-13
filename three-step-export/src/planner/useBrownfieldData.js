import { useState, useEffect } from 'react';

const STATUS_COLOURS = {
  'Permissioned':     '#4ade80',
  'Pending':          '#60a5fa',
  'Allocation':       '#a78bfa',
  'Not permissioned': '#f59e0b',
};

export function useBrownfieldData() {
  const [sites, setSites]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);

  useEffect(() => {
    fetch('/brownfield_london.geojson')
      .then(r => {
        if (!r.ok) throw new Error('Failed to load brownfield data');
        return r.json();
      })
      .then(data => {
        const parsed = [];
        let id = 1;
        for (const f of data.features) {
          const geom = f.geometry;
          if (!geom) continue;
          // Extract outer ring as [[lat,lng],...] for Leaflet
          // GeoJSON coords are [lng, lat] — flip them
          let ring;
          if (geom.type === 'MultiPolygon') {
            ring = geom.coordinates[0][0];
          } else if (geom.type === 'Polygon') {
            ring = geom.coordinates[0];
          } else {
            continue;
          }
          // Drop closing duplicate vertex
          const coords = ring.slice(0, ring[0][0] === ring[ring.length-1][0] && ring[0][1] === ring[ring.length-1][1] ? -1 : undefined);
          const latLngs = coords.map(([lng, lat]) => [lat, lng]);
          if (latLngs.length < 3) continue;

          const centLat = latLngs.reduce((s, p) => s + p[0], 0) / latLngs.length;
          const centLng = latLngs.reduce((s, p) => s + p[1], 0) / latLngs.length;

          const p = f.properties;
          const status = p.status || 'Not permissioned';

          parsed.push({
            id:      id++,
            name:    p.name    || p.address || `Site ${p.id}`,
            address: p.address || '',
            borough: p.borough || '',
            status,
            colour:  STATUS_COLOURS[status] || '#9e9a91',
            hectares: p.hectares || 0,
            area: p.hectares ? `${p.hectares} ha` : '',
            lat: centLat,
            lng: centLng,
            coords: latLngs,
            siteContext: {
              surface:       'flat',
              contamination: 'industrial',
              floodZone:     false,
              maxFloors:     null,
              railBuffer:    0,
            },
          });
        }
        setSites(parsed);
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  return { sites, loading, error };
}
