import { useEffect, useState, useMemo } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { supabase } from '@/lib/supabase';
import { AlertTriangle, CheckCircle, AlertCircle, XCircle, ChevronDown, ChevronUp, Building2 } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface HubSession {
  hub_code:     string;
  email:        string;
  process_name: string;
  pct:          number;
  pause_count:  number;
  error_count:  number;
  completed_at: string;
}

interface HubProfile {
  hub_code: string | null;
  hub:      string | null;
  email:    string;
}

interface HubRow {
  hub_code:     string;
  hub_name:     string;
  sessions:     number;
  captains:     number;
  avgQFD:       number;  // avg pauses/session
  avgPCT:       number;  // avg seconds
  avgIPER:      number;  // avg error_count/session
  score:        number;  // 0–100 composite
  band:         'critical' | 'intervention' | 'at_risk' | 'high';
  diagnosis:    string;
  diagnosisTag: string;
  processes:    ProcessRow[];
  qfdTrend:     'improving' | 'worsening' | 'stable';
  iperTrend:    'improving' | 'worsening' | 'stable';
}

interface ProcessRow {
  process_name: string;
  sessions:     number;
  avgQFD:       number;
  avgPCT:       number;
  avgIPER:      number;
}

// ── Composite score formula ───────────────────────────────────────────────────
//
// Each metric is normalised to 0–100 (higher = better performance):
//   QFD score  = clamp(100 - (avgQFD / 5 × 100), 0, 100)   — 0 pauses → 100, 5+ → 0
//   PCT score  = clamp(100 - (avgPCT / 1800 × 100), 0, 100) — 0s → 100, 30min+ → 0
//   iPER score = clamp(100 - (avgIPER × 100), 0, 100)        — 0 errors → 100, 1+ → 0
//
// Weighted composite (QFD most reliable, iPER outcome signal, PCT context):
//   score = (QFD×0.45) + (iPER×0.35) + (PCT×0.20)
//
// Bands:  ≥75 High · 50–74 At Risk · 25–49 Needs Intervention · <25 Critical

function computeScore(avgQFD: number, avgPCT: number, avgIPER: number): number {
  const qfdScore  = Math.max(0, Math.min(100, 100 - (avgQFD  / 5)    * 100));
  const pctScore  = Math.max(0, Math.min(100, 100 - (avgPCT  / 1800) * 100));
  const iperScore = Math.max(0, Math.min(100, 100 - (avgIPER)         * 100));
  return Math.round(qfdScore * 0.45 + iperScore * 0.35 + pctScore * 0.20);
}

function scoreToBand(score: number): HubRow['band'] {
  if (score >= 75) return 'high';
  if (score >= 50) return 'at_risk';
  if (score >= 25) return 'intervention';
  return 'critical';
}

function diagnose(qfdTrend: string, iperTrend: string): { label: string; tag: string } {
  if (qfdTrend === 'improving' && iperTrend === 'improving')
    return { label: 'Resolution Working',  tag: '✅ QFD↓ + iPER↓ — knowledge gap closing' };
  if (qfdTrend === 'improving' && iperTrend !== 'improving')
    return { label: 'Execution Gap',       tag: '⚡ QFD↓ but iPER flat — doubts clearing but errors persist' };
  if (qfdTrend !== 'improving' && iperTrend === 'worsening')
    return { label: 'Content Gap',         tag: '📚 QFD flat + iPER↑ — SOPs/sims not resolving issues' };
  return   { label: 'Adoption Problem',   tag: '⚠️ QFD flat + iPER flat — tool not being used' };
}

function calcTrend(sorted: HubSession[], field: 'pause_count' | 'error_count'): 'improving' | 'worsening' | 'stable' {
  if (sorted.length < 4) return 'stable';
  const half  = Math.floor(sorted.length / 2);
  const early = sorted.slice(0, half);
  const late  = sorted.slice(half);
  const avg   = (arr: HubSession[]) => arr.reduce((s, x) => s + (x[field] || 0), 0) / arr.length;
  const ratio = avg(late) / (avg(early) || 1);
  if (ratio < 0.85) return 'improving';
  if (ratio > 1.10) return 'worsening';
  return 'stable';
}

// ── Band UI helpers ───────────────────────────────────────────────────────────

const BAND_CONFIG = {
  high:         { label: 'High Performing', color: '#22c55e', bg: '#f0fdf4', Icon: CheckCircle },
  at_risk:      { label: 'At Risk',         color: '#f59e0b', bg: '#fffbeb', Icon: AlertTriangle },
  intervention: { label: 'Needs Intervention', color: '#ef4444', bg: '#fef2f2', Icon: AlertCircle },
  critical:     { label: 'Critical',        color: '#7f1d1d', bg: '#fef2f2', Icon: XCircle },
};

function fmtPCT(s: number) {
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function HubsPage() {
  const [sessions,  setSessions]  = useState<HubSession[]>([]);
  const [profiles,  setProfiles]  = useState<HubProfile[]>([]);
  const [hubMeta,   setHubMeta]   = useState<Record<string, string>>({});  // hub_code → hub_name
  const [loading,   setLoading]   = useState(true);
  const [expanded,  setExpanded]  = useState<string | null>(null);
  const [sortField, setSortField] = useState<'score' | 'sessions' | 'avgQFD' | 'avgIPER'>('score');
  const [sortAsc,   setSortAsc]   = useState(false);
  const [bandFilter,setBandFilter]= useState<string>('all');

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    Promise.all([
      supabase
        .from('captain_sessions')
        .select('hub_code,email,process_name,pct,pause_count,error_count,completed_at')
        .not('hub_code', 'is', null)
        .gte('completed_at', thirtyDaysAgo)
        .order('completed_at', { ascending: true }),
      supabase
        .from('agent_profiles')
        .select('hub_code,hub,email')
        .eq('role', 'Captain')
        .not('hub_code', 'is', null),
      supabase
        .from('hubs')
        .select('hub_code,hub_name')
        .eq('active', true),
    ]).then(([sessRes, profRes, hubRes]) => {
      setSessions((sessRes.data || []) as HubSession[]);
      setProfiles((profRes.data || []) as HubProfile[]);
      const meta: Record<string, string> = {};
      (hubRes.data || []).forEach((h: any) => { meta[h.hub_code] = h.hub_name; });
      setHubMeta(meta);
      setLoading(false);
    });
  }, []);

  // ── Compute hub rows ──────────────────────────────────────────────────────

  const hubRows = useMemo<HubRow[]>(() => {
    // Group sessions by hub_code
    const byHub: Record<string, HubSession[]> = {};
    sessions.forEach(s => {
      if (!s.hub_code) return;
      if (!byHub[s.hub_code]) byHub[s.hub_code] = [];
      byHub[s.hub_code].push(s);
    });

    // Count captains per hub from profiles
    const captainsByHub: Record<string, Set<string>> = {};
    profiles.forEach(p => {
      if (!p.hub_code) return;
      if (!captainsByHub[p.hub_code]) captainsByHub[p.hub_code] = new Set();
      captainsByHub[p.hub_code].add(p.email);
    });

    return Object.entries(byHub).map(([hub_code, rows]) => {
      const n       = rows.length;
      const avgQFD  = rows.reduce((s, x) => s + (x.pause_count || 0), 0) / n;
      const avgPCT  = rows.reduce((s, x) => s + (x.pct || 0), 0) / n;
      const avgIPER = rows.reduce((s, x) => s + (x.error_count || 0), 0) / n;

      const sorted   = [...rows].sort((a, b) => new Date(a.completed_at).getTime() - new Date(b.completed_at).getTime());
      const qfdTrend = calcTrend(sorted, 'pause_count');
      const iperTrend= calcTrend(sorted, 'error_count');

      const score = computeScore(avgQFD, avgPCT, avgIPER);
      const band  = scoreToBand(score);
      const dx    = diagnose(qfdTrend, iperTrend);

      // Per-process breakdown for this hub
      const byProc: Record<string, { sessions: number; pct: number; pauses: number; errors: number }> = {};
      rows.forEach(s => {
        const p = s.process_name || 'Unknown';
        if (!byProc[p]) byProc[p] = { sessions: 0, pct: 0, pauses: 0, errors: 0 };
        byProc[p].sessions++;
        byProc[p].pct    += s.pct          || 0;
        byProc[p].pauses += s.pause_count  || 0;
        byProc[p].errors += s.error_count  || 0;
      });
      const processes: ProcessRow[] = Object.entries(byProc)
        .map(([process_name, d]) => ({
          process_name,
          sessions: d.sessions,
          avgQFD:   +(d.pauses / d.sessions).toFixed(2),
          avgPCT:   Math.round(d.pct / d.sessions),
          avgIPER:  +(d.errors / d.sessions).toFixed(3),
        }))
        .sort((a, b) => b.avgQFD - a.avgQFD); // worst QFD first

      return {
        hub_code,
        hub_name:    hubMeta[hub_code] || hub_code,
        sessions:    n,
        captains:    captainsByHub[hub_code]?.size || 0,
        avgQFD:      +avgQFD.toFixed(2),
        avgPCT:      Math.round(avgPCT),
        avgIPER:     +avgIPER.toFixed(3),
        score,
        band,
        diagnosis:   dx.label,
        diagnosisTag:dx.tag,
        processes,
        qfdTrend,
        iperTrend,
      };
    });
  }, [sessions, profiles, hubMeta]);

  // ── Sort + filter ─────────────────────────────────────────────────────────

  const displayed = useMemo(() => {
    let rows = bandFilter === 'all' ? hubRows : hubRows.filter(h => h.band === bandFilter);
    rows = [...rows].sort((a, b) => {
      const diff = (a[sortField] as number) - (b[sortField] as number);
      return sortAsc ? diff : -diff;
    });
    return rows;
  }, [hubRows, bandFilter, sortField, sortAsc]);

  const counts = useMemo(() => ({
    all:          hubRows.length,
    critical:     hubRows.filter(h => h.band === 'critical').length,
    intervention: hubRows.filter(h => h.band === 'intervention').length,
    at_risk:      hubRows.filter(h => h.band === 'at_risk').length,
    high:         hubRows.filter(h => h.band === 'high').length,
  }), [hubRows]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  function toggleSort(field: typeof sortField) {
    if (sortField === field) setSortAsc(a => !a);
    else { setSortField(field); setSortAsc(false); }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return (
    <AdminLayout title="Hub Intelligence">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: '#888', gap: 12 }}>
        <Building2 size={20} /> Loading hub data…
      </div>
    </AdminLayout>
  );

  return (
    <AdminLayout title="Hub Intelligence">

      {/* Summary band pills */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
        {(['all', 'critical', 'intervention', 'at_risk', 'high'] as const).map(band => {
          const cfg   = band === 'all' ? { label: `All (${counts.all})`, color: '#9747FF', bg: '#f5f3ff' } : { ...BAND_CONFIG[band], label: `${BAND_CONFIG[band].label} (${counts[band]})` };
          const active= bandFilter === band;
          return (
            <button key={band} onClick={() => setBandFilter(band)} style={{
              padding: '6px 14px', borderRadius: 20, border: `1.5px solid ${active ? cfg.color : '#e5e7eb'}`,
              background: active ? cfg.bg : '#fff', color: active ? cfg.color : '#666',
              fontWeight: active ? 700 : 500, fontSize: 12, cursor: 'pointer', transition: 'all 0.15s'
            }}>
              {cfg.label}
            </button>
          );
        })}
        <div style={{ marginLeft: 'auto', fontSize: 11, color: '#aaa', alignSelf: 'center' }}>
          Last 30 days · Score = QFD×45% + iPER×35% + PCT×20%
        </div>
      </div>

      {displayed.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#bbb', fontSize: 14 }}>
          No hubs with session data yet.<br />
          <span style={{ fontSize: 12, marginTop: 8, display: 'block' }}>Hub data appears once captains complete sessions with a validated hub code.</span>
        </div>
      ) : (
        <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>

          {/* Table header */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1.5fr 1fr', gap: 0, padding: '12px 20px', background: '#f8f9fa', borderBottom: '1px solid #e8eaed', fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: 0.5, textTransform: 'uppercase' }}>
            <div>Hub</div>
            {(['score','sessions','avgQFD','avgIPER'] as const).map(f => (
              <div key={f} onClick={() => toggleSort(f)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                {f === 'score' ? 'Score' : f === 'sessions' ? 'Sessions' : f === 'avgQFD' ? 'QFD' : 'iPER'}
                {sortField === f ? (sortAsc ? <ChevronUp size={11}/> : <ChevronDown size={11}/>) : null}
              </div>
            ))}
            <div>Avg PCT</div>
            <div>Diagnosis</div>
            <div />
          </div>

          {/* Rows */}
          {displayed.map(hub => {
            const cfg      = BAND_CONFIG[hub.band];
            const isOpen   = expanded === hub.hub_code;
            return (
              <div key={hub.hub_code} style={{ borderBottom: '1px solid #f0f0f5' }}>

                {/* Main row */}
                <div
                  onClick={() => setExpanded(isOpen ? null : hub.hub_code)}
                  style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1.5fr 1fr', gap: 0, padding: '14px 20px', cursor: 'pointer', alignItems: 'center', transition: 'background 0.1s' }}
                  onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = '#fafafa'}
                  onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = ''}
                >
                  {/* Hub name + band */}
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a2e' }}>{hub.hub_name}</div>
                    <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{hub.hub_code} · {hub.captains} captains</div>
                  </div>

                  {/* Score */}
                  <div>
                    <span style={{
                      display: 'inline-block', padding: '3px 10px', borderRadius: 20,
                      background: cfg.bg, color: cfg.color,
                      fontSize: 13, fontWeight: 800
                    }}>{hub.score}</span>
                    <div style={{ fontSize: 10, color: cfg.color, marginTop: 3, fontWeight: 600 }}>{cfg.label}</div>
                  </div>

                  {/* Sessions */}
                  <div style={{ fontSize: 13, color: '#444' }}>{hub.sessions}</div>

                  {/* QFD */}
                  <div style={{ fontSize: 13, fontWeight: 700, color: hub.avgQFD <= 1 ? '#22c55e' : hub.avgQFD <= 3 ? '#f59e0b' : '#ef4444' }}>
                    {hub.avgQFD.toFixed(1)}
                    <span style={{ fontSize: 10, marginLeft: 4, color: hub.qfdTrend === 'improving' ? '#22c55e' : hub.qfdTrend === 'worsening' ? '#ef4444' : '#aaa' }}>
                      {hub.qfdTrend === 'improving' ? '↓' : hub.qfdTrend === 'worsening' ? '↑' : '→'}
                    </span>
                  </div>

                  {/* iPER */}
                  <div style={{ fontSize: 13, fontWeight: 700, color: hub.avgIPER < 0.2 ? '#22c55e' : hub.avgIPER < 0.5 ? '#f59e0b' : '#ef4444' }}>
                    {hub.avgIPER.toFixed(2)}
                    <span style={{ fontSize: 10, marginLeft: 4, color: hub.iperTrend === 'improving' ? '#22c55e' : hub.iperTrend === 'worsening' ? '#ef4444' : '#aaa' }}>
                      {hub.iperTrend === 'improving' ? '↓' : hub.iperTrend === 'worsening' ? '↑' : '→'}
                    </span>
                  </div>

                  {/* PCT */}
                  <div style={{ fontSize: 13, color: '#444' }}>{fmtPCT(hub.avgPCT)}</div>

                  {/* Diagnosis */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: cfg.color }}>{hub.diagnosis}</span>
                    {isOpen ? <ChevronUp size={13} color="#aaa" /> : <ChevronDown size={13} color="#aaa" />}
                  </div>
                </div>

                {/* Expanded process breakdown */}
                {isOpen && (
                  <div style={{ padding: '0 20px 20px 20px', background: '#fafafa' }}>

                    {/* Diagnosis detail */}
                    <div style={{ padding: '10px 14px', borderRadius: 8, background: cfg.bg, border: `1px solid ${cfg.color}22`, marginBottom: 14, fontSize: 12, color: cfg.color, fontWeight: 500 }}>
                      {hub.diagnosisTag}
                    </div>

                    {/* Process table */}
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#888', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Process Breakdown — sorted by QFD (worst first)
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: '#f0f0f5', textAlign: 'left' }}>
                          {['Process', 'Sessions', 'Avg QFD', 'Avg PCT', 'Avg iPER'].map(h => (
                            <th key={h} style={{ padding: '7px 12px', fontWeight: 700, color: '#666', fontSize: 11 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {hub.processes.map(p => (
                          <tr key={p.process_name} style={{ borderBottom: '1px solid #e8eaed' }}>
                            <td style={{ padding: '8px 12px', fontWeight: 600, color: '#1a1a2e' }}>{p.process_name}</td>
                            <td style={{ padding: '8px 12px', color: '#555' }}>{p.sessions}</td>
                            <td style={{ padding: '8px 12px', fontWeight: 700, color: p.avgQFD <= 1 ? '#22c55e' : p.avgQFD <= 3 ? '#f59e0b' : '#ef4444' }}>
                              {p.avgQFD.toFixed(1)}
                            </td>
                            <td style={{ padding: '8px 12px', color: '#555' }}>{fmtPCT(p.avgPCT)}</td>
                            <td style={{ padding: '8px 12px', fontWeight: 700, color: p.avgIPER < 0.2 ? '#22c55e' : p.avgIPER < 0.5 ? '#f59e0b' : '#ef4444' }}>
                              {p.avgIPER.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </AdminLayout>
  );
}
