/**
 * Computes a Bill of Materials for a configured unit.
 * All quantities derived from typology grid dimensions + config choices.
 */

const CELL   = 3.0;   // m per grid cell
const WALL_H = 2.8;   // m
const SLAB_T = 0.22;  // m slab thickness
const WALL_T = 0.18;  // m wall thickness
const COL_H  = 3.2;   // m column height (slab-to-slab)

// Mould reuse limits by form type
const MOULD_REUSE = {
  caststone: 40,
  grp:       20,
};

// Column types selectable in the Configure step (ids match
// data/structureCatalogue.json). Each carries the per-shaft weight and a
// material label so picking a different column type actually moves the BOM
// numbers, not just a cosmetic tag. shaftKg is the dominant column part weight.
export const COLUMN_TYPES = {
  COL_QUARTER:   { label: 'Quarter-Shell Column', shaftKg: 680, material: 'Cast stone · grade C45' },
  COL_SECONDARY: { label: 'Secondary Column',     shaftKg: 540, material: 'Cast stone · grade C40' },
  COL_HOLLOW:    { label: 'Hollow-Core Column',   shaftKg: 600, material: 'Cast stone · serviced core' },
};

// Part categories for grouping in UI
export const CATEGORIES = {
  STRUCTURAL: 'Structural',
  ENVELOPE:   'Envelope',
  OPENINGS:   'Openings',
  FITOUT:     'Fit-Out',
};

// Image references — paths to mould GLB previews / part diagrams
const PART_IMAGES = {
  COL_BASE:    '/moulds/COLAA0.glb',
  COL_SHAFT:   '/moulds/COLMOL0-A.glb',
  COL_CAPITAL: '/moulds/COLG-A.glb',
  COL_OUTER:   '/moulds/COLO0-0.glb',
  COL_B:       '/moulds/COL-B.glb',
  SLAB_FLOOR:  null,
  SLAB_ROOF:   null,
  WALL_EXT:    null,
  WALL_INT:    null,
  BAL_SLAB:    null,
  WIN_FRAME:   null,
  DOOR_ENTRY:  null,
  WET_POD:     null,
};

/**
 * @param {object} typology  — from typologies.json
 * @param {object} config    — { balcony, partition, pigment, glazing }
 * @param {object} layouts   — from roomLayouts.json
 * @returns {Array}          — sorted list of parts with qty, dims, weight, category
 */
export function computeBOM(typology, config, layouts) {
  const parts = [];
  const roomId = typology.glb?.replace('/', '').replace('.glb', '');
  const layout = layouts.rooms[roomId] || {};

  const gridX  = typology.gridX;
  const gridZ  = typology.gridZ;
  const floors = typology.twoStorey ? 2 : 1;

  // Some typologies (the largest 4-bed units) reuse a smaller GLB's geometry
  // for preview purposes because no dedicated asset exists for their declared
  // footprint — e.g. '4b6p' is a 7×5 grid but points at ROOM1.glb, whose real
  // layout is only 3×2. In that case the GLB's own column/wet-zone counts
  // describe the WRONG building and must not be trusted; fall back to counts
  // derived from the typology's own declared grid/bed count instead.
  const layoutMatchesTypology = layout.gridX === gridX && layout.gridZ === gridZ;

  // Columns. Count comes from the GLB layout by default (when it actually
  // matches the typology's footprint), but the Configure step can override it
  // (config.columnCountOverride) so the user can add/remove columns and watch
  // the BOM respond. The chosen column type sets the shaft weight + material.
  const columnPositions = layoutMatchesTypology ? (layout.columns || []) : [];
  const layoutColumnCount = columnPositions.length || (gridX + 1) * 2;
  const columnCount = Number.isFinite(config.columnCountOverride) && config.columnCountOverride > 0
    ? Math.round(config.columnCountOverride)
    : layoutColumnCount;
  const colType = COLUMN_TYPES[config.columnType] || COLUMN_TYPES.COL_QUARTER;
  const colShaftKg = colType.shaftKg;
  const colMaterial = colType.material;

  // ── STRUCTURAL ────────────────────────────────────────────────────────────

  // Each column = exactly 4 discrete cast-stone parts per floor:
  // base cap, shaft, and the capital split into 2 equal halves.
  const partsPerColumn = 4; // base cap + shaft + capital half × 2
  const capitalHalfKg = 235; // half of the old single-piece capital weight

  parts.push({
    id: 'COL_BASE',
    label: 'Column Base Cap',
    desc: 'Tapered frustum base — socket cast-in for shaft seating',
    category: CATEGORIES.STRUCTURAL,
    qty: columnCount,
    unit: 'pcs',
    dimLabel: `Ø${(WALL_T * 4).toFixed(2)}m × ${(COL_H * 0.15).toFixed(2)}m`,
    weightKgEach: 420,
    weightKgTotal: 420 * columnCount,
    material: 'Cast stone · grade C45',
    mouldType: 'caststone',
    uniqueMoulds: 1,
    repeatNote: `1 per column · ${columnCount} columns`,
    partsPerColumn: 1,
    image: PART_IMAGES.COL_BASE,
    color: '#787470',
  });

  parts.push({
    id: 'COL_SHAFT',
    label: 'Column Shaft',
    desc: 'Hollow post-tensioned shaft — continuous cast channel',
    category: CATEGORIES.STRUCTURAL,
    qty: columnCount * floors,
    unit: 'pcs',
    dimLabel: `${(WALL_T * 4).toFixed(2)}m sq × ${COL_H.toFixed(1)}m`,
    weightKgEach: colShaftKg,
    weightKgTotal: colShaftKg * columnCount * floors,
    material: colMaterial,
    mouldType: 'caststone',
    uniqueMoulds: 1,
    repeatNote: `1 per column per floor · ${columnCount} columns × ${floors} floor${floors > 1 ? 's' : ''}`,
    partsPerColumn: floors,
    image: PART_IMAGES.COL_SHAFT,
    color: '#787470',
  });

  parts.push({
    id: 'COL_CAPITAL',
    label: 'Column Capital Half',
    desc: 'Star capital split into 2 equal halves — assembled and seamed on-site',
    category: CATEGORIES.STRUCTURAL,
    qty: columnCount * floors * 2,
    unit: 'pcs',
    dimLabel: `2 half-segments per capital`,
    weightKgEach: capitalHalfKg,
    weightKgTotal: capitalHalfKg * columnCount * floors * 2,
    material: 'Cast stone · grade C45',
    mouldType: 'caststone',
    uniqueMoulds: 1,
    repeatNote: `2 identical halves per capital · ${columnCount * floors} capitals total`,
    partsPerColumn: floors * 2,
    image: PART_IMAGES.COL_CAPITAL,
    color: '#787470',
  });

  // Summary annotation for the card group
  const totalColumnParts = columnCount * floors * partsPerColumn;
  parts.push({
    id: 'COL_SUMMARY',
    label: 'Column Assembly Total',
    desc: `${columnCount} column positions · ${partsPerColumn} discrete parts each · ${totalColumnParts} cast-stone pieces total`,
    category: CATEGORIES.STRUCTURAL,
    qty: columnCount,
    unit: 'columns',
    dimLabel: `${partsPerColumn} parts per column`,
    weightKgEach: Math.round((420 + (colShaftKg + capitalHalfKg * 2) * floors)),
    weightKgTotal: Math.round((420 + (colShaftKg + capitalHalfKg * 2) * floors) * columnCount),
    material: 'Cast stone · assembly',
    mouldType: null,
    uniqueMoulds: 0,
    repeatNote: `${totalColumnParts} total column parts`,
    image: null,
    color: '#c9a96e',
    isSummary: true,
  });

  // Floor/roof slab panels — each slab position is cast and shipped as 3
  // equal thirds (same material, weight/3 each), same pattern as the wall split.
  const SLAB_SPLIT = 3;
  const slabPanelW = CELL;
  const slabPanelD = CELL;
  const slabCount  = gridX * gridZ * floors;
  const slabFloorThirdKg = Math.round(slabPanelW * slabPanelD * SLAB_T * 2400 / SLAB_SPLIT);
  parts.push({
    id: 'SLAB_FLOOR',
    label: 'Floor Slab Third',
    desc: `${slabPanelW}m × ${slabPanelD}m cast-stone plank, cast in 3 equal thirds — spans column grid, identical repeat`,
    category: CATEGORIES.STRUCTURAL,
    qty: slabCount * SLAB_SPLIT,
    unit: 'pcs',
    dimLabel: `${(slabPanelW / SLAB_SPLIT).toFixed(2)}m × ${slabPanelD}m × ${SLAB_T}m`,
    weightKgEach: slabFloorThirdKg,
    weightKgTotal: slabFloorThirdKg * slabCount * SLAB_SPLIT,
    material: 'Cast stone · grade C35',
    mouldType: 'caststone',
    uniqueMoulds: 1,
    repeatNote: `3 thirds per slab · ${slabCount} slabs · ${slabCount * SLAB_SPLIT} casts`,
    image: PART_IMAGES.SLAB_FLOOR,
    color: '#a09c98',
  });

  const roofCount = gridX * gridZ;
  const slabRoofThirdKg = Math.round(slabPanelW * slabPanelD * (SLAB_T + 0.04) * 2500 / SLAB_SPLIT);
  parts.push({
    id: 'SLAB_ROOF',
    label: 'Roof Slab Third',
    desc: 'Top-of-unit cast-stone plank with waterproof topping, cast in 3 equal thirds',
    category: CATEGORIES.STRUCTURAL,
    qty: roofCount * SLAB_SPLIT,
    unit: 'pcs',
    dimLabel: `${(slabPanelW / SLAB_SPLIT).toFixed(2)}m × ${slabPanelD}m × ${(SLAB_T + 0.04).toFixed(2)}m`,
    weightKgEach: slabRoofThirdKg,
    weightKgTotal: slabRoofThirdKg * roofCount * SLAB_SPLIT,
    material: 'Cast stone · waterproof grade C40',
    mouldType: 'caststone',
    uniqueMoulds: 1,
    repeatNote: `3 thirds per slab · ${roofCount} slabs · ${roofCount * SLAB_SPLIT} casts`,
    image: PART_IMAGES.SLAB_ROOF,
    color: '#a09c98',
  });

  // ── ENVELOPE ──────────────────────────────────────────────────────────────
  // Each wall position is cast and shipped as 2 equal half-panels (split down
  // the middle) — same material, half the weight each, total mass unchanged.
  const WALL_SPLIT = 2;

  const perimeterCells = 2 * (gridX + gridZ);
  const extWallCount   = perimeterCells * floors;
  const extWallHalfKg  = Math.round(CELL * WALL_H * WALL_T * 2300 / WALL_SPLIT);
  parts.push({
    id: 'WALL_EXT',
    label: 'External Wall Half-Panel',
    desc: `${config.pigment !== 'PIG_NONE' ? 'Pigmented' : 'Natural'} cast-stone facade panel — cast in 2 equal halves`,
    category: CATEGORIES.ENVELOPE,
    qty: extWallCount * WALL_SPLIT,
    unit: 'pcs',
    dimLabel: `${(CELL / WALL_SPLIT).toFixed(2)}m × ${WALL_H}m × ${WALL_T}m`,
    weightKgEach: extWallHalfKg,
    weightKgTotal: extWallHalfKg * extWallCount * WALL_SPLIT,
    material: `Cast stone${config.pigment !== 'PIG_NONE' ? ' · mineral pigmented' : ''}`,
    mouldType: 'caststone',
    uniqueMoulds: 1,
    repeatNote: `2 halves per wall · ${extWallCount} walls · ${extWallCount * WALL_SPLIT} casts`,
    image: PART_IMAGES.WALL_EXT,
    color: '#bcb8b2',
  });

  const partitionWalls = layout.walls || [];
  const internalWallCount =
    config.partition === 'PAR_OPEN'  ? 0 :
    config.partition === 'PAR_SOFT'  ? Math.ceil(partitionWalls.length * 0.6) :
    partitionWalls.length;

  if (internalWallCount > 0) {
    const intWallHalfKg = Math.round(CELL * WALL_H * WALL_T * 2100 / WALL_SPLIT);
    parts.push({
      id: 'WALL_INT',
      label: 'Internal Partition Half-Panel',
      desc: (config.partition === 'PAR_SOFT'
        ? 'Cast-stone movable screens — slotted base track'
        : 'Fixed cast-stone internal partition — mortar-set') + ', cast in 2 equal halves',
      category: CATEGORIES.ENVELOPE,
      qty: internalWallCount * floors * WALL_SPLIT,
      unit: 'pcs',
      dimLabel: `${(CELL / WALL_SPLIT).toFixed(2)}m × ${WALL_H}m × ${WALL_T}m`,
      weightKgEach: intWallHalfKg,
      weightKgTotal: intWallHalfKg * internalWallCount * floors * WALL_SPLIT,
      material: config.partition === 'PAR_SOFT' ? 'Cast stone · lightweight mix' : 'Cast stone',
      mouldType: 'caststone',
      uniqueMoulds: 1,
      repeatNote: `2 halves per wall · ${internalWallCount * floors} walls · ${internalWallCount * floors * WALL_SPLIT} casts`,
      image: PART_IMAGES.WALL_INT,
      color: '#d0ccc6',
    });
  }

  const balconyData = {
    BAL_NONE:    { proj: 0,   wKg: 0   },
    BAL_SHALLOW: { proj: 0.6, wKg: 80  },
    BAL_MID:     { proj: 1.0, wKg: 130 },
    BAL_DEEP:    { proj: 1.5, wKg: 165 },
  };
  const bal = balconyData[config.balcony] || balconyData.BAL_NONE;
  if (bal.proj > 0) {
    const balQty = gridX * floors;
    parts.push({
      id: 'BAL_SLAB',
      label: 'Balcony Slab',
      desc: `${bal.proj}m cantilever — cast-stone, drainage outlet cast-in`,
      category: CATEGORIES.ENVELOPE,
      qty: balQty,
      unit: 'pcs',
      dimLabel: `${CELL}m × ${bal.proj}m × ${SLAB_T}m`,
      weightKgEach: bal.wKg,
      weightKgTotal: bal.wKg * balQty,
      material: 'Cast stone · grade C40',
      mouldType: 'caststone',
      uniqueMoulds: 1,
      repeatNote: `${balQty} identical balcony slabs`,
      image: PART_IMAGES.BAL_SLAB,
      color: '#a09c98',
    });
  }

  // ── OPENINGS ──────────────────────────────────────────────────────────────

  const glazingLabel = {
    GLZ_STANDARD: 'Double-glazed unit · 1.2 W/m²K',
    GLZ_TRIPLE:   'Triple-glazed unit · 0.7 W/m²K',
    GLZ_SMART:    'Smart electrochromic glass · 0.9 W/m²K',
  }[config.glazing] || 'Double-glazed unit';

  const windowCount = Math.round(perimeterCells * 0.4) * floors;
  parts.push({
    id: 'WIN_FRAME',
    label: 'Window + Glazing Unit',
    desc: glazingLabel,
    category: CATEGORIES.OPENINGS,
    qty: windowCount,
    unit: 'pcs',
    dimLabel: `1.2m × 1.8m`,
    weightKgEach: 48,
    weightKgTotal: 48 * windowCount,
    material: `Cast-stone surround · ${config.glazing === 'GLZ_SMART' ? 'smart glass' : config.glazing === 'GLZ_TRIPLE' ? 'triple-pane glass' : 'double-pane glass'}`,
    mouldType: null,
    uniqueMoulds: 0,
    repeatNote: `${windowCount} identical units`,
    image: PART_IMAGES.WIN_FRAME,
    color: '#88aacc',
  });

  parts.push({
    id: 'DOOR_ENTRY',
    label: 'Entry Door Set',
    desc: 'Solid-core pivot door — cast-stone surround, threshold panel',
    category: CATEGORIES.OPENINGS,
    qty: 1,
    unit: 'set',
    dimLabel: `1.0m × 2.2m`,
    weightKgEach: 95,
    weightKgTotal: 95,
    material: 'Cast-stone surround · solid-core pivot leaf',
    mouldType: 'caststone',
    uniqueMoulds: 1,
    repeatNote: `1 entry per unit`,
    image: PART_IMAGES.DOOR_ENTRY,
    color: '#6a6055',
  });

  // ── FIT-OUT ───────────────────────────────────────────────────────────────

  // When the GLB layout doesn't match the typology's declared footprint, its
  // real wet-zone count (bathrooms/kitchen) describes the wrong building —
  // derive a sane count from bed count instead: 1 bathroom per 2 bedrooms
  // (rounded up) plus 1 kitchen, every unit has at least 1 wet zone.
  const wetZoneLabels = layoutMatchesTypology
    ? (layout.wetZones || []).map(w => w.label)
    : (() => {
        const bathCount = Math.max(1, Math.ceil((typology.beds || 1) / 2));
        return [...Array(bathCount)].map((_, i) => i === 0 ? 'Bath' : `Bath ${i + 1}`).concat('Kitchen');
      })();

  if (wetZoneLabels.length > 0) {
    parts.push({
      id: 'WET_POD',
      label: 'Wet Zone Pod',
      desc: `${wetZoneLabels.join(' + ')} — prefabricated plumbing pod, cast-in drainage`,
      category: CATEGORIES.FITOUT,
      qty: wetZoneLabels.length * floors,
      unit: 'pcs',
      dimLabel: `${CELL}m × ${CELL}m module`,
      weightKgEach: 320,
      weightKgTotal: 320 * wetZoneLabels.length * floors,
      material: 'GRP shell · cast-stone surround',
      mouldType: 'grp',
      uniqueMoulds: 1,
      repeatNote: `${wetZoneLabels.length * floors} wet pods`,
      image: PART_IMAGES.WET_POD,
      color: '#8899aa',
    });
  }

  return parts;
}

/** Summarise BOM into totals */
export function bomSummary(parts) {
  const nonSummary = parts.filter(p => !p.isSummary);
  const totalPieces = nonSummary.reduce((s, p) => s + p.qty, 0);
  const totalWeightKg = nonSummary.reduce((s, p) => s + p.weightKgTotal, 0);
  const totalMoulds = nonSummary.reduce((s, p) => s + (p.uniqueMoulds || 0), 0);
  return {
    totalPieces,
    totalWeightT: (totalWeightKg / 1000).toFixed(1),
    totalMoulds,
    byCategory: Object.fromEntries(
      Object.values(CATEGORIES).map(cat => [
        cat,
        nonSummary.filter(p => p.category === cat),
      ])
    ),
  };
}

/**
 * Returns mould schedule: for each castable part, how many mould sets are
 * needed given the reuse limit, total casts required, and batching.
 */
export function mouldSchedule(parts) {
  return parts
    .filter(p => p.mouldType && p.uniqueMoulds > 0 && !p.isSummary)
    .map(p => {
      const reuse = MOULD_REUSE[p.mouldType] || 20;
      const totalCasts = p.qty;
      const mouldSetsNeeded = Math.ceil(totalCasts / reuse) * p.uniqueMoulds;
      const castingsPerSet  = Math.ceil(totalCasts / mouldSetsNeeded);
      return {
        partId:          p.id,
        label:           p.label,
        mouldType:       p.mouldType,
        uniqueMoulds:    p.uniqueMoulds,
        totalCasts,
        mouldSetsNeeded,
        castingsPerSet,
        reuseLimit:      reuse,
      };
    });
}
