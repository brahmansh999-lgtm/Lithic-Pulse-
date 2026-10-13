import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { useGLTF, Text, useTexture, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import RoomEnv from '../shared/RoomEnv';
import { applyMaterials, applyFlatMaterials } from './utils/materials';
// Drop a real exterior panorama at public/hdri/exterior.hdr to give windows
// here the same real-environment reflections as the Hero/render view —
// RoomEnv falls back to its synthetic studio environment until that file
// exists, so this is safe to leave wired in unconditionally.
const EXTERIOR_HDRI_URL = '/hdri/exterior.hdr';
import layouts from './data/roomLayouts.json';
import './RoomConfigurator.css';

// ─── Constants ────────────────────────────────────────────────────────────────
const CELL = layouts.cellSize;

// Clearance verdict styling — "is this a good choice?" readout colors.
const CLEARANCE_STYLE = {
  good:    { label: 'Good clearance',     bg: 'rgba(110,200,140,0.08)', border: 'rgba(110,200,140,0.3)', fg: '#8fdba8' },
  tight:   { label: 'Tight clearance',    bg: 'rgba(230,180,90,0.09)',  border: 'rgba(230,180,90,0.32)', fg: '#e8c878' },
  blocked: { label: 'Blocked — too close',bg: 'rgba(230,90,90,0.10)',   border: 'rgba(230,90,90,0.35)',  fg: '#ec8888' },
  overlap: { label: 'Overlapping pieces', bg: 'rgba(230,60,60,0.14)',   border: 'rgba(230,60,60,0.45)',  fg: '#ff7a7a' },
};

// Pricing-factor verdict styling — same visual language as clearance, on cost.
const COST_STYLE = {
  good:  { label: 'Within budget', bg: 'rgba(110,200,140,0.08)', border: 'rgba(110,200,140,0.3)', fg: '#8fdba8' },
  tight: { label: 'Near budget',   bg: 'rgba(230,180,90,0.09)',  border: 'rgba(230,180,90,0.32)', fg: '#e8c878' },
  over:  { label: 'Over budget',   bg: 'rgba(230,90,90,0.10)',   border: 'rgba(230,90,90,0.35)',  fg: '#ec8888' },
};

export const ROOMS_META = [
  { id: '1l', file: '/1l.glb', label: 'Unit 01', typology: '1-BHK' },
  { id: '2l', file: '/2l.glb', label: 'Unit 02', typology: '1-BHK' },
  { id: '3l', file: '/3l.glb', label: 'Unit 03', typology: '2-BHK' },
  { id: '4l', file: '/4l.glb', label: 'Unit 04', typology: '2-BHK' },
  { id: '5l', file: '/5l.glb', label: 'Unit 05', typology: '3-BHK' },
];

// ─── Furniture catalogue ──────────────────────────────────────────────────────
const FURN_CATALOGUE = [
  { category: 'Beds', icon: '🛏', color: '#c8a870', items: [
    { id: 'bed-single',    label: 'Single Bed',        w:0.90, d:2.00, h:0.55, mat:'fabric',  color:'#c8b89a', icon:'🛏' },
    { id: 'bed-double',    label: 'Double Bed',        w:1.40, d:2.00, h:0.55, mat:'fabric',  color:'#d0c0a0', icon:'🛏' },
    { id: 'bed-queen',     label: 'Queen Bed',         w:1.60, d:2.00, h:0.55, mat:'fabric',  color:'#b8a888', icon:'🛏' },
    { id: 'bed-king',      label: 'King Bed',          w:1.80, d:2.10, h:0.55, mat:'fabric',  color:'#c0b090', icon:'🛏' },
    { id: 'bed-bunk',      label: 'Bunk Bed',          w:0.90, d:2.00, h:1.60, mat:'wood',    color:'#a89878', icon:'🛏' },
    { id: 'bed-daybed',    label: 'Day Bed',           w:1.00, d:2.10, h:0.42, mat:'fabric',  color:'#b8b0a0', icon:'🛋' },
    { id: 'nightstand',    label: 'Nightstand',        w:0.50, d:0.50, h:0.60, mat:'wood',    color:'#8a7060', icon:'🟫' },
    { id: 'dressing-t',   label: 'Dressing Table',    w:1.20, d:0.50, h:0.75, mat:'wood',    color:'#9a8070', icon:'🪞' },
    { id: 'wardrobe-2d',   label: 'Wardrobe 2-Door',   w:1.20, d:0.60, h:2.10, mat:'wood',    color:'#b0a898', icon:'🚪' },
    { id: 'wardrobe-3d',   label: 'Wardrobe 3-Door',   w:1.80, d:0.60, h:2.10, mat:'wood',    color:'#a89888', icon:'🚪' },
    { id: 'ottoman-bed',   label: 'Bench / Ottoman',   w:1.40, d:0.50, h:0.45, mat:'fabric',  color:'#9a9080', icon:'🟫' },
    { id: 'floor-lamp-b',  label: 'Floor Lamp',        w:0.35, d:0.35, h:1.60, mat:'metal',   color:'#d4c8a8', icon:'💡' },
  ]},
  { category: 'Sofas', icon: '🛋', color: '#8088a0', items: [
    { id: 'sofa-2',        label: '2-Seat Sofa',       w:1.40, d:0.85, h:0.80, mat:'fabric',  color:'#707080', icon:'🛋' },
    { id: 'sofa-3',        label: '3-Seat Sofa',       w:2.00, d:0.90, h:0.80, mat:'fabric',  color:'#6a6878', icon:'🛋' },
    { id: 'sofa-l',        label: 'L-Shape Sofa',      w:2.40, d:1.60, h:0.80, mat:'fabric',  color:'#5a5868', icon:'🛋' },
    { id: 'sofa-modular',  label: 'Modular Sofa',      w:2.80, d:1.80, h:0.80, mat:'fabric',  color:'#686678', icon:'🛋' },
    { id: 'armchair',      label: 'Armchair',          w:0.82, d:0.82, h:0.85, mat:'fabric',  color:'#7a7880', icon:'🪑' },
    { id: 'armchair-wing', label: 'Wing Chair',        w:0.90, d:0.90, h:1.10, mat:'fabric',  color:'#888090', icon:'🪑' },
    { id: 'ottoman',       label: 'Ottoman',           w:0.70, d:0.70, h:0.42, mat:'fabric',  color:'#8a8278', icon:'🟫' },
    { id: 'chaise',        label: 'Chaise Longue',     w:0.90, d:1.80, h:0.75, mat:'fabric',  color:'#807888', icon:'🛋' },
    { id: 'sofa-bench',    label: 'Sofa Bench',        w:1.60, d:0.45, h:0.48, mat:'fabric',  color:'#706880', icon:'🟫' },
    { id: 'tv-unit',       label: 'TV Unit',           w:1.60, d:0.42, h:0.52, mat:'wood',    color:'#303038', icon:'📺' },
    { id: 'plant-lg',      label: 'Plant (Large)',     w:0.55, d:0.55, h:1.20, mat:'none',    color:'#3a6040', icon:'🌿' },
    { id: 'plant-sm',      label: 'Plant (Small)',     w:0.35, d:0.35, h:0.60, mat:'none',    color:'#4a7050', icon:'🌿' },
  ]},
  { category: 'Dining', icon: '🍽', color: '#9a8878', items: [
    { id: 'tbl-d4',        label: 'Table 4P',          w:1.40, d:0.90, h:0.75, mat:'wood',    color:'#7a6858', icon:'🟫' },
    { id: 'tbl-d6',        label: 'Table 6P',          w:1.80, d:0.90, h:0.75, mat:'wood',    color:'#6a5848', icon:'🟫' },
    { id: 'tbl-d8',        label: 'Table 8P',          w:2.40, d:1.00, h:0.75, mat:'wood',    color:'#5a4838', icon:'🟫' },
    { id: 'tbl-round-4',   label: 'Round Table 4P',    w:1.10, d:1.10, h:0.75, mat:'wood',    color:'#806858', icon:'⭕' },
    { id: 'tbl-round-6',   label: 'Round Table 6P',    w:1.40, d:1.40, h:0.75, mat:'wood',    color:'#705848', icon:'⭕' },
    { id: 'bench-d',       label: 'Dining Bench',      w:1.40, d:0.38, h:0.46, mat:'wood',    color:'#8a7060', icon:'🟫' },
    { id: 'chair-d',       label: 'Dining Chair',      w:0.45, d:0.52, h:0.95, mat:'wood',    color:'#806858', icon:'🪑' },
    { id: 'chair-stool',   label: 'Bar Stool',         w:0.40, d:0.40, h:1.05, mat:'metal',   color:'#808090', icon:'🪑' },
    { id: 'buffet',        label: 'Buffet',            w:1.60, d:0.48, h:0.85, mat:'wood',    color:'#605040', icon:'🟫' },
    { id: 'bar-cart',      label: 'Bar Cart',          w:0.60, d:0.40, h:0.90, mat:'metal',   color:'#909898', icon:'🛒' },
    { id: 'plant-dining',  label: 'Plant',             w:0.40, d:0.40, h:0.80, mat:'none',    color:'#3a6040', icon:'🌿' },
    { id: 'sideboard',     label: 'Sideboard',         w:1.60, d:0.45, h:0.85, mat:'wood',    color:'#706050', icon:'🟫' },
  ]},
  { category: 'Tables', icon: '🖥', color: '#b89868', items: [
    { id: 'tbl-coffee',    label: 'Coffee Table',      w:1.10, d:0.55, h:0.42, mat:'wood',    color:'#806858', icon:'🟫' },
    { id: 'tbl-coffee-lg', label: 'Coffee Table L',    w:1.40, d:0.70, h:0.42, mat:'wood',    color:'#705848', icon:'🟫' },
    { id: 'tbl-side',      label: 'Side Table',        w:0.50, d:0.50, h:0.56, mat:'wood',    color:'#907868', icon:'🟫' },
    { id: 'desk',          label: 'Work Desk',         w:1.20, d:0.60, h:0.75, mat:'wood',    color:'#8a7060', icon:'🖥' },
    { id: 'desk-lg',       label: 'Large Desk',        w:1.60, d:0.70, h:0.75, mat:'wood',    color:'#806858', icon:'🖥' },
    { id: 'desk-corner',   label: 'Corner Desk',       w:1.80, d:1.50, h:0.75, mat:'wood',    color:'#a09080', icon:'🖥' },
    { id: 'desk-standing', label: 'Standing Desk',     w:1.40, d:0.70, h:1.10, mat:'metal',   color:'#8090a0', icon:'🖥' },
    { id: 'console-tbl',   label: 'Console Table',     w:1.20, d:0.35, h:0.80, mat:'wood',    color:'#987868', icon:'🟫' },
    { id: 'pc-chair',      label: 'Office Chair',      w:0.65, d:0.65, h:1.15, mat:'fabric',  color:'#202830', icon:'🪑' },
    { id: 'bookshelf',     label: 'Bookshelf',         w:0.90, d:0.30, h:1.80, mat:'wood',    color:'#806858', icon:'📚' },
    { id: 'bookshelf-w',   label: 'Wide Bookshelf',    w:1.80, d:0.30, h:1.80, mat:'wood',    color:'#705848', icon:'📚' },
    { id: 'footstool',     label: 'Footstool',         w:0.50, d:0.50, h:0.38, mat:'fabric',  color:'#807868', icon:'🟫' },
  ]},
  { category: 'Storage', icon: '📦', color: '#a09080', items: [
    { id: 'wardrobe-ww',   label: 'Walk-In Wardrobe',  w:2.40, d:1.20, h:2.10, mat:'wood',    color:'#887870', icon:'🚪' },
    { id: 'chest',         label: 'Chest of Drawers',  w:0.80, d:0.50, h:1.10, mat:'wood',    color:'#907868', icon:'🟫' },
    { id: 'shoe-rack',     label: 'Shoe Rack',         w:1.00, d:0.35, h:1.20, mat:'wood',    color:'#808078', icon:'🟫' },
    { id: 'coat-hook',     label: 'Coat Stand',        w:0.40, d:0.40, h:1.70, mat:'metal',   color:'#9090a0', icon:'🧥' },
    { id: 'storage-box',   label: 'Storage Box',       w:0.60, d:0.60, h:0.40, mat:'fabric',  color:'#908878', icon:'📦' },
    { id: 'display-cab',   label: 'Display Cabinet',   w:1.00, d:0.38, h:1.80, mat:'wood',    color:'#887060', icon:'🟫' },
    { id: 'linen-press',   label: 'Linen Press',       w:0.90, d:0.50, h:2.00, mat:'wood',    color:'#988070', icon:'🚪' },
    { id: 'filing-cab',    label: 'Filing Cabinet',    w:0.46, d:0.62, h:1.35, mat:'metal',   color:'#687080', icon:'🟫' },
    { id: 'tv-unit-lg',    label: 'TV Unit Large',     w:2.20, d:0.42, h:0.52, mat:'wood',    color:'#282830', icon:'📺' },
    { id: 'shelf-float',   label: 'Floating Shelf',    w:1.20, d:0.25, h:0.20, mat:'wood',    color:'#907868', icon:'🟫' },
    { id: 'coat-rack',     label: 'Coat Rack',         w:1.00, d:0.30, h:1.85, mat:'metal',   color:'#989090', icon:'🧥' },
    { id: 'toy-box',       label: 'Storage Trunk',     w:1.10, d:0.55, h:0.55, mat:'fabric',  color:'#9a8878', icon:'📦' },
  ]},
  { category: 'Kitchen', icon: '🍳', color: '#707878', items: [
    { id: 'kit-counter',   label: 'Counter (L)',       w:2.40, d:0.62, h:0.90, mat:'concrete',color:'#c8c0b0', icon:'🟫' },
    { id: 'kit-counter-s', label: 'Counter (S)',       w:1.20, d:0.62, h:0.90, mat:'concrete',color:'#c0b8a8', icon:'🟫' },
    { id: 'kit-island',    label: 'Island',            w:1.60, d:0.90, h:0.90, mat:'concrete',color:'#d0c8b8', icon:'🟫' },
    { id: 'kit-island-lg', label: 'Island + Seats',    w:2.00, d:1.10, h:0.90, mat:'concrete',color:'#d8d0c0', icon:'🟫' },
    { id: 'fridge',        label: 'Fridge',            w:0.70, d:0.70, h:1.75, mat:'metal',   color:'#d0d0d8', icon:'🧊' },
    { id: 'fridge-us',     label: 'Fridge US (wide)',  w:0.90, d:0.72, h:1.80, mat:'metal',   color:'#c8c8d0', icon:'🧊' },
    { id: 'oven',          label: 'Oven / Cooker',     w:0.60, d:0.60, h:0.90, mat:'metal',   color:'#909098', icon:'🍳' },
    { id: 'washing-m',     label: 'Washer',            w:0.60, d:0.60, h:0.85, mat:'metal',   color:'#a8a8b0', icon:'🫧' },
    { id: 'dishwasher',    label: 'Dishwasher',        w:0.60, d:0.60, h:0.85, mat:'metal',   color:'#b8b8c0', icon:'🫧' },
    { id: 'pantry-cab',    label: 'Pantry Cabinet',    w:0.60, d:0.60, h:2.10, mat:'wood',    color:'#b8b0a0', icon:'🚪' },
    { id: 'microwave',     label: 'Microwave',         w:0.55, d:0.40, h:0.32, mat:'metal',   color:'#808088', icon:'📡' },
    { id: 'dryer',         label: 'Dryer',             w:0.60, d:0.60, h:0.85, mat:'metal',   color:'#b0b0b8', icon:'🫧' },
  ]},
  { category: 'Bathroom', icon: '🚿', color: '#88a0b0', items: [
    { id: 'bathtub',       label: 'Bathtub',           w:1.70, d:0.75, h:0.55, mat:'none',    color:'#dce8f0', icon:'🛁' },
    { id: 'bathtub-free',  label: 'Freestanding Bath', w:1.80, d:0.80, h:0.65, mat:'none',    color:'#e4eef8', icon:'🛁' },
    { id: 'shower-900',    label: 'Shower 900',        w:0.90, d:0.90, h:0.06, mat:'none',    color:'#b8d0e8', icon:'🚿' },
    { id: 'shower-1200',   label: 'Shower 1200',       w:1.20, d:0.90, h:0.06, mat:'none',    color:'#b0c8e0', icon:'🚿' },
    { id: 'wc',            label: 'WC',                w:0.40, d:0.70, h:0.80, mat:'none',    color:'#e0e8f0', icon:'🚽' },
    { id: 'wc-wall',       label: 'Wall-Hung WC',      w:0.38, d:0.55, h:0.50, mat:'none',    color:'#d8e0e8', icon:'🚽' },
    { id: 'vanity-s',      label: 'Vanity Single',     w:0.60, d:0.50, h:0.85, mat:'wood',    color:'#b0a8a0', icon:'🪥' },
    { id: 'vanity-d',      label: 'Vanity Double',     w:1.20, d:0.50, h:0.85, mat:'wood',    color:'#a8a098', icon:'🪥' },
    { id: 'vanity-lg',     label: 'Vanity Large',      w:1.60, d:0.50, h:0.85, mat:'wood',    color:'#a09890', icon:'🪥' },
    { id: 'towel-rack',    label: 'Towel Rail',        w:0.60, d:0.12, h:0.90, mat:'metal',   color:'#c8c8d0', icon:'🧺' },
    { id: 'laundry-bin',   label: 'Laundry Bin',       w:0.45, d:0.45, h:0.65, mat:'fabric',  color:'#a0b0b8', icon:'🧺' },
    { id: 'mirror-cab',    label: 'Mirror Cabinet',    w:0.80, d:0.15, h:0.70, mat:'metal',   color:'#c8d0d8', icon:'🪞' },
  ]},
];

// Estimated retail cost (£) per catalogue item — derived from footprint ×
// height × a per-material £/m³ rate, not a hand-typed price list. This is
// a defensible *estimate* for budget-pressure feedback, not a supplier quote.
const MATERIAL_RATE_PER_M3 = { wood: 320, fabric: 260, metal: 480, none: 180 };
const ITEM_COST_FLOOR = 25; // smallest items (towel rail etc.) still cost something real

function estimateCost(item) {
  const volume = (item.w || 0.5) * (item.d || 0.5) * (item.h || 0.5);
  const rate = MATERIAL_RATE_PER_M3[item.mat] ?? MATERIAL_RATE_PER_M3.none;
  return Math.max(ITEM_COST_FLOOR, Math.round(volume * rate));
}

// id → catalogue item lookup, built once (covers every category/item).
const FURN_BY_ID = {};
FURN_CATALOGUE.forEach(cat => cat.items.forEach(it => { FURN_BY_ID[it.id] = it; }));

function furnCost(id) {
  const item = FURN_BY_ID[id];
  return item ? estimateCost(item) : 0;
}

// Per-typology fit-out budget (£) — a reasonable ceiling for furnishing a
// unit of this size, used only as a "is this overspending" signal, not a
// hard cap (you can still place pieces over budget; the room just reacts).
const TYPOLOGY_BUDGET = { '1-BHK': 3500, '2-BHK': 5500, '3-BHK': 8000, 'Cluster': 11000 };

// ─── GLTF furniture model map ────────────────────────────────────────────────
const FURN_MODEL_MAP = {
  // Beds
  'bed-single':    '/furniture/bed/GothicBed_01/GothicBed_01_1k.gltf',
  'bed-double':    '/furniture/bed/GothicBed_01/GothicBed_01_1k.gltf',
  'bed-queen':     '/furniture/bed/GothicBed_01/GothicBed_01_1k.gltf',
  'bed-king':      '/furniture/bed/GothicBed_01/GothicBed_01_1k.gltf',
  'nightstand':    '/furniture/nightstand/ClassicNightstand_01/ClassicNightstand_01_1k.gltf',
  'dressing-t':    '/furniture/nightstand/painted_wooden_nightstand/painted_wooden_nightstand_1k.gltf',
  'ottoman-bed':   '/furniture/ottoman/Ottoman_01/Ottoman_01_1k.gltf',
  // Sofas
  'sofa-2':        '/furniture/sofa/sofa_02/sofa_02_1k.gltf',
  'sofa-3':        '/furniture/sofa/Sofa_01/Sofa_01_1k.gltf',
  'sofa-l':        '/furniture/sofa/sofa_03/sofa_03_1k.gltf',
  'sofa-modular':  '/furniture/sofa/painted_wooden_sofa/painted_wooden_sofa_1k.gltf',
  'armchair':      '/furniture/chair/ArmChair_01/ArmChair_01_1k.gltf',
  'armchair-wing': '/furniture/chair/modern_arm_chair_01/modern_arm_chair_01_1k.gltf',
  'ottoman':       '/furniture/ottoman/Ottoman_01/Ottoman_01_1k.gltf',
  'chaise':        '/furniture/chair/mid_century_lounge_chair/mid_century_lounge_chair_1k.gltf',
  // Dining
  'tbl-d4':        '/furniture/table/WoodenTable_01/WoodenTable_01_1k.gltf',
  'tbl-d6':        '/furniture/table/WoodenTable_01/WoodenTable_01_1k.gltf',
  'tbl-round-4':   '/furniture/table/round_wooden_table_01/round_wooden_table_01_1k.gltf',
  'tbl-round-6':   '/furniture/table/round_wooden_table_01/round_wooden_table_01_1k.gltf',
  'chair-d':       '/furniture/chair/dining_chair_02/dining_chair_02_1k.gltf',
  // Tables / desks
  'tbl-coffee':    '/furniture/table/CoffeeTable_01/CoffeeTable_01_1k.gltf',
  'tbl-coffee-lg': '/furniture/table/modern_coffee_table_01/modern_coffee_table_01_1k.gltf',
  'tbl-side':      '/furniture/nightstand/side_table_01/side_table_01_1k.gltf',
  'desk':          '/furniture/desk/metal_office_desk/metal_office_desk_1k.gltf',
  'desk-lg':       '/furniture/desk/metal_office_desk/metal_office_desk_1k.gltf',
  'bookshelf':     '/furniture/storage/wooden_bookshelf_worn/wooden_bookshelf_worn_1k.gltf',
  'bookshelf-w':   '/furniture/storage/steel_frame_shelves_01/steel_frame_shelves_01_1k.gltf',
  'shelf-float':   '/furniture/storage/Shelf_01/Shelf_01_1k.gltf',
  // Storage
  'wardrobe-2d':   '/furniture/storage/modern_wooden_cabinet/modern_wooden_cabinet_1k.gltf',
  'wardrobe-3d':   '/furniture/storage/modern_wooden_cabinet/modern_wooden_cabinet_1k.gltf',
  'wardrobe-ww':   '/furniture/storage/modern_wooden_cabinet/modern_wooden_cabinet_1k.gltf',
  'chest':         '/furniture/storage/drawer_cabinet/drawer_cabinet_1k.gltf',
  'display-cab':   '/furniture/storage/drawer_cabinet/drawer_cabinet_1k.gltf',
  'linen-press':   '/furniture/storage/modern_wooden_cabinet/modern_wooden_cabinet_1k.gltf',
};

// Preload all mapped GLTF models
const _MODEL_PATHS = [...new Set(Object.values(FURN_MODEL_MAP))];

// ─── Texture loader (shared across all furniture pieces) ──────────────────────
// We load textures once via a separate component that uses useTexture,
// then pass them down. Much faster than loading inside each piece.

// Per-type material builders — called once per material type
const matCache = {};
function getFurnMat(matType, color) {
  const key = `${matType}_${color}`;
  if (matCache[key]) return matCache[key];

  let mat;
  if (matType === 'fabric') {
    mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color), roughness: 0.92, metalness: 0.0,
    });
  } else if (matType === 'metal') {
    mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color), roughness: 0.22, metalness: 0.88,
    });
  } else if (matType === 'none') {
    mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color), roughness: 0.55, metalness: 0.0, transparent: true, opacity: 0.82,
    });
  } else {
    // wood or concrete — plain tinted (textures loaded separately in FurnTextureLoader)
    mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color), roughness: matType === 'wood' ? 0.62 : 0.78, metalness: 0.0,
    });
  }
  matCache[key] = mat;
  return mat;
}

// A component that loads wood/concrete textures and patches them into placed pieces
export function FurnTextureApplier({ pieces }) {
  const wood = useTexture({
    map:          '/textures-opt/wood_walnut/diff.webp',
    normalMap:    '/textures-opt/wood_walnut/nor.webp',
    roughnessMap: '/textures-opt/wood_walnut/rough.webp',
  });
  const concrete = useTexture({
    map:          '/textures-opt/concrete_polished/diff.webp',
    normalMap:    '/textures-opt/concrete_polished/nor.webp',
    roughnessMap: '/textures-opt/concrete_polished/rough.webp',
  });

  useEffect(() => {
    // patch repeat & color space
    [wood.map, concrete.map].forEach(t => { if (t) { t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; } });
    [wood.normalMap, wood.roughnessMap, concrete.normalMap, concrete.roughnessMap].forEach(t => {
      if (t) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; }
    });

    // Clone a loaded texture and re-tile it. Only force a GPU re-upload when the
    // source actually has decoded image data — cloning before the image is ready
    // and flagging needsUpdate is what makes three log "Texture marked for update
    // but no image data found". A null source is skipped entirely.
    const cloneAndRepeat = (t, scale) => {
      if (!t || !t.image) return null;
      const c = t.clone();
      c.repeat.set(scale, scale);
      c.needsUpdate = true;
      return c;
    };

    // Apply textures to each wood/concrete material exactly ONCE. Previously this
    // re-cloned and GPU-re-uploaded 3 textures per cached material on every single
    // furniture placement/move (effect was keyed on `pieces`), which was the main
    // source of drag lag. Materials are shared+cached, so once a material has its
    // texture it never needs it re-applied — we skip any key already done.
    Object.entries(matCache).forEach(([key, mat]) => {
      if (_texturedMatKeys.has(key)) return;   // already textured — nothing to do
      if (key.startsWith('wood_')) {
        const map = cloneAndRepeat(wood.map, 8);
        const nor = cloneAndRepeat(wood.normalMap, 8);
        const rgh = cloneAndRepeat(wood.roughnessMap, 8);
        if (!map) return;            // textures not ready yet — effect re-runs when they are
        mat.map = map; mat.normalMap = nor; mat.roughnessMap = rgh;
        mat.needsUpdate = true;
        _texturedMatKeys.add(key);
      } else if (key.startsWith('concrete_')) {
        const map = cloneAndRepeat(concrete.map, 6);
        const nor = cloneAndRepeat(concrete.normalMap, 6);
        const rgh = cloneAndRepeat(concrete.roughnessMap, 6);
        if (!map) return;
        mat.map = map; mat.normalMap = nor; mat.roughnessMap = rgh;
        mat.needsUpdate = true;
        _texturedMatKeys.add(key);
      }
    });
  }, [wood, concrete, pieces]);

  return null;
}

// Tracks which cached material keys have already had their wood/concrete
// textures applied, so placing a 2nd piece of the same type is a no-op instead
// of re-cloning + re-uploading textures. Module-scoped to match matCache's
// lifetime (both are app-lifetime singletons).
const _texturedMatKeys = new Set();

// ─── Shared floor plane for furniture dragging (fallback when no surface hit) ──
const _FLOOR_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _PLANE_HIT   = new THREE.Vector3();

// ─── Error boundary — isolates furniture-load failures from the room/walls ────
class FurnitureErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch() {}
  render() {
    if (this.state.error) return null;
    return this.props.children;
  }
}

// ─── GLTF model renderer (scales model to fit floor footprint, natural height) ──
function FurnitureModelGLTF({ path, targetW, targetD, castShadow = false }) {
  const { scene } = useGLTF(path);

  const model = useMemo(() => {
    const clone = scene.clone(true);
    clone.updateMatrixWorld(true);
    // Shadow casting is OFF by default (perf, Configure step) — RoomHeroView
    // ("View Your Home") opts in via castShadow=true since that scene is a
    // one-shot capture, not an interactive 60fps view, so the extra draw cost
    // is fine and real shadows are what sell it as an actually-lit room.
    clone.traverse(n => { if (n.isMesh) { n.castShadow = castShadow; n.receiveShadow = castShadow; } });

    // Compute bounding box in model's own space (no parent yet)
    const box  = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());

    // Scale by floor footprint only — don't constrain height so models look natural
    if (size.x > 0 && size.z > 0) {
      const scale = Math.min(targetW / size.x, targetD / size.z);
      if (Number.isFinite(scale) && scale > 0) {
        clone.scale.multiplyScalar(scale);
        clone.updateMatrixWorld(true);
      }
    }

    // Center horizontally and sit the bottom exactly on y=0. We apply the
    // position, then RE-MEASURE the world box and correct any residual y offset
    // — some models have internal origin offsets / empty nodes that make a
    // single-pass `-min.y` land the base above or below the floor (the floating
    // nightstand / wardrobe). A second correction pass snaps the true lowest
    // visible point onto y=0 regardless of the model's internal pivot.
    let nb  = new THREE.Box3().setFromObject(clone);
    const ctr = nb.getCenter(new THREE.Vector3());
    if (Number.isFinite(ctr.x) && Number.isFinite(nb.min.y)) {
      clone.position.set(-ctr.x, -nb.min.y, -ctr.z);
      clone.updateMatrixWorld(true);
      // Correction pass: measure again and zero out whatever min.y remains.
      nb = new THREE.Box3().setFromObject(clone);
      if (Number.isFinite(nb.min.y) && Math.abs(nb.min.y) > 1e-4) {
        clone.position.y -= nb.min.y;
        clone.updateMatrixWorld(true);
      }
    }
    return clone;
  }, [scene, targetW, targetD]);

  return <primitive object={model} />;
}

// ─── Bed dressing (mattress + duvet + pillows) ────────────────────────────────
// The only bed GLTF in the project (GothicBed_01) is a bare carved wooden
// FRAME with no mattress or bedding — so a placed bed captured for AI render
// reads as "two posts and a railing", and Style Transfer can only restyle the
// geometry that's actually there (it cannot invent a duvet that isn't in the
// scene). This adds real mattress + duvet + pillow volumes on top of the frame
// so the capture has the full bed silhouette of the reference photos. Rendered
// in the bed group's local space: floor is y=0, footprint is ±w/2 × ±d/2, head
// of the bed at -d/2 (matching the GLTF's headboard end). White/linen so the
// reference's white-bedding look transfers directly.
const _MATTRESS_MAT = new THREE.MeshStandardMaterial({ color: '#f4f1ec', roughness: 0.92, metalness: 0 });
const _DUVET_MAT    = new THREE.MeshStandardMaterial({ color: '#fbfaf7', roughness: 0.85, metalness: 0 });
const _PILLOW_MAT   = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8,  metalness: 0 });

function BedDressing({ w, d, castShadow = false }) {
  // Inset the bedding slightly inside the frame so the wooden frame still reads
  // around the edges (like a real platform bed), and lift it to sit on top of
  // the frame's base rails rather than on the floor.
  const mW = Math.max(0.6, w - 0.16);
  const mD = Math.max(1.6, d - 0.16);
  const baseY   = 0.30;          // top of the frame's side rails ≈ mattress underside
  const matH    = 0.22;          // mattress thickness
  const duvetH  = 0.12;          // duvet loft on top of the mattress
  const matCY   = baseY + matH / 2;
  const duvetCY = baseY + matH + duvetH / 2;
  // Pillows cluster at the head (−Z) end.
  const pillowW = Math.min(0.6, mW * 0.42);
  const pillowZ = -mD / 2 + 0.34;
  const pillowY = baseY + matH + 0.10;
  const pillowX = mW > 1.0 ? mW * 0.22 : 0;   // two pillows on wider beds, one centred on singles
  return (
    <group>
      {/* Mattress */}
      <mesh position={[0, matCY, 0]} material={_MATTRESS_MAT} castShadow={castShadow} receiveShadow={castShadow}>
        <boxGeometry args={[mW, matH, mD]} />
      </mesh>
      {/* Duvet — slightly wider than the mattress so it drapes over the sides,
          and shorter in Z so the pillows show at the head. */}
      <mesh position={[0, duvetCY, 0.18]} material={_DUVET_MAT} castShadow={castShadow} receiveShadow={castShadow}>
        <boxGeometry args={[mW + 0.06, duvetH, mD - 0.5]} />
      </mesh>
      {/* Pillow(s) at the head end */}
      {pillowX > 0 ? (
        <>
          <mesh position={[-pillowX, pillowY, pillowZ]} material={_PILLOW_MAT} castShadow={castShadow}>
            <boxGeometry args={[pillowW, 0.16, 0.42]} />
          </mesh>
          <mesh position={[pillowX, pillowY, pillowZ]} material={_PILLOW_MAT} castShadow={castShadow}>
            <boxGeometry args={[pillowW, 0.16, 0.42]} />
          </mesh>
        </>
      ) : (
        <mesh position={[0, pillowY, pillowZ]} material={_PILLOW_MAT} castShadow={castShadow}>
          <boxGeometry args={[pillowW, 0.16, 0.42]} />
        </mesh>
      )}
    </group>
  );
}

// True for the frame-style beds that need dressing added (the GothicBed frame).
// Bunk beds (h 1.60) are excluded — their geometry is a different shape.
const _BED_NEEDS_DRESSING = new Set(['bed-single', 'bed-double', 'bed-queen', 'bed-king', 'bed-daybed']);

// ─── 3D furniture piece ───────────────────────────────────────────────────────
// readOnly: true skips drag/delete interaction entirely (used by the hero
// "View Your Home" step, which presents the same placed pieces without any
// edit affordances).
export function FurniturePiece3D({ piece, onDelete, onMove: onMoveCallback, orbitRef, sceneBox, readOnly = false }) {
  const [hovered,  setHovered]  = useState(false);
  const [dragging, setDragging] = useState(false);
  const { camera, gl } = useThree();
  const setDpr = useThree(s => s.setDpr);   // adaptive resolution while dragging
  const H         = piece.h ?? 0.50;
  const floorY    = sceneBox ? sceneBox.min.y : 0;
  const mat       = getFurnMat(piece.mat ?? 'none', piece.color);
  const modelPath = FURN_MODEL_MAP[piece.id] ?? null;

  const draggingRef    = useRef(false);
  const pointerDownPos = useRef(null);
  const raycasterRef   = useRef(new THREE.Raycaster());
  const floorPlaneRef  = useRef(_FLOOR_PLANE);

  const getFloorPoint = useCallback((clientX, clientY) => {
    const rect = gl.domElement.getBoundingClientRect();
    const nx   = ((clientX - rect.left) / rect.width)  * 2 - 1;
    const ny   = -((clientY - rect.top)  / rect.height) * 2 + 1;
    floorPlaneRef.current.constant = -floorY;
    raycasterRef.current.setFromCamera({ x: nx, y: ny }, camera);
    raycasterRef.current.ray.intersectPlane(floorPlaneRef.current, _PLANE_HIT);
    return { x: _PLANE_HIT.x, z: _PLANE_HIT.z };
  }, [camera, gl, floorY]);

  const onPointerDown = useCallback(e => {
    if (e.button !== 0) return;
    e.stopPropagation();
    pointerDownPos.current = { x: e.clientX, y: e.clientY };
    draggingRef.current = false;
    const canvas = gl.domElement;

    const onPointerMove = (me) => {
      const dx = me.clientX - pointerDownPos.current.x;
      const dy = me.clientY - pointerDownPos.current.y;
      if (!draggingRef.current && Math.sqrt(dx*dx + dy*dy) > 5) {
        draggingRef.current = true;
        setDragging(true);
        setDpr(1);   // drop to 1× resolution while dragging → ~4× lighter frames
        if (orbitRef?.current) orbitRef.current.enabled = false;
        document.body.style.cursor = 'grabbing';
      }
      if (draggingRef.current) {
        const pt = getFloorPoint(me.clientX, me.clientY);
        onMoveCallback(piece.uid, pt.x, pt.z);
      }
    };

    const onPointerUp = () => {
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup',   onPointerUp);
      if (orbitRef?.current) orbitRef.current.enabled = true;
      document.body.style.cursor = 'auto';
      if (draggingRef.current) setDpr(Math.min(window.devicePixelRatio, 2)); // restore crisp on drop
      // A plain click (no drag) used to DELETE the piece — which is why clicking
      // a placed item made it vanish. Now a click does nothing destructive; the
      // piece only moves when dragged, and is removed only via the × in the
      // placed-items list. (onDelete kept for that list button.)
      draggingRef.current = false;
      setDragging(false);
    };

    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup',   onPointerUp);
  }, [gl, camera, piece.uid, onDelete, onMoveCallback, getFloorPoint, orbitRef, setDpr]);

  const isActive = !readOnly && (hovered || dragging);

  return (
    <group
      position={[piece.x, floorY + 0.012, piece.z]}
      rotation={[0, piece.rot || 0, 0]}
      {...(readOnly ? {} : {
        onPointerDown,
        onPointerOver: e => { e.stopPropagation(); setHovered(true);  document.body.style.cursor = 'grab'; },
        onPointerOut:  e => { e.stopPropagation(); setHovered(false); if (!draggingRef.current) document.body.style.cursor = 'auto'; },
      })}
    >
      {/* Invisible bbox — tall enough to cover real GLTF models with headboards etc. */}
      {/* Use max(H, 2.2) so it covers furniture like beds, wardrobes, tall shelves */}
      {!readOnly && (
        <mesh position={[0, Math.max(H, 2.2) / 2, 0]} visible={false}>
          <boxGeometry args={[piece.w, Math.max(H, 2.2), piece.d]} />
          <meshBasicMaterial />
        </mesh>
      )}

      {/* Hover / drag tint overlay */}
      {isActive && (
        <mesh position={[0, Math.max(H, 2.2) / 2, 0]}>
          <boxGeometry args={[piece.w + 0.04, Math.max(H, 2.2) + 0.04, piece.d + 0.04]} />
          <meshBasicMaterial color={dragging ? '#66aaff' : '#4488ff'} transparent opacity={0.18} depthWrite={false} />
        </mesh>
      )}

      {/* Visual — real GLTF model when mapped, textured box otherwise */}
      {modelPath ? (
        <React.Suspense fallback={
          <mesh position={[0, H / 2, 0]}>
            <boxGeometry args={[piece.w, H, piece.d]} />
            <primitive object={mat} attach="material" />
          </mesh>
        }>
          <FurnitureModelGLTF path={modelPath} targetW={piece.w} targetD={piece.d} castShadow={readOnly} />
          {/* Beds get a mattress+duvet+pillows volume on top of the bare frame
              so the AI capture has the full reference bed silhouette to restyle. */}
          {_BED_NEEDS_DRESSING.has(piece.id) && (
            <BedDressing w={piece.w} d={piece.d} castShadow={readOnly} />
          )}
        </React.Suspense>
      ) : (
        <mesh position={[0, H / 2, 0]} castShadow={readOnly} receiveShadow={readOnly}>
          <boxGeometry args={[piece.w, H, piece.d]} />
          <primitive object={mat} attach="material"
            color={isActive ? (dragging ? '#66aaff' : '#4488ff') : piece.color}
            emissive={isActive ? (dragging ? '#66aaff' : '#4488ff') : piece.color}
            emissiveIntensity={dragging ? 0.45 : isActive ? 0.35 : 0.08}
          />
        </mesh>
      )}

      {/* Labels — hidden in read-only hero view; only useful while editing.
          Counter-rotated against the piece's own rotation so they stay
          upright/readable regardless of which way the furniture is facing. */}
      {!readOnly && (
        <group rotation={[0, -(piece.rot || 0), 0]}>
          <Text position={[0, Math.max(H, 2.2) + 0.30, 0]} fontSize={0.17}
            color={isActive ? '#aaccff' : '#ffffff'} anchorX="center" anchorY="middle"
            renderOrder={10} depthOffset={-1} outlineWidth={0.022} outlineColor="#000000"
          >{piece.label}</Text>
          <Text position={[0, Math.max(H, 2.2) + 0.48, 0]} fontSize={0.11}
            color={isActive ? '#88aaff' : '#ffffff'} fillOpacity={isActive ? 1 : 0.4}
            anchorX="center" anchorY="middle"
            renderOrder={10} depthOffset={-1}
          >{dragging ? '↔ drag to move' : isActive ? 'drag to move' : `${piece.w}×${piece.d}m`}</Text>
        </group>
      )}
    </group>
  );
}

// ─── Drop target floor plane ──────────────────────────────────────────────────
// IMPORTANT: We must NOT use pointer events on this mesh (no onClick, no onPointer)
// because that would conflict with OrbitControls drag. Instead we listen to
// native DOM 'drop' events which fire independently of pointer capture.
function DropTarget({ roomW, roomD, onDrop, draggedRef, orbitRef, sceneBox }) {
  const { camera, gl } = useThree();
  const meshRef = useRef();
  const floorY  = sceneBox ? sceneBox.min.y : 0;

  useEffect(() => {
    const canvas = gl.domElement;

    const onDragEnter = () => {
      // Disable orbit while a furniture drag is in progress
      if (orbitRef.current) orbitRef.current.enabled = false;
    };
    const onDragLeave = e => {
      // Only re-enable if truly leaving the canvas (not just a child)
      if (!canvas.contains(e.relatedTarget)) {
        if (orbitRef.current) orbitRef.current.enabled = true;
      }
    };
    const onDragOver = e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; };
    const onDropEvt  = e => {
      if (orbitRef.current) orbitRef.current.enabled = true;
      if (!draggedRef.current) return;
      e.preventDefault();

      const item = draggedRef.current;
      const rect = canvas.getBoundingClientRect();
      const nx   = ((e.clientX - rect.left) / rect.width)  * 2 - 1;
      const ny   = -((e.clientY - rect.top)  / rect.height) * 2 + 1;

      const ray = new THREE.Raycaster();
      ray.setFromCamera({ x: nx, y: ny }, camera);

      // Primary: hit the invisible floor mesh
      const hits = meshRef.current ? ray.intersectObject(meshRef.current) : [];
      let wx = 0, wz = 0;
      if (hits.length > 0) {
        wx = hits[0].point.x;
        wz = hits[0].point.z;
      } else {
        // Fallback: intersect y=0 math plane
        const t = -ray.ray.origin.y / ray.ray.direction.y;
        if (t > 0) { wx = ray.ray.origin.x + t * ray.ray.direction.x; wz = ray.ray.origin.z + t * ray.ray.direction.z; }
      }

      const hw = roomW / 2, hd = roomD / 2;
      const x  = Math.max(-hw + item.w / 2, Math.min(hw - item.w / 2, wx));
      const z  = Math.max(-hd + item.d / 2, Math.min(hd - item.d / 2, wz));
      onDrop({ ...item, x, z, y: floorY, uid: Math.random().toString(36).slice(2) });
      draggedRef.current = null;
    };

    canvas.addEventListener('dragenter', onDragEnter);
    canvas.addEventListener('dragleave', onDragLeave);
    canvas.addEventListener('dragover',  onDragOver);
    canvas.addEventListener('drop',      onDropEvt);
    return () => {
      canvas.removeEventListener('dragenter', onDragEnter);
      canvas.removeEventListener('dragleave', onDragLeave);
      canvas.removeEventListener('dragover',  onDragOver);
      canvas.removeEventListener('drop',      onDropEvt);
    };
  }, [camera, gl, onDrop, draggedRef, orbitRef, roomW, roomD, floorY]);

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, floorY + 0.005, 0]}>
      <planeGeometry args={[roomW * 6, roomD * 6]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

// ─── GLB base scene ───────────────────────────────────────────────────────────
const ALWAYS_HIDE = new Set(['furniture', 'default']);

// flat=true → fast solid-colour materials (Configure step): no texture maps, no
// shader injection. flat=false (default) → full textured PBR (the render step).
export function BaseRoom({ file, pigmentHex, hiddenLayers, onReady, onLayers, onDoors, flat = false }) {
  const { scene: src } = useGLTF(file);
  const { invalidate }  = useThree();
  const groupRef  = useRef();

  const scene = useMemo(() => src.clone(true), [src, file]); // eslint-disable-line

  const applyMats = () => {
    if (flat) applyFlatMaterials(scene);
    else applyMaterials(scene, pigmentHex || '#f0ece6');
  };

  useEffect(() => {
    applyMats();
    scene.traverse(n => { n.visible = true; });
    const box    = new THREE.Box3().setFromObject(scene);
    const center = box.getCenter(new THREE.Vector3());
    const recenter = new THREE.Vector3(-center.x, -box.min.y, -center.z);
    if (groupRef.current) groupRef.current.position.copy(recenter);
    const shifted = box.clone().translate(recenter);
    applyVis(scene, hiddenLayers);
    onReady?.(shifted);
    const found = new Set();
    scene.traverse(n => { const k = nk(n.name); if (k) found.add(k); });
    onLayers?.(found);

    // Door world-space positions, expressed in the SAME recentred room-local
    // space placedFurniture x/z already use (x=0/z=0 at room centre, floor
    // y=0) — needed for real walkway-to-door clearance, not just a layer
    // visibility toggle.
    //
    // The GLB convention (confirmed by inspection): a single top-level
    // 'doors' node groups EVERY door in the unit, and each DIRECT CHILD of
    // that node is one real, separate door opening (frame+leaf+hardware
    // sub-meshes nested below it). So: find the 'doors' root, then merge
    // sub-meshes per DIRECT CHILD — not per leaf mesh (which split one real
    // door into a dozen+ bogus boxes) and not per top-level 'doors' root
    // (which would merge multiple real, separate doorways into one
    // nonsensical box spanning both).
    if (onDoors) {
      let doorsRoot = null;
      scene.traverse(n => { if (nk(n.name) === 'doors') doorsRoot = n; });

      const doorBoxes = [];
      if (doorsRoot) {
        for (const doorChild of doorsRoot.children) {
          const box = new THREE.Box3().setFromObject(doorChild);
          if (!box.isEmpty()) doorBoxes.push(box.translate(recenter));
        }
      }
      onDoors(doorBoxes);
    }
    invalidate();
  }, [scene]); // eslint-disable-line

  useEffect(() => { applyMats(); invalidate(); }, [scene, pigmentHex, flat, invalidate]); // eslint-disable-line

  // Apply layer visibility directly when it changes, then request a single
  // redraw. This used to defer to a per-frame useFrame + dirty flag — but the
  // mere presence of a useFrame subscription forces R3F to render EVERY frame,
  // silently defeating frameloop="demand" and running the full CinematicFX
  // composer continuously. Doing the work here + invalidate() keeps the scene
  // truly on-demand: the expensive post stack only runs on actual interaction.
  useEffect(() => {
    applyVis(scene, hiddenLayers);
    invalidate();
  }, [scene, hiddenLayers, invalidate]);

  return <group ref={groupRef}><primitive object={scene} /></group>;
}

function nk(n) { return (n || '').toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim(); }
function applyVis(root, hiddenSet) {
  const toHide = new Set();
  root.traverse(n => { const k = nk(n.name); if (k && (ALWAYS_HIDE.has(k) || hiddenSet.has(k))) toHide.add(n); });
  root.traverse(n => { n.visible = true; });
  toHide.forEach(n => { n.visible = false; n.traverse(c => { c.visible = false; }); });
}

// ─── OrbitControls wrapper (exposes ref to DropTarget) ───────────────────────
// We import OrbitControls directly from drei but need to hand its ref out.
import { OrbitControls } from '@react-three/drei';

// True isometric directions (35.264° elevation, 45° increments)
const ISO_DIRS = {
  SE: new THREE.Vector3( 1, 0.8166,  1).normalize(),
  SW: new THREE.Vector3(-1, 0.8166,  1).normalize(),
  NW: new THREE.Vector3(-1, 0.8166, -1).normalize(),
  NE: new THREE.Vector3( 1, 0.8166, -1).normalize(),
};

// Eased rAF camera tween — deliberately NOT a useFrame subscription (see the
// frameloop="demand" note below on RoomConfigurator's own animation): it only
// schedules frames for the duration of the tween itself, then stops, so it
// can't silently force the canvas back into a continuous render loop.
function tweenCamera(camera, orbitControls, { position, target, fov }, { duration = 450, invalidate }) {
  const fromPos    = camera.position.clone();
  const fromTarget = orbitControls ? orbitControls.target.clone() : null;
  const fromFov    = camera.fov;
  const toFov      = fov ?? fromFov;
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const start = performance.now();
  let raf = 0;

  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    const e = easeOutCubic(t);
    camera.position.lerpVectors(fromPos, position, e);
    if (toFov !== fromFov) { camera.fov = fromFov + (toFov - fromFov) * e; camera.updateProjectionMatrix(); }
    if (orbitControls && fromTarget) {
      orbitControls.target.lerpVectors(fromTarget, target, e);
      orbitControls.update();
    } else {
      camera.lookAt(target);
    }
    invalidate();
    if (t < 1) raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf); // cleanup if box/isoDir changes mid-tween
}

function OrbitControlsWithRef({ orbitRef, box, isoDir, isoNonce }) {
  const { camera, invalidate } = useThree();

  // Frame the room when box first becomes available in free mode.
  useEffect(() => {
    if (!box || !camera || isoDir) return;
    camera.fov = 42;                 // restore normal lens in free mode
    camera.updateProjectionMatrix();
    const sz     = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(sz.x, sz.z) * 1.5;
    const position = new THREE.Vector3(center.x + maxDim * 0.8, maxDim * 1.0, center.z + maxDim * 0.8);
    const target   = new THREE.Vector3(center.x, 0, center.z);
    return tweenCamera(camera, orbitRef.current, { position, target }, { invalidate });
  }, [box, camera, isoDir, orbitRef, invalidate]);

  // Snap to a true isometric angle. Keyed on isoNonce (not isoDir) so clicking
  // the SAME iso button again re-snaps, and so the snap survives a prior orbit.
  // We collapse the FOV to a long-telephoto value so parallel lines stay parallel
  // — visually identical to an orthographic projection — then pull the camera back
  // proportionally so the unit still fills the frame. This keeps a single
  // perspective camera (the drop-target raycasting + OrbitControls rely on it)
  // while delivering a genuinely isometric, distortion-free look.
  useEffect(() => {
    if (!box || !camera || !isoDir) return;
    const ISO_FOV = 6;               // near-orthographic
    const sz     = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    // Use the full diagonal (not just the largest single axis) so irregular,
    // non-cubic room footprints are framed with enough clearance — using only
    // the largest axis under-estimated distance for long-thin rooms and let
    // the camera land inside/near the structure (e.g. under a column capital).
    const diag   = Math.sqrt(sz.x * sz.x + sz.y * sz.y + sz.z * sz.z);
    const radius = diag * 0.62;
    // distance so the framed radius subtends the (tiny) FOV — gives ortho-like fill
    const dist   = radius / Math.tan((ISO_FOV * Math.PI / 180) / 2);
    const position = center.clone().addScaledVector(ISO_DIRS[isoDir], dist);
    return tweenCamera(camera, orbitRef.current, { position, target: center, fov: ISO_FOV }, { invalidate });
  }, [box, camera, isoDir, isoNonce, orbitRef, invalidate]);

  // Adaptive DPR: while the user is actively orbiting/panning, drop the render
  // resolution to 1× (and let the AO go cheap) so the per-frame cost during
  // motion is ~4× lighter and stays smooth; snap back to full crisp dpr the
  // instant they let go. This is the single biggest 3D-interaction perf win,
  // and quality is unchanged at rest (which is what you actually look at).
  const setDpr = useThree(s => s.setDpr);
  const fullDpr = Math.min(window.devicePixelRatio, 2);
  const onStart = useCallback(() => setDpr(1), [setDpr]);
  const onEnd   = useCallback(() => { setDpr(fullDpr); invalidate(); }, [setDpr, fullDpr, invalidate]);

  return (
    <OrbitControls
      ref={orbitRef}
      makeDefault
      enablePan={true}
      panSpeed={0.5}
      rotateSpeed={0.6}
      zoomSpeed={0.8}
      minPolarAngle={Math.PI * 0.10}
      maxPolarAngle={Math.PI * 0.40}
      minDistance={4}
      maxDistance={400}
      onStart={onStart}
      onEnd={onEnd}
    />
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
// placedFurniture/setPlacedFurniture are owned by Configurator.jsx (lifted up
// so the furniture layout survives navigating to the "View Your Home" step
// and back — this component used to own that state locally, which silently
// wiped it on unmount).
export default function RoomConfigurator({ typology, config, setConfig, placedFurniture, setPlacedFurniture, onNext }) {
  const initialIdx = typology?.glb
    ? Math.max(0, ROOMS_META.findIndex(r => r.file === typology.glb))
    : 0;

  const [roomIdx,        setRoomIdx]        = useState(initialIdx);
  const [hiddenLayers,   setHiddenLayers]   = useState(new Set());
  const [sceneBox,       setSceneBox]       = useState(null);
  const [doorBoxes,      setDoorBoxes]      = useState([]);
  const [availableLayers,setAvailableLayers]= useState(new Set());
  const [isoDir,         setIsoDir]         = useState('SE'); // default to elegant isometric; null = free perspective, else 'SE'|'SW'|'NW'|'NE'
  const [isoNonce,       setIsoNonce]       = useState(0);    // bumps on every iso click so re-clicking re-snaps

  const snapIso = useCallback((dir) => { setIsoDir(dir); setIsoNonce(n => n + 1); }, []);

  const room       = ROOMS_META[roomIdx];
  const baseLayout = layouts.rooms[room.id] || layouts.rooms['ROOM1'];
  const pigmentHex = '#f0ece6'; // constant — pigment picker removed
  const roomW      = (baseLayout.gridX || 4) * CELL;
  const roomD      = (baseLayout.gridZ || 4) * CELL;


  // Orbit ref — so DropTarget can disable it during drag
  const orbitRef = useRef(null);

  // ── Furniture ──
  const [activeFurnCat,    setActiveFurnCat]    = useState(0);
  const [activeFurnSearch, setActiveFurnSearch] = useState('');
  const draggedFurnRef = useRef(null);

  const handleFurnDrop   = useCallback(p => setPlacedFurniture(prev => [...prev, { rot: 0, ...p }]), []);
  const handleFurnDelete = useCallback(uid => setPlacedFurniture(prev => prev.filter(f => f.uid !== uid)), []);
  // Rotation is surface-only — spins the footprint flat in the room (around
  // the vertical Y axis, in 90° steps), never tips a piece onto its side.
  const handleFurnRotate = useCallback(uid => setPlacedFurniture(prev => prev.map(f => (
    f.uid === uid ? { ...f, rot: ((f.rot || 0) + Math.PI / 2) % (Math.PI * 2) } : f
  ))), []);
  const handleFurnMove   = useCallback((uid, nx, nz) => {
    setPlacedFurniture(prev => prev.map(f => {
      if (f.uid !== uid) return f;
      const hw = roomW / 2, hd = roomD / 2;
      return { ...f,
        x: Math.max(-hw + f.w / 2, Math.min(hw - f.w / 2, nx)),
        z: Math.max(-hd + f.d / 2, Math.min(hd - f.d / 2, nz)),
      };
    }));
  }, [roomW, roomD]);

  useEffect(() => {
    setHiddenLayers(new Set());
    setPlacedFurniture([]);
    setSceneBox(null);
    setDoorBoxes([]);
    setAvailableLayers(new Set());
  }, [roomIdx]);

  // ── Clearance / circulation check ──────────────────────────────────────
  // Axis-aligned rectangle gap between every pair of placed pieces, plus
  // each piece's gap to the nearest wall. 0.9m is the standard accessible
  // circulation width (Approved Document M / ADA-equivalent); below that
  // it's "tight", below 0.4m it's "blocked" (pieces effectively touching).
  // This is a real ergonomic threshold, not an arbitrary tuning number.
  const CLEARANCE_GOOD_M   = 0.9;
  const CLEARANCE_TIGHT_M  = 0.4;

  function rectGap(a, b) {
    // Gap between two axis-aligned rects' edges along X and Z; negative = overlap.
    const gapX = Math.abs(a.x - b.x) - (a.w + b.w) / 2;
    const gapZ = Math.abs(a.z - b.z) - (a.d + b.d) / 2;
    // If rects overlap on one axis, the real clearance is the gap on the OTHER axis.
    if (gapX < 0 && gapZ < 0) return Math.max(gapX, gapZ); // overlapping in both → negative, true collision
    if (gapX < 0) return gapZ;
    if (gapZ < 0) return gapX;
    // Separated on BOTH axes → closest points are corner-to-corner, so the
    // true gap is the diagonal distance, not min(gapX, gapZ) (which under-
    // reports clearance for diagonally-placed pieces and can flag a
    // perfectly well-spaced arrangement as "tight" or "blocked").
    return Math.sqrt(gapX * gapX + gapZ * gapZ);
  }

  // Door centers in room-local space (already recentred by BaseRoom's onDoors).
  // A piece only "blocks the doorway" if it actually sits in the corridor
  // between the door and the room's open centre — NOT just because it's
  // near some wall. Furniture flush against a wall it isn't blocking with
  // (e.g. a headboard against the back wall, away from the door) is normal,
  // correct placement and must NOT be flagged.
  const doorCenters = useMemo(
    () => doorBoxes.map(b => b.getCenter(new THREE.Vector3())),
    [doorBoxes]
  );

  const clearance = useMemo(() => {
    let worst = Infinity;
    let worstPair = null;
    let worstUids = [];

    for (let i = 0; i < placedFurniture.length; i++) {
      const p = placedFurniture[i];

      // Gap to the nearest door's walkway, only counted if this piece is
      // actually between that door and the room centre (i.e. in the path),
      // not merely near a wall the door has nothing to do with.
      for (const dc of doorCenters) {
        const toCenter = new THREE.Vector2(-dc.x, -dc.z); // door → room centre (0,0)
        const doorToCenterLen = toCenter.length();
        if (doorToCenterLen < 1e-6) continue;
        const dirN = toCenter.clone().normalize();
        const pieceRel = new THREE.Vector2(p.x - dc.x, p.z - dc.z);
        const along = pieceRel.dot(dirN); // distance along the door→centre path
        // Only "in the path" if between the door and the centre (with a
        // little slack on each end) — not behind the door or past the centre.
        if (along < -0.3 || along > doorToCenterLen + 0.3) continue;
        const across = Math.abs(pieceRel.x * dirN.y - pieceRel.y * dirN.x); // perpendicular offset from the path centerline (pieceRel.y holds room-Z)
        const halfFootprint = Math.max(p.w, p.d) / 2;
        const gap = across - halfFootprint - 0.45; // 0.45 = half a comfortable single-file walking width
        if (gap < worst) { worst = gap; worstPair = { a: p.label, b: 'doorway path' }; worstUids = [p.uid]; }
      }

      // Gap to every other piece (each pair counted once via j > i).
      for (let j = i + 1; j < placedFurniture.length; j++) {
        const g = rectGap(p, placedFurniture[j]);
        if (g < worst) { worst = g; worstPair = { a: p.label, b: placedFurniture[j].label }; worstUids = [p.uid, placedFurniture[j].uid]; }
      }
    }

    if (!Number.isFinite(worst)) return { verdict: 'empty', worst: null, worstPair: null, worstUids: [] };
    const verdict = worst < 0 ? 'overlap' : worst < CLEARANCE_TIGHT_M ? 'blocked' : worst < CLEARANCE_GOOD_M ? 'tight' : 'good';
    return { verdict, worst, worstPair, worstUids };
  }, [placedFurniture, doorCenters]);

  // ── Pricing factor ───────────────────────────────────────────────────────
  // Live running fit-out cost vs. a per-typology budget ceiling. Crossing
  // budget doesn't block placement — it's a "is this a good choice" signal,
  // same spirit as the clearance verdict, just on the money axis.
  const costStatus = useMemo(() => {
    const total = placedFurniture.reduce((sum, p) => sum + furnCost(p.id), 0);
    const budget = TYPOLOGY_BUDGET[room.typology] ?? 5000;
    const pct = budget > 0 ? total / budget : 0;
    const verdict = pct > 1.15 ? 'over' : pct > 0.9 ? 'tight' : 'good';
    return { total, budget, pct, verdict };
  }, [placedFurniture, room.typology]);

  // ── Layer toggles — these map directly to real mesh groups baked into the
  // GLB itself (slab/columns/walls/etc.) and only ever change visibility,
  // never geometry. No synthetic walls are added or removed. Some units
  // (e.g. ROOM1) only have a single "slab" mesh covering both floor and
  // roof — in that case we show one "Slab" toggle instead of two dead ones. ──
  // "Roof" = the upper/roof slab layer. Older GLBs named it 'top slabs';
  // the current unit GLBs (1l..5l) name it 'slabs' (with the floor plates in
  // a separate 'floors'/'floor plates' group). "Floor" = the floor plates.
  // We accept every real-world spelling so the Roof toggle isn't silently
  // filtered out (the "missing upper-slab toggle" bug).
  const hasFloorRoofSplit =
    availableLayers.has('top slabs') || availableLayers.has('slabs') ||
    availableLayers.has('bottom slabs') || availableLayers.has('floors') ||
    availableLayers.has('floor plates');
  const LAYER_TOGGLES = useMemo(() => {
    const defs = hasFloorRoofSplit
      ? [
          { key: 'top slabs',      label: 'Roof',       aliases: ['slabs'] },
          { key: 'bottom slabs',   label: 'Floor',      aliases: ['floors', 'floor plates'] },
        ]
      : [
          { key: 'slab',           label: 'Slab',       aliases: [] },
        ];
    defs.push(
      { key: 'external walls', label: 'Ext. Walls', aliases: [] },
      { key: 'internal walls', label: 'Int. Walls', aliases: [] },
      { key: 'balconies',      label: 'Balconies',  aliases: [] },
      { key: 'columns',        label: 'Columns',    aliases: [] },
      { key: 'doors',          label: 'Doors',      aliases: [] },
      { key: 'windows',        label: 'Windows',    aliases: ['glasses'] },
      { key: 'fins',           label: 'Fins',       aliases: [] },
      { key: 'staircase',      label: 'Staircase',  aliases: [] },
    );
    // Only show toggles for layers that actually exist in the loaded GLB —
    // otherwise the button does nothing and looks broken.
    return defs.filter(lt => availableLayers.has(lt.key) || lt.aliases.some(a => availableLayers.has(a)));
  }, [availableLayers, hasFloorRoofSplit]);

  const toggleLayer = useCallback((key, aliases = []) => {
    setHiddenLayers(prev => {
      const next = new Set(prev);
      const hide = !next.has(key);
      if (hide) { next.add(key); aliases.forEach(a => next.add(a)); }
      else       { next.delete(key); aliases.forEach(a => next.delete(a)); }
      return next;
    });
  }, []);

  const activeItems = useMemo(() => {
    const cat = FURN_CATALOGUE[activeFurnCat];
    if (!activeFurnSearch.trim()) return cat.items;
    const q = activeFurnSearch.toLowerCase();
    return cat.items.filter(i => i.label.toLowerCase().includes(q));
  }, [activeFurnCat, activeFurnSearch]);

  return (
    <div className="rc-root">

      {/* ── 3D Canvas ── */}
      <Canvas
        className="rc-canvas"
        camera={{ fov: 42, near: 0.1, far: 2000, position: [12, 10, 12] }}
        gl={{
          antialias: true,   // smooth model edges — cheap on this light flat scene
          alpha: true,       // transparent → CSS studio gradient shows through
          powerPreference: 'high-performance',
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 0.78,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
        dpr={Math.min(window.devicePixelRatio, 2)} // on-demand: only redraws on interaction, so dpr 2 is free at rest
        frameloop="demand"
      >
        {/* Transparent canvas — the studio gradient backdrop lives in CSS behind
            it (zero GPU cost), giving the clean architectural-model look. */}

        {/* Studio lighting — LOW env + directional key/fill so the white model
            actually shows FORM (face angles catch different light) instead of
            clipping to a flat white blob. No shadow MAPS (those lag) — just
            directional shading; ContactShadows below grounds it cheaply. */}
        <RoomEnv intensity={0.5} hdriUrl={EXTERIOR_HDRI_URL} />
        <ambientLight intensity={0.32} color="#fff4e6" />
        <directionalLight position={[6, 12, 8]} intensity={1.7} color="#fff3e2" />
        <directionalLight position={[-8, 6, -4]} intensity={0.5} color="#e8ddc8" />

        <OrbitControlsWithRef orbitRef={orbitRef} box={sceneBox} isoDir={isoDir} isoNonce={isoNonce} />

        <React.Suspense fallback={null}>
          <BaseRoom
            key={room.file}
            file={room.file}
            pigmentHex={pigmentHex}
            hiddenLayers={hiddenLayers}
            onReady={setSceneBox}
            onLayers={setAvailableLayers}
            onDoors={setDoorBoxes}
            flat
          />

          {/* Drop target — raycasts against the real room geometry + native event listeners */}
          <DropTarget
            roomW={roomW} roomD={roomD}
            onDrop={handleFurnDrop}
            draggedRef={draggedFurnRef}
            orbitRef={orbitRef}
            sceneBox={sceneBox}
          />

        </React.Suspense>

        {/* Furniture in its own error-isolated boundary — a bad/missing GLTF
            piece must never take the room or walls down with it. */}
        <FurnitureErrorBoundary>
          <React.Suspense fallback={null}>
            {placedFurniture.map(p => (
              <FurnitureErrorBoundary key={p.uid}>
                <FurniturePiece3D piece={p} onDelete={handleFurnDelete} onMove={handleFurnMove} orbitRef={orbitRef} sceneBox={sceneBox} />
              </FurnitureErrorBoundary>
            ))}
          </React.Suspense>
        </FurnitureErrorBoundary>

        {/* Clearance flag — a thin colored ring under whichever piece is the
            worst offender, so the "good/tight/blocked" verdict reads directly
            in the viewport, not just the sidebar. */}
        {clearance.worstUids.length > 0 && clearance.verdict !== 'good' && clearance.verdict !== 'empty' &&
          placedFurniture
            .filter(p => clearance.worstUids.includes(p.uid))
            .map(p => (
              <mesh key={`clr-${p.uid}`} position={[p.x, (sceneBox ? sceneBox.min.y : 0) + 0.02, p.z]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[Math.max(p.w, p.d) / 2 + 0.08, Math.max(p.w, p.d) / 2 + 0.16, 32]} />
                <meshBasicMaterial color={CLEARANCE_STYLE[clearance.verdict].fg} transparent opacity={0.85} depthWrite={false} />
              </mesh>
            ))}

        {/* Cheap grounding shadow instead of expensive N8AO postprocessing
            (which was the lag). A single blurred ContactShadows plane reads as
            the model sitting on a surface and costs a tiny fraction of full AO. */}
        {sceneBox && (
          <ContactShadows
            position={[0, (sceneBox.min.y ?? 0) + 0.01, 0]}
            scale={Math.max(roomW, roomD) * 2.4}
            resolution={1024}
            blur={2.6}
            opacity={0.42}
            far={6}
            frames={1}
          />
        )}

      </Canvas>

      {/* ── View mode bar (free orbit vs. true isometric) ── */}
      <div className="rc-view-bar">
        <button className={`rc-view-btn${isoDir === null ? ' active' : ''}`} onClick={() => setIsoDir(null)}>
          Free
        </button>
        {['SE', 'SW', 'NW', 'NE'].map(dir => (
          <button key={dir} className={`rc-view-btn${isoDir === dir ? ' active' : ''}`} onClick={() => snapIso(dir)}>
            Iso {dir}
          </button>
        ))}
      </div>

      {/* ── Layer visibility bar ── */}
      <div className="rc-vis-bar">
        <div className="rc-vis-bar-label">LAYERS</div>
        {LAYER_TOGGLES.map(lt => {
          const hidden = hiddenLayers.has(lt.key);
          return (
            <button key={lt.key} className={`rc-vis-chip${hidden ? ' off' : ''}`}
              onClick={() => toggleLayer(lt.key, lt.aliases)}>
              <span className="rc-vis-dot" />{lt.label}
            </button>
          );
        })}
      </div>

      {/* ── Right drawer ── */}
      <div className="rc-drawer">
        <div className="rc-drawer-head">
          <div className="rc-drawer-eyebrow">Configure</div>
          <div className="rc-drawer-unit">{typology?.label || room.label}</div>
          {typology && <div className="rc-drawer-area">{typology.areaM2} m² · {typology.gridX}×{typology.gridZ} grid</div>}

          <div className="rc-room-grid">
            {ROOMS_META.map((r, i) => (
              <button key={r.id} className={`rc-room-btn${roomIdx === i ? ' active' : ''}`} onClick={() => setRoomIdx(i)}>
                <span className="rc-room-id">{r.id}</span>
                <span className="rc-room-typ">{r.typology}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="rc-drawer-body">

          {/* ══ FURNITURE PANEL ══ */}
          <>
            <div className="rc-section">
              <div className="rc-section-label">
                <span>Catalogue</span>
                {placedFurniture.length > 0 && (
                  <button onClick={() => setPlacedFurniture([])} style={{
                    fontSize:'0.56rem', background:'rgba(255,60,60,0.10)',
                    border:'1px solid rgba(255,60,60,0.25)', color:'#ff7777',
                    borderRadius:'4px', padding:'2px 7px', cursor:'pointer',
                  }}>Clear all</button>
                )}
              </div>

              {/* Category pills */}
              <div style={{ display:'flex', flexWrap:'wrap', gap:'3px', marginBottom:'6px' }}>
                {FURN_CATALOGUE.map((cat, i) => (
                  <button key={cat.category}
                    onClick={() => { setActiveFurnCat(i); setActiveFurnSearch(''); }}
                    style={{
                      display:'flex', alignItems:'center', gap:'3px',
                      fontSize:'0.57rem', padding:'3px 6px', borderRadius:'4px', cursor:'pointer',
                      background: activeFurnCat===i ? cat.color+'20' : 'rgba(255,255,255,0.03)',
                      border:`1px solid ${activeFurnCat===i ? cat.color+'80' : 'rgba(255,255,255,0.08)'}`,
                      color: activeFurnCat===i ? cat.color : 'rgba(255,255,255,0.38)',
                      fontWeight: activeFurnCat===i ? 700 : 400,
                    }}>
                    <span style={{ fontSize:'0.65rem' }}>{cat.icon}</span>{cat.category}
                  </button>
                ))}
              </div>

              {/* Search */}
              <input type="text" placeholder={`Search ${FURN_CATALOGUE[activeFurnCat].category}…`}
                value={activeFurnSearch} onChange={e => setActiveFurnSearch(e.target.value)}
                style={{ width:'100%', boxSizing:'border-box', padding:'5px 8px', borderRadius:'5px',
                  background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.10)',
                  color:'rgba(255,255,255,0.75)', fontSize:'0.62rem', outline:'none', marginBottom:'5px',
                }}
              />

              {/* Drag hint — prominent */}
              <div style={{ display:'flex', alignItems:'center', gap:'7px', padding:'6px 9px', borderRadius:'5px',
                background:'rgba(232,228,218,0.07)', border:'1px solid rgba(232,228,218,0.18)', marginBottom:'5px' }}>
                <span style={{ fontSize:'1.0rem' }}>⠿</span>
                <span style={{ fontSize:'0.57rem', color:'rgba(232,228,218,0.80)', lineHeight:1.4 }}>
                  Drag any item below onto the 3D room<br/>
                  <span style={{ opacity:0.6 }}>Drag a placed piece to move it · remove via the list below</span>
                </span>
              </div>

              {/* Item list */}
              <div style={{ display:'flex', flexDirection:'column', gap:'2px', maxHeight:'220px', overflowY:'auto' }}>
                {activeItems.map(item => (
                  <div key={item.id} draggable
                    onDragStart={e => {
                      draggedFurnRef.current = item;
                      e.dataTransfer.effectAllowed = 'copy';
                      // Ghost image (small square)
                      const ghost = document.createElement('div');
                      ghost.style.cssText = `width:40px;height:40px;background:${item.color};border-radius:4px;opacity:0.9;position:fixed;top:-100px`;
                      document.body.appendChild(ghost);
                      e.dataTransfer.setDragImage(ghost, 20, 20);
                      requestAnimationFrame(() => ghost.remove());
                    }}
                    onDragEnd={() => { /* orbit re-enabled in DropTarget drop handler */ }}
                    style={{ display:'flex', alignItems:'center', gap:'7px', padding:'5px 7px', borderRadius:'5px',
                      cursor:'grab', background:'rgba(255,255,255,0.025)', border:'1px solid rgba(255,255,255,0.07)',
                      userSelect:'none' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.025)'}
                  >
                    <div style={{ width:'9px', height:'9px', borderRadius:'2px', flexShrink:0,
                      background:item.color, border:'1px solid rgba(255,255,255,0.15)',
                      boxShadow:`0 0 5px ${item.color}50` }} />
                    <span style={{ fontSize:'0.70rem', flexShrink:0 }}>{item.icon}</span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:'0.63rem', color:'rgba(255,255,255,0.82)', fontWeight:500,
                        whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{item.label}</div>
                      <div style={{ fontSize:'0.51rem', color:'rgba(255,255,255,0.28)' }}>{item.w}×{item.d}m · {item.mat}</div>
                    </div>
                    <div style={{ fontSize:'0.65rem', color:'rgba(255,255,255,0.18)', flexShrink:0 }}>⠿</div>
                  </div>
                ))}
                {activeItems.length === 0 && (
                  <div style={{ fontSize:'0.60rem', color:'rgba(255,255,255,0.25)', textAlign:'center', padding:'12px 0' }}>
                    No items match "{activeFurnSearch}"
                  </div>
                )}
              </div>
            </div>

            {/* Placed list */}
            {placedFurniture.length > 0 && (
              <div className="rc-section">
                <div className="rc-section-label">Placed ({placedFurniture.length})</div>
                <div style={{ display:'flex', flexDirection:'column', gap:'2px', maxHeight:'130px', overflowY:'auto' }}>
                  {placedFurniture.map(p => (
                    <div key={p.uid} style={{ display:'flex', alignItems:'center', gap:'6px',
                      padding:'4px 7px', borderRadius:'4px',
                      background:'rgba(255,255,255,0.025)', border:'1px solid rgba(255,255,255,0.06)' }}>
                      <div style={{ width:'7px', height:'7px', borderRadius:'2px', background:p.color, flexShrink:0 }} />
                      <span style={{ fontSize:'0.60rem', color:'rgba(255,255,255,0.65)', flex:1 }}>{p.label}</span>
                      <span style={{ fontSize:'0.51rem', color:'rgba(255,255,255,0.25)' }}>{p.w}×{p.d}m</span>
                      <span style={{ fontSize:'0.51rem', color:'rgba(255,255,255,0.32)' }}>£{furnCost(p.id).toLocaleString()}</span>
                      <button onClick={() => handleFurnRotate(p.uid)} title="Rotate 90°"
                        style={{ background:'none', border:'none', color:'rgba(140,170,255,0.7)', cursor:'pointer', fontSize:'0.72rem', padding:'0 2px', lineHeight:1 }}>⟳</button>
                      <button onClick={() => handleFurnDelete(p.uid)}
                        style={{ background:'none', border:'none', color:'rgba(255,80,80,0.55)', cursor:'pointer', fontSize:'0.78rem', padding:'0 2px', lineHeight:1 }}>×</button>
                    </div>
                  ))}
                </div>
                {/* Stats */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'5px', marginTop:'6px' }}>
                  {[
                    ['Pieces',    placedFurniture.length],
                    ['Footprint', `${placedFurniture.reduce((a,p)=>a+p.w*p.d,0).toFixed(1)} m²`],
                    ['Room',      `${roomW}×${roomD}m`],
                    ['Coverage',  `${Math.min(100,Math.round(placedFurniture.reduce((a,p)=>a+p.w*p.d,0)/(roomW*roomD)*100))}%`],
                  ].map(([k,v]) => (
                    <div key={k} style={{ padding:'5px 8px', borderRadius:'5px',
                      background:'rgba(255,255,255,0.025)', border:'1px solid rgba(255,255,255,0.07)' }}>
                      <div style={{ fontSize:'0.62rem', color:'#e8e4da', fontFamily:'DM Serif Display,serif' }}>{v}</div>
                      <div style={{ fontSize:'0.50rem', color:'rgba(255,255,255,0.28)', textTransform:'uppercase', letterSpacing:'0.08em' }}>{k}</div>
                    </div>
                  ))}
                </div>

                {/* Clearance verdict — is this a good choice? */}
                {clearance.verdict !== 'empty' && (
                  <div style={{
                    marginTop: '6px', padding: '7px 9px', borderRadius: '6px',
                    background: CLEARANCE_STYLE[clearance.verdict].bg,
                    border: `1px solid ${CLEARANCE_STYLE[clearance.verdict].border}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '0.62rem', fontWeight: 600, color: CLEARANCE_STYLE[clearance.verdict].fg }}>
                        {CLEARANCE_STYLE[clearance.verdict].label}
                      </span>
                      <span style={{ fontSize: '0.55rem', color: CLEARANCE_STYLE[clearance.verdict].fg, opacity: 0.85 }}>
                        {clearance.worst < 0 ? 'overlapping' : `${clearance.worst.toFixed(2)}m gap`}
                      </span>
                    </div>
                    {clearance.worstPair && (
                      <div style={{ fontSize: '0.52rem', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>
                        {clearance.worstPair.a} ↔ {clearance.worstPair.b}
                      </div>
                    )}
                    {doorCenters.length === 0 && (
                      <div style={{ fontSize: '0.5rem', color: 'rgba(255,255,255,0.3)', marginTop: '3px' }}>
                        No door detected in this unit — only furniture-to-furniture spacing is checked.
                      </div>
                    )}
                  </div>
                )}

                {/* Pricing factor — live fit-out cost vs. typology budget. */}
                {placedFurniture.length > 0 && (
                  <div style={{
                    marginTop: '6px', padding: '7px 9px', borderRadius: '6px',
                    background: COST_STYLE[costStatus.verdict].bg,
                    border: `1px solid ${COST_STYLE[costStatus.verdict].border}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '0.62rem', fontWeight: 600, color: COST_STYLE[costStatus.verdict].fg }}>
                        {COST_STYLE[costStatus.verdict].label}
                      </span>
                      <span style={{ fontSize: '0.55rem', color: COST_STYLE[costStatus.verdict].fg, opacity: 0.85 }}>
                        £{costStatus.total.toLocaleString()} / £{costStatus.budget.toLocaleString()}
                      </span>
                    </div>
                    <div style={{ marginTop: '4px', height: '3px', borderRadius: '2px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: '2px',
                        width: `${Math.min(100, costStatus.pct * 100)}%`,
                        background: COST_STYLE[costStatus.verdict].fg, opacity: 0.8,
                      }} />
                    </div>
                  </div>
                )}
              </div>
            )}
          </>

        </div>

        {onNext && (
          <div className="rc-drawer-footer">
            <button className="rc-next-btn" onClick={onNext}>
              Proceed to View Your Home
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M2.5 6.5h8M8 3.5l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        )}
      </div>

      <div className="rc-label">
        <span className="rc-label-eyebrow">Configure</span>
        <span className="rc-label-name">{room.id} — {room.label}</span>
      </div>

    </div>
  );
}

ROOMS_META.forEach(r => useGLTF.preload(r.file));
_MODEL_PATHS.forEach(p => useGLTF.preload(p));
