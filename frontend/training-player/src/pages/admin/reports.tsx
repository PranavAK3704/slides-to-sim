import { useEffect, useState } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { supabase } from '@/lib/supabase';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid
} from 'recharts';

// ── Assumed cost constants (ops context) ─────────────────────────
const LABOR_RATE_PER_MIN = 4;    // ₹240/hr → ₹4/min
const ERROR_REWORK_COST  = 150;  // ₹150 per error (supervisor time)

export default function ReportsPage() {
  const [qfdByHub,    setQfdByHub]    = useState<{ hub: string; qfd: number; sessions: number }[]>([]);
  const [iperByProc,  setIperByProc]  = useState<{ process: string; iper: number; sessions: number }[]>([]);
  const [xpByDay,     setXpByDay]     = useState<{ day: string; xp: number }[]>([]);
  const [levelDist,   setLevelDist]   = useState<{ range: string; count: number }[]>([]);
  const [qfdDist,     setQfdDist]     = useState<{ band: string; count: number }[]>([]);
  const [pctDist,     setPctDist]     = useState<{ band: string; count: number }[]>([]);
  const [costSummary, setCostSummary] = useState<{
    totalLaborCost: number; totalReworkCost: number;
    avgCostPerSession: number; costPerProcTop: { process: string; cost: number }[];
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      supabase.from('captain_sessions').select('email, pct, error_count, process_name').not('pct', 'is', null),
      supabase.from('agent_profiles').select('email, hub, level').eq('role', 'Captain'),
      supabase.from('gamification_events').select('xp_amount, created_at').eq('event_type', 'xp_earned')
        .gte('created_at', new Date(Date.now() - 14 * 86400000).toISOString()),
    ]).then(([sessRes, profRes, xpRes]) => {
      const sessions  = sessRes.data  || [];
      const profiles  = profRes.data  || [];
      const xpEvents  = xpRes.data    || [];

      const emailToHub: Record<string, string> = {};
      profiles.forEach(p => { emailToHub[p.email] = p.hub || 'Unknown'; });

      // ── QFD by Hub ────────────────────────────────────────────
      const hubData: Record<string, { errors: number[]; sessions: number }> = {};
      sessions.forEach(s => {
        const hub = emailToHub[s.email] || 'Unknown';
        if (!hubData[hub]) hubData[hub] = { errors: [], sessions: 0 };
        hubData[hub].errors.push(s.error_count || 0);
        hubData[hub].sessions++;
      });
      setQfdByHub(Object.entries(hubData).map(([hub, d]) => {
        const avgErr = d.errors.reduce((a, b) => a + b, 0) / d.errors.length;
        const qfd = Math.max(0, Math.round((1 - avgErr * 0.1) * 100));
        return { hub, qfd, sessions: d.sessions, fill: qfd >= 90 ? '#22c55e' : qfd >= 70 ? '#f59e0b' : '#ef4444' };
      }).sort((a, b) => b.qfd - a.qfd));

      // ── iPER by Process (top 10 most error-prone) ────────────
      const procData: Record<string, { errors: number; sessions: number }> = {};
      sessions.forEach(s => {
        if (!s.process_name) return;
        if (!procData[s.process_name]) procData[s.process_name] = { errors: 0, sessions: 0 };
        procData[s.process_name].errors   += s.error_count || 0;
        procData[s.process_name].sessions += 1;
      });
      setIperByProc(
        Object.entries(procData)
          .map(([process, d]) => ({ process: process.length > 22 ? process.slice(0, 20) + '…' : process, iper: Math.round((d.errors / d.sessions) * 10) / 10, sessions: d.sessions }))
          .sort((a, b) => b.iper - a.iper)
          .slice(0, 10)
      );

      // ── XP by day ────────────────────────────────────────────
      const byDay: Record<string, number> = {};
      xpEvents.forEach(e => {
        const day = new Date(e.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        byDay[day] = (byDay[day] || 0) + (e.xp_amount || 0);
      });
      setXpByDay(Object.entries(byDay).slice(-14).map(([day, xp]) => ({ day, xp })));

      // ── Captain level distribution ────────────────────────────
      const bands = [
        { range: '1–3', min: 1, max: 3 },
        { range: '4–6', min: 4, max: 6 },
        { range: '7–9', min: 7, max: 9 },
        { range: '10–12', min: 10, max: 12 },
        { range: '13–15', min: 13, max: 15 },
        { range: '16–20', min: 16, max: 20 },
      ];
      setLevelDist(bands.map(b => ({
        range: b.range,
        count: profiles.filter(p => (p.level || 1) >= b.min && (p.level || 1) <= b.max).length
      })));

      // ── QFD score distribution ────────────────────────────────
      const qfdBands = [
        { band: '< 60%', min: 0,  max: 59  },
        { band: '60–69', min: 60, max: 69  },
        { band: '70–79', min: 70, max: 79  },
        { band: '80–89', min: 80, max: 89  },
        { band: '90–99', min: 90, max: 99  },
        { band: '100%',  min: 100, max: 100 },
      ];
      const sessionQFDs = sessions.map(s => Math.max(0, Math.round((1 - (s.error_count || 0) * 0.1) * 100)));
      setQfdDist(qfdBands.map(b => {
        const color = (b.band === '100%' || b.band === '90–99') ? '#22c55e' : (b.band === '80–89' || b.band === '70–79') ? '#f59e0b' : '#ef4444';
        return { band: b.band, count: sessionQFDs.filter(q => q >= b.min && q <= b.max).length, fill: color };
      }));

      // ── PCT distribution ──────────────────────────────────────
      const pctBands = [
        { band: '< 2m',  max: 120   },
        { band: '2–4m',  max: 240   },
        { band: '4–6m',  max: 360   },
        { band: '6–10m', max: 600   },
        { band: '10–15m',max: 900   },
        { band: '> 15m', max: Infinity },
      ];
      const pcts = sessions.map(s => s.pct || 0);
      setPctDist(pctBands.map((b, i) => ({
        band: b.band,
        count: pcts.filter(p => p <= b.max && (i === 0 || p > pctBands[i - 1].max)).length
      })));

      // ── Cost metrics ─────────────────────────────────────────
      if (sessions.length > 0) {
        const totalLaborCost  = sessions.reduce((sum, s) => sum + ((s.pct || 0) / 60) * LABOR_RATE_PER_MIN, 0);
        const totalReworkCost = sessions.reduce((sum, s) => sum + (s.error_count || 0) * ERROR_REWORK_COST, 0);
        const avgCostPerSession = (totalLaborCost + totalReworkCost) / sessions.length;

        const costPerProc: Record<string, number> = {};
        sessions.forEach(s => {
          if (!s.process_name) return;
          const cost = ((s.pct || 0) / 60) * LABOR_RATE_PER_MIN + (s.error_count || 0) * ERROR_REWORK_COST;
          costPerProc[s.process_name] = (costPerProc[s.process_name] || 0) + cost;
        });
        const costPerProcTop = Object.entries(costPerProc)
          .map(([process, cost]) => ({ process: process.length > 22 ? process.slice(0, 20) + '…' : process, cost: Math.round(cost) }))
          .sort((a, b) => b.cost - a.cost)
          .slice(0, 8);

        setCostSummary({ totalLaborCost: Math.round(totalLaborCost), totalReworkCost: Math.round(totalReworkCost), avgCostPerSession: Math.round(avgCostPerSession), costPerProcTop });
      }

      setLoading(false);
    });
  }, []);

  if (loading) return <AdminLayout title="Reports"><div style={{ padding: 40, textAlign: 'center', color: '#bbb' }}>Loading...</div></AdminLayout>;

  const IPER_COLOR = '#f59e0b';
  const COST_COLOR = '#ef4444';

  const card = (title: string, children: React.ReactNode) => (
    <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e', marginBottom: 18 }}>{title}</div>
      {children}
    </div>
  );

  const empty = (msg: string) => (
    <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: 13 }}>{msg}</div>
  );

  return (
    <AdminLayout title="Reports">

      {/* ── Quality metrics ── */}
      <div style={{ fontSize: 12, fontWeight: 700, color: '#888', letterSpacing: 1, marginBottom: 12, textTransform: 'uppercase' }}>Quality Metrics</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 28 }}>

        {card('QFD Score by Hub', qfdByHub.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={qfdByHub}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="hub" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
              <Tooltip formatter={(v) => [`${v}%`, 'QFD Score']} />
              <Bar dataKey="qfd" fill="fill" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : empty('No session data yet'))}

        {card('iPER by Process (Top 10 Error-Prone)', iperByProc.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={iperByProc} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10 }} unit=" err" />
              <YAxis type="category" dataKey="process" tick={{ fontSize: 10 }} width={120} />
              <Tooltip formatter={(v) => [Number(v).toFixed(1), 'Avg Errors/Session']} />
              <Bar dataKey="iper" fill={IPER_COLOR} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : empty('No session data yet'))}
      </div>

      {/* ── Distribution metrics ── */}
      <div style={{ fontSize: 12, fontWeight: 700, color: '#888', letterSpacing: 1, marginBottom: 12, textTransform: 'uppercase' }}>Distribution Metrics</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginBottom: 28 }}>

        {card('QFD Score Distribution', qfdDist.some(d => d.count > 0) ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={qfdDist}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="band" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip formatter={(v) => [v, 'Sessions']} />
              <Bar dataKey="count" fill="fill" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : empty('No sessions yet'))}

        {card('PCT Distribution', pctDist.some(d => d.count > 0) ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={pctDist}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="band" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip formatter={(v) => [v, 'Sessions']} />
              <Bar dataKey="count" fill="#9747FF" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : empty('No sessions yet'))}

        {card('Captain Level Distribution', (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={levelDist}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="range" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip formatter={(v) => [v, 'Captains']} />
              <Bar dataKey="count" fill="#F43397" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ))}
      </div>

      {/* ── Cost metrics ── */}
      <div style={{ fontSize: 12, fontWeight: 700, color: '#888', letterSpacing: 1, marginBottom: 12, textTransform: 'uppercase' }}>Cost Metrics</div>
      {costSummary ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 20 }}>
            {[
              { label: 'Total Labor Cost', value: `₹${costSummary.totalLaborCost.toLocaleString()}`, sub: 'PCT × ₹4/min', color: '#0ea5e9' },
              { label: 'Total Rework Cost', value: `₹${costSummary.totalReworkCost.toLocaleString()}`, sub: 'Errors × ₹150', color: COST_COLOR },
              { label: 'Avg Cost / Session', value: `₹${costSummary.avgCostPerSession}`, sub: 'Labor + rework', color: '#9747FF' },
            ].map(c => (
              <div key={c.label} style={{ background: '#fff', borderRadius: 12, padding: '16px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{c.label}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: c.color }}>{c.value}</div>
                <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{c.sub}</div>
              </div>
            ))}
          </div>
          {card('Highest Cost Processes', costSummary.costPerProcTop.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={costSummary.costPerProcTop} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `₹${v}`} />
                <YAxis type="category" dataKey="process" tick={{ fontSize: 10 }} width={130} />
                <Tooltip formatter={(v) => [`₹${Number(v).toLocaleString()}`, 'Total Cost']} />
                <Bar dataKey="cost" fill={COST_COLOR} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : empty('No data'))}
        </>
      ) : (
        <div style={{ background: '#fff', borderRadius: 12, padding: 32, textAlign: 'center', color: '#bbb', fontSize: 13, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          No session data to calculate costs yet
        </div>
      )}

      {/* ── Engagement ── */}
      <div style={{ fontSize: 12, fontWeight: 700, color: '#888', letterSpacing: 1, marginTop: 28, marginBottom: 12, textTransform: 'uppercase' }}>Engagement</div>
      {card('XP Earned (Last 14 Days)', xpByDay.length > 0 ? (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={xpByDay}>
            <defs>
              <linearGradient id="xpGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#9747FF" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#9747FF" stopOpacity={0}    />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="day" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip formatter={(v) => [v, 'XP']} />
            <Area type="monotone" dataKey="xp" stroke="#9747FF" fill="url(#xpGrad)" strokeWidth={2} dot={{ r: 3 }} />
          </AreaChart>
        </ResponsiveContainer>
      ) : empty('No XP events in last 14 days'))}

    </AdminLayout>
  );
}
