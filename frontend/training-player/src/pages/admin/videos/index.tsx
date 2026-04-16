import { useEffect, useState, useCallback } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { supabase, ProcessVideo } from '@/lib/supabase';
import { Plus, Trash2, ExternalLink, Video, Loader, ChevronDown, ChevronRight, FileVideo } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const HUBS = ['Mumbai','Delhi','Bengaluru','Hyderabad','Chennai','Kolkata','Pune','Ahmedabad','Jaipur','Lucknow'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function embedUrl(raw: string): string | null {
  // YouTube
  const yt = raw.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([a-zA-Z0-9_-]{11})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  // Google Drive
  const gd = raw.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (gd && raw.includes('drive.google.com')) return `https://drive.google.com/file/d/${gd[1]}/preview`;
  return null;
}

// ─── VideoCard ────────────────────────────────────────────────────────────────

function VideoCard({ video, onDelete }: { video: ProcessVideo; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const embed = embedUrl(video.video_url);

  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 18, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Title row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: '#1a1a2e', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {video.title || video.process_name}
          </div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 2, display: 'flex', gap: 8 }}>
            {video.hub && <span>📍 {video.hub}</span>}
            {video.starting_tab && <span>🔗 starts at /{video.starting_tab}</span>}
            <span>{new Date(video.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          </div>
        </div>
        <button onClick={onDelete} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e5e7eb', padding: 4, flexShrink: 0 }}>
          <Trash2 size={14} />
        </button>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <a href={video.video_url} target="_blank" rel="noreferrer"
          style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#9747FF', fontWeight: 600, textDecoration: 'none' }}>
          <ExternalLink size={11} /> Open
        </a>
        {embed && (
          <button onClick={() => setExpanded(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#555', background: '#f5f5f5', border: 'none', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontWeight: 600 }}>
            {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            {expanded ? 'Hide' : 'Preview'}
          </button>
        )}
      </div>

      {/* Embedded player */}
      {expanded && embed && (
        <div style={{ borderRadius: 8, overflow: 'hidden', background: '#000', aspectRatio: '16/9' }}>
          <iframe src={embed} width="100%" height="100%" frameBorder={0} allowFullScreen
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            style={{ display: 'block' }} />
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function VideosPage() {
  const [videos,   setVideos]   = useState<ProcessVideo[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [formOpen, setFormOpen] = useState(false);

  // Form state
  const [processName, setProcessName] = useState('');
  const [hub,         setHub]         = useState('');
  const [videoUrl,    setVideoUrl]    = useState('');
  const [slidesLink,  setSlidesLink]  = useState('');
  const [startingTab, setStartingTab] = useState('');
  const [busy,        setBusy]        = useState(false);
  const [error,       setError]       = useState('');
  const [extracting,  setExtracting]  = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('process_videos').select('*').order('created_at', { ascending: false });
    setVideos((data as ProcessVideo[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Extract process name + starting tab from Slides link ─────────────────
  const extractFromSlides = async (url: string) => {
    if (!url.trim()) return;
    setExtracting(true); setError('');
    try {
      const fd = new FormData();
      fd.append('process_name', 'extract');
      fd.append('drive_url', url.trim());
      const res = await fetch(`${API}/api/import-ppt`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error('Extraction failed — make sure the deck is shared as "Anyone with link"');
      const data = await res.json();
      const proc = data.processes?.[0];
      if (proc) {
        setProcessName(proc.process_name || '');
        const firstTab = proc.steps?.[0]?.urlPattern;
        if (firstTab) setStartingTab(firstTab);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setExtracting(false);
    }
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const save = async () => {
    if (!processName.trim()) { setError('Process name required'); return; }
    if (!videoUrl.trim())    { setError('Video URL required'); return; }
    setBusy(true); setError('');
    try {
      const { error: sbErr } = await supabase.from('process_videos').insert({
        process_name: processName.trim(),
        hub:          hub || null,
        video_url:    videoUrl.trim(),
        title:        processName.trim(),
        starting_tab: startingTab.trim() || null,
      });
      if (sbErr) throw new Error(sbErr.message);
      setFormOpen(false);
      setProcessName(''); setHub(''); setVideoUrl(''); setSlidesLink(''); setStartingTab('');
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteVideo = async (v: ProcessVideo) => {
    if (!confirm('Delete this video?')) return;
    await supabase.from('process_videos').delete().eq('id', v.id);
    setVideos(vs => vs.filter(x => x.id !== v.id));
  };

  // Group by process_name for display
  const grouped = videos.reduce<Record<string, ProcessVideo[]>>((acc, v) => {
    (acc[v.process_name] = acc[v.process_name] || []).push(v);
    return acc;
  }, {});

  return (
    <AdminLayout title="Videos">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: '#888' }}>{videos.length} video{videos.length !== 1 ? 's' : ''}</div>
        <button onClick={() => setFormOpen(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 16px',
            background: 'linear-gradient(135deg,#F43397,#9747FF)', color: '#fff',
            border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          <Plus size={14} /> Add Video
        </button>
      </div>

      {/* Add Video form */}
      {formOpen && (
        <div style={{ background: '#fff', borderRadius: 14, padding: 24, boxShadow: '0 4px 20px rgba(0,0,0,0.1)', marginBottom: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e', marginBottom: 20 }}>Add Video</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

            {/* Slides link — auto-fills name + starting tab */}
            <div style={{ gridColumn: '1/-1' }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 }}>
                Google Slides Link — auto-fills process name + starting tab
                {extracting && <span style={{ marginLeft: 8, color: '#9747FF', fontWeight: 400, textTransform: 'none' }}>
                  <Loader size={10} style={{ display: 'inline', animation: 'spin 1s linear infinite', marginRight: 4 }} />extracting…
                </span>}
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={slidesLink} onChange={e => setSlidesLink(e.target.value)}
                  placeholder="https://docs.google.com/presentation/d/..."
                  style={{ flex: 1, padding: '10px 14px', border: '1.5px solid #e8eaed', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' as const }} />
                <button type="button" onClick={() => extractFromSlides(slidesLink)} disabled={!slidesLink.trim() || extracting}
                  style={{ padding: '10px 16px', background: '#9747FF', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', opacity: (!slidesLink.trim() || extracting) ? 0.5 : 1 }}>
                  {extracting ? 'Extracting…' : 'Extract'}
                </button>
              </div>
            </div>

            {/* Process name — auto-filled or manual */}
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 }}>Process Name *</label>
              <input value={processName} onChange={e => setProcessName(e.target.value)}
                placeholder="e.g. RTO Bagging"
                style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #e8eaed', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' as const }} />
            </div>

            {/* Hub */}
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 }}>Hub (optional)</label>
              <select value={hub} onChange={e => setHub(e.target.value)}
                style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #e8eaed', borderRadius: 8, fontSize: 13, background: '#fff', boxSizing: 'border-box' as const }}>
                <option value="">All hubs</option>
                {HUBS.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>

            {/* Video URL */}
            <div style={{ gridColumn: '1/-1' }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 }}>Video URL *</label>
              <input value={videoUrl} onChange={e => setVideoUrl(e.target.value)}
                placeholder="YouTube, Google Drive, or direct MP4 URL"
                style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #e8eaed', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' as const }} />
            </div>

            {/* Starting tab — auto-filled, editable */}
            <div style={{ gridColumn: '1/-1' }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 }}>
                Starting Tab (url fragment)
                <span style={{ fontWeight: 400, textTransform: 'none', marginLeft: 6 }}>— auto-filled from PPT, edit if needed</span>
              </label>
              <input value={startingTab} onChange={e => setStartingTab(e.target.value)}
                placeholder="e.g. rto"
                style={{ width: '100%', padding: '10px 14px', border: `1.5px solid ${startingTab ? '#22c55e' : '#e8eaed'}`, borderRadius: 8, fontSize: 13, boxSizing: 'border-box' as const }} />
            </div>

          </div>

          {error && <div style={{ marginTop: 12, fontSize: 12, color: '#ef4444' }}>{error}</div>}

          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button onClick={save} disabled={busy || extracting}
              style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#F43397,#9747FF)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: (busy || extracting) ? 0.6 : 1 }}>
              {busy ? 'Saving…' : 'Save Video'}
            </button>
            <button onClick={() => { setFormOpen(false); setError(''); }}
              style={{ padding: '10px 18px', background: '#f5f5f5', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', color: '#555' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Video list */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#bbb' }}>
          <Loader size={24} style={{ animation: 'spin 1s linear infinite', marginBottom: 12 }} />
        </div>
      ) : videos.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#bbb' }}>
          <Video size={40} style={{ marginBottom: 16, opacity: 0.3 }} />
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>No videos yet</div>
          <div style={{ fontSize: 13 }}>Add a video and link it to a process.</div>
        </div>
      ) : (
        Object.entries(grouped).map(([pname, pvids]) => (
          <div key={pname} style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#9747FF', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
              {pname} · {pvids.length} video{pvids.length !== 1 ? 's' : ''}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
              {pvids.map(v => (
                <VideoCard key={v.id} video={v} onDelete={() => deleteVideo(v)} />
              ))}
            </div>
          </div>
        ))
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </AdminLayout>
  );
}
