import { useEffect, useState } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { supabase } from '@/lib/supabase';
import { Plus, Trash2, ChevronDown, ChevronUp, CheckCircle, Loader, Edit2, X } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Assessment {
  id: string;
  title: string;
  process_name: string | null;
  passing_score: number;
  created_at: string;
  question_count?: number;
  pass_rate?: number;
}

interface Option { key: string; text: string; }

interface Question {
  id: string;           // temp id for builder
  question: string;
  options: Option[];
  correct_key: string;
  explanation: string;
}

const KEYS = ['A', 'B', 'C', 'D'];

function blankQuestion(): Question {
  return {
    id: Math.random().toString(36).slice(2),
    question: '',
    options: KEYS.map(k => ({ key: k, text: '' })),
    correct_key: 'A',
    explanation: '',
  };
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AssessmentsPage() {
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [processes,   setProcesses]   = useState<string[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [panelOpen,   setPanelOpen]   = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [saved,       setSaved]       = useState(false);
  const [expandedId,  setExpandedId]  = useState<string | null>(null);
  const [expandedQs,  setExpandedQs]  = useState<any[]>([]);

  // Form state
  const [title,        setTitle]        = useState('');
  const [processName,  setProcessName]  = useState('');
  const [passingScore, setPassingScore] = useState(70);
  const [questions,    setQuestions]    = useState<Question[]>([blankQuestion()]);

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = async () => {
    setLoading(true);
    const [{ data: aRows }, { data: sims }] = await Promise.all([
      supabase.from('assessments').select('*').order('created_at', { ascending: false }),
      supabase.from('simulations').select('process_name').not('process_name', 'is', null),
    ]);

    if (aRows) {
      // Fetch question counts + pass rates in parallel
      const enriched = await Promise.all(aRows.map(async a => {
        const [{ count }, { data: results }] = await Promise.all([
          supabase.from('assessment_questions').select('*', { count: 'exact', head: true }).eq('assessment_id', a.id),
          supabase.from('assessment_results').select('passed').eq('assessment_id', a.id),
        ]);
        const passRate = results?.length
          ? Math.round((results.filter(r => r.passed).length / results.length) * 100)
          : null;
        return { ...a, question_count: count ?? 0, pass_rate: passRate };
      }));
      setAssessments(enriched);
    }

    if (sims) {
      const names = [...new Set(sims.map(s => s.process_name).filter(Boolean))];
      setProcesses(names as string[]);
    }

    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // ── Question builder helpers ──────────────────────────────────────────────

  const updateQuestion = (idx: number, field: keyof Question, value: any) => {
    setQuestions(qs => qs.map((q, i) => i === idx ? { ...q, [field]: value } : q));
  };

  const updateOption = (qIdx: number, optKey: string, text: string) => {
    setQuestions(qs => qs.map((q, i) => {
      if (i !== qIdx) return q;
      return { ...q, options: q.options.map(o => o.key === optKey ? { ...o, text } : o) };
    }));
  };

  const addQuestion = () => setQuestions(qs => [...qs, blankQuestion()]);

  const removeQuestion = (idx: number) =>
    setQuestions(qs => qs.filter((_, i) => i !== idx));

  // ── Save ──────────────────────────────────────────────────────────────────

  const saveAssessment = async () => {
    if (!title.trim()) return alert('Add a title');
    if (questions.some(q => !q.question.trim() || q.options.some(o => !o.text.trim()))) {
      return alert('Fill in all questions and options');
    }

    setSaving(true);
    const { data: a, error } = await supabase.from('assessments').insert({
      title:         title.trim(),
      process_name:  processName || null,
      passing_score: passingScore,
      created_by:    'admin',
    }).select().single();

    if (error || !a) { setSaving(false); return alert('Save failed: ' + error?.message); }

    const qRows = questions.map((q, i) => ({
      assessment_id: a.id,
      question:      q.question.trim(),
      options:       q.options,
      correct_key:   q.correct_key,
      explanation:   q.explanation.trim() || null,
      order_index:   i,
    }));

    const { error: qErr } = await supabase.from('assessment_questions').insert(qRows);
    if (qErr) { setSaving(false); return alert('Questions save failed: ' + qErr.message); }

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    setPanelOpen(false);
    setTitle(''); setProcessName(''); setPassingScore(70);
    setQuestions([blankQuestion()]);
    load();
  };

  // ── Delete ────────────────────────────────────────────────────────────────

  const deleteAssessment = async (id: string) => {
    if (!confirm('Delete this assessment? Captain results will also be deleted.')) return;
    await supabase.from('assessments').delete().eq('id', id);
    setAssessments(a => a.filter(x => x.id !== id));
  };

  // ── Expand to show questions ───────────────────────────────────────────────

  const toggleExpand = async (id: string) => {
    if (expandedId === id) { setExpandedId(null); return; }
    const { data } = await supabase.from('assessment_questions')
      .select('*').eq('assessment_id', id).order('order_index');
    setExpandedQs(data || []);
    setExpandedId(id);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const card: React.CSSProperties = {
    background: '#fff', borderRadius: 12, border: '1px solid #e8eaed',
    padding: '16px 20px', marginBottom: 10,
  };

  return (
    <AdminLayout title="Assessments">
      {/* Top bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 13, color: '#666' }}>
            {assessments.length} assessment{assessments.length !== 1 ? 's' : ''} created
          </div>
        </div>
        <button
          onClick={() => setPanelOpen(p => !p)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 8, background: 'linear-gradient(135deg,#F43397,#9747FF)', color: '#fff', border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
          <Plus size={15} /> New Assessment
        </button>
      </div>

      {/* Builder panel */}
      {panelOpen && (
        <div style={{ ...card, border: '2px solid #9747FF', marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: '#1a1a2e' }}>Create Assessment</span>
            <button onClick={() => setPanelOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999' }}><X size={16} /></button>
          </div>

          {/* Meta */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 12, marginBottom: 20 }}>
            <div>
              <label style={labelStyle}>Title *</label>
              <input value={title} onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Return Process Check" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Linked Process</label>
              <select value={processName} onChange={e => setProcessName(e.target.value)} style={inputStyle}>
                <option value="">— Any process —</option>
                {processes.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Pass score %</label>
              <input type="number" min={1} max={100} value={passingScore}
                onChange={e => setPassingScore(+e.target.value)} style={{ ...inputStyle, width: 80 }} />
            </div>
          </div>

          {/* Questions */}
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a2e', marginBottom: 12 }}>
            Questions ({questions.length})
          </div>

          {questions.map((q, qi) => (
            <div key={q.id} style={{ background: '#f8f9fb', borderRadius: 10, padding: 16, marginBottom: 12, border: '1px solid #e8eaed' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Q{qi + 1} — Question *</label>
                  <input value={q.question} onChange={e => updateQuestion(qi, 'question', e.target.value)}
                    placeholder="Type the question…" style={{ ...inputStyle, width: '100%' }} />
                </div>
                {questions.length > 1 && (
                  <button onClick={() => removeQuestion(qi)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', marginTop: 20, flexShrink: 0 }}>
                    <Trash2 size={15} />
                  </button>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
                {q.options.map(opt => (
                  <div key={opt.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="radio" name={`correct_${q.id}`} checked={q.correct_key === opt.key}
                      onChange={() => updateQuestion(qi, 'correct_key', opt.key)}
                      title="Mark as correct answer" style={{ accentColor: '#22c55e', flexShrink: 0 }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#9747FF', width: 16 }}>{opt.key}</span>
                    <input value={opt.text} onChange={e => updateOption(qi, opt.key, e.target.value)}
                      placeholder={`Option ${opt.key}`}
                      style={{ ...inputStyle, flex: 1, fontSize: 12, padding: '6px 10px' }} />
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 8 }}>
                <label style={labelStyle}>Explanation (shown after attempt)</label>
                <input value={q.explanation} onChange={e => updateQuestion(qi, 'explanation', e.target.value)}
                  placeholder="Optional — why is the correct answer right?" style={{ ...inputStyle, width: '100%', fontSize: 12 }} />
              </div>

              <div style={{ fontSize: 11, color: '#22c55e', marginTop: 6 }}>
                ✓ Correct: {q.correct_key} — {q.options.find(o => o.key === q.correct_key)?.text || '(select above)'}
              </div>
            </div>
          ))}

          <button onClick={addQuestion}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, background: '#f0f0f5', border: '1.5px dashed #9747FF', color: '#9747FF', fontWeight: 600, fontSize: 12, cursor: 'pointer', width: '100%', justifyContent: 'center', marginBottom: 16 }}>
            <Plus size={13} /> Add Question
          </button>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button onClick={() => setPanelOpen(false)}
              style={{ padding: '9px 18px', borderRadius: 8, background: '#f0f0f5', border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={saveAssessment} disabled={saving}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 20px', borderRadius: 8, background: 'linear-gradient(135deg,#F43397,#9747FF)', color: '#fff', border: 'none', fontWeight: 600, fontSize: 13, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? <Loader size={13} style={{ animation: 'spin 0.8s linear infinite' }} /> : saved ? <CheckCircle size={13} /> : null}
              {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Assessment'}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#999' }}>
          <Loader size={24} style={{ animation: 'spin 0.8s linear infinite' }} />
        </div>
      ) : assessments.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: 60, color: '#999' }}>
          No assessments yet. Click <strong>New Assessment</strong> to create one.
        </div>
      ) : (
        assessments.map(a => (
          <div key={a.id} style={card}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#1a1a2e' }}>{a.title}</div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 3, display: 'flex', gap: 14 }}>
                  {a.process_name && <span>📋 {a.process_name}</span>}
                  <span>❓ {a.question_count} questions</span>
                  <span>🎯 Pass: {a.passing_score}%</span>
                  {a.pass_rate !== null && <span style={{ color: a.pass_rate! >= 70 ? '#22c55e' : '#ef4444' }}>📊 Pass rate: {a.pass_rate}%</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                <button onClick={() => toggleExpand(a.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 6, background: '#f0f0f5', border: 'none', fontSize: 12, cursor: 'pointer', color: '#555', fontWeight: 600 }}>
                  {expandedId === a.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  {expandedId === a.id ? 'Hide' : 'Preview'}
                </button>
                <button onClick={() => deleteAssessment(a.id)}
                  style={{ padding: '6px 10px', borderRadius: 6, background: 'rgba(239,68,68,0.08)', border: 'none', cursor: 'pointer', color: '#ef4444' }}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>

            {/* Question preview */}
            {expandedId === a.id && (
              <div style={{ marginTop: 14, borderTop: '1px solid #f0f0f5', paddingTop: 14 }}>
                {expandedQs.map((q, i) => (
                  <div key={q.id} style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a2e', marginBottom: 6 }}>
                      Q{i + 1}. {q.question}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {(q.options as Option[]).map(opt => (
                        <div key={opt.key} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: opt.key === q.correct_key ? '#22c55e' : '#555', fontWeight: opt.key === q.correct_key ? 600 : 400 }}>
                          <span style={{ width: 16, flexShrink: 0 }}>{opt.key === q.correct_key ? '✓' : '·'}</span>
                          <span style={{ fontWeight: 700, marginRight: 2 }}>{opt.key}.</span>
                          {opt.text}
                        </div>
                      ))}
                    </div>
                    {q.explanation && (
                      <div style={{ fontSize: 11, color: '#888', fontStyle: 'italic', marginTop: 4, marginLeft: 24 }}>
                        💡 {q.explanation}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </AdminLayout>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 600, color: '#666',
  marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em',
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 8,
  border: '1.5px solid #e8eaed', fontSize: 13, fontFamily: 'inherit',
  outline: 'none', background: '#fff', boxSizing: 'border-box',
};
