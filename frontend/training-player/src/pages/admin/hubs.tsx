import { useEffect, useState, useMemo, useCallback } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { supabase } from '@/lib/supabase';
import {
  AlertTriangle, CheckCircle, AlertCircle, XCircle,
  ChevronDown, ChevronUp, Building2, Search, Send, X
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface HubSession {
  hub_code:     string;
  email:        string;
  process_name: string;
  session_id:   string;
  pct:          number;
  pause_count:  number;
  error_count:  number;
  completed_at: string;
}

interface PauseRow {
  session_id: string;
  bucket:     string | null;
}

interface HubProfile {
  hub_code: string | null;
  email:    string;
}

interface HubRow {
  hub_code:     string;
  hub_name:     string;
  sessions:     number;
  captains:     number;
  avgQFD:       number;
  avgPCT:       number;
  avgIPER:      number;   // bucket-weighted error signal (0–1)
  score:        number;
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

interface SimOption {
  id:    string;
  title: string;
}

// ── iPER bucket weights ───────────────────────────────────────────────────────
//
// iPER is an inferred error signal derived from why captains paused.
// Groq classifies each pause reason into a bucket (stored in captain_pauses.bucket).
// Higher weight = stronger error signal.
//
// REPETITIVE      1.0 — same issue recurs → not learning
// PROCESS_GAP     0.8 — SOP/sim didn't cover the step
// POLICY_UNCLEAR  0.4 — ambiguous rule, not a hard error
// UNCLASSIFIED    0.2 — unknown, moderate concern
// CUSTOMER_COMPLEXITY 0.1 — external complexity, not a training failure
// SYSTEM_ISSUE    0.0 — tool/system broke, not captain's fault
//
// iPER per hub/process = avg(bucket_weight) across all classified pauses
// iPER = 0 → no error signal · iPER = 1 → all pauses are repetitive errors

const BUCKET_WEIGHT: Record<string, number> = {
  REPETITIVE:          1.0,
  PROCESS_GAP:         0.8,
  POLICY_UNCLEAR:      0.4,
  UNCLASSIFIED:        0.2,
  CUSTOMER_COMPLEXITY: 0.1,
  SYSTEM_ISSUE:        0.0,
};

// ── Score formula ─────────────────────────────────────────────────────────────
//
// Each metric normalised 0–100 (higher = better):
//   QFD  = clamp(100 − avgQFD/5 × 100,  0, 100)   0 pauses → 100, 5+ → 0
//   PCT  = clamp(100 − avgPCT/1800 × 100, 0, 100)  0s → 100, 30m → 0
//   iPER = clamp(100 − avgIPER × 100,    0, 100)   0 signal → 100, max → 0
//
// Composite = QFD×45% + iPER×35% + PCT×20%

function computeScore(avgQFD: number, avgPCT: number, avgIPER: number) {
  const q = Math.max(0, Math.min(100, 100 - (avgQFD  / 5)    * 100));
  const p = Math.max(0, Math.min(100, 100 - (avgPCT  / 1800) * 100));
  const i = Math.max(0, Math.min(100, 100 - avgIPER           * 100));
  return Math.round(q * 0.45 + i * 0.35 + p * 0.20);
}

function scoreToBand(score: number): HubRow['band'] {
  if (score >= 75) return 'high';
  if (score >= 50) return 'at_risk';
  if (score >= 25) return 'intervention';
  return 'critical';
}

function diagnose(qfdTrend: string, iperTrend: string) {
  if (qfdTrend === 'improving' && iperTrend === 'improving')
    return { label: 'Resolution Working',  tag: '✅ QFD↓ + iPER↓ — knowledge gap closing'            };
  if (qfdTrend === 'improving' && iperTrend !== 'improving')
    return { label: 'Execution Gap',       tag: '⚡ QFD↓ but iPER flat — doubts clearing, errors persist' };
  if (qfdTrend !== 'improving' && iperTrend === 'worsening')
    return { label: 'Content Gap',         tag: '📚 QFD flat + iPER↑ — SOPs/sims not resolving issues' };
  return   { label: 'Adoption Problem',   tag: '⚠️ QFD flat + iPER flat — tool not being used'       };
}

function calcTrend(
  sorted: { pause_count: number; error_count: number; iper: number }[],
  field: 'pause_count' | 'iper'
): 'improving' | 'worsening' | 'stable' {
  if (sorted.length < 4) return 'stable';
  const half  = Math.floor(sorted.length / 2);
  const early = sorted.slice(0, half);
  const late  = sorted.slice(half);
  const avg   = (arr: typeof sorted) => arr.reduce((s, x) => s + x[field], 0) / arr.length;
  const ratio = avg(late) / (avg(early) || 1);
  if (ratio < 0.85) return 'improving';
  if (ratio > 1.10) return 'worsening';
  return 'stable';
}

// ── UI config ─────────────────────────────────────────────────────────────────

const BAND_CONFIG = {
  high:         { label: 'High Performing',    color: '#22c55e', bg: '#f0fdf4', Icon: CheckCircle  },
  at_risk:      { label: 'At Risk',            color: '#f59e0b', bg: '#fffbeb', Icon: AlertTriangle },
  intervention: { label: 'Needs Intervention', color: '#ef4444', bg: '#fef2f2', Icon: AlertCircle  },
  critical:     { label: 'Critical',           color: '#7f1d1d', bg: '#fee2e2', Icon: XCircle      },
};

function fmtPCT(s: number) {
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function HubsPage() {
  // Core data
  const [sessions,  setSessions]  = useState<HubSession[]>([]);
  const [pauses,    setPauses]    = useState<PauseRow[]>([]);
  const [profiles,  setProfiles]  = useState<HubProfile[]>([]);
  const [hubMeta,   setHubMeta]   = useState<Record<string, string>>({});
  const [loading,   setLoading]   = useState(true);

  // Table UI
  const [hubSearch,   setHubSearch]   = useState('');
  const [bandFilter,  setBandFilter]  = useState<string>('all');
  const [sortField,   setSortField]   = useState<'score' | 'sessions' | 'avgQFD' | 'avgIPER'>('score');
  const [sortAsc,     setSortAsc]     = useState(false);
  const [expanded,    setExpanded]    = useState<string | null>(null);

  // Enforcement panel (inline, shown inside expanded hub row)
  const [enforceHub,    setEnforceHub]    = useState<HubRow | null>(null);
  const [procSearch,    setProcSearch]    = useState('');
  const [simCache,      setSimCache]      = useState<Record<string, SimOption[]>>({});
  const [simsLoading,   setSimsLoading]   = useState(false);
  const [selectedSims,  setSelectedSims]  = useState<Record<string, string[]>>({});  // process → sim ids
  const [isMandatory,   setIsMandatory]   = useState(false);
  const [dueDate,       setDueDate]       = useState('');
  const [pushing,       setPushing]       = useState(false);
  const [pushed,        setPushed]        = useState(false);
  const [adminEmail,    setAdminEmail]    = useState('');

  // ── Load all data ──────────────────────────────────────────────────────────

  useEffect(() => {
    const ago = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    Promise.all([
      supabase
        .from('captain_sessions')
        .select('hub_code,email,process_name,session_id,pct,pause_count,error_count,completed_at')
        .not('hub_code', 'is', null)
        .gte('completed_at', ago)
        .order('completed_at', { ascending: true }),
      supabase
        .from('captain_pauses')
        .select('session_id,bucket')
        .not('bucket', 'is', null),
      supabase
        .from('agent_profiles')
        .select('hub_code,email')
        .eq('role', 'Captain')
        .not('hub_code', 'is', null),
      supabase
        .from('hubs')
        .select('hub_code,hub_name')
        .eq('active', true),
    ]).then(([sessRes, pauseRes, profRes, hubRes]) => {
      setSessions((sessRes.data  || []) as HubSession[]);
      setPauses  ((pauseRes.data || []) as PauseRow[]);
      setProfiles((profRes.data  || []) as HubProfile[]);
      const meta: Record<string, string> = {};
      (hubRes.data || []).forEach((h: any) => { meta[h.hub_code] = h.hub_name; });
      setHubMeta(meta);
      setLoading(false);
    });

    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email) setAdminEmail(data.user.email);
    });
  }, []);

  // ── iPER per session (bucket-weighted avg) ────────────────────────────────
  // Maps session_id → avg bucket weight (or null if no classified pauses)

  const iperBySession = useMemo(() => {
    const grouped: Record<string, number[]> = {};
    pauses.forEach(p => {
      if (!p.bucket) return;
      const w = BUCKET_WEIGHT[p.bucket] ?? 0.2;
      if (!grouped[p.session_id]) grouped[p.session_id] = [];
      grouped[p.session_id].push(w);
    });
    const result: Record<string, number> = {};
    Object.entries(grouped).forEach(([sid, weights]) => {
      result[sid] = weights.reduce((s, w) => s + w, 0) / weights.length;
    });
    return result;
  }, [pauses]);

  // ── Compute hub rows ──────────────────────────────────────────────────────

  const hubRows = useMemo<HubRow[]>(() => {
    const byHub: Record<string, HubSession[]> = {};
    sessions.forEach(s => {
      if (!s.hub_code) return;
      if (!byHub[s.hub_code]) byHub[s.hub_code] = [];
      byHub[s.hub_code].push(s);
    });

    const captainsByHub: Record<string, Set<string>> = {};
    profiles.forEach(p => {
      if (!p.hub_code) return;
      if (!captainsByHub[p.hub_code]) captainsByHub[p.hub_code] = new Set();
      captainsByHub[p.hub_code].add(p.email);
    });

    return Object.entries(byHub).map(([hub_code, rows]) => {
      const n      = rows.length;
      const avgQFD = rows.reduce((s, x) => s + (x.pause_count || 0), 0) / n;
      const avgPCT = rows.reduce((s, x) => s + (x.pct        || 0), 0) / n;

      // iPER: avg bucket weight across sessions with classified pauses
      const iperRows = rows.filter(s => iperBySession[s.session_id] != null);
      const avgIPER  = iperRows.length > 0
        ? iperRows.reduce((s, x) => s + iperBySession[x.session_id], 0) / iperRows.length
        : 0;

      // Trend: sort by time (oldest first)
      const sorted = [...rows]
        .sort((a, b) => new Date(a.completed_at).getTime() - new Date(b.completed_at).getTime())
        .map(s => ({
          pause_count: s.pause_count || 0,
          error_count: s.error_count || 0,
          iper:        iperBySession[s.session_id] ?? 0,
        }));

      const qfdTrend  = calcTrend(sorted, 'pause_count');
      const iperTrend = calcTrend(sorted, 'iper');

      const score = computeScore(avgQFD, avgPCT, avgIPER);
      const band  = scoreToBand(score);
      const dx    = diagnose(qfdTrend, iperTrend);

      // Per-process breakdown
      const byProc: Record<string, { sessions: number; pct: number; pauses: number; iperSum: number; iperN: number }> = {};
      rows.forEach(s => {
        const pn = s.process_name || 'Unknown';
        if (!byProc[pn]) byProc[pn] = { sessions: 0, pct: 0, pauses: 0, iperSum: 0, iperN: 0 };
        byProc[pn].sessions++;
        byProc[pn].pct    += s.pct         || 0;
        byProc[pn].pauses += s.pause_count || 0;
        if (iperBySession[s.session_id] != null) {
          byProc[pn].iperSum += iperBySession[s.session_id];
          byProc[pn].iperN   += 1;
        }
      });

      const processes: ProcessRow[] = Object.entries(byProc)
        .map(([process_name, d]) => ({
          process_name,
          sessions: d.sessions,
          avgQFD:   +(d.pauses / d.sessions).toFixed(2),
          avgPCT:   Math.round(d.pct / d.sessions),
          avgIPER:  d.iperN > 0 ? +(d.iperSum / d.iperN).toFixed(3) : 0,
        }))
        .sort((a, b) => b.avgQFD - a.avgQFD);

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
  }, [sessions, profiles, hubMeta, iperBySession]);

  // ── Filter + sort ─────────────────────────────────────────────────────────

  const displayed = useMemo(() => {
    const q = hubSearch.toLowerCase();
    let rows = hubRows.filter(h => {
      const matchBand = bandFilter === 'all' || h.band === bandFilter;
      const matchText = !q || h.hub_code.toLowerCase().includes(q) || h.hub_name.toLowerCase().includes(q);
      return matchBand && matchText;
    });
    return [...rows].sort((a, b) => {
      const diff = (a[sortField] as number) - (b[sortField] as number);
      return sortAsc ? diff : -diff;
    });
  }, [hubRows, hubSearch, bandFilter, sortField, sortAsc]);

  function toggleSort(field: typeof sortField) {
    if (sortField === field) setSortAsc(a => !a);
    else { setSortField(field); setSortAsc(false); }
  }

  // ── Enforcement helpers ───────────────────────────────────────────────────

  const openEnforce = useCallback(async (hub: HubRow) => {
    setEnforceHub(hub);
    setProcSearch('');
    setSelectedSims({});
    setPushed(false);

    // Lazy-load sims for all processes in this hub
    const processNames = hub.processes.map(p => p.process_name);
    if (processNames.length === 0) return;

    setSimsLoading(true);
    const { data } = await supabase
      .from('simulations')
      .select('id,title,process_name')
      .in('process_name', processNames);

    const cache: Record<string, SimOption[]> = {};
    (data || []).forEach((s: any) => {
      if (!cache[s.process_name]) cache[s.process_name] = [];
      cache[s.process_name].push({ id: s.id, title: s.title });
    });
    setSimCache(cache);
    setSimsLoading(false);
  }, []);

  function toggleSim(processName: string, simId: string) {
    setSelectedSims(prev => {
      const cur = prev[processName] || [];
      return {
        ...prev,
        [processName]: cur.includes(simId) ? cur.filter(id => id !== simId) : [...cur, simId],
      };
    });
  }

  const totalSelected = useMemo(
    () => Object.values(selectedSims).reduce((n, arr) => n + arr.length, 0),
    [selectedSims]
  );

  async function pushAssignments() {
    if (!enforceHub || totalSelected === 0) return;
    setPushing(true);

    const rows: object[] = [];
    Object.entries(selectedSims).forEach(([, simIds]) => {
      simIds.forEach(simId => {
        rows.push({
          sim_id:      simId,
          assigned_to: enforceHub.hub_code,
          assign_type: 'hub',
          hub_code:    enforceHub.hub_code,
          is_mandatory: isMandatory,
          due_date:    dueDate || null,
          assigned_by: adminEmail,
        });
      });
    });

    const { error } = await supabase.from('sim_assignments').insert(rows);
    setPushing(false);
    if (!error) {
      setPushed(true);
      setSelectedSims({});
    } else {
      alert('Push failed: ' + error.message);
    }
  }

  // ── Rendered enforcement panel ────────────────────────────────────────────

  function EnforcePanel() {
    if (!enforceHub) return null;

    const procs = enforceHub.processes.filter(p =>
      !procSearch || p.process_name.toLowerCase().includes(procSearch.toLowerCase())
    );

    return (
      <div style={{ padding: '0 20px 24px 20px', background: '#f8f6ff', borderTop: '2px solid #9747FF22' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0 10px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#9747FF' }}>
            Enforcement — {enforceHub.hub_name}
          </div>
          <button
            onClick={() => setEnforceHub(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', display: 'flex', alignItems: 'center' }}
          >
            <X size={14} /> <span style={{ fontSize: 11, marginLeft: 4 }}>Close</span>
          </button>
        </div>

        {/* Push controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 14, background: '#fff', borderRadius: 8, padding: '10px 14px', border: '1px solid #e8eaed' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={isMandatory} onChange={e => setIsMandatory(e.target.checked)} style={{ width: 14, height: 14 }} />
            Mandatory
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            Due date
            <input
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              style={{ padding: '4px 10px', border: '1px solid #e8eaed', borderRadius: 6, fontSize: 13, outline: 'none' }}
            />
          </label>
          <div style={{ flex: 1 }} />
          {pushed && <span style={{ fontSize: 13, color: '#22c55e', fontWeight: 600 }}>✓ Pushed</span>}
          <button
            onClick={pushAssignments}
            disabled={totalSelected === 0 || pushing}
            style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '7px 16px',
              borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600, cursor: totalSelected === 0 ? 'not-allowed' : 'pointer',
              background: totalSelected === 0 ? '#e5e7eb' : 'linear-gradient(135deg,#F43397,#9747FF)',
              color: totalSelected === 0 ? '#9ca3af' : '#fff',
              opacity: pushing ? 0.7 : 1,
            }}
          >
            <Send size={13} />
            {pushing ? 'Pushing…' : `Push ${totalSelected > 0 ? totalSelected + ' sim' + (totalSelected !== 1 ? 's' : '') : 'sims'}`}
          </button>
        </div>

        {/* Process search */}
        <div style={{ position: 'relative', marginBottom: 10 }}>
          <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
          <input
            type="text"
            placeholder="Search processes…"
            value={procSearch}
            onChange={e => setProcSearch(e.target.value)}
            style={{ width: '100%', padding: '7px 10px 7px 30px', border: '1px solid #e8eaed', borderRadius: 8, fontSize: 13, outline: 'none', background: '#fff', boxSizing: 'border-box' }}
          />
        </div>

        {/* Process list */}
        {simsLoading ? (
          <div style={{ fontSize: 13, color: '#9ca3af', padding: '12px 0' }}>Loading simulations…</div>
        ) : procs.length === 0 ? (
          <div style={{ fontSize: 13, color: '#9ca3af', fontStyle: 'italic' }}>No processes match search</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {procs.map((proc, i) => {
              const sims = simCache[proc.process_name] || [];
              const chosen = selectedSims[proc.process_name] || [];
              const qfdColor = proc.avgQFD >= 3 ? '#ef4444' : proc.avgQFD >= 1.5 ? '#f59e0b' : '#22c55e';
              return (
                <div key={proc.process_name} style={{ background: '#fff', borderRadius: 8, border: '1px solid #e8eaed', overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px' }}>
                    <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#6b7280', flexShrink: 0 }}>{i + 1}</span>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#1a1a2e' }}>{proc.process_name}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: qfdColor }}>{proc.avgQFD.toFixed(1)} QFD</span>
                    <span style={{ fontSize: 12, color: '#6b7280' }}>{proc.avgPCT ? fmtPCT(proc.avgPCT) : '—'} PCT</span>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: sims.length ? '#ede9fe' : '#f3f4f6', color: sims.length ? '#7c3aed' : '#9ca3af', fontWeight: 600 }}>
                      {sims.length ? `${sims.length} sim${sims.length !== 1 ? 's' : ''}` : 'no sims'}
                    </span>
                    {chosen.length > 0 && (
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#f0fdf4', color: '#16a34a', fontWeight: 700 }}>{chosen.length} ✓</span>
                    )}
                  </div>
                  {sims.length > 0 && (
                    <div style={{ padding: '0 14px 10px 46px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {sims.map(sim => {
                        const checked = chosen.includes(sim.id);
                        return (
                          <label key={sim.id} style={{
                            display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                            padding: '5px 10px', borderRadius: 6, fontSize: 12,
                            background: checked ? '#f5f3ff' : '#f9fafb',
                            border: `1px solid ${checked ? '#c4b5fd' : '#e8eaed'}`,
                            color: checked ? '#7c3aed' : '#374151', fontWeight: checked ? 600 : 400,
                          }}>
                            <input type="checkbox" checked={checked} onChange={() => toggleSim(proc.process_name, sim.id)} style={{ width: 13, height: 13 }} />
                            {sim.title}
                          </label>
                        );
                      })}
                    </div>
                  )}
                  {sims.length === 0 && (
                    <div style={{ padding: '0 14px 10px 46px', fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>
                      No sims for this process — create one in Content first.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
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

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center' }}>
        {/* Hub search */}
        <div style={{ position: 'relative', flex: '0 0 280px' }}>
          <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
          <input
            type="text"
            placeholder="Search hub name or code…"
            value={hubSearch}
            onChange={e => setHubSearch(e.target.value)}
            style={{ width: '100%', padding: '8px 10px 8px 30px', border: '1px solid #e8eaed', borderRadius: 8, fontSize: 13, outline: 'none', background: '#fff', boxSizing: 'border-box' }}
          />
        </div>

        {/* Band dropdown */}
        <select
          value={bandFilter}
          onChange={e => setBandFilter(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid #e8eaed', borderRadius: 8, fontSize: 13, background: '#fff', color: '#374151', outline: 'none', cursor: 'pointer' }}
        >
          <option value="all">All bands ({hubRows.length})</option>
          <option value="critical">Critical ({hubRows.filter(h => h.band === 'critical').length})</option>
          <option value="intervention">Needs Intervention ({hubRows.filter(h => h.band === 'intervention').length})</option>
          <option value="at_risk">At Risk ({hubRows.filter(h => h.band === 'at_risk').length})</option>
          <option value="high">High Performing ({hubRows.filter(h => h.band === 'high').length})</option>
        </select>

        <div style={{ marginLeft: 'auto', fontSize: 11, color: '#aaa' }}>
          Last 30 days · Score = QFD×45% + iPER×35% + PCT×20% · iPER from pause bucket weights
        </div>
      </div>

      {displayed.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#bbb', fontSize: 14 }}>
          No hubs match your filters.<br />
          <span style={{ fontSize: 12, marginTop: 8, display: 'block' }}>Hub data appears once captains complete sessions with a validated hub code.</span>
        </div>
      ) : (
        <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>

          {/* Table header */}
          <div style={{
            display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1.6fr 120px',
            padding: '11px 20px', background: '#f8f9fa', borderBottom: '1px solid #e8eaed',
            fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: 0.5, textTransform: 'uppercase'
          }}>
            <div>Hub</div>
            {(['score', 'sessions', 'avgQFD', 'avgIPER'] as const).map(f => (
              <div key={f} onClick={() => toggleSort(f)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}>
                {f === 'score' ? 'Score' : f === 'sessions' ? 'Sessions' : f === 'avgQFD' ? 'QFD ↕' : 'iPER ↕'}
                {sortField === f ? (sortAsc ? <ChevronUp size={10}/> : <ChevronDown size={10}/>) : null}
              </div>
            ))}
            <div>Avg PCT</div>
            <div>Diagnosis</div>
            <div />
          </div>

          {/* Rows */}
          {displayed.map(hub => {
            const cfg    = BAND_CONFIG[hub.band];
            const isOpen = expanded === hub.hub_code;
            const isEnforcing = enforceHub?.hub_code === hub.hub_code;

            return (
              <div key={hub.hub_code} style={{ borderBottom: '1px solid #f0f0f5' }}>

                {/* Main row */}
                <div
                  onClick={() => setExpanded(isOpen ? null : hub.hub_code)}
                  style={{
                    display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1.6fr 120px',
                    padding: '13px 20px', cursor: 'pointer', alignItems: 'center',
                    background: isOpen ? '#fafafa' : 'transparent',
                  }}
                  onMouseEnter={e => { if (!isOpen) (e.currentTarget as HTMLDivElement).style.background = '#fafafa'; }}
                  onMouseLeave={e => { if (!isOpen) (e.currentTarget as HTMLDivElement).style.background = ''; }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a2e' }}>{hub.hub_name}</div>
                    <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{hub.hub_code} · {hub.captains} captains</div>
                  </div>

                  <div>
                    <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, background: cfg.bg, color: cfg.color, fontSize: 13, fontWeight: 800 }}>
                      {hub.score}
                    </span>
                    <div style={{ fontSize: 10, color: cfg.color, marginTop: 3, fontWeight: 600 }}>{cfg.label}</div>
                  </div>

                  <div style={{ fontSize: 13, color: '#444' }}>{hub.sessions}</div>

                  <div style={{ fontSize: 13, fontWeight: 700, color: hub.avgQFD <= 1 ? '#22c55e' : hub.avgQFD <= 3 ? '#f59e0b' : '#ef4444' }}>
                    {hub.avgQFD.toFixed(1)}
                    <span style={{ fontSize: 10, marginLeft: 3, color: hub.qfdTrend === 'improving' ? '#22c55e' : hub.qfdTrend === 'worsening' ? '#ef4444' : '#aaa' }}>
                      {hub.qfdTrend === 'improving' ? '↓' : hub.qfdTrend === 'worsening' ? '↑' : '→'}
                    </span>
                  </div>

                  <div style={{ fontSize: 13, fontWeight: 700, color: hub.avgIPER < 0.2 ? '#22c55e' : hub.avgIPER < 0.5 ? '#f59e0b' : '#ef4444' }}>
                    {hub.avgIPER.toFixed(2)}
                    <span style={{ fontSize: 10, marginLeft: 3, color: hub.iperTrend === 'improving' ? '#22c55e' : hub.iperTrend === 'worsening' ? '#ef4444' : '#aaa' }}>
                      {hub.iperTrend === 'improving' ? '↓' : hub.iperTrend === 'worsening' ? '↑' : '→'}
                    </span>
                  </div>

                  <div style={{ fontSize: 13, color: '#444' }}>{fmtPCT(hub.avgPCT)}</div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: cfg.color }}>{hub.diagnosis}</span>
                    {isOpen ? <ChevronUp size={12} color="#aaa" /> : <ChevronDown size={12} color="#aaa" />}
                  </div>
                </div>

                {/* Expanded: process breakdown + enforce button */}
                {isOpen && (
                  <div style={{ background: '#fafafa' }}>
                    <div style={{ padding: '0 20px 16px 20px' }}>

                      {/* Diagnosis tag */}
                      <div style={{ padding: '9px 14px', borderRadius: 8, background: cfg.bg, border: `1px solid ${cfg.color}22`, marginBottom: 12, fontSize: 12, color: cfg.color, fontWeight: 500 }}>
                        {hub.diagnosisTag}
                      </div>

                      {/* Process breakdown table */}
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#888', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        Process Breakdown — sorted by QFD (worst first)
                      </div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 14 }}>
                        <thead>
                          <tr style={{ background: '#f0f0f5', textAlign: 'left' }}>
                            {['Process', 'Sessions', 'Avg QFD', 'Avg PCT', 'iPER'].map(h => (
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
                                {p.avgIPER > 0 ? p.avgIPER.toFixed(2) : <span style={{ color: '#ccc' }}>—</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      {/* Enforce button */}
                      <button
                        onClick={e => { e.stopPropagation(); isEnforcing ? setEnforceHub(null) : openEnforce(hub); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 7, padding: '7px 16px',
                          borderRadius: 8, border: `1.5px solid ${isEnforcing ? '#9747FF' : '#e8eaed'}`,
                          background: isEnforcing ? '#f5f3ff' : '#fff',
                          color: isEnforcing ? '#9747FF' : '#374151',
                          fontSize: 13, fontWeight: 600, cursor: 'pointer',
                        }}
                      >
                        <Send size={13} />
                        {isEnforcing ? 'Close enforcement ↑' : 'Enforce this hub →'}
                      </button>
                    </div>

                    {/* Enforcement panel (inline) */}
                    {isEnforcing && <EnforcePanel />}
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
