// RhinoImport — lets the architect upload the .glb they exported from Rhino
// after designing the real building on top of the massing/column data from
// the Export step. No existing upload pattern in this codebase to reuse —
// this is a standard <input type="file"> + object-URL handoff.
import { useRef } from 'react';
import { setRhinoImport } from './rhinoImportStore';

export default function RhinoImportButton({ siteId, onImported }) {
  const inputRef = useRef(null);

  const handleChange = (e) => {
    const file = e.target.files?.[0];
    if (!file || siteId == null) return;
    setRhinoImport(siteId, file);
    onImported?.(file);
    e.target.value = '';
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".glb"
        onChange={handleChange}
        style={{ display: 'none' }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={siteId == null}
        style={{
          width: '100%', background: 'var(--accent)', color: 'var(--bg)', border: 'none',
          fontFamily: 'var(--mono)', fontSize: '0.72rem', fontWeight: 700,
          letterSpacing: '0.08em', padding: '0.65rem 0.8rem', cursor: siteId == null ? 'default' : 'pointer',
          textTransform: 'uppercase', opacity: siteId == null ? 0.5 : 1,
        }}
      >
        Import .glb ↑
      </button>
    </>
  );
}
