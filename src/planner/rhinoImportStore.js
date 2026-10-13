// rhinoImportStore — holds the Rhino-exported GLB an architect has uploaded
// back into the platform, keyed by site id. In-memory/session-only for now
// (no backend upload endpoint exists yet) — real enough to demo the full
// export → design in Rhino → import loop; wiring this to durable storage is
// separate follow-up work, not something to fake here.

const store = new Map(); // siteId -> { url, fileName }

export function setRhinoImport(siteId, file) {
  const prev = store.get(siteId);
  if (prev?.url) URL.revokeObjectURL(prev.url);
  const url = URL.createObjectURL(file);
  store.set(siteId, { url, fileName: file.name });
  return url;
}

export function getRhinoImport(siteId) {
  return store.get(siteId) ?? null;
}

export function clearRhinoImport(siteId) {
  const prev = store.get(siteId);
  if (prev?.url) URL.revokeObjectURL(prev.url);
  store.delete(siteId);
}
