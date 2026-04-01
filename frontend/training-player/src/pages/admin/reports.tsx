import { useEffect, useState, useMemo } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { supabase, AgentProfile, CaptainSession } from '@/lib/supabase';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts';
import { Search } from 'lucide-react';

// ── Cost constants ────────────────────────────────────────────────
const LABOR_RATE_PER_MIN = 4;
const ERROR_REWORK_COST  = 150;

// ── Types ─────────────────────────────────────────────────────────

interface ProcStat {
  process: string; sessions: number;
  avgPCT: number; avgPKRT: number; avgPauses: number; iPER: number;
}

interface AsmResult {
  id: string; email: string; assessment_id: string;
  score: number; passed: boolean; answers: Record<string, string> | null;
  attempt_count: number; completed_at: string;
  assessments: { process_name: string | null; title: string } | null;
}

interface AsmQuestion {
  id: string; assessment_id: string; question: string;
  correct_key: string; options: Record<string, string>;
}

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
  <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: 13, textAlign: 'center', padding: '0 20px' }}>{msg}</div>
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
  const [allSessions,  setAllSessions]  = useState<CaptainSession[]>([]);
  const [profiles,     setProfiles]     = useState<AgentProfile[]>([]);
  const [asmResults,   setAsmResults]   = useState<AsmResult[]>([]);
  const [asmQuestions, setAsmQuestions] = useState<AsmQuestion[]>([]);
  const [hubFilter,    setHubFilter]    = useState('');
  const [procFilter,   setProcFilter]   = useState('');
  const [qfdRange,     setQfdRange]     = useState<'daily'|'weekly'|'monthly'>('daily');
  const [loading,      setLoading]      = useState(true);

  // ── Load ─────────────────────────────────────────────────────────

  useEffect(() => {
    Promise.all([
      supabase.from('captain_sessions').select('*').order('completed_at', { ascending: false }).limit(500),
      supabase.from('agent_profiles').select('*').eq('role', 'Captain'),
      supabase.from('assessment_results').select('*, assessments(process_name, title)').order('completed_at', { ascending: false }).limit(1000),
      supabase.from('assessment_questions').select('*'),
    ]).then(([sessRes, profRes, asmRes, qRes]) => {
      const sessions = sessRes.data || [];
      const profs    = profRes.data || [];
      setAllSessions(sessions);
      setProfiles(profs);
      setAsmResults((asmRes.data || []) as AsmResult[]);
      setAsmQuestions((qRes.data || []) as AsmQuestion[]);

      setLoading(false);
    });
  }, []);

  // ── Memos ─────────────────────────────────────────────────────────

  const emailToHub = useMemo(() => {
    const m: Record<string, string> = {};
    profiles.forEach((p: any) => { m[p.email] = p.hub || 'Unknown'; });
    return m;
  }, [profiles]);

  // Filtered sessions (shared across PCT/PKRT/iPER and QFD sections)
  const filteredSessions = useMemo(() =>
    allSessions.filter(s => {
      const hubOk  = !hubFilter  || (emailToHub[s.email] || '').toLowerCase().includes(hubFilter.toLowerCase());
      const procOk = !procFilter || (s.process_name || '').toLowerCase().includes(procFilter.toLowerCase());
      return hubOk && procOk;
    }),
  [allSessions, hubFilter, procFilter, emailToHub]);

  // PCT + PKRT 7-day trend
  const pctPkrtTrend = useMemo(() => {
    const byDay: Record<string, { pct: number; pkrt: number; count: number }> = {};
    filteredSessions.forEach(s => {
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
  }, [filteredSessions]);

  // iPER trend
  const iperTrend = useMemo(() => {
    const byDay: Record<string, { errors: number; count: number }> = {};
    filteredSessions.forEach(s => {
      if (!s.completed_at) return;
      const key = new Date(s.completed_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
      if (!byDay[key]) byDay[key] = { errors: 0, count: 0 };
      byDay[key].errors += s.error_count || 0;
      byDay[key].count++;
    });
    return Object.entries(byDay).slice(-7).map(([day, v]) => ({
      day, iper: +(v.errors / v.count).toFixed(2),
    }));
  }, [filteredSessions]);

  // Diagnostic — QFD + iPER 4-state matrix
  const diagnostic = useMemo(() => {
    if (filteredSessions.length < 4) return null;
    const sorted = [...filteredSessions].sort((a,b) => new Date(a.completed_at).getTime() - new Date(b.completed_at).getTime());
    const half  = Math.floor(sorted.length / 2);
    const early = sorted.slice(0, half);
    const late  = sorted.slice(half);
    const avgQ = (arr: CaptainSession[]) => arr.reduce((s,x) => s+(x.pause_count||0),0)/arr.length;
    const avgE = (arr: CaptainSession[]) => arr.reduce((s,x) => s+(x.error_count||0),0)/arr.length;
    const qfdDecaying  = avgQ(late) < avgQ(early) * 0.85;
    const iperDecaying = avgE(late) < avgE(early) * 0.85;
    const iperRising   = avgE(late) > avgE(early) * 1.1;
    if (qfdDecaying && iperDecaying)  return { color:'#22c55e', label:'✅ Resolution Working',  detail:'QFD decaying + iPER falling — knowledge gap closing. Captains reaching operational independence.' };
    if (qfdDecaying && !iperDecaying) return { color:'#f59e0b', label:'⚡ Execution Gap',        detail:'QFD falling (doubt cleared) but iPER flat — wrong actions taken post-resolution. Content is fine; focus on execution coaching.' };
    if (!qfdDecaying && iperRising)   return { color:'#ef4444', label:'📚 Content Gap',          detail:'QFD flat + iPER rising — Jarvis not resolving issues. Review SOPs and sim content.' };
    return                                   { color:'#9747FF', label:'⚠️ Adoption Problem',     detail:'QFD flat + iPER flat — captains not using Jarvis for resolution. Push tool adoption.' };
  }, [filteredSessions]);

  // QFD trend — avg pauses/session (time-range aware, filtered)
  const qfdTrend = useMemo(() => {
    const bucket: Record<string, { pauses: number; count: number }> = {};
    filteredSessions.forEach(s => {
      if (!s.completed_at) return;
      const d = new Date(s.completed_at);
      const key = qfdRange === 'daily'
        ? d.toLocaleDateString('en-IN', { month:'short', day:'numeric' })
        : qfdRange === 'weekly'
          ? `W${Math.ceil(d.getDate()/7)} ${d.toLocaleDateString('en-IN',{month:'short'})}`
          : d.toLocaleDateString('en-IN', { month:'short', year:'2-digit' });
      if (!bucket[key]) bucket[key] = { pauses: 0, count: 0 };
      bucket[key].pauses += s.pause_count || 0;
      bucket[key].count++;
    });
    return Object.entries(bucket).slice(-14).map(([period, v]) => ({
      period, qfd: +(v.pauses / v.count).toFixed(1)
    }));
  }, [filteredSessions, qfdRange]);

  // Per-process stats — recomputed whenever filters change
  const processStats = useMemo<ProcStat[]>(() => {
    type Agg = { count: number; totalPCT: number; totalPKRT: number; totalPauses: number; totalErrors: number };
    const proc: Record<string, Agg> = {};
    filteredSessions.forEach(s => {
      const p = s.process_name || 'Unknown';
      if (!proc[p]) proc[p] = { count: 0, totalPCT: 0, totalPKRT: 0, totalPauses: 0, totalErrors: 0 };
      proc[p].count++;
      proc[p].totalPCT    += s.pct         || 0;
      proc[p].totalPKRT   += s.total_pkrt  || 0;
      proc[p].totalPauses += s.pause_count || 0;
      proc[p].totalErrors += s.error_count || 0;
    });
    return Object.entries(proc).map(([process, d]) => ({
      process,
      sessions:  d.count,
      avgPCT:    d.count > 0 ? d.totalPCT    / d.count : 0,
      avgPKRT:   d.count > 0 ? d.totalPKRT   / d.count : 0,
      avgPauses: d.count > 0 ? d.totalPauses / d.count : 0,
      iPER:      d.count > 0 ? d.totalErrors / d.count : 0,
    })).sort((a, b) => b.sessions - a.sessions);
  }, [filteredSessions]);

  // Per-process QFD bars (respects filters via processStats)
  const processQFDs = useMemo(() => processStats.map((ps: ProcStat) => ({
    process: ps.process.length > 20 ? ps.process.slice(0,19)+'…' : ps.process,
    qfd: +ps.avgPauses.toFixed(1),
    fill: ps.avgPauses <= 1 ? '#22c55e' : ps.avgPauses <= 3 ? '#f59e0b' : '#ef4444',
  })), [processStats]);

  // Cost metrics (global)
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

  // Level distribution (global)
  const levelDist = useMemo(() => {
    const bands = [['1–3',1,3],['4–6',4,6],['7–9',7,9],['10–12',10,12],['13–15',13,15],['16–20',16,20]] as [string,number,number][];
    return bands.map(([range,min,max]) => ({ range, count: profiles.filter(p=>(p.level||1)>=min&&(p.level||1)<=max).length }));
  }, [profiles]);

  // ── Assessment memos ──────────────────────────────────────────────

  // Unique processes reached per hub
  const processCoverage = useMemo(() => {
    const hubProcs: Record<string, Set<string>> = {};
    allSessions.forEach(s => {
      const hub = emailToHub[s.email] || 'Unknown';
      if (!hubProcs[hub]) hubProcs[hub] = new Set();
      if (s.process_name) hubProcs[hub].add(s.process_name);
    });
    return Object.entries(hubProcs).map(([hub, procs]) => ({ hub, count: procs.size })).sort((a,b) => b.count - a.count);
  }, [allSessions, emailToHub]);

  // Assessment overview (respects hub + proc filter)
  const assessmentOverview = useMemo(() => {
    let results = asmResults;
    if (hubFilter)  results = results.filter(r => (emailToHub[r.email] || '').toLowerCase().includes(hubFilter.toLowerCase()));
    if (procFilter) results = results.filter(r => (r.assessments?.process_name || '').toLowerCase().includes(procFilter.toLowerCase()));
    const total   = results.length;
    const passed  = results.filter(r => r.passed).length;
    const failed  = total - passed;
    const captainsInScope = new Set(
      profiles
        .filter((p: any) => !hubFilter || ((p as any).hub || '').toLowerCase().includes(hubFilter.toLowerCase()))
        .map((p: any) => p.email)
    );
    const attempted   = new Set(results.map(r => r.email)).size;
    const attemptRate = captainsInScope.size > 0 ? Math.round(attempted / captainsInScope.size * 100) : 0;
    return {
      total, passed, failed,
      passRate:    total > 0 ? Math.round(passed/total*100) : 0,
      failRate:    total > 0 ? Math.round(failed/total*100) : 0,
      attemptRate,
      attempted,
      totalCaptains: captainsInScope.size,
    };
  }, [asmResults, hubFilter, procFilter, profiles, emailToHub]);

  // Failed concepts (respects hub + proc filter)
  const failedConcepts = useMemo(() => {
    let results = asmResults;
    if (hubFilter)  results = results.filter(r => (emailToHub[r.email] || '').toLowerCase().includes(hubFilter.toLowerCase()));
    if (procFilter) results = results.filter(r => (r.assessments?.process_name || '').toLowerCase().includes(procFilter.toLowerCase()));

    const qMap: Record<string, AsmQuestion> = {};
    asmQuestions.forEach(q => { qMap[q.id] = q; });

    const tally: Record<string, { question: string; fails: number; total: number }> = {};
    results.forEach(r => {
      if (!r.answers) return;
      Object.entries(r.answers).forEach(([qid, selected]) => {
        const q = qMap[qid];
        if (!q) return;
        if (!tally[qid]) tally[qid] = { question: q.question, fails: 0, total: 0 };
        tally[qid].total++;
        if (selected !== q.correct_key) tally[qid].fails++;
      });
    });
    return Object.values(tally)
      .filter(f => f.total > 0)
      .map(f => ({ ...f, failRate: Math.round(f.fails / f.total * 100) }))
      .sort((a,b) => b.failRate - a.failRate)
      .slice(0, 10);
  }, [asmResults, asmQuestions, hubFilter, procFilter, emailToHub]);

  if (loading) return <AdminLayout title="Reports"><div style={{ padding:60, textAlign:'center', color:'#bbb' }}>Loading…</div></AdminLayout>;

  return (
    <AdminLayout title="Reports">

      {/* ── Shared Filters ── */}
      <div style={{ background:'#fff', borderRadius:12, padding:'16px 20px', boxShadow:'0 1px 4px rgba(0,0,0,0.06)', marginBottom:20, display:'flex', gap:20, flexWrap:'wrap', alignItems:'flex-end' }}>
        <div>
          <div style={{ fontSize:10, fontWeight:700, color:'#aaa', textTransform:'uppercase', letterSpacing:0.5, marginBottom:6 }}>Hub</div>
          <div style={{ position:'relative' }}>
            <Search size={13} style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'#9ca3af', pointerEvents:'none' }} />
            <input
              type="text" placeholder="Search hub…" value={hubFilter}
              onChange={e => setHubFilter(e.target.value)}
              style={{ padding:'7px 10px 7px 30px', border:'1px solid #e8eaed', borderRadius:8, fontSize:13, outline:'none', width:220, background:'#fff' }}
            />
          </div>
        </div>
        <div style={{ borderLeft:'1px solid #f0f0f0', paddingLeft:20 }}>
          <div style={{ fontSize:10, fontWeight:700, color:'#aaa', textTransform:'uppercase', letterSpacing:0.5, marginBottom:6 }}>Process</div>
          <div style={{ position:'relative' }}>
            <Search size={13} style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'#9ca3af', pointerEvents:'none' }} />
            <input
              type="text" placeholder="Search process…" value={procFilter}
              onChange={e => setProcFilter(e.target.value)}
              style={{ padding:'7px 10px 7px 30px', border:'1px solid #e8eaed', borderRadius:8, fontSize:13, outline:'none', width:240, background:'#fff' }}
            />
          </div>
        </div>
      </div>

      {/* ── 1. PCT + PKRT + iPER ── */}
      {sectionLabel('PCT · PKRT · iPER Analysis')}
      {card('Process Cycle Time · Knowledge Resolution Time · Error Rate — 7-Day Trend', (
        <>
          {diagnostic && (
            <div style={{ background:`${diagnostic.color}12`, border:`1.5px solid ${diagnostic.color}40`, borderRadius:10, padding:'10px 16px', marginBottom:20, display:'flex', gap:12, alignItems:'flex-start' }}>
              <div style={{ fontSize:14, fontWeight:700, color:diagnostic.color, flexShrink:0 }}>{diagnostic.label}</div>
              <div style={{ fontSize:12, color:'#555', lineHeight:1.5 }}>{diagnostic.detail}</div>
            </div>
          )}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:20 }}>
            <div>
              <div style={{ fontSize:11, fontWeight:600, color:'#888', marginBottom:10, textTransform:'uppercase', letterSpacing:0.4 }}>Avg PCT (minutes)</div>
              {pctPkrtTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height={180}>
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
              <div style={{ fontSize:11, fontWeight:600, color:'#888', marginBottom:10, textTransform:'uppercase', letterSpacing:0.4 }}>Avg PKRT (seconds paused)</div>
              {pctPkrtTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height={180}>
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
            <div>
              <div style={{ fontSize:11, fontWeight:600, color:'#888', marginBottom:10, textTransform:'uppercase', letterSpacing:0.4 }}>Avg iPER (errors/session)</div>
              {iperTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={iperTrend}>
                    <defs>
                      <linearGradient id="iperG" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.2}/>
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                    <XAxis dataKey="day" tick={{ fontSize:10 }}/>
                    <YAxis tick={{ fontSize:10 }}/>
                    <Tooltip formatter={(v) => [`${v}`,'Avg iPER']}/>
                    <Area type="monotone" dataKey="iper" stroke="#ef4444" fill="url(#iperG)" strokeWidth={2} dot={{ r:3 }}/>
                  </AreaChart>
                </ResponsiveContainer>
              ) : empty()}
            </div>
          </div>
        </>
      ))}

      {/* ── 2. QFD Trend ── */}
      {sectionLabel('Query Frequency Decay (QFD)')}
      {card('Avg Queries per Session — Decay Trend & Per-Process Breakdown',
        (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:24 }}>
            <div>
              <div style={{ fontSize:11, fontWeight:600, color:'#888', marginBottom:10, textTransform:'uppercase', letterSpacing:0.4 }}>Avg queries/session over time (↓ = improving)</div>
              {qfdTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={qfdTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                    <XAxis dataKey="period" tick={{ fontSize:10 }}/>
                    <YAxis tick={{ fontSize:10 }} allowDecimals={false}/>
                    <Tooltip formatter={(v) => [`${v} queries`,'Avg QFD']}/>
                    <Line type="monotone" dataKey="qfd" stroke="#22c55e" strokeWidth={2} dot={{ r:3 }}/>
                  </LineChart>
                </ResponsiveContainer>
              ) : empty()}
            </div>
            <div>
              <div style={{ fontSize:11, fontWeight:600, color:'#888', marginBottom:10, textTransform:'uppercase', letterSpacing:0.4 }}>Avg queries/session by process — global (↓ = better)</div>
              {processQFDs.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={processQFDs} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false}/>
                    <XAxis type="number" tick={{ fontSize:10 }}/>
                    <YAxis type="category" dataKey="process" tick={{ fontSize:10 }} width={110}/>
                    <Tooltip formatter={(v) => [`${v} queries`,'Avg QFD']}/>
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

      {/* ── 3. Process Performance (Global) ── */}
      {sectionLabel('Process Performance (Global)')}
      <div style={{ background:'#fff', borderRadius:12, boxShadow:'0 1px 4px rgba(0,0,0,0.06)', overflow:'hidden', marginBottom:20 }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
          <thead>
            <tr style={{ background:'#f8f9fa' }}>
              {['Process','Sessions','Avg PCT','Avg PKRT','QFD','iPER'].map(h => (
                <th key={h} style={{ padding:'9px 14px', textAlign:h==='Process'?'left':'center', fontWeight:600, color:'#666', fontSize:11, textTransform:'uppercase', letterSpacing:0.3, whiteSpace:'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {processStats.length === 0 ? (
              <tr><td colSpan={6} style={{ padding:40, textAlign:'center', color:'#bbb', fontSize:13 }}>No data yet</td></tr>
            ) : processStats.map((ps, i) => {
              const qCol = ps.avgPauses <= 1 ? '#22c55e' : ps.avgPauses <= 3 ? '#f59e0b' : '#ef4444';
              const iCol = ps.iPER > 1 ? '#ef4444' : ps.iPER > 0.5 ? '#f59e0b' : '#22c55e';
              return (
                <tr key={ps.process} style={{ borderBottom:'1px solid #f0f0f0', background:i%2===0?'#fff':'#fafafa' }}>
                  <td style={{ padding:'10px 14px', fontWeight:600, color:'#1a1a2e', maxWidth:240, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{ps.process}</td>
                  <td style={{ padding:'10px 14px', textAlign:'center', color:'#555' }}>{ps.sessions}</td>
                  <td style={{ padding:'10px 14px', textAlign:'center', color:'#555' }}>{ps.avgPCT>0?`${(ps.avgPCT/60).toFixed(1)}m`:'—'}</td>
                  <td style={{ padding:'10px 14px', textAlign:'center', color:'#555' }}>{ps.avgPKRT>0?`${Math.round(ps.avgPKRT)}s`:'—'}</td>
                  <td style={{ padding:'10px 14px', textAlign:'center', fontWeight:700, color:qCol }}>{ps.avgPauses.toFixed(1)}</td>
                  <td style={{ padding:'10px 14px', textAlign:'center', fontWeight:700, color:iCol }}>{ps.iPER.toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── 4. Distribution Metrics ── */}
      {sectionLabel('Distribution Metrics')}

      {/* Row 1: Process coverage + Assessment overview */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20, marginBottom:20 }}>
        {card('Process Coverage by Hub', processCoverage.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={processCoverage} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false}/>
              <XAxis type="number" tick={{ fontSize:10 }} allowDecimals={false}/>
              <YAxis type="category" dataKey="hub" tick={{ fontSize:10 }} width={100}/>
              <Tooltip formatter={(v) => [v,'Unique Processes']}/>
              <Bar dataKey="count" fill="#9747FF" radius={[0,4,4,0]}/>
            </BarChart>
          </ResponsiveContainer>
        ) : empty('No session data yet'))}

        {card('Assessment Overview', (
          <>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:16 }}>
              {[
                { label:'Pass Rate',    value:`${assessmentOverview.passRate}%`,    color:'#22c55e', sub:`${assessmentOverview.passed} passed` },
                { label:'Fail Rate',   value:`${assessmentOverview.failRate}%`,    color:'#ef4444', sub:`${assessmentOverview.failed} failed` },
                { label:'Attempt Rate',value:`${assessmentOverview.attemptRate}%`, color:'#9747FF', sub:`${assessmentOverview.attempted}/${assessmentOverview.totalCaptains} captains` },
              ].map(c => (
                <div key={c.label} style={{ background:'#f8f9fa', borderRadius:10, padding:'12px 14px', textAlign:'center' }}>
                  <div style={{ fontSize:11, color:'#888', marginBottom:4 }}>{c.label}</div>
                  <div style={{ fontSize:24, fontWeight:800, color:c.color }}>{c.value}</div>
                  <div style={{ fontSize:10, color:'#aaa', marginTop:2 }}>{c.sub}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize:11, color:'#aaa', textAlign:'center' }}>
              {assessmentOverview.total} total attempts
              {hubFilter  ? ` · Hub: ${hubFilter}`  : ''}
              {procFilter ? ` · Process: ${procFilter}` : ''}
            </div>
          </>
        ))}
      </div>

      {/* Row 2: Failed concepts + Level dist */}
      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:20, marginBottom:20 }}>
        {card('Failed Concepts — Top 10 by Fail Rate', failedConcepts.length > 0 ? (
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {failedConcepts.map((f, i) => (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:10 }}>
                <div style={{ width:22, fontSize:10, color:'#aaa', textAlign:'right', flexShrink:0 }}>#{i+1}</div>
                <div style={{ flex:1, fontSize:11, color:'#333', lineHeight:1.3, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                  {f.question}
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
                  <div style={{ width:80, height:6, background:'#f0f0f0', borderRadius:3, overflow:'hidden' }}>
                    <div style={{ width:`${f.failRate}%`, height:'100%', background:f.failRate>50?'#ef4444':f.failRate>30?'#f59e0b':'#22c55e', borderRadius:3 }}/>
                  </div>
                  <div style={{ fontSize:11, fontWeight:700, color:f.failRate>50?'#ef4444':f.failRate>30?'#f59e0b':'#22c55e', width:36 }}>{f.failRate}%</div>
                  <div style={{ fontSize:10, color:'#aaa', width:40 }}>{f.fails}/{f.total}</div>
                </div>
              </div>
            ))}
          </div>
        ) : empty('No assessment data yet — create assessments and have captains attempt them'))}

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

      {/* ── 5. Cost Metrics ── */}
      {sectionLabel('Cost Metrics')}
      {costData ? (
        <>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:16, marginBottom:20 }}>
            {[
              { label:'Total Labor Cost',   value:`₹${costData.totalLabor.toLocaleString()}`,   sub:'PCT × ₹4/min',  color:'#0ea5e9' },
              { label:'Total Rework Cost',  value:`₹${costData.totalRework.toLocaleString()}`,  sub:'Errors × ₹150', color:'#ef4444' },
              { label:'Avg Cost / Session', value:`₹${costData.avgPerSession}`,                 sub:'Labor + rework', color:'#9747FF' },
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

    </AdminLayout>
  );
}
