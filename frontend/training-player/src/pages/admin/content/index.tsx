import { useEffect, useState } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { supabase, Simulation } from '@/lib/supabase';
import { Plus, Loader, CheckCircle, XCircle, BookOpen, Trash2, ExternalLink, AlertTriangle } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

type JobStatus = 'idle' | 'running' | 'complete' | 'error';

interface Job {
  job_id:        string;
  status:        string;
  progress:      number;
  current_phase: string;
  simulation_id: string | null;
  error:         string | null;
}

export default function ContentPage() {
  const [sims,       setSims]       = useState<Simulation[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [slidesUrl,  setSlidesUrl]  = useState('');
  const [targetUrl,  setTargetUrl]  = useState('');
  const [processName,setProcessName]= useState('');
  const [hub,        setHub]        = useState('');
  const [jobStatus,  setJobStatus]  = useState<JobStatus>('idle');
  const [job,        setJob]        = useState<Job | null>(null);
  const [formOpen,   setFormOpen]   = useState(false);

  const loadSims = async () => {
    const { data } = await supabase.from('simulations').select('*').order('created_at', { ascending: false });
    if (data) setSims(data);
    setLoading(false);
  };

  useEffect(() => { loadSims(); }, []);

  // Poll job status
  useEffect(() => {
    if (!job?.job_id || jobStatus !== 'running') return;
    const interval = setInterval(async () => {
      try {
        const res  = await fetch(`${API}/api/jobs/${job.job_id}`);
        const data: Job = await res.json();
        setJob(data);
        if (data.status === 'complete') {
          setJobStatus('complete');
          clearInterval(interval);
          // Save to Supabase
          if (data.simulation_id) {
            const simRes = await fetch(`${API}/api/simulations/${data.simulation_id}`);
            const simData = await simRes.json();
            await supabase.from('simulations').upsert({
              id:           simData.id,
              title:        simData.title,
              process_name: processName || null,
              hub:          hub || null,
              step_count:   simData.stepCount,
              steps_json:   simData.steps,
              created_by:   'admin',
              created_at:   new Date().toISOString()
            });
            loadSims();
          }
        } else if (data.status === 'error') {
          setJobStatus('error');
          clearInterval(interval);
        }
      } catch (e) { /* network error — keep polling */ }
    }, 2000);
    return () => clearInterval(interval);
  }, [job, jobStatus, processName, hub]);

  const generate = async () => {
    if (!slidesUrl.trim()) return;
    setJobStatus('running');
    setFormOpen(false);
    try {
      const res  = await fetch(`${API}/api/generate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ slides_url: slidesUrl, target_url: targetUrl || undefined })
      });
      const data: Job = await res.json();
      setJob(data);
    } catch {
      setJobStatus('error');
      setJob({ job_id: '', status: 'error', progress: 0, current_phase: '', simulation_id: null, error: 'Could not reach the simulation backend. Is it running?' });
    }
  };

  const deleteSim = async (id: string) => {
    if (!confirm('Delete this simulation?')) return;
    await supabase.from('simulations').delete().eq('id', id);
    setSims(prev => prev.filter(s => s.id !== id));
  };

  return (
    <AdminLayout title="Content">
      {/* Generation status banner */}
      {jobStatus === 'running' && job && (
        <div style={{ background: 'rgba(151,71,255,0.08)', border: '1px solid rgba(151,71,255,0.2)', borderRadius: 12, padding: '16px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 14 }}>
          <Loader size={18} color="#9747FF" style={{ animation: 'spin 1s linear infinite' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, color: '#1a1a2e', fontSize: 13 }}>Generating simulation…</div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{job.current_phase} · {job.progress}%</div>
          </div>
          <div style={{ height: 6, width: 140, background: '#e8eaed', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${job.progress}%`, background: 'linear-gradient(90deg,#F43397,#9747FF)', borderRadius: 3, transition: 'width 0.3s' }} />
          </div>
        </div>
      )}
      {jobStatus === 'complete' && (
        <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 12, padding: '14px 20px', marginBottom: 20, display: 'flex', gap: 10, alignItems: 'center' }}>
          <CheckCircle size={18} color="#22c55e" />
          <span style={{ fontSize: 13, color: '#1a1a2e', fontWeight: 600 }}>Simulation generated and saved!</span>
          <button onClick={() => { setJobStatus('idle'); setJob(null); setSlidesUrl(''); setTargetUrl(''); setProcessName(''); setHub(''); }} style={{ marginLeft: 'auto', fontSize: 12, color: '#888', background: 'none', border: 'none', cursor: 'pointer' }}>Dismiss</button>
        </div>
      )}
      {jobStatus === 'error' && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 12, padding: '14px 20px', marginBottom: 20, display: 'flex', gap: 10, alignItems: 'center' }}>
          <XCircle size={18} color="#ef4444" />
          <span style={{ fontSize: 13, color: '#1a1a2e' }}>{job?.error || 'Generation failed.'}</span>
          <button onClick={() => { setJobStatus('idle'); setJob(null); }} style={{ marginLeft: 'auto', fontSize: 12, color: '#888', background: 'none', border: 'none', cursor: 'pointer' }}>Dismiss</button>
        </div>
      )}

      {/* Header + create button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: '#888' }}>{sims.length} simulation{sims.length !== 1 ? 's' : ''}</div>
        <button onClick={() => setFormOpen(!formOpen)} disabled={jobStatus === 'running'} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', background: 'linear-gradient(135deg,#F43397,#9747FF)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: jobStatus === 'running' ? 0.6 : 1 }}>
          <Plus size={16} /> New Simulation
        </button>
      </div>

      {/* Create form */}
      {formOpen && (
        <div style={{ background: '#fff', borderRadius: 14, padding: 24, boxShadow: '0 4px 20px rgba(0,0,0,0.1)', marginBottom: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e', marginBottom: 20 }}>Generate Simulation from Google Slides</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div style={{ gridColumn: '1/-1' }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 }}>Google Slides URL *</label>
              <input value={slidesUrl} onChange={e => setSlidesUrl(e.target.value)} placeholder="https://docs.google.com/presentation/d/..." style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #e8eaed', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 }}>Target App URL (optional)</label>
              <input value={targetUrl} onChange={e => setTargetUrl(e.target.value)} placeholder="https://console.valmo.in/..." style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #e8eaed', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 }}>Process Name</label>
              <input value={processName} onChange={e => setProcessName(e.target.value)} placeholder="e.g. ATO Bagging" style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #e8eaed', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 }}>Hub (optional)</label>
              <select value={hub} onChange={e => setHub(e.target.value)} style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #e8eaed', borderRadius: 8, fontSize: 13, background: '#fff', boxSizing: 'border-box' as const }}>
                <option value="">All hubs</option>
                {['Mumbai','Delhi','Bengaluru','Hyderabad','Chennai','Kolkata','Pune','Ahmedabad','Jaipur','Lucknow'].map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button onClick={generate} disabled={!slidesUrl.trim()} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#F43397,#9747FF)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: !slidesUrl.trim() ? 0.5 : 1 }}>
              Generate
            </button>
            <button onClick={() => setFormOpen(false)} style={{ padding: '10px 18px', background: '#f5f5f5', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', color: '#555' }}>Cancel</button>
          </div>
          <div style={{ fontSize: 11, color: '#aaa', marginTop: 12 }}>
            Make sure the slides-to-sim backend is running at <code style={{ background: '#f5f5f5', padding: '1px 4px', borderRadius: 3 }}>{API}</code>
          </div>
        </div>
      )}

      {/* Simulation library */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#bbb' }}>Loading simulations...</div>
      ) : sims.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#bbb' }}>
          <BookOpen size={40} style={{ marginBottom: 16, opacity: 0.3 }} />
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>No simulations yet</div>
          <div style={{ fontSize: 13 }}>Create your first simulation from a Google Slides deck above.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {sims.map(s => (
            <div key={s.id} style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, color: '#1a1a2e', fontSize: 14, marginBottom: 4 }}>{s.title}</div>
                  {s.process_name && <div style={{ fontSize: 12, color: '#F43397', fontWeight: 600 }}>{s.process_name}</div>}
                </div>
                <button onClick={() => deleteSim(s.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ddd', padding: 4 }}>
                  <Trash2 size={14} />
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {s.hub && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#f0f0f0', color: '#555' }}>📍 {s.hub}</span>}
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#f0f0f0', color: '#555' }}>{s.step_count} steps</span>
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: 'rgba(151,71,255,0.1)', color: '#9747FF' }}>
                  {new Date(s.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 'auto', alignItems: 'center' }}>
                <a href={`/sim/${s.id}`} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#9747FF', textDecoration: 'none', fontSize: 12, fontWeight: 600 }}>
                  <ExternalLink size={13} /> Preview
                </a>
                {Array.isArray(s.steps_json) && (s.steps_json as any[]).some((step: any) => step.needsReview) && (
                  <a href={`/admin/simulations/${s.id}/review`} style={{ display: 'flex', alignItems: 'center', gap: 5, marginLeft: 'auto', padding: '4px 10px', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 6, color: '#f59e0b', textDecoration: 'none', fontSize: 11, fontWeight: 700 }}>
                    <AlertTriangle size={11} /> Review steps
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </AdminLayout>
  );
}
