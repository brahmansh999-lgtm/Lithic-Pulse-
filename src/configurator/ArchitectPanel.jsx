import { useState } from 'react';
import './ArchitectReview.css';
import './ArchitectPanel.css';

// Architect Review used to be its own top-level step (Configure → View Your
// Home → Architect Review → Manufacture) — but an architect reviewing a home
// AFTER the client already saw/captured it as a separate later screen meant
// re-navigating back and forth to compare notes against the actual view.
// User-directed: fold review straight into View Your Home as a docked side
// panel, live against the same room the client is looking at right now, and
// drop the standalone step from the pipeline entirely.

const CATEGORIES = [
  { id: 'structure',  label: 'Structure',         color: '#a8a49e' },
  { id: 'envelope',   label: 'Envelope & Facade',  color: '#bcb8b2' },
  { id: 'materials',  label: 'Material Mix',       color: '#8898b0' },
  { id: 'layout',     label: 'Layout & Spatial',   color: '#88aacc' },
  { id: 'services',   label: 'Services & MEP',     color: '#a8c890' },
  { id: 'general',    label: 'General Notes',      color: '#c0b090' },
];

const STATUS_OPTIONS = [
  { id: 'suggest',  label: 'Suggestion', color: '#5ba3c9',  bg: 'rgba(91,163,201,0.12)' },
  { id: 'query',    label: 'Query',      color: '#f0c040',  bg: 'rgba(240,192,64,0.12)'  },
  { id: 'approve',  label: 'Approved',   color: '#6dbb82',  bg: 'rgba(109,187,130,0.12)' },
  { id: 'flag',     label: 'Flag',       color: '#e05c3a',  bg: 'rgba(224,92,58,0.12)'   },
];

function statusDef(id) {
  return STATUS_OPTIONS.find(s => s.id === id) || STATUS_OPTIONS[0];
}

function NoteCard({ note, onUpdate, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.text);
  const st = statusDef(note.status);
  const commit = () => { onUpdate({ ...note, text: draft }); setEditing(false); };

  return (
    <div className="ar-note-card ap-note-card" style={{ borderLeftColor: st.color }}>
      <div className="ar-note-header">
        <div className="ar-note-cat-dot" style={{ background: CATEGORIES.find(c => c.id === note.category)?.color || '#888' }} />
        <span className="ar-note-cat">{CATEGORIES.find(c => c.id === note.category)?.label}</span>
        <div className="ar-note-actions">
          <button className="ar-icon-btn" onClick={() => setEditing(e => !e)} title="Edit">✎</button>
          <button className="ar-icon-btn ar-icon-btn--remove" onClick={onRemove} title="Remove">✕</button>
        </div>
      </div>
      <div className="ar-note-status-group ap-note-status-group">
        {STATUS_OPTIONS.map(s => (
          <button
            key={s.id}
            className={`ar-status-chip${note.status === s.id ? ' active' : ''}`}
            style={note.status === s.id ? { background: s.bg, color: s.color, borderColor: s.color } : {}}
            onClick={() => onUpdate({ ...note, status: s.id })}
          >
            {s.label}
          </button>
        ))}
      </div>
      {editing ? (
        <div className="ar-note-edit">
          <textarea className="ar-textarea" value={draft} onChange={e => setDraft(e.target.value)} rows={3} autoFocus />
          <div className="ar-note-edit-actions">
            <button className="ar-btn ar-btn--primary" onClick={commit}>Save</button>
            <button className="ar-btn ar-btn--ghost" onClick={() => { setDraft(note.text); setEditing(false); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <p className="ar-note-text">{note.text}</p>
      )}
    </div>
  );
}

function AddNoteForm({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [category, setCategory] = useState('general');
  const [status, setStatus] = useState('suggest');

  const submit = () => {
    if (!text.trim()) return;
    onAdd({ id: Date.now(), text: text.trim(), category, status });
    setText(''); setOpen(false);
  };

  if (!open) return (
    <button className="ar-add-btn" onClick={() => setOpen(true)}>+ Add Annotation</button>
  );

  return (
    <div className="ar-add-form">
      <div className="ar-add-form-row">
        <select className="ar-select" value={category} onChange={e => setCategory(e.target.value)}>
          {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <select className="ar-select" value={status} onChange={e => setStatus(e.target.value)}>
          {STATUS_OPTIONS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>
      <textarea
        className="ar-textarea"
        placeholder="Write your annotation, suggestion, or query…"
        value={text}
        onChange={e => setText(e.target.value)}
        rows={2}
        autoFocus
      />
      <div className="ar-add-form-actions">
        <button className="ar-btn ar-btn--primary" onClick={submit}>Add</button>
        <button className="ar-btn ar-btn--ghost" onClick={() => { setText(''); setOpen(false); }}>Cancel</button>
      </div>
    </div>
  );
}

function buildReport(typology, notes) {
  const now = new Date();
  const refId = `AR-${(typology?.id || 'unit').toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
  const lines = [
    '═══════════════════════════════════════════════',
    '  LITHIC PULSE — ARCHITECT REVIEW',
    '═══════════════════════════════════════════════',
    `  Reference  : ${refId}`,
    `  Date       : ${now.toLocaleDateString('en-GB')}`,
    '',
    '── UNIT ────────────────────────────────────────',
    `  Typology   : ${typology?.label || '—'}`,
    `  Floor Area : ${typology?.areaM2 ? typology.areaM2 + ' m²' : '—'}`,
    '',
    '── ARCHITECT ANNOTATIONS ───────────────────────',
  ];
  if (notes.length === 0) {
    lines.push('  (No annotations added)');
  } else {
    const grouped = {};
    notes.forEach(n => { (grouped[n.category] ??= []).push(n); });
    Object.entries(grouped).forEach(([cat, ns]) => {
      const catLabel = CATEGORIES.find(c => c.id === cat)?.label || cat;
      lines.push('', `  ▸ ${catLabel}`);
      ns.forEach(n => lines.push(`    [${statusDef(n.status).label.toUpperCase()}] ${n.text}`));
    });
  }
  lines.push('', '═══════════════════════════════════════════════');
  return lines.join('\n');
}

export default function ArchitectPanel({ typology }) {
  const [notes, setNotes] = useState([]);
  const [collapsed, setCollapsed] = useState(false);

  const addNote    = (n)  => setNotes(prev => [...prev, n]);
  const updateNote = (n)  => setNotes(prev => prev.map(x => x.id === n.id ? n : x));
  const removeNote = (id) => setNotes(prev => prev.filter(x => x.id !== id));

  const counts = STATUS_OPTIONS.reduce((acc, s) => {
    acc[s.id] = notes.filter(n => n.status === s.id).length;
    return acc;
  }, {});

  const handleDownload = () => {
    const report = buildReport(typology, notes);
    const blob = new Blob([report], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `lithic-pulse-${typology?.id || 'unit'}-architect-review.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`ap-panel${collapsed ? ' ap-panel--collapsed' : ''}`}>
      <div className="ap-panel-head" onClick={() => setCollapsed(c => !c)}>
        <span className="ap-panel-title">Architect's Notes</span>
        <div className="ap-panel-head-right">
          {notes.length > 0 && <span className="ap-panel-count">{notes.length}</span>}
          <span className="ap-panel-chevron">{collapsed ? '▸' : '▾'}</span>
        </div>
      </div>
      {!collapsed && (
        <div className="ap-panel-body">
          {counts && (
            <div className="ar-count-pills ap-count-pills">
              {STATUS_OPTIONS.map(s => counts[s.id] > 0 && (
                <span key={s.id} className="ar-count-pill" style={{ color: s.color, borderColor: s.color, background: s.bg }}>
                  {counts[s.id]} {s.label}
                </span>
              ))}
            </div>
          )}
          <div className="ap-notes-list">
            {notes.length === 0 && (
              <div className="ar-notes-empty ap-notes-empty">
                Review this home right here — add suggestions, queries, or approvals as you look at it.
              </div>
            )}
            {notes.map(n => (
              <NoteCard key={n.id} note={n} onUpdate={updateNote} onRemove={() => removeNote(n.id)} />
            ))}
          </div>
          <AddNoteForm onAdd={addNote} />
          {notes.length > 0 && (
            <button className="ar-btn ar-btn--primary ap-download-btn" onClick={handleDownload}>↓ Download Review</button>
          )}
        </div>
      )}
    </div>
  );
}
