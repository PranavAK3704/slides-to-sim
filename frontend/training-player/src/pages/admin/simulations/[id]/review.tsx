import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '@/components/AdminLayout';
import { supabase } from '@/lib/supabase';
import type { SimulationConfig, SimulationStep, Hotspot } from '@/types';
import {
  ChevronLeft, ChevronRight, Save, Trash2, CheckCircle,
  AlertTriangle, Check, Eye, Loader
} from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// ─── Hotspot Editor ───────────────────────────────────────────────────────────

function HotspotEditor({
  imageUrl,
  hotspot,
  onChange,
}: {
  imageUrl: string;
  hotspot: Hotspot | null | undefined;
  onChange: (h: Hotspot) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    const w = hotspot?.widthPct ?? 12;
    const h = hotspot?.heightPct ?? 6;
    onChange({
      xPct: Math.max(0, Math.min(100 - w, xPct - w / 2)),
      yPct: Math.max(0, Math.min(100 - h, yPct - h / 2)),
      widthPct: w,
      heightPct: h,
    });
  };

  const adjust = (key: 'widthPct' | 'heightPct', delta: number) => {
    if (!hotspot) return;
    onChange({ ...hotspot, [key]: Math.max(2, Math.min(80, hotspot[key] + delta)) });
  };

  return (
    <div>
      <div
        ref={containerRef}
        onClick={handleClick}
        style={{ position: 'relative', width: '100%', aspectRatio: '16/9', borderRadius: 8, overflow: 'hidden', cursor: 'crosshair', border: '1.5px solid #e8eaed', background: '#000' }}
        title="Click to reposition hotspot"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="Slide" style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }} draggable={false} />

        {hotspot && (
          <>
            {/* Dim strips */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: `${hotspot.yPct}%`, background: 'rgba(0,0,0,0.45)', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', top: `${hotspot.yPct + hotspot.heightPct}%`, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.45)', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', top: `${hotspot.yPct}%`, left: 0, width: `${hotspot.xPct}%`, height: `${hotspot.heightPct}%`, background: 'rgba(0,0,0,0.45)', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', top: `${hotspot.yPct}%`, left: `${hotspot.xPct + hotspot.widthPct}%`, right: 0, height: `${hotspot.heightPct}%`, background: 'rgba(0,0,0,0.45)', pointerEvents: 'none' }} />
            {/* Hotspot ring */}
            <div style={{
              position: 'absolute',
              left: `${hotspot.xPct}%`, top: `${hotspot.yPct}%`,
              width: `${hotspot.widthPct}%`, height: `${hotspot.heightPct}%`,
              border: '2px solid #f59e0b',
              boxShadow: '0 0 0 3px rgba(245,158,11,0.25)',
              borderRadius: 4, pointerEvents: 'none',
            }} />
          </>
        )}

        {!hotspot && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <div style={{ background: 'rgba(0,0,0,0.7)', color: '#fff', padding: '8px 16px', borderRadius: 8, fontSize: 12 }}>
              Click anywhere to place hotspot
            </div>
          </div>
        )}
      </div>

      {hotspot && (
        <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 12, color: '#555' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#888' }}>W</span>
            <button onClick={() => adjust('widthPct', -1)} style={adjBtn}>−</button>
            <span style={{ fontWeight: 600, minWidth: 36, textAlign: 'center' }}>{hotspot.widthPct.toFixed(1)}%</span>
            <button onClick={() => adjust('widthPct', 1)} style={adjBtn}>+</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#888' }}>H</span>
            <button onClick={() => adjust('heightPct', -1)} style={adjBtn}>−</button>
            <span style={{ fontWeight: 600, minWidth: 36, textAlign: 'center' }}>{hotspot.heightPct.toFixed(1)}%</span>
            <button onClick={() => adjust('heightPct', 1)} style={adjBtn}>+</button>
          </div>
          <span style={{ color: '#aaa', marginLeft: 'auto' }}>
            pos: ({hotspot.xPct.toFixed(1)}%, {hotspot.yPct.toFixed(1)}%)
          </span>
        </div>
      )}
    </div>
  );
}

const adjBtn: React.CSSProperties = {
  width: 22, height: 22, border: '1px solid #e8eaed', background: '#f5f5f5',
  borderRadius: 4, cursor: 'pointer', fontSize: 14, display: 'flex',
  alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  padding: 0,
};


// ─── Main Review Page ─────────────────────────────────────────────────────────

export default function ReviewPage() {
  const router = useRouter();
  const { id } = router.query as { id: string };

  const [sim, setSim]             = useState<SimulationConfig | null>(null);
  const [steps, setSteps]         = useState<SimulationStep[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);
  const [error, setError]         = useState('');

  useEffect(() => {
    if (!id) return;
    fetch(`${API}/api/simulations/${id}`)
      .then(r => r.json())
      .then((data: SimulationConfig) => {
        setSim(data);
        setSteps(JSON.parse(JSON.stringify(data.steps))); // deep copy
        setLoading(false);
        // Auto-select first step needing review
        const firstFlagged = data.steps.findIndex(s => s.needsReview);
        if (firstFlagged >= 0) setActiveIdx(firstFlagged);
      })
      .catch(() => { setError('Could not load simulation'); setLoading(false); });
  }, [id]);

  const updateStep = (idx: number, patch: Partial<SimulationStep>) => {
    setSteps(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
    setSaved(false);
  };

  const markReviewed = (idx: number) => {
    updateStep(idx, { needsReview: false });
  };

  const deleteStep = (idx: number) => {
    if (!confirm('Delete this step?')) return;
    setSteps(prev => {
      const next = prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, stepNumber: i + 1 }));
      return next;
    });
    setActiveIdx(i => Math.min(i, steps.length - 2));
    setSaved(false);
  };

  const saveAll = async () => {
    if (!id) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/api/simulations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steps }),
      });
      if (!res.ok) throw new Error('Save failed');
      const updated: SimulationConfig = await res.json();

      // Sync to Supabase
      await supabase.from('simulations').update({ steps_json: updated.steps }).eq('id', id);

      setSaved(true);
      setSim(updated);
    } catch {
      setError('Save failed. Check backend is running.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <AdminLayout title="Review Simulation">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: '#888', gap: 10 }}>
        <Loader size={18} style={{ animation: 'spin 1s linear infinite' }} /> Loading…
        <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
      </div>
    </AdminLayout>
  );

  if (error || !sim) return (
    <AdminLayout title="Review Simulation">
      <div style={{ color: '#ef4444', padding: 20 }}>{error || 'Simulation not found'}</div>
    </AdminLayout>
  );

  const step = steps[activeIdx];
  if (!step) return null;

  const reviewCount  = steps.filter(s => s.needsReview).length;
  const imageUrl = step.slideImage
    ? (step.slideImage.startsWith('http') ? step.slideImage : `${API}${step.slideImage}`)
    : null;

  return (
    <AdminLayout title="Review Simulation">
      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={() => router.push('/admin/content')} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: '1px solid #e8eaed', borderRadius: 8, padding: '7px 14px', fontSize: 12, color: '#555', cursor: 'pointer' }}>
          <ChevronLeft size={14} /> Back
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#1a1a2e' }}>{sim.title}</div>
          <div style={{ fontSize: 11, color: reviewCount > 0 ? '#f59e0b' : '#22c55e', marginTop: 1, fontWeight: 600 }}>
            {reviewCount > 0 ? `${reviewCount} step${reviewCount > 1 ? 's' : ''} need review` : 'All steps reviewed ✓'}
          </div>
        </div>
        <button
          onClick={saveAll}
          disabled={saving}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 20px', background: saved ? '#22c55e' : 'linear-gradient(135deg,#F43397,#9747FF)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}
        >
          {saving ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : saved ? <Check size={14} /> : <Save size={14} />}
          {saving ? 'Saving…' : saved ? 'Saved!' : 'Save All'}
        </button>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '10px 16px', marginBottom: 16, fontSize: 12, color: '#ef4444' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 20, alignItems: 'start' }}>

        {/* Step list */}
        <div style={{ background: '#fff', borderRadius: 12, padding: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            {steps.length} Steps
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {steps.map((s, i) => (
              <button
                key={i}
                onClick={() => setActiveIdx(i)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                  borderRadius: 8, border: 'none', cursor: 'pointer', textAlign: 'left',
                  background: activeIdx === i ? 'rgba(151,71,255,0.1)' : 'transparent',
                  outline: activeIdx === i ? '1.5px solid rgba(151,71,255,0.3)' : '1px solid transparent',
                }}
              >
                <div style={{
                  width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                  background: s.needsReview ? 'rgba(245,158,11,0.15)' : 'rgba(34,197,94,0.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {s.needsReview
                    ? <AlertTriangle size={11} color="#f59e0b" />
                    : <CheckCircle size={11} color="#22c55e" />}
                </div>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: activeIdx === i ? '#9747FF' : '#333', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {s.stepNumber}. {s.meta?.target || s.instruction}
                  </div>
                  <div style={{ fontSize: 10, color: '#aaa', marginTop: 1 }}>
                    {s.meta?.annotationType || 'unknown'} · {((s.meta?.confidence ?? 0) * 100).toFixed(0)}%
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Editor */}
        <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          {/* Step header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Step {step.stepNumber} · {step.action} · {step.meta?.annotationType || '—'}
              </div>
              {step.needsReview && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4, padding: '2px 8px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 6, fontSize: 11, color: '#f59e0b', fontWeight: 600 }}>
                  <AlertTriangle size={10} /> Needs review · {((step.meta?.confidence ?? 0) * 100).toFixed(0)}% confidence
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => setActiveIdx(i => Math.max(0, i - 1))}
                disabled={activeIdx === 0}
                style={{ padding: '6px 10px', border: '1px solid #e8eaed', borderRadius: 7, background: '#f9f9f9', cursor: 'pointer', color: '#555', opacity: activeIdx === 0 ? 0.4 : 1 }}
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() => setActiveIdx(i => Math.min(steps.length - 1, i + 1))}
                disabled={activeIdx === steps.length - 1}
                style={{ padding: '6px 10px', border: '1px solid #e8eaed', borderRadius: 7, background: '#f9f9f9', cursor: 'pointer', color: '#555', opacity: activeIdx === steps.length - 1 ? 0.4 : 1 }}
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>

          {/* Hotspot editor */}
          {imageUrl ? (
            <HotspotEditor
              imageUrl={imageUrl}
              hotspot={step.hotspot}
              onChange={h => updateStep(activeIdx, { hotspot: h })}
            />
          ) : (
            <div style={{ aspectRatio: '16/9', background: '#f5f5f5', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: 13, marginBottom: 16 }}>
              No slide image available
            </div>
          )}

          {/* Instruction edit */}
          <div style={{ marginTop: 16 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 }}>
              Instruction
            </label>
            <input
              value={step.instruction}
              onChange={e => updateStep(activeIdx, { instruction: e.target.value })}
              style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #e8eaed', borderRadius: 8, fontSize: 13, boxSizing: 'border-box', outline: 'none' }}
              onFocus={e => (e.currentTarget.style.borderColor = '#9747FF')}
              onBlur={e => (e.currentTarget.style.borderColor = '#e8eaed')}
            />
          </div>

          {/* Hint edit */}
          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 }}>
              Hint (shown on request)
            </label>
            <input
              value={step.hint || ''}
              onChange={e => updateStep(activeIdx, { hint: e.target.value })}
              style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #e8eaed', borderRadius: 8, fontSize: 13, boxSizing: 'border-box', outline: 'none' }}
              onFocus={e => (e.currentTarget.style.borderColor = '#9747FF')}
              onBlur={e => (e.currentTarget.style.borderColor = '#e8eaed')}
            />
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            {step.needsReview ? (
              <button
                onClick={() => markReviewed(activeIdx)}
                style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 9, color: '#16a34a', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
              >
                <CheckCircle size={14} /> Mark as Reviewed
              </button>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', background: 'rgba(34,197,94,0.08)', borderRadius: 9, color: '#22c55e', fontSize: 13, fontWeight: 600 }}>
                <Check size={14} /> Reviewed
              </div>
            )}

            <a
              href={`/sim/${sim.id}?step=${activeIdx}`}
              target="_blank"
              rel="noreferrer"
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', background: '#f5f5f5', border: '1px solid #e8eaed', borderRadius: 9, color: '#555', textDecoration: 'none', fontSize: 13 }}
            >
              <Eye size={14} /> Preview in player
            </a>

            <button
              onClick={() => deleteStep(activeIdx)}
              style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 9, color: '#ef4444', fontSize: 13, cursor: 'pointer' }}
            >
              <Trash2 size={13} /> Delete step
            </button>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
