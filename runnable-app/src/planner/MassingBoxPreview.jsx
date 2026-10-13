import { useMemo } from 'react';
import { CELL } from './masterplanGenerator';

// Lightweight solid-massing preview — isometric SVG boxes per building (real
// footprint x floor count from a generateMasterplan() plan). Deliberately
// NOT Three.js/WebGL: mounting 20 of these simultaneously (one per massing
// candidate card) blew past the browser's WebGL context limit ("Too many
// active WebGL contexts" — the first several cards' contexts got evicted
// and rendered blank/white). Plain SVG has no such ceiling.

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = Math.sin(Math.PI / 6);
const project = (x, y, z) => ({ sx: (x - z) * COS30, sy: (x + z) * SIN30 - y });
const pts = (arr) => arr.map(p => `${p.sx.toFixed(2)},${p.sy.toFixed(2)}`).join(' ');

function boxFaces(x0, x1, y0, y1, z0, z1) {
  const p = (x, y, z) => project(x, y, z);
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

const FLOOR_TO_FLOOR_M = 3.2;

function layoutBuildings(plan) {
  const buildings = (plan?.buildings || []).filter(b => b.units?.length > 0);
  if (!buildings.length) return null;

  const items = buildings.map(b => ({
    x0: b.col * CELL, x1: (b.col + b.w) * CELL,
    z0: b.row * CELL, z1: (b.row + b.d) * CELL,
    h: Math.max(1, b.floors) * FLOOR_TO_FLOOR_M,
  }));

  const allPts = items.flatMap(b => {
    const f = boxFaces(b.x0, b.x1, 0, b.h, b.z0, b.z1);
    return [...f.top, ...f.left, ...f.right];
  });
  const xs = allPts.map(p => p.sx), ys = allPts.map(p => p.sy);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = Math.max(2, (maxX - minX) * 0.06);
  const viewBox = `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;

  return { items, viewBox };
}

export default function MassingBoxPreview({ plan }) {
  const layout = useMemo(() => layoutBuildings(plan), [plan]);
  if (!layout) return null;

  return (
    <svg viewBox={layout.viewBox} className="msg-box-preview-svg" preserveAspectRatio="xMidYMid meet">
      {layout.items.map((b, i) => {
        const f = boxFaces(b.x0, b.x1, 0, b.h, b.z0, b.z1);
        return (
          <g key={i}>
            <polygon points={pts(f.left)}  fill="#9a958a" stroke="#0a0a0a" strokeWidth="0.3" />
            <polygon points={pts(f.right)} fill="#b8b2a4" stroke="#0a0a0a" strokeWidth="0.3" />
            <polygon points={pts(f.top)}   fill="#d8d4c8" stroke="#0a0a0a" strokeWidth="0.3" />
          </g>
        );
      })}
    </svg>
  );
}
