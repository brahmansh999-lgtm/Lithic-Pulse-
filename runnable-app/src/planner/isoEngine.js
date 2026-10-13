// Shared isometric drawing engine + the sketch-faithful visual language used
// across the Architect pipeline's diagram stages (Massing 02b, Columns 02c).
// Previously each stage re-declared its own COS30/SIN30/boxFaces/pts and its
// own ad-hoc palette, so the three stages didn't read as ONE coherent study.
// Phase E centralises the projection AND the legend/palette here so Zoning →
// Massing → Columns speak the same visual language — the thing that makes the
// chain read as a single designed object rather than three unrelated diagrams.
//
// The legend is the architect's OWN hand-drawn key (see SPATIALLOGIC sketches):
//   ▦ green / communal space   ▣ semi-open space   ■ service core
// The generator's internal zone categories (units/amenity/green/connector/
// parking) are MAPPED onto that three-key language below, so what the juror
// sees on screen matches the paper sketch exactly.

export const COS30 = Math.cos(Math.PI / 6);
export const SIN30 = Math.sin(Math.PI / 6);

// Isometric projection: world (x up-right, y up, z up-left) → screen (sx, sy).
export const project = (x, y, z) => ({ sx: (x - z) * COS30, sy: (x + z) * SIN30 - y });

export const pts = (arr) => arr.map(p => `${p.sx.toFixed(2)},${p.sy.toFixed(2)}`).join(' ');

// Three visible faces of an axis-aligned box, already projected.
export function boxFaces(x0, x1, y0, y1, z0, z1) {
  const p = project;
  const c = {
    bnw: p(x0, y0, z0), bne: p(x1, y0, z0), bsw: p(x0, y0, z1), bse: p(x1, y0, z1),
    tnw: p(x0, y1, z0), tne: p(x1, y1, z0), tsw: p(x0, y1, z1), tse: p(x1, y1, z1),
  };
  return {
    top:   [c.tnw, c.tne, c.tse, c.tsw],
    left:  [c.bnw, c.bsw, c.tsw, c.tnw],
    right: [c.bne, c.bse, c.tse, c.tne],
  };
}

// Compute a padded viewBox that fits a set of already-projected points.
export function fitViewBox(allPts, padFrac = 0.1, padMin = 0.08) {
  const xs = allPts.map(p => p.sx), ys = allPts.map(p => p.sy);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = Math.max(padMin, (maxX - minX) * padFrac);
  return `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;
}

// ── The sketch's three-key visual language ────────────────────────────────
// Each generator category renders as one of the architect's three hand-drawn
// keys. top/left/right give the three isometric face tones (lighter top, the
// two sides progressively darker) for a clean, readable solid — the look of
// the reference "Spatial Zoning Diagram", not a flat fill.
//   green/communal → soft sage-green (the hatched ▦ in the sketch)
//   semi-open      → warm sand (the dotted ▣)
//   service core   → deep indigo (the solid ■)
//   units (mass)   → neutral warm plaster (the building solids the sketch
//                    leaves un-keyed — the actual dwellings)
// Tuned to POP against the dark canvas (the sketch is bold blue ink on white;
// on black the fills must be bright + saturated to read the same way). Each
// key keeps a clearly distinct hue: communal = vivid green, semi-open = warm
// gold, service = electric indigo (the sketch's solid ■), mass = warm plaster.
// FLAT-ish shading: the side faces are kept CLOSE to the top tone (only a small
// step darker) so a thin-plate cell reads as a bright solid block, like the
// sketch's flat-filled zones — not a bright lid on dark walls that swallow the
// colour at thumbnail scale. Top is the lightest, left the darkest, all within
// one clearly-coloured family per key.
export const SKETCH_KEYS = {
  communal: { label: 'Green / communal', top: '#8fd66f', left: '#79c456', right: '#84cd63' },
  semiOpen: { label: 'Semi-open space',  top: '#f3cf76', left: '#e6bd5a', right: '#edc868' },
  service:  { label: 'Service core',     top: '#8b9bf5', left: '#6d7ee8', right: '#7c8cf0' },
  mass:     { label: 'Dwellings',        top: '#f7f3ec', left: '#e4ddd0', right: '#ede7db' },
};

// Generator category → sketch key. units = the building mass; amenity reads as
// the dotted semi-open programme; green/connector are the communal/open fabric;
// parking maps to the service-core key (the only "hard service" the DXF carries
// at floor level besides cores).
const CATEGORY_TO_KEY = {
  units:     'mass',
  amenity:   'semiOpen',
  green:     'communal',
  connector: 'communal',
  parking:   'service',
};

export function keyForCategory(category) {
  return CATEGORY_TO_KEY[category] || 'mass';
}

export function colorForCategory(category) {
  return SKETCH_KEYS[keyForCategory(category)];
}

// Legend rows in the sketch's own order (communal, semi-open, service), with
// the dwelling mass last — exactly the key the architect drew.
export const LEGEND_ROWS = ['communal', 'semiOpen', 'service', 'mass']
  .map(k => ({ key: k, ...SKETCH_KEYS[k] }));
