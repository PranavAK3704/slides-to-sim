import { useEffect, useState, useMemo } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { supabase } from '@/lib/supabase';
import {
  AlertTriangle, CheckCircle, AlertCircle, XCircle,
  Send, ChevronDown, ChevronUp, Search, BookOpen
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface HubOption {
  hub_code: string;
  hub_name: string;
  band:     'critical' | 'intervention' | 'at_risk' | 'high';
  score:    number;
}

interface WeakProcess {
  process_name: string;
  sessions:     number;
  avg_qfd:      number;
  avg_iper:     number;
  avg_pct_min:  number;
  captains_ran: number;
  sims:         SimOption[];       // matching sims for this process
  selectedSims: string[];          // sim ids chosen by trainer
}

interface SimOption {
  id:    string;
  title: string;
}

interface AssignmentRow {
  sim_id:      string;
  assigned_to: string;
  assign_type: 'hub';
  hub_code:    string;
  is_mandatory: boolean;
  due_date:    string | null;
  assigned_by: string;
  assigned_at: string;
}

// ── Score helpers (same as hubs.tsx) ─────────────────────────────────────────

function computeScore(avgQFD: number, avgPCT: number, avgIPER: number): number {
  const qfdScore  = Math.max(0, Math.min(100, 100 - (avgQFD  / 5)    * 100));
  const pctScore  = Math.max(0, Math.min(100, 100 - (avgPCT  / 1800) * 100));
  const iperScore = Math.max(0, Math.min(100, 100 - (avgIPER)         * 100));
  return Math.round(qfdScore * 0.45 + iperScore * 0.35 + pctScore * 0.20);
}

function scoreToBand(score: number): HubOption['band'] {
  if (score >= 75) return 'high';
  if (score >= 50) return 'at_risk';
  if (score >= 25) return 'intervention';
  return 'critical';
}

const BAND_CONFIG = {
  high:         { label: 'High Performing',     color: '#22c55e', bg: '#f0fdf4', Icon: CheckCircle  },
  at_risk:      { label: 'At Risk',             color: '#f59e0b', bg: '#fffbeb', Icon: AlertTriangle },
  intervention: { label: 'Needs Intervention',  color: '#ef4444', bg: '#fef2f2', Icon: AlertCircle  },
  critical:     { label: 'Critical',            color: '#7f1d1d', bg: '#fef2f2', Icon: XCircle      },
};

const BAND_ORDER = { critical: 0, intervention: 1, at_risk: 2, high: 3 };

// ── Main component ─────────────────────────────────────────────────────────────

export default function EnforcePage() {
  const [hubs,         setHubs]         = useState<HubOption[]>([]);
  const [selectedHub,  setSelectedHub]  = useState<HubOption | null>(null);
  const [weakProcesses,setWeakProcesses]= useState<WeakProcess[]>([]);
  const [loadingHubs,  setLoadingHubs]  = useState(true);
  const [loadingProcs, setLoadingProcs] = useState(false);
  const [isMandatory,  setIsMandatory]  = useState(false);
  const [dueDate,      setDueDate]      = useState('');
  const [pushing,      setPushing]      = useState(false);
  const [pushed,       setPushed]       = useState(false);
  const [hubSearch,    setHubSearch]    = useState('');
  const [bandFilter,   setBandFilter]   = useState<string>('all');
  const [expandedProc, setExpandedProc] = useState<string | null>(null);
  const [adminEmail,   setAdminEmail]   = useState('');

  // ── Load hub list ─────────────────────────────────────────────────────────

  useEffect(() => {
    async function loadHubs() {
      setLoadingHubs(true);

      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      const [{ data: sessions }, { data: hubMeta }] = await Promise.all([
        supabase
          .from('captain_sessions')
          .select('hub_code,pct,pause_count,error_count')
          .not('hub_code', 'is', null)
          .gte('completed_at', thirtyDaysAgo),
        supabase
          .from('hubs')
          .select('hub_code,hub_name')
          .eq('active', true),
      ]);

      const nameMap: Record<string, string> = {};
      (hubMeta || []).forEach(h => { nameMap[h.hub_code] = h.hub_name; });

      // Aggregate per hub
      const agg: Record<string, { sumQFD: number; sumPCT: number; sumIPER: number; n: number }> = {};
      (sessions || []).forEach(s => {
        if (!agg[s.hub_code]) agg[s.hub_code] = { sumQFD: 0, sumPCT: 0, sumIPER: 0, n: 0 };
        agg[s.hub_code].sumQFD  += s.pause_count || 0;
        agg[s.hub_code].sumPCT  += s.pct         || 0;
        agg[s.hub_code].sumIPER += s.error_count  || 0;
        agg[s.hub_code].n       += 1;
      });

      const hubList: HubOption[] = Object.entries(agg)
        .map(([hub_code, a]) => {
          const avgQFD  = a.sumQFD  / a.n;
          const avgPCT  = a.sumPCT  / a.n;
          const avgIPER = a.sumIPER / a.n;
          const score   = computeScore(avgQFD, avgPCT, avgIPER);
          return {
            hub_code,
            hub_name: nameMap[hub_code] || hub_code,
            band:  scoreToBand(score),
            score,
          };
        })
        .sort((a, b) => BAND_ORDER[a.band] - BAND_ORDER[b.band] || a.score - b.score);

      setHubs(hubList);
      setLoadingHubs(false);
    }

    loadHubs();

    // Get admin email for assigned_by
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email) setAdminEmail(data.user.email);
    });
  }, []);

  // ── Load weak processes when hub is selected ──────────────────────────────

  async function selectHub(hub: HubOption) {
    setSelectedHub(hub);
    setWeakProcesses([]);
    setPushed(false);
    setLoadingProcs(true);

    const { data: weakData } = await supabase
      .from('hub_process_weakness')
      .select('process_name,sessions,avg_qfd,avg_iper,avg_pct_min,captains_ran')
      .eq('hub_code', hub.hub_code)
      .order('avg_qfd', { ascending: false })
      .limit(15);

    if (!weakData || weakData.length === 0) {
      setWeakProcesses([]);
      setLoadingProcs(false);
      return;
    }

    // Fetch available sims for each weak process in one query
    const processNames = weakData.map(p => p.process_name);
    const { data: allSims } = await supabase
      .from('simulations')
      .select('id,title,process_name')
      .in('process_name', processNames);

    const simsByProcess: Record<string, SimOption[]> = {};
    (allSims || []).forEach(s => {
      if (!simsByProcess[s.process_name]) simsByProcess[s.process_name] = [];
      simsByProcess[s.process_name].push({ id: s.id, title: s.title });
    });

    const procs: WeakProcess[] = weakData.map(p => ({
      process_name: p.process_name,
      sessions:     p.sessions,
      avg_qfd:      Number(p.avg_qfd),
      avg_iper:     Number(p.avg_iper),
      avg_pct_min:  Number(p.avg_pct_min),
      captains_ran: p.captains_ran,
      sims:         simsByProcess[p.process_name] || [],
      selectedSims: [],
    }));

    setWeakProcesses(procs);
    setLoadingProcs(false);
  }

  // ── Toggle sim selection ──────────────────────────────────────────────────

  function toggleSim(processName: string, simId: string) {
    setWeakProcesses(prev => prev.map(p => {
      if (p.process_name !== processName) return p;
      const already = p.selectedSims.includes(simId);
      return {
        ...p,
        selectedSims: already
          ? p.selectedSims.filter(id => id !== simId)
          : [...p.selectedSims, simId],
      };
    }));
  }

  // ── Push assignments ──────────────────────────────────────────────────────

  const totalSelected = useMemo(
    () => weakProcesses.reduce((n, p) => n + p.selectedSims.length, 0),
    [weakProcesses]
  );

  async function pushAssignments() {
    if (!selectedHub || totalSelected === 0) return;
    setPushing(true);

    const rows: Omit<AssignmentRow, 'assigned_at'>[] = [];
    weakProcesses.forEach(p => {
      p.selectedSims.forEach(simId => {
        rows.push({
          sim_id:      simId,
          assigned_to: selectedHub.hub_code,  // hub_code as assigned_to for compat
          assign_type: 'hub',
          hub_code:    selectedHub.hub_code,
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
      // Clear selections
      setWeakProcesses(prev => prev.map(p => ({ ...p, selectedSims: [] })));
    } else {
      console.error('[Enforce] Insert error:', error);
      alert('Push failed: ' + error.message);
    }
  }

  // ── Filtered hub list ─────────────────────────────────────────────────────

  const filteredHubs = useMemo(() => {
    return hubs.filter(h => {
      const matchBand = bandFilter === 'all' || h.band === bandFilter;
      const matchText = h.hub_code.toLowerCase().includes(hubSearch.toLowerCase()) ||
                        h.hub_name.toLowerCase().includes(hubSearch.toLowerCase());
      return matchBand && matchText;
    });
  }, [hubs, bandFilter, hubSearch]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AdminLayout title="Trainer Enforcement">
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>

        {/* Left: Hub selector */}
        <div style={{ width: 280, flexShrink: 0 }}>
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8eaed', overflow: 'hidden' }}>

            {/* Search */}
            <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid #f0f0f0' }}>
              <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
                <input
                  type="text"
                  placeholder="Search hub..."
                  value={hubSearch}
                  onChange={e => setHubSearch(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px 7px 30px', border: '1px solid #e8eaed', borderRadius: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
            </div>

            {/* Band filter pills */}
            <div style={{ padding: '8px 14px', display: 'flex', flexWrap: 'wrap', gap: 6, borderBottom: '1px solid #f0f0f0' }}>
              {(['all', 'critical', 'intervention', 'at_risk', 'high'] as const).map(b => (
                <button
                  key={b}
                  onClick={() => setBandFilter(b)}
                  style={{
                    padding: '3px 10px', borderRadius: 20, fontSize: 11, border: 'none', cursor: 'pointer',
                    background: bandFilter === b ? '#1a1a2e' : '#f3f4f6',
                    color:      bandFilter === b ? '#fff'     : '#374151',
                    fontWeight: bandFilter === b ? 600        : 400,
                  }}
                >
                  {b === 'all' ? 'All' : BAND_CONFIG[b].label}
                </button>
              ))}
            </div>

            {/* Hub list */}
            <div style={{ maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
              {loadingHubs ? (
                <div style={{ padding: 20, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>Loading hubs…</div>
              ) : filteredHubs.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>No hubs found</div>
              ) : filteredHubs.map(hub => {
                const cfg = BAND_CONFIG[hub.band];
                const active = selectedHub?.hub_code === hub.hub_code;
                return (
                  <div
                    key={hub.hub_code}
                    onClick={() => selectHub(hub)}
                    style={{
                      padding: '10px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                      background: active ? '#f5f3ff' : 'transparent',
                      borderLeft: active ? '3px solid #9747FF' : '3px solid transparent',
                      transition: 'background 0.1s',
                    }}
                  >
                    <cfg.Icon size={14} color={cfg.color} style={{ flexShrink: 0 }} />
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a2e', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {hub.hub_name}
                      </div>
                      <div style={{ fontSize: 11, color: '#6b7280' }}>{hub.hub_code} · Score {hub.score}</div>
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: cfg.color, background: cfg.bg, padding: '2px 7px', borderRadius: 10, flexShrink: 0 }}>
                      {hub.score}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: Process + assignment panel */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {!selectedHub ? (
            <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8eaed', padding: 48, textAlign: 'center' }}>
              <BookOpen size={40} color="#d1d5db" style={{ marginBottom: 16 }} />
              <div style={{ fontSize: 16, fontWeight: 600, color: '#6b7280', marginBottom: 6 }}>Select a hub</div>
              <div style={{ fontSize: 13, color: '#9ca3af' }}>Choose a hub from the left to see its weak processes and push sim assignments</div>
            </div>
          ) : (
            <>
              {/* Hub header */}
              <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8eaed', padding: '16px 20px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a2e' }}>{selectedHub.hub_name}</div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                    {selectedHub.hub_code} · {BAND_CONFIG[selectedHub.band].label} · Score {selectedHub.score}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <BAND_CONFIG[selectedHub.band].Icon size={20} color={BAND_CONFIG[selectedHub.band].color} />
                </div>
              </div>

              {/* Push controls */}
              <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8eaed', padding: '14px 20px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151', cursor: 'pointer', userSelect: 'none' }}>
                  <input
                    type="checkbox"
                    checked={isMandatory}
                    onChange={e => setIsMandatory(e.target.checked)}
                    style={{ width: 15, height: 15, cursor: 'pointer' }}
                  />
                  Mandatory
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151' }}>
                  Due date
                  <input
                    type="date"
                    value={dueDate}
                    onChange={e => setDueDate(e.target.value)}
                    style={{ padding: '5px 10px', border: '1px solid #e8eaed', borderRadius: 8, fontSize: 13, outline: 'none' }}
                  />
                </label>
                <div style={{ flex: 1 }} />
                {pushed && (
                  <span style={{ fontSize: 13, color: '#22c55e', fontWeight: 600 }}>✓ {totalSelected > 0 ? totalSelected : 'Assignments'} pushed</span>
                )}
                <button
                  onClick={pushAssignments}
                  disabled={totalSelected === 0 || pushing}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 18px', borderRadius: 8, border: 'none', cursor: totalSelected === 0 ? 'not-allowed' : 'pointer',
                    background: totalSelected === 0 ? '#e5e7eb' : 'linear-gradient(135deg,#F43397,#9747FF)',
                    color: totalSelected === 0 ? '#9ca3af' : '#fff',
                    fontSize: 13, fontWeight: 600, transition: 'opacity 0.15s',
                    opacity: pushing ? 0.7 : 1,
                  }}
                >
                  <Send size={14} />
                  {pushing ? 'Pushing…' : `Push ${totalSelected > 0 ? totalSelected + ' sim' + (totalSelected !== 1 ? 's' : '') : 'sims'}`}
                </button>
              </div>

              {/* Weak processes */}
              {loadingProcs ? (
                <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8eaed', padding: 32, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
                  Loading weak processes…
                </div>
              ) : weakProcesses.length === 0 ? (
                <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8eaed', padding: 32, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
                  No session data in the last 30 days for this hub
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {weakProcesses.map((proc, i) => {
                    const isOpen = expandedProc === proc.process_name;
                    // Colour-code severity by QFD
                    const qfdColor = proc.avg_qfd >= 3 ? '#ef4444' : proc.avg_qfd >= 1.5 ? '#f59e0b' : '#22c55e';
                    return (
                      <div
                        key={proc.process_name}
                        style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8eaed', overflow: 'hidden' }}
                      >
                        {/* Row header */}
                        <div
                          onClick={() => setExpandedProc(isOpen ? null : proc.process_name)}
                          style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 18px', cursor: 'pointer' }}
                        >
                          {/* Rank */}
                          <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#6b7280', flexShrink: 0 }}>
                            {i + 1}
                          </div>

                          {/* Process name */}
                          <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: '#1a1a2e' }}>{proc.process_name}</div>

                          {/* Metrics */}
                          <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
                            <div style={{ textAlign: 'center' }}>
                              <div style={{ fontSize: 15, fontWeight: 700, color: qfdColor }}>{proc.avg_qfd.toFixed(1)}</div>
                              <div style={{ fontSize: 10, color: '#9ca3af' }}>Pauses/sess</div>
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <div style={{ fontSize: 15, fontWeight: 700, color: '#374151' }}>{proc.avg_pct_min.toFixed(1)}m</div>
                              <div style={{ fontSize: 10, color: '#9ca3af' }}>Avg PCT</div>
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <div style={{ fontSize: 15, fontWeight: 700, color: '#374151' }}>{proc.captains_ran}</div>
                              <div style={{ fontSize: 10, color: '#9ca3af' }}>Captains</div>
                            </div>
                          </div>

                          {/* Sim badge */}
                          <div style={{
                            fontSize: 11, padding: '3px 9px', borderRadius: 10, flexShrink: 0,
                            background: proc.sims.length > 0 ? '#ede9fe' : '#f3f4f6',
                            color:      proc.sims.length > 0 ? '#7c3aed'  : '#9ca3af',
                            fontWeight: 600,
                          }}>
                            {proc.sims.length > 0 ? `${proc.sims.length} sim${proc.sims.length !== 1 ? 's' : ''}` : 'No sims'}
                          </div>

                          {/* Selected count */}
                          {proc.selectedSims.length > 0 && (
                            <div style={{ fontSize: 11, padding: '3px 9px', borderRadius: 10, background: '#f0fdf4', color: '#16a34a', fontWeight: 700, flexShrink: 0 }}>
                              {proc.selectedSims.length} selected
                            </div>
                          )}

                          {isOpen ? <ChevronUp size={14} color="#9ca3af" /> : <ChevronDown size={14} color="#9ca3af" />}
                        </div>

                        {/* Expanded: sim picker */}
                        {isOpen && (
                          <div style={{ borderTop: '1px solid #f0f0f0', padding: '12px 18px' }}>
                            {proc.sims.length === 0 ? (
                              <div style={{ fontSize: 13, color: '#9ca3af', fontStyle: 'italic' }}>
                                No simulations found for "{proc.process_name}" — create one in the Content section first.
                              </div>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Select sims to assign to this hub:</div>
                                {proc.sims.map(sim => {
                                  const checked = proc.selectedSims.includes(sim.id);
                                  return (
                                    <label
                                      key={sim.id}
                                      style={{
                                        display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                                        padding: '8px 12px', borderRadius: 8,
                                        background: checked ? '#f5f3ff' : '#f9fafb',
                                        border: `1px solid ${checked ? '#c4b5fd' : '#e8eaed'}`,
                                        transition: 'all 0.1s',
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => toggleSim(proc.process_name, sim.id)}
                                        style={{ width: 15, height: 15, cursor: 'pointer', flexShrink: 0 }}
                                      />
                                      <span style={{ fontSize: 13, color: '#1a1a2e', fontWeight: checked ? 600 : 400 }}>{sim.title}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
