import { useEffect, useState, useCallback } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { supabase, AgentProfile, CaptainSession, HubSummary } from '@/lib/supabase';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid
} from 'recharts';
import { Users, Clock, Zap, Activity, AlertCircle, ShieldCheck } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────

interface HubStat {
  hub: string; sessions: number;
  avgPCT: number; avgPKRT: number; qfd: number; iPER: number;
}

interface ProcessStat {
  process: string; sessions: number;
  avgPCT: number; avgPKRT: number; qfd: number; iPER: number;
  byHub: HubStat[];
}

// ── Helpers ──────────────────────────────────────────────────────

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

// ── Sub-components ────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType; label: string; value: string | number;
  sub?: string; color: string;
}) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: '20px 24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', gap: 16, alignItems: 'center' }}>
      <div style={{ width: 48, height: 48, borderRadius: 12, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={22} color={color} />
      </div>
      <div>
        <div style={{ fontSize: 26, fontWeight: 800, color: '#1a1a2e', lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: color, marginTop: 2, fontWeight: 600 }}>{sub}</div>}
      </div>
    </div>
  );
}

function HubCard({ hub }: { hub: HubSummary }) {
  const score = Math.min(100, Math.round((hub.avg_level / 20) * 100));
  const barColor = score >= 70 ? '#22c55e' : score >= 40 ? '#f59e0b' : '#ef4444';
  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#1a1a2e' }}>{hub.hub}</div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{hub.captains} captain{hub.captains !== 1 ? 's' : ''}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: '#888' }}>Sessions today</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#F43397' }}>{hub.sessions_today}</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        <div style={{ background: '#f8f9fa', borderRadius: 8, padding: '8px 12px' }}>
          <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>Avg PCT</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e', marginTop: 2 }}>
            {hub.avg_pct > 0 ? `${hub.avg_pct.toFixed(1)}m` : '—'}
          </div>
        </div>
        <div style={{ background: '#f8f9fa', borderRadius: 8, padding: '8px 12px' }}>
          <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>Avg Level</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#9747FF', marginTop: 2 }}>
            {hub.avg_level > 0 ? hub.avg_level.toFixed(1) : '—'}
          </div>
        </div>
      </div>
      {/* Progress bar */}
      <div style={{ height: 6, background: '#f0f0f0', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${score}%`, background: barColor, borderRadius: 3, transition: 'width 0.5s' }} />
      </div>
      <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>Proficiency {score}%</div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────

export default function AdminDashboard() {
  const [profiles, setProfiles]       = useState<AgentProfile[]>([]);
  const [sessions, setSessions]       = useState<CaptainSession[]>([]);
  const [liveActivity, setLiveActivity] = useState<CaptainSession[]>([]);
  const [pctTrend, setPctTrend]       = useState<{ day: string; pct: number }[]>([]);
  const [knowledgeGaps, setKnowledgeGaps] = useState<{ process: string; pauses: number; sessions: number }[]>([]);
  const [processStats, setProcessStats] = useState<ProcessStat[]>([]);
  const [expandedProcess, setExpandedProcess] = useState<string | null>(null);
  const [processPanelOpen, setProcessPanelOpen] = useState(true);
  const [loading, setLoading]         = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const load = useCallback(async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [profilesRes, sessionsRes, recentRes] = await Promise.all([
      supabase.from('agent_profiles').select('*').eq('role', 'Captain'),
      supabase.from('captain_sessions')
        .select('*')
        .gte('completed_at', today.toISOString())
        .order('completed_at', { ascending: false }),
      supabase.from('captain_sessions')
        .select('*')
        .order('completed_at', { ascending: false })
        .limit(200),
    ]);

    if (profilesRes.data) setProfiles(profilesRes.data);
    if (sessionsRes.data) setSessions(sessionsRes.data);
    if (recentRes.data)  setLiveActivity(recentRes.data.slice(0, 15));

    // PCT 7-day trend
    if (recentRes.data) {
      const byDay: Record<string, { total: number; count: number }> = {};
      recentRes.data.forEach(s => {
        if (!s.completed_at || !s.pct) return;
        const day = new Date(s.completed_at).toLocaleDateString('en-IN', { weekday: 'short' });
        if (!byDay[day]) byDay[day] = { total: 0, count: 0 };
        byDay[day].total += s.pct;
        byDay[day].count++;
      });
      setPctTrend(Object.entries(byDay).slice(-7).map(([day, v]) => ({
        day,
        pct: Math.round(v.total / v.count / 60 * 10) / 10
      })));

      // Knowledge gaps: most paused processes
      const byProcess: Record<string, { pauses: number; sessions: number }> = {};
      recentRes.data.forEach(s => {
        if (!s.process_name) return;
        if (!byProcess[s.process_name]) byProcess[s.process_name] = { pauses: 0, sessions: 0 };
        byProcess[s.process_name].pauses   += s.pause_count || 0;
        byProcess[s.process_name].sessions += 1;
      });
      setKnowledgeGaps(
        Object.entries(byProcess)
          .map(([process, v]) => ({ process, ...v }))
          .sort((a, b) => (b.pauses / b.sessions) - (a.pauses / a.sessions))
          .slice(0, 6)
      );

      // ── Process × Hub breakdown ────────────────────────────────
      type HubAgg = { count: number; totalPCT: number; totalPKRT: number; totalErrors: number };
      const procHub: Record<string, Record<string, HubAgg>> = {};
      recentRes.data.forEach(s => {
        const proc    = s.process_name || 'Unknown';
        const profile = profilesRes.data?.find((p: AgentProfile) => p.email === s.email);
        const hub     = (profile as any)?.hub || 'Unknown';
        if (!procHub[proc])       procHub[proc] = {};
        if (!procHub[proc][hub])  procHub[proc][hub] = { count: 0, totalPCT: 0, totalPKRT: 0, totalErrors: 0 };
        procHub[proc][hub].count++;
        procHub[proc][hub].totalPCT    += s.pct          || 0;
        procHub[proc][hub].totalPKRT   += s.total_pkrt   || 0;
        procHub[proc][hub].totalErrors += s.error_count  || 0;
      });

      const stats: ProcessStat[] = Object.entries(procHub).map(([process, hubs]) => {
        const agg = Object.values(hubs).reduce(
          (acc, h) => ({ count: acc.count + h.count, totalPCT: acc.totalPCT + h.totalPCT, totalPKRT: acc.totalPKRT + h.totalPKRT, totalErrors: acc.totalErrors + h.totalErrors }),
          { count: 0, totalPCT: 0, totalPKRT: 0, totalErrors: 0 }
        );
        const iPER = agg.count > 0 ? agg.totalErrors / agg.count : 0;
        const byHub: HubStat[] = Object.entries(hubs).map(([hub, d]) => {
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
    // Refresh every 30s
    const interval = setInterval(load, 30000);

    // Realtime: append new sessions to activity feed
    const channel = supabase
      .channel('new-sessions')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'captain_sessions' },
        (payload) => {
          setLiveActivity(prev => [payload.new as CaptainSession, ...prev].slice(0, 15));
        })
      .subscribe();

    return () => { clearInterval(interval); supabase.removeChannel(channel); };
  }, [load]);

  // ── Derived metrics ───────────────────────────────────────────

  const captains     = profiles.filter(p => p.role === 'Captain');
  const activeLast24 = captains.filter(p => p.last_active && (Date.now() - new Date(p.last_active).getTime()) < 86400000);
  const avgPCT       = sessions.length > 0 ? sessions.reduce((s, x) => s + (x.pct || 0), 0) / sessions.length : 0;
  const totalXP      = captains.reduce((s, p) => s + (p.total_xp || 0), 0);
  const avgErrors    = sessions.length > 0 ? sessions.reduce((s, x) => s + (x.error_count || 0), 0) / sessions.length : 0;
  const avgQFD       = sessions.length > 0 ? Math.max(0, Math.round((1 - avgErrors * 0.1) * 100)) : null;
  const avgIPER      = sessions.length > 0 ? avgErrors.toFixed(1) : null;

  // Hub summaries
  const hubMap: Record<string, HubSummary> = {};
  captains.forEach(p => {
    const h = p.hub || 'Unknown';
    if (!hubMap[h]) hubMap[h] = { hub: h, captains: 0, avg_pct: 0, avg_xp: 0, sessions_today: 0, avg_level: 0 };
    hubMap[h].captains++;
    hubMap[h].avg_xp    += p.total_xp || 0;
    hubMap[h].avg_level += p.level    || 0;
  });
  sessions.forEach(s => {
    const profile = captains.find(p => p.email === s.email);
    const h = profile?.hub || 'Unknown';
    if (hubMap[h]) {
      hubMap[h].sessions_today++;
      hubMap[h].avg_pct += (s.pct || 0) / 60;
    }
  });
  const hubs = Object.values(hubMap).map(h => ({
    ...h,
    avg_xp:   h.captains > 0 ? h.avg_xp   / h.captains : 0,
    avg_level: h.captains > 0 ? h.avg_level / h.captains : 0,
    avg_pct:  h.sessions_today > 0 ? h.avg_pct / h.sessions_today : 0,
  })).sort((a, b) => b.captains - a.captains);

  if (loading) {
    return (
      <AdminLayout title="Dashboard">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: '#888', gap: 12 }}>
          <Activity size={20} />
          Loading dashboard data...
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Captain Dashboard">
      {/* Last updated */}
      <div style={{ fontSize: 11, color: '#aaa', marginBottom: 20, textAlign: 'right' }}>
        Last updated {lastUpdated.toLocaleTimeString()} · Auto-refreshes every 30s
      </div>

      {/* KPI strip — row 1 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 14 }}>
        <StatCard icon={Users}       label="Active Captains (24h)" value={activeLast24.length}                            sub={`${captains.length} total`}   color="#F43397" />
        <StatCard icon={Activity}    label="Sessions Today"         value={sessions.length}                               sub="completed processes"           color="#9747FF" />
        <StatCard icon={Clock}       label="Avg PCT Today"          value={avgPCT > 0 ? fmtPCT(Math.round(avgPCT)) : '—'} sub="process cycle time"           color="#0ea5e9" />
      </div>
      {/* KPI strip — row 2: quality + gamification */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 28 }}>
        <StatCard icon={ShieldCheck} label="Avg QFD Today"          value={avgQFD !== null ? `${avgQFD}%` : '—'}          sub="quality first delivery"       color="#22c55e" />
        <StatCard icon={AlertCircle} label="Avg iPER Today"         value={avgIPER !== null ? avgIPER : '—'}               sub="errors per session"            color="#ef4444" />
        <StatCard icon={Zap}         label="Total XP (All Time)"    value={totalXP.toLocaleString()}                       sub={`${captains.length} captains`} color="#f59e0b" />
      </div>

      {/* Hub grid */}
      {hubs.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e', marginBottom: 14, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Hub Performance
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
            {hubs.map(h => <HubCard key={h.hub} hub={h} />)}
          </div>
        </section>
      )}

      {/* Process Performance table */}
      {processStats.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <div
            onClick={() => setProcessPanelOpen(o => !o)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', marginBottom: processPanelOpen ? 12 : 0 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e', textTransform: 'uppercase', letterSpacing: 0.5, margin: 0 }}>
              Process Performance — All Hubs (Last 30 days)
            </h2>
            <span style={{ fontSize: 12, color: '#aaa' }}>{processPanelOpen ? '▲ collapse' : '▼ expand'}</span>
          </div>

          {processPanelOpen && (
            <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#f8f9fa' }}>
                    {['', 'Process', 'Sessions', 'Avg PCT', 'Avg PKRT', 'QFD', 'iPER'].map(h => (
                      <th key={h} style={{ padding: '9px 14px', textAlign: h === 'Sessions' || h === 'Avg PCT' || h === 'Avg PKRT' || h === 'QFD' || h === 'iPER' ? 'center' : 'left', fontWeight: 600, color: '#666', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {processStats.map((ps, i) => {
                    const isExpanded = expandedProcess === ps.process;
                    const qfdCol = ps.qfd >= 90 ? '#22c55e' : ps.qfd >= 70 ? '#f59e0b' : '#ef4444';
                    const iperCol = ps.iPER > 1 ? '#ef4444' : ps.iPER > 0.5 ? '#f59e0b' : '#22c55e';
                    return (
                      <>
                        <tr
                          key={ps.process}
                          onClick={() => setExpandedProcess(isExpanded ? null : ps.process)}
                          style={{ borderBottom: '1px solid #f0f0f0', background: i % 2 === 0 ? '#fff' : '#fafafa', cursor: 'pointer' }}
                        >
                          <td style={{ padding: '10px 14px', width: 24, color: '#aaa', fontSize: 10 }}>
                            {isExpanded ? '▼' : '▶'}
                          </td>
                          <td style={{ padding: '10px 14px', fontWeight: 600, color: '#1a1a2e', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {ps.process}
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'center', color: '#555' }}>{ps.sessions}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'center', color: '#555' }}>{ps.avgPCT > 0 ? `${(ps.avgPCT / 60).toFixed(1)}m` : '—'}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'center', color: '#555' }}>{ps.avgPKRT > 0 ? `${Math.round(ps.avgPKRT)}s` : '—'}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 700, color: qfdCol }}>{ps.qfd}%</td>
                          <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 700, color: iperCol }}>{ps.iPER.toFixed(2)}</td>
                        </tr>

                        {isExpanded && ps.byHub.map(h => {
                          const hQfdCol  = h.qfd >= 90 ? '#22c55e' : h.qfd >= 70 ? '#f59e0b' : '#ef4444';
                          const hIperCol = h.iPER > 1 ? '#ef4444' : h.iPER > 0.5 ? '#f59e0b' : '#22c55e';
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
                              <td style={{ padding: '8px 14px', textAlign: 'center', fontWeight: 700, fontSize: 11, color: hQfdCol }}>{h.qfd}%</td>
                              <td style={{ padding: '8px 14px', textAlign: 'center', fontWeight: 700, fontSize: 11, color: hIperCol }}>{h.iPER.toFixed(2)}</td>
                            </tr>
                          );
                        })}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20, marginBottom: 28 }}>
        {/* PCT trend */}
        <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e', marginBottom: 18 }}>PCT Trend (7-Day Rolling)</div>
          {pctTrend.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={pctTrend}>
                <defs>
                  <linearGradient id="pctGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#F43397" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#F43397" stopOpacity={0}   />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit="m" />
                <Tooltip formatter={(v) => [`${v}m`, 'Avg PCT']} />
                <Area type="monotone" dataKey="pct" stroke="#F43397" fill="url(#pctGrad)" strokeWidth={2} dot={{ r: 3 }} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: 13 }}>
              No session data yet
            </div>
          )}
        </div>

        {/* Live activity feed */}
        <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px rgba(34,197,94,0.6)' }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e' }}>Live Activity</span>
          </div>
          {liveActivity.length === 0 ? (
            <div style={{ color: '#bbb', fontSize: 13, textAlign: 'center', marginTop: 40 }}>No recent activity</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', maxHeight: 220 }}>
              {liveActivity.map(s => (
                <div key={s.id} style={{ display: 'flex', gap: 10, padding: '8px 10px', background: '#f8f9fa', borderRadius: 8 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg,#F43397,#9747FF)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 12, color: '#fff', fontWeight: 700 }}>
                    {s.email?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#1a1a2e', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {s.process_name}
                    </div>
                    <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
                      {s.email?.split('@')[0]} · PCT {fmtPCT(s.pct || 0)} · {s.pause_count}p
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: '#aaa', flexShrink: 0 }}>
                    {s.completed_at ? timeAgo(s.completed_at) : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Knowledge gaps + Captain table */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 20 }}>
        {/* Knowledge gaps */}
        <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <AlertCircle size={16} color="#f59e0b" />
            <span style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e' }}>Knowledge Gaps</span>
          </div>
          {knowledgeGaps.length === 0 ? (
            <div style={{ color: '#bbb', fontSize: 13 }}>No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={knowledgeGaps} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="process" tick={{ fontSize: 10 }} width={90} />
                <Tooltip formatter={(v) => [Number(v).toFixed(1), 'Avg Pauses']} />
                <Bar dataKey="pauses" fill="#9747FF" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Captain performance table */}
        <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e', marginBottom: 16 }}>Captain Performance</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f8f9fa' }}>
                  {['Captain', 'Hub', 'Level', 'XP', 'Sessions Today', 'Streak', 'Last Active'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#666', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {captains.sort((a, b) => (b.total_xp || 0) - (a.total_xp || 0)).slice(0, 20).map((p, i) => {
                  const todaySessions = sessions.filter(s => s.email === p.email).length;
                  return (
                    <tr key={p.email} style={{ borderBottom: '1px solid #f0f0f0', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 600, color: '#1a1a2e' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 26, height: 26, borderRadius: 6, background: 'linear-gradient(135deg,#F43397,#9747FF)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#fff', fontWeight: 700, flexShrink: 0 }}>
                            {p.email?.[0]?.toUpperCase()}
                          </div>
                          {p.email?.split('@')[0]}
                        </div>
                      </td>
                      <td style={{ padding: '10px 12px', color: '#555' }}>{p.hub || '—'}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ background: 'rgba(151,71,255,0.12)', color: '#9747FF', padding: '2px 8px', borderRadius: 10, fontWeight: 600, fontSize: 11 }}>
                          L{p.level}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', color: '#555' }}>{(p.total_xp || 0).toLocaleString()}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <span style={{ background: todaySessions > 0 ? 'rgba(34,197,94,0.12)' : 'transparent', color: todaySessions > 0 ? '#22c55e' : '#bbb', padding: '2px 8px', borderRadius: 10, fontWeight: 600, fontSize: 11 }}>
                          {todaySessions}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', color: '#555' }}>
                        {p.streak_current > 0 ? `🔥 ${p.streak_current}d` : '—'}
                      </td>
                      <td style={{ padding: '10px 12px', color: '#888', fontSize: 11 }}>
                        {p.last_active ? timeAgo(p.last_active) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {captains.length === 0 && (
              <div style={{ color: '#bbb', fontSize: 13, textAlign: 'center', padding: 32 }}>
                No captains registered yet. Data syncs when captains log in to the extension.
              </div>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
