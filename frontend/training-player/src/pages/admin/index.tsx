import { useEffect, useState, useCallback, useMemo } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { supabase, AgentProfile, CaptainSession, HubSummary } from '@/lib/supabase';
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend
} from 'recharts';
import { Users, Clock, Zap, Activity, AlertCircle, ShieldCheck, X } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────

interface HubStat {
  hub: string; sessions: number;
  avgPCT: number; avgPKRT: number; qfd: number; iPER: number;
}

interface ProcessStat {
  process: string; sessions: number;
  avgPCT: number; avgPKRT: number; qfd: number; iPER: number;
  byHub: HubStat[];
}

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

const PROCESS_COLORS = ['#F43397','#9747FF','#0ea5e9','#22c55e','#f59e0b','#ef4444','#8b5cf6','#06b6d4'];

// ── Sub-components ────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub, color, onClick, active }: {
  icon: React.ElementType; label: string; value: string | number;
  sub?: string; color: string; onClick?: () => void; active?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        background: active ? `${color}12` : '#fff',
        borderRadius: 12, padding: '20px 24px',
        boxShadow: active ? `0 0 0 2px ${color}` : '0 1px 4px rgba(0,0,0,0.06)',
        display: 'flex', gap: 16, alignItems: 'center',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.15s',
      }}>
      <div style={{ width: 48, height: 48, borderRadius: 12, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={22} color={color} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 26, fontWeight: 800, color: '#1a1a2e', lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color, marginTop: 2, fontWeight: 600 }}>{sub}</div>}
      </div>
      {onClick && <div style={{ fontSize: 11, color: '#aaa' }}>{active ? '▲' : '▼'}</div>}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────

export default function AdminDashboard() {
  const [profiles,    setProfiles]    = useState<AgentProfile[]>([]);
  const [sessions,    setSessions]    = useState<CaptainSession[]>([]);
  const [allSessions, setAllSessions] = useState<CaptainSession[]>([]);
  const [liveActivity,setLiveActivity]= useState<CaptainSession[]>([]);
  const [processStats,setProcessStats]= useState<ProcessStat[]>([]);
  const [expandedProcess, setExpandedProcess] = useState<string | null>(null);
  const [activeCard,  setActiveCard]  = useState<'pct' | 'qfd' | null>(null);
  const [qfdRange,    setQfdRange]    = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [hubFilter,   setHubFilter]   = useState<string>('');
  const [loading,     setLoading]     = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  // ── Load ─────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const [profilesRes, sessionsRes, recentRes] = await Promise.all([
      supabase.from('agent_profiles').select('*').eq('role', 'Captain'),
      supabase.from('captain_sessions').select('*').gte('completed_at', today.toISOString()).order('completed_at', { ascending: false }),
      supabase.from('captain_sessions').select('*').order('completed_at', { ascending: false }).limit(400),
    ]);

    if (profilesRes.data) setProfiles(profilesRes.data);
    if (sessionsRes.data) setSessions(sessionsRes.data);
    if (recentRes.data)  { setAllSessions(recentRes.data); setLiveActivity(recentRes.data.slice(0, 10)); }

    // Process × Hub breakdown
    if (recentRes.data && profilesRes.data) {
      type HubAgg = { count: number; totalPCT: number; totalPKRT: number; totalErrors: number };
      const procHub: Record<string, Record<string, HubAgg>> = {};
      recentRes.data.forEach(s => {
        const proc    = s.process_name || 'Unknown';
        const profile = profilesRes.data!.find((p: AgentProfile) => p.email === s.email);
        const hub     = (profile as any)?.hub || 'Unknown';
        if (!procHub[proc])      procHub[proc] = {};
        if (!procHub[proc][hub]) procHub[proc][hub] = { count: 0, totalPCT: 0, totalPKRT: 0, totalErrors: 0 };
        procHub[proc][hub].count++;
        procHub[proc][hub].totalPCT    += s.pct         || 0;
        procHub[proc][hub].totalPKRT   += s.total_pkrt  || 0;
        procHub[proc][hub].totalErrors += s.error_count || 0;
      });

      const stats: ProcessStat[] = Object.entries(procHub).map(([process, hubs]) => {
        const agg = Object.values(hubs).reduce(
          (acc, h) => ({ count: acc.count + h.count, totalPCT: acc.totalPCT + h.totalPCT, totalPKRT: acc.totalPKRT + h.totalPKRT, totalErrors: acc.totalErrors + h.totalErrors }),
          { count: 0, totalPCT: 0, totalPKRT: 0, totalErrors: 0 }
        );
        const iPER  = agg.count > 0 ? agg.totalErrors / agg.count : 0;
        const byHub = Object.entries(hubs).map(([hub, d]) => {
          const hi = d.count > 0 ? d.totalErrors / d.count : 0;
          return { hub, sessions: d.count, avgPCT: d.count > 0 ? d.totalPCT / d.count : 0, avgPKRT: d.count > 0 ? d.totalPKRT / d.count : 0, qfd: Math.max(0, Math.round((1 - hi * 0.1) * 100)), iPER: hi };
        }).sort((a, b) => b.sessions - a.sessions);
        return { process, sessions: agg.count, avgPCT: agg.count > 0 ? agg.totalPCT / agg.count : 0, avgPKRT: agg.count > 0 ? agg.totalPKRT / agg.count : 0, qfd: Math.max(0, Math.round((1 - iPER * 0.1) * 100)), iPER, byHub };
      }).sort((a, b) => b.sessions - a.sessions);
      setProcessStats(stats);
    }

    setLastUpdated(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    const channel = supabase.channel('new-sessions')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'captain_sessions' },
        (payload) => setLiveActivity(prev => [payload.new as CaptainSession, ...prev].slice(0, 10)))
      .subscribe();
    return () => { clearInterval(interval); supabase.removeChannel(channel); };
  }, [load]);

  // ── Derived KPIs ─────────────────────────────────────────────────

  const captains     = profiles.filter(p => p.role === 'Captain');
  const activeLast24 = captains.filter(p => p.last_active && (Date.now() - new Date(p.last_active).getTime()) < 86400000);
  const avgPCT       = sessions.length > 0 ? sessions.reduce((s, x) => s + (x.pct || 0), 0) / sessions.length : 0;
  const totalXP      = captains.reduce((s, p) => s + (p.total_xp || 0), 0);
  const avgErrors    = sessions.length > 0 ? sessions.reduce((s, x) => s + (x.error_count || 0), 0) / sessions.length : 0;
  const avgQFD       = sessions.length > 0 ? Math.max(0, Math.round((1 - avgErrors * 0.1) * 100)) : null;
  const avgIPER      = sessions.length > 0 ? avgErrors.toFixed(1) : null;

  // Unique hubs from captains
  const allHubs = useMemo(() => [...new Set(captains.map(p => (p as any).hub).filter(Boolean))], [captains]);

  // ── PCT + PKRT 7-day trend ────────────────────────────────────────

  const pctPkrtTrend = useMemo(() => {
    const byDay: Record<string, { pct: number; pkrt: number; count: number }> = {};
    allSessions.forEach(s => {
      if (!s.completed_at) return;
      const d = new Date(s.completed_at);
      const key = d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
      if (!byDay[key]) byDay[key] = { pct: 0, pkrt: 0, count: 0 };
      byDay[key].pct  += s.pct        || 0;
      byDay[key].pkrt += s.total_pkrt || 0;
      byDay[key].count++;
    });
    return Object.entries(byDay).slice(-7).map(([day, v]) => ({
      day,
      pct:  Math.round(v.pct  / v.count / 60 * 10) / 10,
      pkrt: Math.round(v.pkrt / v.count),
    }));
  }, [allSessions]);

  // ── Diagnostic: PCT vs PKRT relationship ─────────────────────────

  const diagnostic = useMemo(() => {
    if (allSessions.length === 0) return null;
    const avgPCTsec  = allSessions.reduce((s, x) => s + (x.pct       || 0), 0) / allSessions.length;
    const avgPKRTsec = allSessions.reduce((s, x) => s + (x.total_pkrt|| 0), 0) / allSessions.length;
    const pctHigh  = avgPCTsec > 300;   // > 5 min is high
    const pkrtHigh = avgPKRTsec > 60;   // > 60s per pause average is high
    if (!pctHigh)                return { type: 'good',      label: '✅ On Track',          detail: 'PCT is within acceptable range. Captains are executing efficiently.', color: '#22c55e' };
    if (pctHigh && !pkrtHigh)    return { type: 'execution', label: '⚡ Execution Issue',   detail: 'PCT is high but PKRT is low — captains know the process but are slow to execute steps. Consider SOP simplification.', color: '#f59e0b' };
    return                              { type: 'knowledge', label: '📚 Knowledge Gap',     detail: 'PCT is high AND PKRT is high — captains are pausing frequently and spending long time resolving. Assign targeted sims for these processes.', color: '#ef4444' };
  }, [allSessions]);

  // ── QFD trend (time-range aware) ─────────────────────────────────

  const qfdTrend = useMemo(() => {
    const bucket: Record<string, { errors: number; count: number }> = {};
    allSessions.forEach(s => {
      if (!s.completed_at) return;
      const d = new Date(s.completed_at);
      let key: string;
      if (qfdRange === 'daily') {
        key = d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
      } else if (qfdRange === 'weekly') {
        const wk = Math.ceil(d.getDate() / 7);
        key = `W${wk} ${d.toLocaleDateString('en-IN', { month: 'short' })}`;
      } else {
        key = d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
      }
      if (!bucket[key]) bucket[key] = { errors: 0, count: 0 };
      bucket[key].errors += s.error_count || 0;
      bucket[key].count++;
    });
    return Object.entries(bucket).slice(-14).map(([period, v]) => ({
      period,
      qfd: Math.max(0, Math.round((1 - (v.errors / v.count) * 0.1) * 100)),
    }));
  }, [allSessions, qfdRange]);

  // ── QFD per process (current) ─────────────────────────────────────

  const processQFDs = useMemo(() =>
    processStats.map((ps, i) => ({ process: ps.process.length > 18 ? ps.process.slice(0, 17) + '…' : ps.process, qfd: ps.qfd, fill: ps.qfd >= 90 ? '#22c55e' : ps.qfd >= 70 ? '#f59e0b' : '#ef4444' })),
  [processStats]);

  // ── Filtered process stats ────────────────────────────────────────

  const filteredProcessStats = useMemo(() => {
    if (!hubFilter) return processStats;
    return processStats.map(ps => {
      const hubRows = ps.byHub.filter(h => h.hub === hubFilter);
      if (!hubRows.length) return null;
      const h = hubRows[0];
      return { ...ps, sessions: h.sessions, avgPCT: h.avgPCT, avgPKRT: h.avgPKRT, qfd: h.qfd, iPER: h.iPER, byHub: hubRows };
    }).filter(Boolean) as ProcessStat[];
  }, [processStats, hubFilter]);

  // ─────────────────────────────────────────────────────────────────

  const panel: React.CSSProperties = { background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' };
  const toggleBtn = (label: string, active: boolean, onClick: () => void) => (
    <button onClick={onClick} style={{ padding: '5px 14px', borderRadius: 20, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: active ? '#1a1a2e' : '#f0f0f5', color: active ? '#fff' : '#555', transition: 'all 0.15s' }}>
      {label}
    </button>
  );

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

      {/* ── KPI strip ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 14 }}>
        <StatCard icon={Users}    label="Active Captains (24h)" value={activeLast24.length} sub={`${captains.length} total`} color="#F43397" />
        <StatCard icon={Activity} label="Sessions Today"         value={sessions.length}     sub="completed processes"        color="#9747FF" />
        <StatCard icon={Clock}    label="Avg PCT Today"
          value={avgPCT > 0 ? fmtPCT(Math.round(avgPCT)) : '—'} sub="click to analyse trend" color="#0ea5e9"
          active={activeCard === 'pct'} onClick={() => setActiveCard(c => c === 'pct' ? null : 'pct')} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 20 }}>
        <StatCard icon={ShieldCheck} label="Avg QFD Today"
          value={avgQFD !== null ? `${avgQFD}%` : '—'} sub="click to analyse trend" color="#22c55e"
          active={activeCard === 'qfd'} onClick={() => setActiveCard(c => c === 'qfd' ? null : 'qfd')} />
        <StatCard icon={AlertCircle} label="Avg iPER Today"       value={avgIPER ?? '—'}         sub="errors per session"         color="#ef4444" />
        <StatCard icon={Zap}         label="Total XP (All Time)"  value={totalXP.toLocaleString()} sub={`${captains.length} captains`} color="#f59e0b" />
      </div>

      {/* ── Expanded PCT panel ── */}
      {activeCard === 'pct' && (
        <div style={{ ...panel, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e' }}>PCT & PKRT — 7-Day Trend</span>
            <button onClick={() => setActiveCard(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aaa' }}><X size={16} /></button>
          </div>

          {/* Diagnostic banner */}
          {diagnostic && (
            <div style={{ background: `${diagnostic.color}12`, border: `1.5px solid ${diagnostic.color}40`, borderRadius: 10, padding: '10px 16px', marginBottom: 18, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: diagnostic.color, flexShrink: 0 }}>{diagnostic.label}</div>
              <div style={{ fontSize: 12, color: '#555', lineHeight: 1.5 }}>{diagnostic.detail}</div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            {/* PCT trend */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#888', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.4 }}>Avg PCT (min)</div>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={pctPkrtTrend}>
                  <defs>
                    <linearGradient id="pctG" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#0ea5e9" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} unit="m" />
                  <Tooltip formatter={(v) => [`${v}m`, 'Avg PCT']} />
                  <Area type="monotone" dataKey="pct" stroke="#0ea5e9" fill="url(#pctG)" strokeWidth={2} dot={{ r: 3 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* PKRT trend */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#888', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.4 }}>Avg PKRT per session (sec) — time spent paused</div>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={pctPkrtTrend}>
                  <defs>
                    <linearGradient id="pkrtG" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#9747FF" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#9747FF" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} unit="s" />
                  <Tooltip formatter={(v) => [`${v}s`, 'Avg PKRT']} />
                  <Area type="monotone" dataKey="pkrt" stroke="#9747FF" fill="url(#pkrtG)" strokeWidth={2} dot={{ r: 3 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div style={{ marginTop: 12, fontSize: 11, color: '#aaa', borderTop: '1px solid #f0f0f0', paddingTop: 10 }}>
            ⓘ Query text is not yet stored per-pause — only aggregate PKRT and pause count are synced. To track per-query text, a <code>captain_pauses</code> table needs to be added.
          </div>
        </div>
      )}

      {/* ── Expanded QFD panel ── */}
      {activeCard === 'qfd' && (
        <div style={{ ...panel, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e' }}>QFD Trend</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {toggleBtn('Daily',   qfdRange === 'daily',   () => setQfdRange('daily'))}
              {toggleBtn('Weekly',  qfdRange === 'weekly',  () => setQfdRange('weekly'))}
              {toggleBtn('Monthly', qfdRange === 'monthly', () => setQfdRange('monthly'))}
              <button onClick={() => setActiveCard(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', marginLeft: 8 }}><X size={16} /></button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            {/* Overall QFD trend */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#888', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.4 }}>Overall QFD trend</div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={qfdTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
                  <Tooltip formatter={(v) => [`${v}%`, 'QFD']} />
                  <Line type="monotone" dataKey="qfd" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Per-process current QFD */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#888', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.4 }}>Current QFD by process</div>
              {processQFDs.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={processQFDs} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
                    <YAxis type="category" dataKey="process" tick={{ fontSize: 10 }} width={100} />
                    <Tooltip formatter={(v) => [`${v}%`, 'QFD']} />
                    <Bar dataKey="qfd" fill="fill" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: 13 }}>No process data yet</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Hub filter tabs ── */}
      {allHubs.length > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#888', marginRight: 4 }}>Hub:</span>
          {toggleBtn('All Hubs', hubFilter === '', () => setHubFilter(''))}
          {allHubs.map(h => toggleBtn(h, hubFilter === h, () => setHubFilter(prev => prev === h ? '' : h)))}
        </div>
      )}

      {/* ── Process Performance table ── */}
      {filteredProcessStats.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e', textTransform: 'uppercase', letterSpacing: 0.5, margin: 0 }}>
              Process Performance {hubFilter ? `— ${hubFilter}` : '— All Hubs'} (Last 30 days)
            </h2>
            <span style={{ fontSize: 11, color: '#aaa' }}>Click row to expand per-hub</span>
          </div>

          <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f8f9fa' }}>
                  {['', 'Process', 'Sessions', 'Avg PCT', 'Avg PKRT', 'QFD', 'iPER'].map(h => (
                    <th key={h} style={{ padding: '9px 14px', textAlign: ['Sessions','Avg PCT','Avg PKRT','QFD','iPER'].includes(h) ? 'center' : 'left', fontWeight: 600, color: '#666', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredProcessStats.map((ps, i) => {
                  const isExp   = expandedProcess === ps.process;
                  const qfdCol  = ps.qfd >= 90 ? '#22c55e' : ps.qfd >= 70 ? '#f59e0b' : '#ef4444';
                  const iperCol = ps.iPER > 1 ? '#ef4444' : ps.iPER > 0.5 ? '#f59e0b' : '#22c55e';
                  return (
                    <>
                      <tr key={ps.process}
                        onClick={() => setExpandedProcess(isExp ? null : ps.process)}
                        style={{ borderBottom: '1px solid #f0f0f0', background: i % 2 === 0 ? '#fff' : '#fafafa', cursor: 'pointer' }}>
                        <td style={{ padding: '10px 14px', width: 24, color: '#aaa', fontSize: 10 }}>{isExp ? '▼' : '▶'}</td>
                        <td style={{ padding: '10px 14px', fontWeight: 600, color: '#1a1a2e', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ps.process}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'center', color: '#555' }}>{ps.sessions}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'center', color: '#555' }}>{ps.avgPCT > 0 ? `${(ps.avgPCT / 60).toFixed(1)}m` : '—'}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'center', color: '#555' }}>{ps.avgPKRT > 0 ? `${Math.round(ps.avgPKRT)}s` : '—'}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 700, color: qfdCol }}>{ps.qfd}%</td>
                        <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 700, color: iperCol }}>{ps.iPER.toFixed(2)}</td>
                      </tr>
                      {isExp && !hubFilter && ps.byHub.map(h => {
                        const hQ = h.qfd >= 90 ? '#22c55e' : h.qfd >= 70 ? '#f59e0b' : '#ef4444';
                        const hI = h.iPER > 1 ? '#ef4444' : h.iPER > 0.5 ? '#f59e0b' : '#22c55e';
                        return (
                          <tr key={`${ps.process}-${h.hub}`} style={{ background: '#f0f4ff', borderBottom: '1px solid #e8eaed' }}>
                            <td />
                            <td style={{ padding: '8px 14px 8px 28px', color: '#555', fontSize: 11 }}>
                              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#9747FF', marginRight: 6 }} />
                              {h.hub}
                            </td>
                            <td style={{ padding: '8px 14px', textAlign: 'center', color: '#777', fontSize: 11 }}>{h.sessions}</td>
                            <td style={{ padding: '8px 14px', textAlign: 'center', color: '#777', fontSize: 11 }}>{h.avgPCT > 0 ? `${(h.avgPCT / 60).toFixed(1)}m` : '—'}</td>
                            <td style={{ padding: '8px 14px', textAlign: 'center', color: '#777', fontSize: 11 }}>{h.avgPKRT > 0 ? `${Math.round(h.avgPKRT)}s` : '—'}</td>
                            <td style={{ padding: '8px 14px', textAlign: 'center', fontWeight: 700, fontSize: 11, color: hQ }}>{h.qfd}%</td>
                            <td style={{ padding: '8px 14px', textAlign: 'center', fontWeight: 700, fontSize: 11, color: hI }}>{h.iPER.toFixed(2)}</td>
                          </tr>
                        );
                      })}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Live activity (compact) ── */}
      {liveActivity.length > 0 && (
        <div style={{ ...panel, marginBottom: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px rgba(34,197,94,0.6)' }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: '#1a1a2e' }}>Live Activity</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {liveActivity.map(s => (
              <div key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'center', background: '#f8f9fa', borderRadius: 8, padding: '6px 12px', fontSize: 11 }}>
                <div style={{ width: 22, height: 22, borderRadius: 6, background: 'linear-gradient(135deg,#F43397,#9747FF)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 10, flexShrink: 0 }}>
                  {s.email?.[0]?.toUpperCase() || '?'}
                </div>
                <span style={{ fontWeight: 600, color: '#1a1a2e' }}>{s.process_name}</span>
                <span style={{ color: '#888' }}>PCT {fmtPCT(s.pct || 0)}</span>
                <span style={{ color: '#aaa' }}>{s.completed_at ? timeAgo(s.completed_at) : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
