import { useEffect, useState, FormEvent } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { supabase } from '@/lib/supabase';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { UserPlus, Trash2, Save, RefreshCw, Shield, CheckCircle, AlertCircle } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface PortalUser {
  id:         string;
  email:      string;
  name:       string;
  role:       'admin' | 'educator';
  created_at: string;
  last_sign_in_at: string | null;
}

interface XPConfig {
  sim_complete:        number;
  sim_perfect_score:   number;
  streak_bonus:        number;
  first_time_process:  number;
  daily_login:         number;
  assessment_pass:     number;
  captain_no_error:    number;
}

const HUBS = ['Mumbai','Delhi','Bengaluru','Hyderabad','Chennai','Kolkata','Pune','Ahmedabad','Jaipur','Lucknow','Bhubaneswar','Kochi'];

const DEFAULT_XP: XPConfig = {
  sim_complete:       50,
  sim_perfect_score:  100,
  streak_bonus:       25,
  first_time_process: 30,
  daily_login:        10,
  assessment_pass:    75,
  captain_no_error:   40,
};

type Tab = 'users' | 'gamification' | 'hubs';

function Toast({ msg, type }: { msg: string; type: 'success' | 'error' }) {
  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 999, background: type === 'success' ? '#1a1a2e' : '#7f1d1d', border: `1px solid ${type === 'success' ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'}`, borderRadius: 12, padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 10, color: '#fff', fontSize: 13, boxShadow: '0 8px 32px rgba(0,0,0,0.3)', animation: 'slideUp 0.2s ease' }}>
      {type === 'success' ? <CheckCircle size={16} color="#22c55e" /> : <AlertCircle size={16} color="#ef4444" />}
      {msg}
    </div>
  );
}

export default function SettingsPage() {
  const { admin } = useAdminAuth();
  const [activeTab, setActiveTab] = useState<Tab>('users');

  // Users
  const [users,     setUsers]     = useState<PortalUser[]>([]);
  const [invEmail,  setInvEmail]  = useState('');
  const [invName,   setInvName]   = useState('');
  const [invRole,   setInvRole]   = useState<'educator' | 'admin'>('educator');
  const [inviting,  setInviting]  = useState(false);

  // XP config (stored in Supabase as a single row in lms_config)
  const [xp,        setXP]        = useState<XPConfig>(DEFAULT_XP);
  const [savingXP,  setSavingXP]  = useState(false);

  // Toast
  const [toast,     setToast]     = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Load portal users from Supabase Auth admin API ──────────────────────
  // We use a stored list in `lms_portal_users` table (populated on invite)
  useEffect(() => {
    loadUsers();
    loadXPConfig();
  }, []);

  const loadUsers = async () => {
    const { data } = await supabase.from('lms_portal_users').select('*').order('created_at', { ascending: false });
    if (data) setUsers(data as PortalUser[]);
  };

  const loadXPConfig = async () => {
    const { data } = await supabase.from('lms_config').select('value').eq('key', 'xp_weights').single();
    if (data?.value) setXP({ ...DEFAULT_XP, ...(data.value as XPConfig) });
  };

  const inviteUser = async (e: FormEvent) => {
    e.preventDefault();
    if (!invEmail.trim()) return;
    setInviting(true);
    try {
      // Record in lms_portal_users table (primary store)
      const { error: dbErr } = await supabase.from('lms_portal_users').upsert({
        email:      invEmail,
        name:       invName || invEmail.split('@')[0],
        role:       invRole,
        created_at: new Date().toISOString(),
      }, { onConflict: 'email' });
      if (dbErr) throw dbErr;
      showToast(`${invEmail} added. Share the portal URL so they can set their password via "Forgot password".`);
      setInvEmail(''); setInvName('');
      loadUsers();
    } catch {
      showToast('Failed to add user', 'error');
    }
    setInviting(false);
  };

  const removeUser = async (email: string) => {
    if (!confirm(`Remove ${email} from the portal?`)) return;
    await supabase.from('lms_portal_users').delete().eq('email', email);
    setUsers(prev => prev.filter(u => u.email !== email));
    showToast('User removed');
  };

  const changeRole = async (email: string, newRole: 'admin' | 'educator') => {
    await supabase.from('lms_portal_users').update({ role: newRole }).eq('email', email);
    setUsers(prev => prev.map(u => u.email === email ? { ...u, role: newRole } : u));
    showToast(`Role updated to ${newRole}`);
  };

  const saveXP = async () => {
    setSavingXP(true);
    await supabase.from('lms_config').upsert({ key: 'xp_weights', value: xp }, { onConflict: 'key' });
    setSavingXP(false);
    showToast('XP weights saved');
  };

  const tabStyle = (t: Tab): React.CSSProperties => ({
    padding: '8px 16px', fontSize: 13, fontWeight: activeTab === t ? 700 : 400,
    color: activeTab === t ? '#9747FF' : '#666', background: 'none', border: 'none',
    borderBottom: activeTab === t ? '2px solid #9747FF' : '2px solid transparent',
    cursor: 'pointer', transition: 'all 0.15s'
  });

  const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 14px', border: '1.5px solid #e8eaed', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' };

  return (
    <AdminLayout title="Settings">
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e8eaed', marginBottom: 28, background: '#fff', borderRadius: '12px 12px 0 0', padding: '0 4px' }}>
        <button style={tabStyle('users')}       onClick={() => setActiveTab('users')}>Portal Users</button>
        <button style={tabStyle('gamification')} onClick={() => setActiveTab('gamification')}>Gamification</button>
        <button style={tabStyle('hubs')}         onClick={() => setActiveTab('hubs')}>Hubs &amp; Config</button>
      </div>

      {/* ── Users Tab ── */}
      {activeTab === 'users' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20, alignItems: 'start' }}>

          {/* User table */}
          <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #f0f0f0', fontWeight: 700, fontSize: 14, color: '#1a1a2e' }}>
              Portal Users <span style={{ fontWeight: 400, fontSize: 12, color: '#aaa' }}>({users.length})</span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8f9fa' }}>
                  {['User', 'Role', 'Joined', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#666', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.length === 0 && (
                  <tr><td colSpan={4} style={{ padding: 32, textAlign: 'center', color: '#bbb', fontSize: 13 }}>No portal users yet. Invite someone using the form.</td></tr>
                )}
                {users.map((u, i) => (
                  <tr key={u.email} style={{ borderBottom: '1px solid #f5f5f5', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 30, height: 30, borderRadius: 8, background: 'linear-gradient(135deg,#F43397,#9747FF)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                          {(u.name || u.email)[0].toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, color: '#1a1a2e' }}>{u.name || u.email.split('@')[0]}</div>
                          <div style={{ fontSize: 11, color: '#aaa' }}>{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {u.email === admin?.email ? (
                        <span style={{ padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: 'rgba(244,51,151,0.1)', color: '#F43397' }}>
                          <Shield size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />
                          {u.role}
                        </span>
                      ) : (
                        <select
                          value={u.role}
                          onChange={e => changeRole(u.email, e.target.value as 'admin' | 'educator')}
                          style={{ padding: '4px 10px', border: '1px solid #e8eaed', borderRadius: 8, fontSize: 12, background: '#fff' }}
                        >
                          <option value="educator">Educator</option>
                          <option value="admin">Admin</option>
                        </select>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px', color: '#888', fontSize: 12 }}>
                      {u.created_at ? new Date(u.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {u.email !== admin?.email && (
                        <button onClick={() => removeUser(u.email)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ddd', padding: 4 }}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Invite form */}
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#1a1a2e', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
              <UserPlus size={16} color="#9747FF" /> Invite User
            </div>
            <form onSubmit={inviteUser}>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Name</label>
                <input value={invName} onChange={e => setInvName(e.target.value)} placeholder="Full name" style={inputStyle} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Email *</label>
                <input type="email" required value={invEmail} onChange={e => setInvEmail(e.target.value)} placeholder="trainer@valmo.in" style={inputStyle} />
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Role</label>
                <select value={invRole} onChange={e => setInvRole(e.target.value as 'educator' | 'admin')} style={{ ...inputStyle, background: '#fff' }}>
                  <option value="educator">Educator — Can create content and view reports</option>
                  <option value="admin">Admin — Full access including settings</option>
                </select>
              </div>
              <button type="submit" disabled={inviting} style={{ width: '100%', padding: '11px', background: 'linear-gradient(135deg,#F43397,#9747FF)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: inviting ? 0.7 : 1 }}>
                {inviting ? <><RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} /> Inviting…</> : <><UserPlus size={14} /> Send Invite</>}
              </button>
            </form>
            <div style={{ marginTop: 14, fontSize: 11, color: '#aaa', lineHeight: 1.6 }}>
              User is added to the portal. Share the portal URL and ask them to use "Forgot password" to set their password.
            </div>
          </div>
        </div>
      )}

      {/* ── Gamification Tab ── */}
      {activeTab === 'gamification' && (
        <div style={{ maxWidth: 640 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#1a1a2e', marginBottom: 6 }}>XP Weights</div>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 24 }}>
              These values control how much XP agents earn for each action. Changes take effect immediately for new events.
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {(Object.entries(xp) as [keyof XPConfig, number][]).map(([key, val]) => (
                <div key={key}>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                    {key.replace(/_/g, ' ')}
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="number" min={0} max={500}
                      value={val}
                      onChange={e => setXP(prev => ({ ...prev, [key]: Number(e.target.value) }))}
                      style={{ flex: 1, padding: '9px 12px', border: '1.5px solid #e8eaed', borderRadius: 8, fontSize: 13 }}
                    />
                    <span style={{ fontSize: 12, color: '#aaa', flexShrink: 0 }}>XP</span>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 24, display: 'flex', gap: 10 }}>
              <button onClick={saveXP} disabled={savingXP} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#F43397,#9747FF)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, opacity: savingXP ? 0.7 : 1 }}>
                {savingXP ? <><RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</> : <><Save size={14} /> Save Weights</>}
              </button>
              <button onClick={() => setXP(DEFAULT_XP)} style={{ padding: '10px 18px', background: '#f5f5f5', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', color: '#555' }}>
                Reset to defaults
              </button>
            </div>
          </div>

          {/* Levels reference */}
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginTop: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#1a1a2e', marginBottom: 16 }}>Level Thresholds (read-only)</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
              {[0,100,250,450,700,1000,1400,1900,2500,3200,4000,5000,6200,7600,9200,11000,13000,15500,18500,22000].map((xpVal, lvl) => (
                <div key={lvl} style={{ background: '#f8f9fa', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#9747FF' }}>L{lvl + 1}</div>
                  <div style={{ fontSize: 11, color: '#888' }}>{xpVal.toLocaleString()} XP</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Hubs Tab ── */}
      {activeTab === 'hubs' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

          {/* Hub list */}
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#1a1a2e', marginBottom: 16 }}>Active Hubs</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {HUBS.map(hub => (
                <div key={hub} style={{ padding: '6px 14px', borderRadius: 20, background: 'rgba(151,71,255,0.08)', border: '1px solid rgba(151,71,255,0.2)', color: '#9747FF', fontSize: 13, fontWeight: 500 }}>
                  📍 {hub}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, fontSize: 12, color: '#aaa' }}>
              Hubs are defined in the codebase. Contact an admin to add or remove hubs from the extension and portal.
            </div>
          </div>

          {/* Supabase config */}
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#1a1a2e', marginBottom: 16 }}>Backend Configuration</div>
            <ConfigRow label="Supabase Project" value="wfnmltorfvaokqbzggkn" masked={false} />
            <ConfigRow label="Supabase URL"     value="https://wfnmltorfvaokqbzggkn.supabase.co" masked={false} />
            <ConfigRow label="Anon Key"         value="sb_publishable_kVRokdcfNT-***" masked />
            <ConfigRow label="Sim API"          value={process.env.NEXT_PUBLIC_SIM_API_URL || 'http://localhost:8000'} masked={false} />
            <div style={{ marginTop: 16, fontSize: 12, color: '#aaa' }}>
              To change these values, set the corresponding environment variables in your deployment.
            </div>
          </div>

          {/* Learner personas card */}
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', gridColumn: '1 / -1' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#1a1a2e', marginBottom: 16 }}>Persona Overview</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16 }}>
              {[
                { title: 'Learner (Agent)', color: '#0ea5e9', desc: 'Uses the Chrome extension. Captains complete process simulations, L1 agents use ART tracker. XP and levels are tracked automatically.', features: ['Captain Timer', 'ART Tracker', 'Gamification', 'Process Simulations'] },
                { title: 'Educator', color: '#9747FF', desc: 'Uses this admin portal. Creates simulation content from Google Slides decks, views agent reports and hub-level dashboards.', features: ['Dashboard', 'Agents view', 'Content creation', 'Reports'] },
                { title: 'Admin', color: '#F43397', desc: 'Full access to everything. Can manage portal users, configure gamification weights, and access system settings.', features: ['All Educator access', 'Portal user management', 'XP config', 'System settings'] },
              ].map(p => (
                <div key={p.title} style={{ border: `1.5px solid ${p.color}22`, borderRadius: 12, padding: 18, background: `${p.color}08` }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: p.color, marginBottom: 8 }}>{p.title}</div>
                  <div style={{ fontSize: 12, color: '#666', lineHeight: 1.6, marginBottom: 12 }}>{p.desc}</div>
                  <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: 12, color: '#888' }}>
                    {p.features.map(f => <li key={f} style={{ marginBottom: 2 }}>{f}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {toast && <Toast msg={toast.msg} type={toast.type} />}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } @keyframes slideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </AdminLayout>
  );
}

function ConfigRow({ label, value, masked }: { label: string; value: string; masked: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #f5f5f5' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, color: '#aaa', marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#333', wordBreak: 'break-all' }}>
          {masked && !show ? '••••••••••••••••••' : value}
        </div>
      </div>
      {masked && (
        <button onClick={() => setShow(!show)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', fontSize: 11, flexShrink: 0 }}>
          {show ? 'Hide' : 'Show'}
        </button>
      )}
    </div>
  );
}
