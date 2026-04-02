import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '@/components/AdminLayout';
import { supabase, AgentProfile, CaptainSession } from '@/lib/supabase';
import { Users, Clock, Zap, Activity, AlertCircle, ShieldCheck } from 'lucide-react';

// ── Helpers ───────────────────────────────────────────────────────

function fmtPCT(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function timeAgo(ts: string) {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60)    return `${Math.floor(diff)}s ago`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ── StatCard ──────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub, color, onClick }: {
  icon: React.ElementType; label: string; value: string | number;
  sub?: string; color: string; onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        background: '#fff', borderRadius: 12, padding: '20px 24px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        display: 'flex', gap: 16, alignItems: 'center',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'box-shadow 0.15s',
      }}
      onMouseEnter={e => { if (onClick) (e.currentTarget as HTMLDivElement).style.boxShadow = `0 0 0 2px ${color}`; }}
      onMouseLeave={e => { if (onClick) (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 4px rgba(0,0,0,0.06)'; }}
    >
      <div style={{ width: 48, height: 48, borderRadius: 12, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={22} color={color} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 26, fontWeight: 800, color: '#1a1a2e', lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color, marginTop: 2, fontWeight: 600 }}>{sub}</div>}
      </div>
      {onClick && <div style={{ fontSize: 11, color: '#ccc' }}>→</div>}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const router = useRouter();

  const [profiles,     setProfiles]     = useState<AgentProfile[]>([]);
  const [sessions,     setSessions]     = useState<CaptainSession[]>([]);
  const [liveActivity, setLiveActivity] = useState<CaptainSession[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [lastUpdated,  setLastUpdated]  = useState<Date>(new Date());

  const load = useCallback(async () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [profilesRes, sessionsRes, recentRes] = await Promise.all([
      supabase.from('agent_profiles').select('*').eq('role', 'Captain'),
      supabase.from('captain_sessions').select('*').eq('session_role', 'captain').gte('completed_at', sevenDaysAgo.toISOString()).order('completed_at', { ascending: false }),
      supabase.from('captain_sessions').select('*').eq('session_role', 'captain').order('completed_at', { ascending: false }).limit(20),
    ]);
    if (profilesRes.data) setProfiles(profilesRes.data);
    if (sessionsRes.data) setSessions(sessionsRes.data);
    if (recentRes.data)  setLiveActivity(recentRes.data);
    setLastUpdated(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    const channel = supabase.channel('new-sessions')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'captain_sessions' },
        (payload) => setLiveActivity(prev => [payload.new as CaptainSession, ...prev].slice(0, 20)))
      .subscribe();
    return () => { clearInterval(interval); supabase.removeChannel(channel); };
  }, [load]);

  const captains     = profiles.filter(p => p.role === 'Captain');
  const activeLast24 = captains.filter(p => p.last_active && (Date.now() - new Date(p.last_active).getTime()) < 86400000);
  const avgPCT       = sessions.length > 0 ? sessions.reduce((s, x) => s + (x.pct || 0), 0) / sessions.length : 0;
  const totalXP      = captains.reduce((s, p) => s + (p.total_xp || 0), 0);
  const avgErrors    = sessions.length > 0 ? sessions.reduce((s, x) => s + (x.error_count  || 0), 0) / sessions.length : 0;
  const avgQFD       = sessions.length > 0 ? sessions.reduce((s, x) => s + (x.pause_count || 0), 0) / sessions.length : null;
  const avgIPER      = sessions.length > 0 ? avgErrors.toFixed(1) : null;

  const toReports = () => router.push('/admin/reports');

  if (loading) return (
    <AdminLayout title="Dashboard">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: '#888', gap: 12 }}>
        <Activity size={20} /> Loading…
      </div>
    </AdminLayout>
  );

  return (
    <AdminLayout title="Captain Dashboard">
      <div style={{ fontSize: 11, color: '#aaa', marginBottom: 20, textAlign: 'right' }}>
        Last updated {lastUpdated.toLocaleTimeString()} · Auto-refreshes every 30s
      </div>

      {/* KPI row 1 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 14 }}>
        <StatCard icon={Users}    label="Active Captains (24h)" value={activeLast24.length} sub={`${captains.length} total`}    color="#F43397" />
        <StatCard icon={Activity} label="Sessions (7d)"           value={sessions.length}     sub="completed processes"           color="#9747FF" />
        <StatCard icon={Clock}    label="Avg PCT (7d)"           value={avgPCT > 0 ? fmtPCT(Math.round(avgPCT)) : '—'} sub="→ view trend in Reports" color="#0ea5e9" onClick={toReports} />
      </div>

      {/* KPI row 2 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 28 }}>
        <StatCard icon={ShieldCheck} label="Avg Queries/Session"  value={avgQFD !== null ? avgQFD.toFixed(1) : '—'} sub="→ view decay in Reports" color="#22c55e" onClick={toReports} />
        <StatCard icon={AlertCircle} label="Avg iPER (7d)"        value={avgIPER ?? '—'}            sub="errors per session"      color="#ef4444" />
        <StatCard icon={Zap}         label="Total XP (All Time)" value={totalXP.toLocaleString()}  sub={`${captains.length} captains`} color="#f59e0b" />
      </div>

      {/* Live activity */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px rgba(34,197,94,0.6)' }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e' }}>Live Activity</span>
        </div>
        {liveActivity.length === 0 ? (
          <div style={{ color: '#bbb', fontSize: 13, textAlign: 'center', padding: 32 }}>No recent activity</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {liveActivity.map(s => (
              <div key={s.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 12px', background: '#f8f9fa', borderRadius: 8 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg,#F43397,#9747FF)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#fff', fontWeight: 700, flexShrink: 0 }}>
                  {s.email?.[0]?.toUpperCase() || '?'}
                </div>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#1a1a2e', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.process_name}</div>
                  <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>{s.email?.split('@')[0]} · PCT {fmtPCT(s.pct || 0)} · {s.pause_count || 0}p · {s.error_count || 0}err</div>
                </div>
                <div style={{ fontSize: 11, color: '#aaa', flexShrink: 0 }}>{s.completed_at ? timeAgo(s.completed_at) : ''}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
