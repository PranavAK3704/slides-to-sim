import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { supabase, AgentProfile, CaptainSession, GamificationEvent } from '@/lib/supabase';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid
} from 'recharts';
import { ArrowLeft, Clock, Pause, MessageSquare, Award, TrendingUp } from 'lucide-react';
import Link from 'next/link';

function fmtPCT(s: number) { const m = Math.floor(s / 60); return `${m}m ${s % 60}s`; }
function fmtDate(ts: string) { return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); }

const XP_LEVELS = [0,100,250,450,700,1000,1400,1900,2500,3200,4000,5000,6200,7600,9200,11000,13000,15500,18500,22000];

export default function AgentDetailPage() {
  const router = useRouter();
  const email  = decodeURIComponent(router.query.email as string || '');

  const [profile,    setProfile]   = useState<AgentProfile | null>(null);
  const [sessions,   setSessions]  = useState<CaptainSession[]>([]);
  const [events,     setEvents]    = useState<GamificationEvent[]>([]);
  const [loading,    setLoading]   = useState(true);

  useEffect(() => {
    if (!email) return;
    Promise.all([
      supabase.from('agent_profiles').select('*').eq('email', email).single(),
      supabase.from('captain_sessions').select('*').eq('email', email).order('completed_at', { ascending: false }).limit(50),
      supabase.from('gamification_events').select('*').eq('email', email).order('created_at', { ascending: false }).limit(30),
    ]).then(([p, s, e]) => {
      if (p.data)  setProfile(p.data);
      if (s.data)  setSessions(s.data);
      if (e.data)  setEvents(e.data);
      setLoading(false);
    });
  }, [email]);

  if (loading || !profile) {
    return <AdminLayout title="Agent Profile"><div style={{ padding: 40, color: '#888', textAlign: 'center' }}>Loading...</div></AdminLayout>;
  }

  const level = profile.level || 1;
  const xp    = profile.total_xp || 0;
  const nextXP = XP_LEVELS[Math.min(level, 19)];
  const prevXP = XP_LEVELS[Math.max(level - 1, 0)];
  const progress = nextXP > prevXP ? ((xp - prevXP) / (nextXP - prevXP)) * 100 : 100;

  // PCT trend from sessions
  const pctTrend = sessions.slice(0, 14).reverse().map(s => ({
    date: fmtDate(s.completed_at),
    pct:  Math.round((s.pct || 0) / 60 * 10) / 10,
    pauses: s.pause_count || 0,
  }));

  // Process breakdown
  const byProcess: Record<string, { sessions: number; totalPCT: number; totalPauses: number; totalQueries: number }> = {};
  sessions.forEach(s => {
    if (!s.process_name) return;
    if (!byProcess[s.process_name]) byProcess[s.process_name] = { sessions: 0, totalPCT: 0, totalPauses: 0, totalQueries: 0 };
    byProcess[s.process_name].sessions++;
    byProcess[s.process_name].totalPCT     += s.pct          || 0;
    byProcess[s.process_name].totalPauses  += s.pause_count  || 0;
    byProcess[s.process_name].totalQueries += s.query_count  || 0;
  });

  // QFD + iPER derived from sessions
  const avgErrors = sessions.length > 0 ? sessions.reduce((s, x) => s + (x.error_count || 0), 0) / sessions.length : 0;
  const qfdScore  = sessions.length > 0 ? Math.max(0, Math.round((1 - avgErrors * 0.1) * 100)) : null;
  const iperScore = sessions.length > 0 ? avgErrors.toFixed(1) : null;

  return (
    <AdminLayout title="Agent Profile">
      <Link href="/admin/agents" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#9747FF', textDecoration: 'none', fontSize: 13, marginBottom: 20 }}>
        <ArrowLeft size={14} /> Back to Agents
      </Link>

      {/* Profile header */}
      <div style={{ background: 'linear-gradient(135deg,#F43397,#9747FF)', borderRadius: 16, padding: 28, color: '#fff', marginBottom: 24, display: 'flex', gap: 24, alignItems: 'center' }}>
        <div style={{ width: 72, height: 72, borderRadius: 18, background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 800 }}>
          {email[0].toUpperCase()}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{email.split('@')[0]}</div>
          <div style={{ fontSize: 13, opacity: 0.8, marginTop: 2 }}>{email}</div>
          <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 13 }}>
            <span>📍 {profile.hub || 'No hub set'}</span>
            <span>🎭 {profile.role}</span>
            <span>🔥 {profile.streak_current || 0}-day streak</span>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 48, fontWeight: 800, lineHeight: 1 }}>L{level}</div>
          <div style={{ fontSize: 13, opacity: 0.8 }}>{xp.toLocaleString()} XP</div>
          {/* Progress to next level */}
          <div style={{ marginTop: 8, width: 160 }}>
            <div style={{ height: 6, background: 'rgba(255,255,255,0.3)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.min(100, progress)}%`, background: '#fff', borderRadius: 3 }} />
            </div>
            <div style={{ fontSize: 10, opacity: 0.7, marginTop: 4 }}>
              {nextXP > xp ? `${(nextXP - xp).toLocaleString()} XP to Level ${level + 1}` : 'Max Level'}
            </div>
          </div>
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14, marginBottom: 24 }}>
        {[
          { icon: Clock,        label: 'Sessions',      value: sessions.length },
          { icon: Pause,        label: 'Avg Pauses',    value: sessions.length ? (sessions.reduce((s, x) => s + (x.pause_count || 0), 0) / sessions.length).toFixed(1) : '—' },
          { icon: MessageSquare,label: 'Avg Queries',   value: sessions.length ? (sessions.reduce((s, x) => s + (x.query_count || 0), 0) / sessions.length).toFixed(1) : '—' },
          { icon: TrendingUp,   label: 'Assessments',   value: profile.assessments_passed || 0 },
          { icon: Award,        label: 'Avg Score',     value: profile.avg_score ? `${profile.avg_score}%` : '—' },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} style={{ background: '#fff', borderRadius: 12, padding: '16px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <Icon size={16} color="#9747FF" style={{ marginBottom: 8 }} />
            <div style={{ fontSize: 22, fontWeight: 800, color: '#1a1a2e' }}>{value}</div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        {/* PCT trend */}
        <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a2e', marginBottom: 16 }}>PCT Over Time</div>
          {pctTrend.length > 1 ? (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={pctTrend}>
                <defs>
                  <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#F43397" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#F43397" stopOpacity={0}   />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} unit="m" />
                <Tooltip formatter={(v) => [`${v}m`, 'PCT']} />
                <Area type="monotone" dataKey="pct" stroke="#F43397" fill="url(#g)" strokeWidth={2} dot={{ r: 3 }} />
              </AreaChart>
            </ResponsiveContainer>
          ) : <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: 13 }}>Not enough data</div>}
        </div>

        {/* QFD & iPER */}
        <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a2e', marginBottom: 16 }}>Quality Metrics</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={{ background: 'rgba(34,197,94,0.06)', border: '1.5px solid rgba(34,197,94,0.2)', borderRadius: 10, padding: 16, textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: '#aaa', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>QFD Score</div>
              <div style={{ fontSize: 32, fontWeight: 800, color: '#22c55e' }}>{qfdScore !== null ? `${qfdScore}%` : '—'}</div>
              <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>Quality First Delivery</div>
            </div>
            <div style={{ background: 'rgba(245,158,11,0.06)', border: '1.5px solid rgba(245,158,11,0.2)', borderRadius: 10, padding: 16, textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: '#aaa', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>iPER</div>
              <div style={{ fontSize: 32, fontWeight: 800, color: '#f59e0b' }}>{iperScore !== null ? iperScore : '—'}</div>
              <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>Avg Errors / Session</div>
            </div>
          </div>
        </div>
      </div>

      {/* Process breakdown */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a2e', marginBottom: 16 }}>Process Breakdown</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
              {['Process', 'Sessions', 'Avg PCT', 'Avg Pauses', 'Avg Queries'].map(h => (
                <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600, color: '#666', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(byProcess).map(([proc, d], i) => (
              <tr key={proc} style={{ borderBottom: '1px solid #f5f5f5', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                <td style={{ padding: '10px 14px', fontWeight: 600, color: '#F43397' }}>{proc}</td>
                <td style={{ padding: '10px 14px', color: '#555' }}>{d.sessions}</td>
                <td style={{ padding: '10px 14px', color: '#555' }}>{fmtPCT(Math.round(d.totalPCT / d.sessions))}</td>
                <td style={{ padding: '10px 14px', color: '#555' }}>{(d.totalPauses / d.sessions).toFixed(1)}</td>
                <td style={{ padding: '10px 14px', color: '#555' }}>{(d.totalQueries / d.sessions).toFixed(1)}</td>
              </tr>
            ))}
            {Object.keys(byProcess).length === 0 && (
              <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: '#bbb' }}>No session data yet</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* XP history */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a2e', marginBottom: 16 }}>Recent XP History</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {events.slice(0, 15).map(e => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid #f5f5f5' }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: e.event_type === 'achievement_unlocked' ? 'rgba(245,158,11,0.12)' : e.event_type === 'level_up' ? 'rgba(151,71,255,0.12)' : 'rgba(244,51,151,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>
                {e.event_type === 'achievement_unlocked' ? '🏅' : e.event_type === 'level_up' ? '⬆️' : e.event_type === 'streak_bonus' ? '🔥' : '⚡'}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#1a1a2e' }}>{e.reason || e.event_type}</div>
                <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{new Date(e.created_at).toLocaleString('en-IN')}</div>
              </div>
              {e.xp_amount > 0 && (
                <div style={{ fontSize: 13, fontWeight: 700, color: '#F43397' }}>+{e.xp_amount} XP</div>
              )}
            </div>
          ))}
          {events.length === 0 && <div style={{ color: '#bbb', fontSize: 13, textAlign: 'center', padding: 16 }}>No events yet</div>}
        </div>
      </div>
    </AdminLayout>
  );
}
