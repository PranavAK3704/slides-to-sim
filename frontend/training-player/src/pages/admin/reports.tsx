import { useEffect, useState, useMemo } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { supabase, AgentProfile, CaptainSession } from '@/lib/supabase';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts';

// ── Cost constants ────────────────────────────────────────────────
const LABOR_RATE_PER_MIN = 4;
const ERROR_REWORK_COST  = 150;

// ── Types ─────────────────────────────────────────────────────────

interface HubStat   { hub: string; sessions: number; avgPCT: number; avgPKRT: number; qfd: number; iPER: number; }
interface ProcStat  { process: string; sessions: number; avgPCT: number; avgPKRT: number; qfd: number; iPER: number; byHub: HubStat[]; }

// ── Helpers ───────────────────────────────────────────────────────

const card = (title: string, children: React.ReactNode, extra?: React.ReactNode) => (
  <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: 20 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e' }}>{title}</div>
      {extra}
    </div>
    {children}
  </div>
);

const empty = (msg = 'No data yet') => (
  <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: 13 }}>{msg}</div>
);

const sectionLabel = (label: string) => (
  <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: 1, marginBottom: 14, textTransform: 'uppercase' }}>{label}</div>
);

const toggleBtn = (label: string, active: boolean, onClick: () => void) => (
  <button key={label} onClick={onClick} style={{ padding: '4px 12px', borderRadius: 20, border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer', background: active ? '#1a1a2e' : '#f0f0f5', color: active ? '#fff' : '#555', transition: 'all 0.15s' }}>
    {label}
  </button>
);

// ── Main ──────────────────────────────────────────────────────────

export default function ReportsPage() {
  const [allSessions, setAllSessions] = useState<CaptainSession[]>([]);
  const [profiles,    setProfiles]    = useState<AgentProfile[]>([]);
  const [processStats,setProcessStats]= useState<ProcStat[]>([]);
  const [hubFilter,   setHubFilter]   = useState('');
  const [expandedProc,setExpandedProc]= useState<string | null>(null);
  const [qfdRange,    setQfdRange]    = useState<'daily'|'weekly'|'monthly'>('daily');
  const [loading,     setLoading]     = useState(true);

  // ── Load ─────────────────────────────────────────────────────────

  useEffect(() => {
    Promise.all([
      supabase.from('captain_sessions').select('*').order('completed_at', { ascending: false }).limit(500),
      supabase.from('agent_profiles').select('*').eq('role', 'Captain'),
      supabase.from('gamification_events').select('xp_amount,created_at').eq('event_type','xp_earned')
        .gte('created_at', new Date(Date.now() - 14 * 86400000).toISOString()),
    ]).then(([sessRes, profRes]) => {
      const sessions = sessRes.data || [];
      const profs    = profRes.data || [];
      setAllSessions(sessions);
      setProfiles(profs);

      // Process × Hub breakdown
      type HubAgg = { count: number; totalPCT: number; totalPKRT: number; totalErrors: number };
      const procHub: Record<string, Record<string, HubAgg>> = {};
      const emailToHub: Record<string, string> = {};
      profs.forEach((p: any) => { emailToHub[p.email] = p.hub || 'Unknown'; });

      sessions.forEach(s => {
        const proc = s.process_name || 'Unknown';
        const hub  = emailToHub[s.email] || 'Unknown';
        if (!procHub[proc])      procHub[proc] = {};
        if (!procHub[proc][hub]) procHub[proc][hub] = { count: 0, totalPCT: 0, totalPKRT: 0, totalErrors: 0 };
        procHub[proc][hub].count++;
        procHub[proc][hub].totalPCT    += s.pct         || 0;
        procHub[proc][hub].totalPKRT   += s.total_pkrt  || 0;
        procHub[proc][hub].totalErrors += s.error_count || 0;
      });

      const stats: ProcStat[] = Object.entries(procHub).map(([process, hubs]) => {
        const agg = Object.values(hubs).reduce(
          (a, h) => ({ count: a.count+h.count, totalPCT: a.totalPCT+h.totalPCT, totalPKRT: a.totalPKRT+h.totalPKRT, totalErrors: a.totalErrors+h.totalErrors }),
          { count: 0, totalPCT: 0, totalPKRT: 0, totalErrors: 0 }
        );
        const iPER  = agg.count > 0 ? agg.totalErrors / agg.count : 0;
        const byHub = Object.entries(hubs).map(([hub, d]) => {
          const hi = d.count > 0 ? d.totalErrors / d.count : 0;
          return { hub, sessions: d.count, avgPCT: d.count>0?d.totalPCT/d.count:0, avgPKRT: d.count>0?d.totalPKRT/d.count:0, qfd: Math.max(0,Math.round((1-hi*0.1)*100)), iPER: hi };
        }).sort((a,b) => b.sessions - a.sessions);
        return { process, sessions: agg.count, avgPCT: agg.count>0?agg.totalPCT/agg.count:0, avgPKRT: agg.count>0?agg.totalPKRT/agg.count:0, qfd: Math.max(0,Math.round((1-iPER*0.1)*100)), iPER, byHub };
      }).sort((a,b) => b.sessions - a.sessions);
      setProcessStats(stats);
      setLoading(false);
    });
  }, []);

  // ── Memos ─────────────────────────────────────────────────────────

  const allHubs = useMemo(() => [...new Set(profiles.map((p:any) => p.hub).filter(Boolean))], [profiles]);

  const filteredStats = useMemo(() => {
    if (!hubFilter) return processStats;
    return processStats.map(ps => {
      const h = ps.byHub.find(b => b.hub === hubFilter);
      if (!h) return null;
      return { ...ps, sessions: h.sessions, avgPCT: h.avgPCT, avgPKRT: h.avgPKRT, qfd: h.qfd, iPER: h.iPER };
    }).filter(Boolean) as ProcStat[];
  }, [processStats, hubFilter]);

  // PCT + PKRT 7-day trend
  const pctPkrtTrend = useMemo(() => {
    const byDay: Record<string, { pct: number; pkrt: number; count: number }> = {};
    allSessions.forEach(s => {
      if (!s.completed_at) return;
      const key = new Date(s.completed_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
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

  // Diagnostic
  const diagnostic = useMemo(() => {
    if (!allSessions.length) return null;
    const avgPCTs  = allSessions.reduce((s,x) => s+(x.pct||0),0) / allSessions.length;
    const avgPKRTs = allSessions.reduce((s,x) => s+(x.total_pkrt||0),0) / allSessions.length;
    if (avgPCTs <= 300)               return { color:'#22c55e', label:'✅ On Track',        detail:'PCT is within acceptable range. Captains are executing efficiently.' };
    if (avgPCTs > 300 && avgPKRTs < 60) return { color:'#f59e0b', label:'⚡ Execution Issue', detail:'PCT is high but PKRT is low — captains know the process but execute slowly. Consider SOP simplification or step sequencing.' };
    return                                   { color:'#ef4444', label:'📚 Knowledge Gap',   detail:'PCT is high AND PKRT is high — captains pause frequently and spend long resolving queries. Assign targeted sims for these processes.' };
  }, [allSessions]);

  // QFD trend (time-range aware)
  const qfdTrend = useMemo(() => {
    const bucket: Record<string, { errors: number; count: number }> = {};
    allSessions.forEach(s => {
      if (!s.completed_at) return;
      const d = new Date(s.completed_at);
      let key = qfdRange === 'daily'
        ? d.toLocaleDateString('en-IN', { month:'short', day:'numeric' })
        : qfdRange === 'weekly'
          ? `W${Math.ceil(d.getDate()/7)} ${d.toLocaleDateString('en-IN',{month:'short'})}`
          : d.toLocaleDateString('en-IN', { month:'short', year:'2-digit' });
      if (!bucket[key]) bucket[key] = { errors: 0, count: 0 };
      bucket[key].errors += s.error_count || 0;
      bucket[key].count++;
    });
    return Object.entries(bucket).slice(-14).map(([period, v]) => ({
      period, qfd: Math.max(0, Math.round((1 - (v.errors/v.count)*0.1)*100))
    }));
  }, [allSessions, qfdRange]);

  // Per-process QFD bars
  const processQFDs = useMemo(() => processStats.map(ps => ({
    process: ps.process.length > 20 ? ps.process.slice(0,19)+'…' : ps.process,
    qfd: ps.qfd,
    fill: ps.qfd >= 90 ? '#22c55e' : ps.qfd >= 70 ? '#f59e0b' : '#ef4444',
  })), [processStats]);

  // Cost metrics
  const costData = useMemo(() => {
    if (!allSessions.length) return null;
    const totalLabor  = allSessions.reduce((s,x) => s + ((x.pct||0)/60)*LABOR_RATE_PER_MIN, 0);
    const totalRework = allSessions.reduce((s,x) => s + (x.error_count||0)*ERROR_REWORK_COST, 0);
    const perProc: Record<string, number> = {};
    allSessions.forEach(s => {
      if (!s.process_name) return;
      perProc[s.process_name] = (perProc[s.process_name]||0) + ((s.pct||0)/60)*LABOR_RATE_PER_MIN + (s.error_count||0)*ERROR_REWORK_COST;
    });
    return {
      totalLabor: Math.round(totalLabor),
      totalRework: Math.round(totalRework),
      avgPerSession: Math.round((totalLabor+totalRework) / allSessions.length),
      topProcs: Object.entries(perProc).map(([p,c]) => ({ process: p.length>22?p.slice(0,20)+'…':p, cost: Math.round(c) })).sort((a,b)=>b.cost-a.cost).slice(0,8),
    };
  }, [allSessions]);

  // Level + QFD + PCT distributions
  const levelDist = useMemo(() => {
    const bands = [['1–3',1,3],['4–6',4,6],['7–9',7,9],['10–12',10,12],['13–15',13,15],['16–20',16,20]] as [string,number,number][];
    return bands.map(([range,min,max]) => ({ range, count: profiles.filter(p=>(p.level||1)>=min&&(p.level||1)<=max).length }));
  }, [profiles]);

  const qfdDist = useMemo(() => {
    const bands = [['<60%',0,59],['60–69',60,69],['70–79',70,79],['80–89',80,89],['90–99',90,99],['100%',100,100]] as [string,number,number][];
    const qs = allSessions.map(s => Math.max(0,Math.round((1-(s.error_count||0)*0.1)*100)));
    return bands.map(([band,min,max]) => ({ band, count: qs.filter(q=>q>=min&&q<=max).length, fill: max<=69?'#ef4444':max<=89?'#f59e0b':'#22c55e' }));
  }, [allSessions]);

  const pctDist = useMemo(() => {
    const bands:[string,number,number][] = [['<2m',0,120],['2–4m',120,240],['4–6m',240,360],['6–10m',360,600],['10–15m',600,900],['>15m',900,Infinity]];
    return bands.map(([band,min,max]) => ({ band, count: allSessions.filter(s=>(s.pct||0)>min&&(s.pct||0)<=max).length }));
  }, [allSessions]);

  if (loading) return <AdminLayout title="Reports"><div style={{ padding:60, textAlign:'center', color:'#bbb' }}>Loading…</div></AdminLayout>;

  return (
    <AdminLayout title="Reports">

      {/* ── 1. PCT + PKRT Analysis ── */}
      {sectionLabel('PCT & PKRT Analysis')}
      {card('Process Cycle Time & Knowledge Resolution Time — 7-Day Trend', (
        <>
          {diagnostic && (
            <div style={{ background:`${diagnostic.color}12`, border:`1.5px solid ${diagnostic.color}40`, borderRadius:10, padding:'10px 16px', marginBottom:20, display:'flex', gap:12, alignItems:'flex-start' }}>
              <div style={{ fontSize:14, fontWeight:700, color:diagnostic.color, flexShrink:0 }}>{diagnostic.label}</div>
              <div style={{ fontSize:12, color:'#555', lineHeight:1.5 }}>{diagnostic.detail}</div>
            </div>
          )}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:24 }}>
            <div>
              <div style={{ fontSize:11, fontWeight:600, color:'#888', marginBottom:10, textTransform:'uppercase', letterSpacing:0.4 }}>Avg PCT per day (minutes)</div>
              {pctPkrtTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={pctPkrtTrend}>
                    <defs>
                      <linearGradient id="pctG" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#0ea5e9" stopOpacity={0.2}/>
                        <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                    <XAxis dataKey="day" tick={{ fontSize:10 }}/>
                    <YAxis tick={{ fontSize:10 }} unit="m"/>
                    <Tooltip formatter={(v) => [`${v}m`,'Avg PCT']}/>
                    <Area type="monotone" dataKey="pct" stroke="#0ea5e9" fill="url(#pctG)" strokeWidth={2} dot={{ r:3 }}/>
                  </AreaChart>
                </ResponsiveContainer>
              ) : empty()}
            </div>
            <div>
              <div style={{ fontSize:11, fontWeight:600, color:'#888', marginBottom:10, textTransform:'uppercase', letterSpacing:0.4 }}>Avg PKRT per session (seconds paused)</div>
              {pctPkrtTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={pctPkrtTrend}>
                    <defs>
                      <linearGradient id="pkrtG" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#9747FF" stopOpacity={0.2}/>
                        <stop offset="95%" stopColor="#9747FF" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                    <XAxis dataKey="day" tick={{ fontSize:10 }}/>
                    <YAxis tick={{ fontSize:10 }} unit="s"/>
                    <Tooltip formatter={(v) => [`${v}s`,'Avg PKRT']}/>
                    <Area type="monotone" dataKey="pkrt" stroke="#9747FF" fill="url(#pkrtG)" strokeWidth={2} dot={{ r:3 }}/>
                  </AreaChart>
                </ResponsiveContainer>
              ) : empty()}
            </div>
          </div>
          <div style={{ marginTop:12, fontSize:11, color:'#aaa', borderTop:'1px solid #f0f0f0', paddingTop:10 }}>
            ⓘ Per-pause query text is not stored yet — only total PKRT per session is synced. A <code>captain_pauses</code> table would enable per-query tracking.
          </div>
        </>
      ))}

      {/* ── 2. QFD Trend ── */}
      {sectionLabel('QFD Trend')}
      {card('Quality First Delivery — Trend & Per-Process Breakdown',
        (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:24 }}>
            <div>
              <div style={{ fontSize:11, fontWeight:600, color:'#888', marginBottom:10, textTransform:'uppercase', letterSpacing:0.4 }}>Overall QFD over time</div>
              {qfdTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={qfdTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                    <XAxis dataKey="period" tick={{ fontSize:10 }}/>
                    <YAxis domain={[0,100]} tick={{ fontSize:10 }} unit="%"/>
                    <Tooltip formatter={(v) => [`${v}%`,'QFD']}/>
                    <Line type="monotone" dataKey="qfd" stroke="#22c55e" strokeWidth={2} dot={{ r:3 }}/>
                  </LineChart>
                </ResponsiveContainer>
              ) : empty()}
            </div>
            <div>
              <div style={{ fontSize:11, fontWeight:600, color:'#888', marginBottom:10, textTransform:'uppercase', letterSpacing:0.4 }}>Current QFD by process</div>
              {processQFDs.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={processQFDs} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false}/>
                    <XAxis type="number" domain={[0,100]} tick={{ fontSize:10 }} unit="%"/>
                    <YAxis type="category" dataKey="process" tick={{ fontSize:10 }} width={110}/>
                    <Tooltip formatter={(v) => [`${v}%`,'QFD']}/>
                    <Bar dataKey="qfd" fill="fill" radius={[0,4,4,0]}/>
                  </BarChart>
                </ResponsiveContainer>
              ) : empty()}
            </div>
          </div>
        ),
        <div style={{ display:'flex', gap:6 }}>
          {(['daily','weekly','monthly'] as const).map(r => toggleBtn(r.charAt(0).toUpperCase()+r.slice(1), qfdRange===r, () => setQfdRange(r)))}
        </div>
      )}

      {/* ── 3. Process × Hub Performance table ── */}
      {sectionLabel('Process Performance by Hub')}
      {allHubs.length > 0 && (
        <div style={{ display:'flex', gap:6, alignItems:'center', marginBottom:12, flexWrap:'wrap' }}>
          <span style={{ fontSize:11, fontWeight:600, color:'#888', marginRight:4 }}>Hub:</span>
          {toggleBtn('All', hubFilter==='', () => setHubFilter(''))}
          {allHubs.map(h => toggleBtn(h, hubFilter===h, () => setHubFilter(p => p===h?'':h)))}
        </div>
      )}
      <div style={{ background:'#fff', borderRadius:12, boxShadow:'0 1px 4px rgba(0,0,0,0.06)', overflow:'hidden', marginBottom:20 }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
          <thead>
            <tr style={{ background:'#f8f9fa' }}>
              {['','Process','Sessions','Avg PCT','Avg PKRT','QFD','iPER'].map(h => (
                <th key={h} style={{ padding:'9px 14px', textAlign:['Sessions','Avg PCT','Avg PKRT','QFD','iPER'].includes(h)?'center':'left', fontWeight:600, color:'#666', fontSize:11, textTransform:'uppercase', letterSpacing:0.3, whiteSpace:'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredStats.length === 0 ? (
              <tr><td colSpan={7} style={{ padding:40, textAlign:'center', color:'#bbb', fontSize:13 }}>No data yet</td></tr>
            ) : filteredStats.map((ps, i) => {
              const isExp  = expandedProc === ps.process;
              const qCol   = ps.qfd  >= 90 ? '#22c55e' : ps.qfd  >= 70 ? '#f59e0b' : '#ef4444';
              const iCol   = ps.iPER  > 1  ? '#ef4444' : ps.iPER  > 0.5 ? '#f59e0b' : '#22c55e';
              return (
                <>
                  <tr key={ps.process} onClick={() => setExpandedProc(isExp?null:ps.process)}
                    style={{ borderBottom:'1px solid #f0f0f0', background:i%2===0?'#fff':'#fafafa', cursor:'pointer' }}>
                    <td style={{ padding:'10px 14px', width:24, color:'#aaa', fontSize:10 }}>{isExp?'▼':'▶'}</td>
                    <td style={{ padding:'10px 14px', fontWeight:600, color:'#1a1a2e', maxWidth:220, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{ps.process}</td>
                    <td style={{ padding:'10px 14px', textAlign:'center', color:'#555' }}>{ps.sessions}</td>
                    <td style={{ padding:'10px 14px', textAlign:'center', color:'#555' }}>{ps.avgPCT>0?`${(ps.avgPCT/60).toFixed(1)}m`:'—'}</td>
                    <td style={{ padding:'10px 14px', textAlign:'center', color:'#555' }}>{ps.avgPKRT>0?`${Math.round(ps.avgPKRT)}s`:'—'}</td>
                    <td style={{ padding:'10px 14px', textAlign:'center', fontWeight:700, color:qCol }}>{ps.qfd}%</td>
                    <td style={{ padding:'10px 14px', textAlign:'center', fontWeight:700, color:iCol }}>{ps.iPER.toFixed(2)}</td>
                  </tr>
                  {isExp && !hubFilter && ps.byHub.map(h => {
                    const hQ = h.qfd>=90?'#22c55e':h.qfd>=70?'#f59e0b':'#ef4444';
                    const hI = h.iPER>1?'#ef4444':h.iPER>0.5?'#f59e0b':'#22c55e';
                    return (
                      <tr key={`${ps.process}-${h.hub}`} style={{ background:'#f0f4ff', borderBottom:'1px solid #e8eaed' }}>
                        <td/>
                        <td style={{ padding:'8px 14px 8px 28px', color:'#555', fontSize:11 }}>
                          <span style={{ display:'inline-block', width:8, height:8, borderRadius:'50%', background:'#9747FF', marginRight:6 }}/>
                          {h.hub}
                        </td>
                        <td style={{ padding:'8px 14px', textAlign:'center', color:'#777', fontSize:11 }}>{h.sessions}</td>
                        <td style={{ padding:'8px 14px', textAlign:'center', color:'#777', fontSize:11 }}>{h.avgPCT>0?`${(h.avgPCT/60).toFixed(1)}m`:'—'}</td>
                        <td style={{ padding:'8px 14px', textAlign:'center', color:'#777', fontSize:11 }}>{h.avgPKRT>0?`${Math.round(h.avgPKRT)}s`:'—'}</td>
                        <td style={{ padding:'8px 14px', textAlign:'center', fontWeight:700, fontSize:11, color:hQ }}>{h.qfd}%</td>
                        <td style={{ padding:'8px 14px', textAlign:'center', fontWeight:700, fontSize:11, color:hI }}>{h.iPER.toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── 4. Cost Metrics ── */}
      {sectionLabel('Cost Metrics')}
      {costData ? (
        <>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:16, marginBottom:20 }}>
            {[
              { label:'Total Labor Cost',   value:`₹${costData.totalLabor.toLocaleString()}`,   sub:'PCT × ₹4/min',   color:'#0ea5e9' },
              { label:'Total Rework Cost',  value:`₹${costData.totalRework.toLocaleString()}`,  sub:'Errors × ₹150',  color:'#ef4444' },
              { label:'Avg Cost / Session', value:`₹${costData.avgPerSession}`,                 sub:'Labor + rework',  color:'#9747FF' },
            ].map(c => (
              <div key={c.label} style={{ background:'#fff', borderRadius:12, padding:'16px 20px', boxShadow:'0 1px 4px rgba(0,0,0,0.06)' }}>
                <div style={{ fontSize:11, color:'#888', marginBottom:4 }}>{c.label}</div>
                <div style={{ fontSize:24, fontWeight:800, color:c.color }}>{c.value}</div>
                <div style={{ fontSize:11, color:'#aaa', marginTop:2 }}>{c.sub}</div>
              </div>
            ))}
          </div>
          {card('Highest Cost Processes', costData.topProcs.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={costData.topProcs} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false}/>
                <XAxis type="number" tick={{ fontSize:10 }} tickFormatter={v=>`₹${v}`}/>
                <YAxis type="category" dataKey="process" tick={{ fontSize:10 }} width={130}/>
                <Tooltip formatter={(v) => [`₹${Number(v).toLocaleString()}`,'Total Cost']}/>
                <Bar dataKey="cost" fill="#ef4444" radius={[0,4,4,0]}/>
              </BarChart>
            </ResponsiveContainer>
          ) : empty())}
        </>
      ) : (
        <div style={{ background:'#fff', borderRadius:12, padding:32, textAlign:'center', color:'#bbb', fontSize:13, boxShadow:'0 1px 4px rgba(0,0,0,0.06)', marginBottom:20 }}>
          No session data to calculate costs yet
        </div>
      )}

      {/* ── 5. Distribution Metrics ── */}
      {sectionLabel('Distribution Metrics')}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:20, marginBottom:20 }}>
        {card('QFD Score Distribution', qfdDist.some(d=>d.count>0) ? (
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={qfdDist}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
              <XAxis dataKey="band" tick={{ fontSize:10 }}/>
              <YAxis tick={{ fontSize:10 }} allowDecimals={false}/>
              <Tooltip formatter={(v) => [v,'Sessions']}/>
              <Bar dataKey="count" fill="fill" radius={[4,4,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        ) : empty())}

        {card('PCT Distribution', pctDist.some(d=>d.count>0) ? (
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={pctDist}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
              <XAxis dataKey="band" tick={{ fontSize:10 }}/>
              <YAxis tick={{ fontSize:10 }} allowDecimals={false}/>
              <Tooltip formatter={(v) => [v,'Sessions']}/>
              <Bar dataKey="count" fill="#9747FF" radius={[4,4,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        ) : empty())}

        {card('Captain Level Distribution', (
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={levelDist}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
              <XAxis dataKey="range" tick={{ fontSize:10 }}/>
              <YAxis tick={{ fontSize:10 }} allowDecimals={false}/>
              <Tooltip formatter={(v) => [v,'Captains']}/>
              <Bar dataKey="count" fill="#F43397" radius={[4,4,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        ))}
      </div>

    </AdminLayout>
  );
}
