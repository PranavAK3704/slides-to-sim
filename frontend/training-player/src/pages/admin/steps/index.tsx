import { useEffect, useState, useCallback } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { supabase, ProcessStep, DetectionStep, Simulation } from '@/lib/supabase';
import { Plus, Trash2, Save, Download, ChevronRight, Globe, Tag, Check, X } from 'lucide-react';

// ── Helpers ───────────────────────────────────────────────────────────────────

const SOURCE_COLORS: Record<string, string> = {
  gemini: '#9747FF',
  ppt:    '#f59e0b',
  manual: '#22c55e',
};

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
      background: `${color}18`, color, textTransform: 'uppercase', letterSpacing: '0.4px',
    }}>{text}</span>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        width: 38, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer', padding: 0,
        background: value ? '#22c55e' : '#d1d5db', position: 'relative', transition: 'background 0.2s',
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: value ? 20 : 2, width: 16, height: 16,
        borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      }} />
    </button>
  );
}

// ── Step row editor ───────────────────────────────────────────────────────────

function StepRow({ step, index, onChange, onDelete }: {
  step: DetectionStep;
  index: number;
  onChange: (s: DetectionStep) => void;
  onDelete: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
      <div style={{
        width: 24, height: 24, borderRadius: '50%', background: 'linear-gradient(135deg,#F43397,#9747FF)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11,
        fontWeight: 700, color: '#fff', flexShrink: 0,
      }}>{index + 1}</div>

      <input
        value={step.elementText}
        onChange={e => onChange({ ...step, elementText: e.target.value })}
        placeholder="Element text (e.g. RTO Manifest)"
        style={{
          flex: 2, padding: '6px 10px', borderRadius: 6, border: '1px solid #e5e7eb',
          fontSize: 12, outline: 'none', color: '#1a1a2e',
        }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
        <Globe size={11} color="#9ca3af" />
        <input
          value={step.urlPattern}
          onChange={e => onChange({ ...step, urlPattern: e.target.value })}
          placeholder="url fragment (e.g. rto)"
          style={{
            flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid #e5e7eb',
            fontSize: 12, outline: 'none', color: '#1a1a2e',
          }}
        />
      </div>

      <button
        onClick={onDelete}
        style={{ padding: 5, border: 'none', background: 'transparent', cursor: 'pointer', color: '#d1d5db', borderRadius: 4 }}
        title="Delete step"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

// ── Import from Simulation modal ──────────────────────────────────────────────

function SimPickerModal({ onPick, onClose }: {
  onPick: (steps: DetectionStep[]) => void;
  onClose: () => void;
}) {
  const [sims, setSims] = useState<Simulation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('simulations').select('id,title,process_name,steps_json')
      .eq('published', true).order('created_at', { ascending: false })
      .then(({ data }) => { setSims((data as Simulation[]) || []); setLoading(false); });
  }, []);

  function pick(sim: Simulation) {
    const raw = Array.isArray(sim.steps_json) ? (sim.steps_json as any[]) : [];
    const steps: DetectionStep[] = raw
      .filter(s => s.elementText?.trim())
      .map((s, i) => ({ order: i + 1, elementText: s.elementText.trim(), urlPattern: s.urlPattern || '' }));
    onPick(steps);
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: '#fff', borderRadius: 14, padding: 24, width: 480, maxHeight: '70vh',
        overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: '#1a1a2e' }}>Import from Simulation</span>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#9ca3af' }}>
            <X size={16} />
          </button>
        </div>
        <div style={{ overflow: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loading && <div style={{ color: '#888', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</div>}
          {!loading && sims.length === 0 && (
            <div style={{ color: '#888', fontSize: 13, textAlign: 'center', padding: 24 }}>No published simulations</div>
          )}
          {sims.map(sim => {
            const raw = Array.isArray(sim.steps_json) ? (sim.steps_json as any[]) : [];
            const count = raw.filter(s => s.elementText?.trim()).length;
            return (
              <button key={sim.id} onClick={() => pick(sim)} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                background: '#f8f9fa', border: '1px solid #e5e7eb', borderRadius: 8,
                cursor: 'pointer', textAlign: 'left', transition: 'border-color 0.15s',
              }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = '#9747FF')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#e5e7eb')}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a2e' }}>{sim.process_name || sim.title}</div>
                  <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{count} detection step{count !== 1 ? 's' : ''}</div>
                </div>
                <ChevronRight size={14} color="#9ca3af" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Editor panel ──────────────────────────────────────────────────────────────

function EditorPanel({ entry, onSave, onDelete, onClose }: {
  entry: ProcessStep | null;
  onSave: (updated: ProcessStep) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const isNew = !entry?.id || entry.id === '__new__';
  const [data, setData] = useState<ProcessStep>(entry ?? {
    id: '__new__', process_name: '', hub: '', source: 'manual',
    steps: [], published: true, sim_id: null, created_at: '', updated_at: '',
  });
  const [saving, setSaving] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    setData(entry ?? {
      id: '__new__', process_name: '', hub: '', source: 'manual',
      steps: [], published: true, sim_id: null, created_at: '', updated_at: '',
    });
  }, [entry]);

  const updateStep = (i: number, s: DetectionStep) =>
    setData(d => { const steps = [...d.steps]; steps[i] = s; return { ...d, steps }; });

  const deleteStep = (i: number) =>
    setData(d => ({ ...d, steps: d.steps.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, order: idx + 1 })) }));

  const addStep = () =>
    setData(d => ({ ...d, steps: [...d.steps, { order: d.steps.length + 1, elementText: '', urlPattern: '' }] }));

  const importSteps = (steps: DetectionStep[]) => {
    setData(d => ({ ...d, steps }));
    setShowPicker(false);
  };

  const save = async () => {
    if (!data.process_name.trim()) return;
    setSaving(true);
    await onSave(data);
    setSaving(false);
  };

  return (
    <>
      {showPicker && <SimPickerModal onPick={importSteps} onClose={() => setShowPicker(false)} />}
      <div style={{
        width: 480, background: '#fff', borderLeft: '1px solid #e8eaed',
        display: 'flex', flexDirection: 'column', height: '100%', flexShrink: 0,
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid #e8eaed',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: '#1a1a2e' }}>
            {isNew ? 'New Process' : 'Edit Steps'}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {!isNew && (
              <button onClick={() => onDelete(data.id)} style={{
                padding: '6px 12px', borderRadius: 7, border: '1px solid #fca5a5',
                background: '#fff', color: '#ef4444', fontSize: 12, cursor: 'pointer',
              }}>Delete</button>
            )}
            <button onClick={onClose} style={{
              padding: '6px 12px', borderRadius: 7, border: '1px solid #e5e7eb',
              background: '#fff', color: '#666', fontSize: 12, cursor: 'pointer',
            }}>Cancel</button>
            <button onClick={save} disabled={saving} style={{
              padding: '6px 14px', borderRadius: 7, border: 'none',
              background: 'linear-gradient(135deg,#F43397,#9747FF)', color: '#fff',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            }}>
              {saving ? 'Saving…' : <><Save size={12} /> Save</>}
            </button>
          </div>
        </div>

        {/* Fields */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e8eaed', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#666', display: 'block', marginBottom: 4 }}>PROCESS NAME</label>
            <input
              value={data.process_name}
              onChange={e => setData(d => ({ ...d, process_name: e.target.value }))}
              placeholder="e.g. RTO Bagging"
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e5e7eb',
                fontSize: 13, outline: 'none', color: '#1a1a2e', boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#666', display: 'block', marginBottom: 4 }}>HUB (optional)</label>
              <input
                value={data.hub || ''}
                onChange={e => setData(d => ({ ...d, hub: e.target.value || null }))}
                placeholder="All hubs"
                style={{
                  width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e5e7eb',
                  fontSize: 13, outline: 'none', color: '#1a1a2e', boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', paddingBottom: 1 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#666', display: 'block', marginBottom: 4 }}>PUBLISHED</label>
              <Toggle value={data.published} onChange={v => setData(d => ({ ...d, published: v }))} />
            </div>
          </div>
        </div>

        {/* Steps */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#1a1a2e' }}>
              STEPS <span style={{ fontWeight: 400, color: '#888' }}>({data.steps.length})</span>
            </span>
            <button onClick={() => setShowPicker(true)} style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px',
              borderRadius: 6, border: '1px solid #e5e7eb', background: '#f8f9fa',
              fontSize: 11, color: '#666', cursor: 'pointer',
            }}>
              <Download size={11} /> Import from Sim
            </button>
          </div>

          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 8, paddingBottom: 6, borderBottom: '1px solid #f3f4f6', marginBottom: 4 }}>
              <div style={{ width: 24, flexShrink: 0 }} />
              <div style={{ flex: 2, fontSize: 10, fontWeight: 600, color: '#9ca3af' }}>ELEMENT TEXT</div>
              <div style={{ flex: 1, fontSize: 10, fontWeight: 600, color: '#9ca3af' }}>URL PATTERN</div>
              <div style={{ width: 23 }} />
            </div>
            {data.steps.length === 0 && (
              <div style={{ color: '#ccc', fontSize: 12, textAlign: 'center', padding: '20px 0' }}>
                No steps yet — add manually or import from a simulation
              </div>
            )}
            {data.steps.map((step, i) => (
              <StepRow key={i} step={step} index={i}
                onChange={s => updateStep(i, s)}
                onDelete={() => deleteStep(i)}
              />
            ))}
          </div>

          <button onClick={addStep} style={{
            display: 'flex', alignItems: 'center', gap: 6, width: '100%',
            padding: '8px 12px', borderRadius: 8, border: '1px dashed #d1d5db',
            background: 'transparent', color: '#9ca3af', fontSize: 12, cursor: 'pointer',
            justifyContent: 'center', marginTop: 4,
          }}>
            <Plus size={13} /> Add Step
          </button>
        </div>
      </div>
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function StepsPage() {
  const [entries,  setEntries]  = useState<ProcessStep[]>([]);
  const [selected, setSelected] = useState<ProcessStep | null>(null);
  const [loading,  setLoading]  = useState(true);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('process_steps')
      .select('*')
      .order('process_name', { ascending: true });
    setEntries((data as ProcessStep[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const startNew = () => setSelected({
    id: '__new__', process_name: '', hub: null, source: 'manual',
    steps: [], published: true, sim_id: null, created_at: '', updated_at: '',
  });

  const handleSave = async (updated: ProcessStep) => {
    const isNew = !updated.id || updated.id === '__new__';
    const payload = {
      process_name: updated.process_name.trim(),
      hub:          updated.hub || null,
      source:       updated.source,
      steps:        updated.steps.map((s, i) => ({ order: i + 1, elementText: s.elementText.trim(), urlPattern: s.urlPattern.trim() })),
      published:    updated.published,
      updated_at:   new Date().toISOString(),
    };

    if (isNew) {
      const { data } = await supabase.from('process_steps').insert(payload).select().single();
      if (data) { setEntries(e => [data as ProcessStep, ...e]); setSelected(data as ProcessStep); }
    } else {
      await supabase.from('process_steps').update(payload).eq('id', updated.id);
      setEntries(e => e.map(x => x.id === updated.id ? { ...x, ...payload } : x));
      setSelected(s => s ? { ...s, ...payload } : s);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this process? PCT detection will stop matching it.')) return;
    await supabase.from('process_steps').delete().eq('id', id);
    setEntries(e => e.filter(x => x.id !== id));
    setSelected(null);
  };

  return (
    <AdminLayout title="Process Steps">
      <div style={{
        display: 'flex', gap: 0, height: 'calc(100vh - 116px)',
        margin: '-28px', overflow: 'hidden',
      }}>
        {/* Left: process list */}
        <div style={{ flex: 1, overflow: 'auto', padding: 28 }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 13, color: '#888' }}>{entries.length} process{entries.length !== 1 ? 'es' : ''}</div>
            </div>
            <button onClick={startNew} style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 9,
              border: 'none', background: 'linear-gradient(135deg,#F43397,#9747FF)', color: '#fff',
              fontWeight: 600, fontSize: 13, cursor: 'pointer',
            }}>
              <Plus size={15} /> New Process
            </button>
          </div>

          {/* Info banner */}
          <div style={{
            background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10, padding: '10px 14px',
            marginBottom: 20, fontSize: 12, color: '#0369a1',
          }}>
            These steps are used by the <strong>PCT auto-detection</strong> extension. Each process needs accurate
            <code style={{ background: '#e0f2fe', padding: '1px 5px', borderRadius: 3, marginLeft: 4 }}>elementText</code> and
            <code style={{ background: '#e0f2fe', padding: '1px 5px', borderRadius: 3, marginLeft: 4 }}>urlPattern</code> per step.
          </div>

          {loading && (
            <div style={{ color: '#888', fontSize: 13, textAlign: 'center', padding: 40 }}>Loading…</div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {entries.map(entry => {
              const isActive = selected?.id === entry.id;
              return (
                <div
                  key={entry.id}
                  onClick={() => setSelected(entry)}
                  style={{
                    background: '#fff', borderRadius: 10, padding: '14px 16px',
                    border: `1.5px solid ${isActive ? '#9747FF' : '#e8eaed'}`,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12,
                    boxShadow: isActive ? '0 0 0 3px rgba(151,71,255,0.08)' : '0 1px 3px rgba(0,0,0,0.04)',
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e' }}>{entry.process_name}</span>
                      {!entry.published && <Badge text="Draft" color="#ef4444" />}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Badge text={entry.source} color={SOURCE_COLORS[entry.source] || '#888'} />
                      {entry.hub && (
                        <span style={{ fontSize: 11, color: '#888', display: 'flex', alignItems: 'center', gap: 3 }}>
                          <Tag size={10} /> {entry.hub}
                        </span>
                      )}
                      <span style={{ fontSize: 11, color: '#888' }}>{entry.steps?.length ?? 0} steps</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {entry.published
                      ? <span style={{ display:'flex', alignItems:'center', gap:3, fontSize:11, color:'#22c55e' }}><Check size={11}/>Live</span>
                      : <span style={{ display:'flex', alignItems:'center', gap:3, fontSize:11, color:'#ef4444' }}><X size={11}/>Draft</span>
                    }
                    <ChevronRight size={14} color={isActive ? '#9747FF' : '#d1d5db'} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: editor panel */}
        {selected && (
          <EditorPanel
            entry={selected}
            onSave={handleSave}
            onDelete={handleDelete}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </AdminLayout>
  );
}
