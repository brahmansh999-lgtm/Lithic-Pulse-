import { useState } from 'react';
import { computeBOM, bomSummary } from './utils/computeBOM';
import layouts from './data/roomLayouts.json';
import kit from './data/kitOfParts.json';
import './ArchitectReview.css';

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

// ── Single annotation card ───────────────────────────────────────
function NoteCard({ note, onUpdate, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.text);
  const st = statusDef(note.status);

  const commit = () => { onUpdate({ ...note, text: draft }); setEditing(false); };

  return (
    <div className="ar-note-card" style={{ borderLeftColor: st.color }}>
      <div className="ar-note-header">
        <div className="ar-note-cat-dot" style={{ background: CATEGORIES.find(c => c.id === note.category)?.color || '#888' }} />
        <span className="ar-note-cat">{CATEGORIES.find(c => c.id === note.category)?.label}</span>

        <div className="ar-note-status-group">
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

        <div className="ar-note-actions">
          <button className="ar-icon-btn" onClick={() => setEditing(e => !e)} title="Edit">✎</button>
          <button className="ar-icon-btn ar-icon-btn--remove" onClick={onRemove} title="Remove">✕</button>
        </div>
      </div>

      {editing ? (
        <div className="ar-note-edit">
          <textarea
            className="ar-textarea"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={3}
            autoFocus
          />
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

// ── Add note form ────────────────────────────────────────────────
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
        rows={3}
        autoFocus
      />
      <div className="ar-add-form-actions">
        <button className="ar-btn ar-btn--primary" onClick={submit}>Add</button>
        <button className="ar-btn ar-btn--ghost" onClick={() => { setText(''); setOpen(false); }}>Cancel</button>
      </div>
    </div>
  );
}

// ── Summary strip ────────────────────────────────────────────────
function SummaryStrip({ typology, config }) {
  const bom = computeBOM(typology, config || {}, layouts);
  const { totalPieces, totalWeightT } = bomSummary(bom);

  const balcony   = kit.balconies.find(b => b.id === config?.balcony);
  const partition = kit.partitions.find(p => p.id === config?.partition);
  const glazing   = kit.glazing.find(g => g.id === config?.glazing);

  const baseCost = typology.areaM2 * kit.baseCostPerM2 * (balcony?.costMult || 1);
  const labour   = typology.areaM2 * kit.labourPerM2;
  const total    = baseCost + labour + kit.deliveryCostBase;

  const facts = [
    { label: 'Typology',   val: typology.label },
    { label: 'Floor Area', val: `${typology.areaM2} m²` },
    { label: 'Balcony',    val: balcony?.label || '—' },
    { label: 'Partitions', val: partition?.label || '—' },
    { label: 'Glazing',    val: glazing?.label || '—' },
    { label: 'Parts',      val: `${totalPieces} pcs` },
    { label: 'Weight',     val: `${totalWeightT} t` },
    { label: 'Est. Cost',  val: `£${Math.round(total).toLocaleString()}` },
  ];

  return (
    <div className="ar-summary">
      {facts.map(f => (
        <div key={f.label} className="ar-summary-item">
          <span className="ar-summary-label">{f.label}</span>
          <span className="ar-summary-val">{f.val}</span>
        </div>
      ))}
    </div>
  );
}

// ── Download combined report ─────────────────────────────────────
function buildReport(typology, config, notes) {
  const now = new Date();
  const refId = `AR-${typology.id.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;

  const balcony   = kit.balconies.find(b => b.id === config?.balcony);
  const partition = kit.partitions.find(p => p.id === config?.partition);
  const glazing   = kit.glazing.find(g => g.id === config?.glazing);

  const lines = [
    '═══════════════════════════════════════════════',
    '  LITHIC PULSE — ARCHITECT REVIEW',
    '═══════════════════════════════════════════════',
    `  Reference  : ${refId}`,
    `  Date       : ${now.toLocaleDateString('en-GB')}`,
    '',
    '── UNIT ────────────────────────────────────────',
    `  Typology   : ${typology.label}`,
    `  Floor Area : ${typology.areaM2} m²`,
    '',
    '── CONFIGURATION ───────────────────────────────',
    `  Balcony    : ${balcony?.label || '—'}`,
    `  Partitions : ${partition?.label || '—'}`,
    `  Glazing    : ${glazing?.label || '—'}`,
    '',
    '── ARCHITECT ANNOTATIONS ───────────────────────',
  ];

  if (notes.length === 0) {
    lines.push('  (No annotations added)');
  } else {
    const grouped = {};
    notes.forEach(n => {
      if (!grouped[n.category]) grouped[n.category] = [];
      grouped[n.category].push(n);
    });
    Object.entries(grouped).forEach(([cat, ns]) => {
      const catLabel = CATEGORIES.find(c => c.id === cat)?.label || cat;
      lines.push('', `  ▸ ${catLabel}`);
      ns.forEach(n => {
        const stLabel = statusDef(n.status).label.toUpperCase();
        lines.push(`    [${stLabel}] ${n.text}`);
      });
    });
  }

  lines.push('', '═══════════════════════════════════════════════');
  return lines.join('\n');
}

// ── Main ─────────────────────────────────────────────────────────
export default function ArchitectReview({ typology, config, onBack, onDone }) {
  const [notes, setNotes] = useState([]);
  const [filterCat, setFilterCat] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  const addNote    = (n)  => setNotes(prev => [...prev, n]);
  const updateNote = (n)  => setNotes(prev => prev.map(x => x.id === n.id ? n : x));
  const removeNote = (id) => setNotes(prev => prev.filter(x => x.id !== id));

  const visible = notes.filter(n =>
    (filterCat === 'all'    || n.category === filterCat) &&
    (filterStatus === 'all' || n.status   === filterStatus)
  );

  const counts = STATUS_OPTIONS.reduce((acc, s) => {
    acc[s.id] = notes.filter(n => n.status === s.id).length;
    return acc;
  }, {});

  const handleDownload = () => {
    const report = buildReport(typology, config, notes);
    const blob = new Blob([report], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `lithic-pulse-${typology?.id || 'unit'}-architect-review.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="ar-root">
      {/* Header */}
      <div className="ar-header">
        <div className="ar-header-left">
          <span className="ar-brand">Architect Review</span>
          {typology && <span className="ar-unit-chip">{typology.label} · {typology.areaM2} m²</span>}
        </div>
        <div className="ar-header-right">
          <div className="ar-count-pills">
            {STATUS_OPTIONS.map(s => counts[s.id] > 0 && (
              <span key={s.id} className="ar-count-pill" style={{ color: s.color, borderColor: s.color, background: s.bg }}>
                {counts[s.id]} {s.label}
              </span>
            ))}
          </div>
          <button className="ar-btn ar-btn--primary" onClick={handleDownload}>↓ Download Review</button>
          {onDone && <button className="ar-btn ar-btn--accent" onClick={onDone}>Finalise →</button>}
        </div>
      </div>

      <div className="ar-body">
        {/* Left: unit summary + filters + notes */}
        <div className="ar-left">
          <SummaryStrip typology={typology} config={config} />

          {/* Filter bar */}
          <div className="ar-filters">
            <div className="ar-filter-group">
              <span className="ar-filter-label">Category</span>
              <button className={`ar-filter-btn${filterCat === 'all' ? ' active' : ''}`} onClick={() => setFilterCat('all')}>All</button>
              {CATEGORIES.map(c => (
                <button
                  key={c.id}
                  className={`ar-filter-btn${filterCat === c.id ? ' active' : ''}`}
                  onClick={() => setFilterCat(c.id)}
                  style={filterCat === c.id ? { borderColor: c.color, color: c.color } : {}}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className="ar-filter-group">
              <span className="ar-filter-label">Status</span>
              <button className={`ar-filter-btn${filterStatus === 'all' ? ' active' : ''}`} onClick={() => setFilterStatus('all')}>All</button>
              {STATUS_OPTIONS.map(s => (
                <button
                  key={s.id}
                  className={`ar-filter-btn${filterStatus === s.id ? ' active' : ''}`}
                  onClick={() => setFilterStatus(s.id)}
                  style={filterStatus === s.id ? { borderColor: s.color, color: s.color } : {}}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Notes list */}
          <div className="ar-notes-list">
            {visible.length === 0 && (
              <div className="ar-notes-empty">
                {notes.length === 0
                  ? 'No annotations yet. Add suggestions, queries, or approvals below.'
                  : 'No annotations match the current filters.'}
              </div>
            )}
            {visible.map(n => (
              <NoteCard
                key={n.id}
                note={n}
                onUpdate={updateNote}
                onRemove={() => removeNote(n.id)}
              />
            ))}
          </div>

          <AddNoteForm onAdd={addNote} />

          <div className="ar-nav-row">
            <button className="ar-btn ar-btn--ghost" onClick={onBack}>← Back to Export</button>
          </div>
        </div>

        {/* Right: guidance panel */}
        <div className="ar-right">
          <div className="ar-guidance-head">Architect's Lens</div>
          <div className="ar-guidance-body">
            <p>Review the client's configured unit against the masterplan intent. Use annotations to record your professional judgement before the spec is locked for manufacture.</p>

            <div className="ar-guidance-section">
              <div className="ar-guidance-section-title">What to check</div>
              <ul className="ar-guidance-list">
                <li>Column grid continuity with adjacent units</li>
                <li>Glazing U-value vs. orientation (solar gain)</li>
                <li>Balcony type against party wall conditions</li>
                <li>Partition layout vs. acoustic separation reqs</li>
                <li>Material mix deviation from reference recipe</li>
                <li>MEP routes through structural panels</li>
                <li>Accessibility & Part M compliance</li>
              </ul>
            </div>

            <div className="ar-guidance-section">
              <div className="ar-guidance-section-title">Annotation types</div>
              {STATUS_OPTIONS.map(s => (
                <div key={s.id} className="ar-guidance-status-row">
                  <span className="ar-guidance-chip" style={{ color: s.color, borderColor: s.color, background: s.bg }}>{s.label}</span>
                  <span className="ar-guidance-desc">
                    {s.id === 'suggest' && 'An alternative approach worth considering'}
                    {s.id === 'query'   && 'Needs clarification from client or engineer'}
                    {s.id === 'approve' && 'Reviewed and sign-off given'}
                    {s.id === 'flag'    && 'Must be resolved before manufacture'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
