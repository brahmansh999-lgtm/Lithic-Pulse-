// rhinoExport — serializes the real massing + real measured column data
// (the same payload buildingSynthesis.js used to consume to fabricate a fake
// "final building") into a download an architect can bring into Rhino/
// Grasshopper, or any 3D app, to do the actual design work. This is the
// pipeline's honest handoff point: past here, a human architect designs the
// building — the platform stops pretending to do that itself.

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

// Structured JSON — floors as box arrays (real per-floor programme), columns
// as point+height list (real measured positions from the matched GLB
// precedent), envelope, and the design rules that informed zoning/massing.
// Directly usable from a Grasshopper Python/C# script (json.load / JSON.Parse).
export function buildRhinoExportPayload({ siteId, siteName, buildingType, floors, envelope, columnPositions, columnDims, designRules }) {
  return {
    meta: {
      exportedAt: new Date().toISOString(),
      siteId: siteId ?? null,
      siteName: siteName ?? null,
      buildingType,
      units: 'metres',
    },
    envelope: envelope ?? null,
    designRules: designRules ?? null,
    floors: (floors ?? []).map(fl => ({
      index: fl.floorIdx ?? null,
      y0: fl.y0 ?? null,
      y1: fl.y1 ?? null,
      boxes: (fl.boxes ?? []).map(b => ({
        type: b.type, x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1,
        // Height falls back to the floor's own extent — a box shipped without
        // y0/y1 gives the architect a footprint with no solid, and JSON
        // silently DROPS undefined keys, so the omission was invisible in the
        // exported file rather than an obvious error.
        y0: b.y0 ?? fl.y0 ?? null,
        y1: b.y1 ?? fl.y1 ?? null,
        // Merged zones are genuinely L/T/U-shaped; x0..z1 above is only their
        // BOUNDING rectangle, which fills in the notch. `outline` carries the
        // true footprint ring so a Rhino script can rebuild the real shape,
        // and `areaM2` the real occupied area rather than the bounding one.
        ...(b.outline ? { outline: b.outline.map(p => ({ x: p.x, z: p.z })) } : {}),
        ...(b.mergedAreaM2 != null ? { areaM2: b.mergedAreaM2 } : {}),
        // Dwelling identity, when this box is a single home.
        ...(b.typologyId ? { typologyId: b.typologyId, beds: b.beds } : {}),
        ...(b.isPenthouse ? { isPenthouse: true, heightFloors: b.heightFloors ?? 2 } : {}),
      })),
    })),
    columns: (columnPositions ?? []).map(c => ({
      x: c.x, z: c.z,
      baseY: columnDims?.baseY ?? 0,
      height: columnDims?.height ?? null,
      radius: columnDims?.radius ?? null,
    })),
  };
}

// Simple OBJ export — massing boxes + column markers as real geometry, for
// architects who want to open the study directly in Rhino without a script.
// Boxes and columns are each emitted as independent 8-vertex cuboids.
function boxToObjFaces(x0, x1, y0, y1, z0, z1, vertexOffset) {
  const verts = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const faces = [
    [1, 2, 3, 4], [5, 8, 7, 6], [1, 5, 6, 2],
    [2, 6, 7, 3], [3, 7, 8, 4], [4, 8, 5, 1],
  ].map(f => f.map(i => i + vertexOffset));
  return { verts, faces };
}

// A merged zone is a real L/T/U prism, not a cuboid. Emitting its bounding box
// would hand the architect a solid that fills in the notch — i.e. claims floor
// area the design does not have. OBJ supports n-gon faces, so the caps go out
// as single rings and the walls as quads.
function prismToObjFaces(outline, y0, y1, vertexOffset) {
  const n = outline.length;
  const verts = [];
  for (const p of outline) verts.push([p.x, y0, p.z]);   // 1..n   bottom
  for (const p of outline) verts.push([p.x, y1, p.z]);   // n+1..2n top
  const faces = [];
  // Bottom ring reversed so its normal points down; top as-is.
  faces.push(Array.from({ length: n }, (_, i) => n - i + vertexOffset));
  faces.push(Array.from({ length: n }, (_, i) => n + i + 1 + vertexOffset));
  for (let i = 0; i < n; i++) {
    const a = i + 1, b = ((i + 1) % n) + 1;
    faces.push([a, b, b + n, a + n].map(k => k + vertexOffset));
  }
  return { verts, faces };
}

export function buildRhinoExportObj({ floors, columnPositions, columnDims }) {
  const lines = ['# Exported from the Zoning/Massing/Columns pipeline for Rhino import', '# Real massing + real measured column positions — not a designed facade.'];
  let vOffset = 0;

  for (const fl of floors ?? []) {
    for (const b of fl.boxes ?? []) {
      // Fall back to the FLOOR's extent when a box carries no height of its
      // own. Boxes are stamped upstream (dwellings.stampBoxHeights), but this
      // writer must never emit `NaN` vertices into a file an architect opens:
      // it previously called undefined.toFixed(3) and threw outright.
      const y0 = b.y0 ?? fl.y0 ?? 0;
      const y1 = b.y1 ?? fl.y1 ?? (y0 + 3.4);
      const { verts, faces } = b.outline?.length >= 3
        ? prismToObjFaces(b.outline, y0, y1, vOffset)
        : boxToObjFaces(b.x0, b.x1, y0, y1, b.z0, b.z1, vOffset);
      lines.push(`o floor${fl.floorIdx ?? ''}_${b.type}`);
      for (const v of verts) lines.push(`v ${v[0].toFixed(3)} ${v[1].toFixed(3)} ${v[2].toFixed(3)}`);
      for (const f of faces) lines.push(`f ${f.join(' ')}`);
      vOffset += verts.length;
    }
  }

  const colW = 0.45 / 2;
  const baseY = columnDims?.baseY ?? 0;
  const height = columnDims?.height ?? 3;
  (columnPositions ?? []).forEach((c, i) => {
    const { verts, faces } = boxToObjFaces(c.x - colW, c.x + colW, baseY, baseY + height, c.z - colW, c.z + colW, vOffset);
    lines.push(`o column${i}`);
    for (const v of verts) lines.push(`v ${v[0].toFixed(3)} ${v[1].toFixed(3)} ${v[2].toFixed(3)}`);
    for (const f of faces) lines.push(`f ${f.join(' ')}`);
    vOffset += verts.length;
  });

  return lines.join('\n');
}

// GLB export — same real geometry as the OBJ writer above (real box/prism
// massing + real column markers), built as an actual THREE scene so
// GLTFExporter can bake it to a single binary .glb an architect can drag
// straight into Rhino, Blender, Unreal, or any GLB-reading app with no
// import script required.
function boxMesh(x0, x1, y0, y1, z0, z1, material) {
  const w = x1 - x0, h = y1 - y0, d = z1 - z0;
  if (!(w > 0) || !(h > 0) || !(d > 0)) return null;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return mesh;
}

// Same shape-extrude convention as MassingStage.jsx's addPolyPrism: build in
// (x, z), extrude +Y for height — a real L/T/U footprint, not its bounding box.
function prismMesh(outline, y0, y1, material) {
  const h = y1 - y0;
  if (!(h > 0) || !outline || outline.length < 3) return null;
  const shape = new THREE.Shape();
  shape.moveTo(outline[0].x, outline[0].z);
  for (let i = 1; i < outline.length; i++) shape.lineTo(outline[i].x, outline[i].z);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, y1, 0);
  return new THREE.Mesh(geo, material);
}

function buildExportScene({ floors, columnPositions, columnDims }) {
  const group = new THREE.Group();
  const massingMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d0 });
  const columnMat = new THREE.MeshStandardMaterial({ color: 0xffb08a });
  for (const fl of floors ?? []) {
    for (const b of fl.boxes ?? []) {
      const y0 = b.y0 ?? fl.y0 ?? 0;
      const y1 = b.y1 ?? fl.y1 ?? (y0 + 3.4);
      const mesh = b.outline?.length >= 3
        ? prismMesh(b.outline, y0, y1, massingMat)
        : boxMesh(b.x0, b.x1, y0, y1, b.z0, b.z1, massingMat);
      if (mesh) { mesh.name = `floor${fl.floorIdx ?? ''}_${b.type}`; group.add(mesh); }
    }
  }
  const colW = 0.45 / 2;
  const baseY = columnDims?.baseY ?? 0;
  const height = columnDims?.height ?? 3;
  (columnPositions ?? []).forEach((c, i) => {
    const mesh = boxMesh(c.x - colW, c.x + colW, baseY, baseY + height, c.z - colW, c.z + colW, columnMat);
    if (mesh) { mesh.name = `column${i}`; group.add(mesh); }
  });
  return group;
}

function exportGlbBinary(scene) {
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      scene,
      (result) => resolve(result), // ArrayBuffer, since binary:true below
      (err) => reject(err),
      { binary: true },
    );
  });
}

// Blob → object URL → <a download> — same pattern already used in
// src/configurator/ArchitectReview.jsx and ExportPanel.jsx.
function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function downloadRhinoExport(params) {
  const safeName = (params.siteName ?? params.buildingType ?? 'export').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const json = buildRhinoExportPayload(params);
  downloadBlob(JSON.stringify(json, null, 2), `${safeName}-massing-columns.json`, 'application/json');
  // Firing three <a download> clicks back-to-back in the same tick trips
  // Chrome/Edge's "this site is trying to download multiple files" block —
  // only the first (JSON) actually saves, and the rest fail silently unless
  // the user notices and approves the browser's blocked-download prompt.
  // Spacing them out lets each one register as its own user-driven download.
  await sleep(400);
  const obj = buildRhinoExportObj(params);
  downloadBlob(obj, `${safeName}-massing-columns.obj`, 'text/plain');
  try {
    const glbBuffer = await exportGlbBinary(buildExportScene(params));
    await sleep(400);
    downloadBlob(glbBuffer, `${safeName}-massing-columns.glb`, 'model/gltf-binary');
  } catch (err) {
    // Real JSON/OBJ downloads above already succeeded — a GLB bake failure
    // (e.g. a degenerate outline) shouldn't be silently swallowed, but it
    // also shouldn't block the two exports that DID work.
    console.error('GLB export failed:', err);
  }
}
