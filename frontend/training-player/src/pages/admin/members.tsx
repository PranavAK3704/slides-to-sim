import { useEffect, useState, useMemo } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { supabase } from '@/lib/supabase';
import { UserPlus, Trash2, Search, Users, ShieldCheck } from 'lucide-react';

interface Hub       { hub_code: string; hub_name: string; }
interface Member    { email: string; hub_code: string; role: string; active: boolean; added_at: string; }

const ROLES = ['Captain', 'Operator'] as const;

export default function MembersPage() {
  const [members,   setMembers]   = useState<Member[]>([]);
  const [hubs,      setHubs]      = useState<Hub[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState('');
  const [hubFilter, setHubFilter] = useState('');

  // Add form
  const [email,    setEmail]    = useState('');
  const [hubCode,  setHubCode]  = useState('');
  const [role,     setRole]     = useState<'Captain' | 'Operator'>('Operator');
  const [adding,   setAdding]   = useState(false);
  const [addErr,   setAddErr]   = useState('');
  const [formOpen, setFormOpen] = useState(false);

  // Bulk import
  const [bulkText,   setBulkText]   = useState('');
  const [bulkOpen,   setBulkOpen]   = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');

  const load = async () => {
    const [mRes, hRes] = await Promise.all([
      supabase.from('hub_members').select('*').order('added_at', { ascending: false }),
      supabase.from('hubs').select('hub_code,hub_name').eq('active', true).order('hub_name'),
    ]);
    if (mRes.data) setMembers(mRes.data);
    if (hRes.data) setHubs(hRes.data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() =>
    members.filter(m => {
      const bySearch = !search   || m.email.toLowerCase().includes(search.toLowerCase());
      const byHub    = !hubFilter || m.hub_code === hubFilter;
      return bySearch && byHub;
    }),
  [members, search, hubFilter]);

  const hubName = (code: string) => hubs.find(h => h.hub_code === code)?.hub_name || code;

  const handleAdd = async () => {
    setAddErr('');
    if (!email.trim() || !hubCode) { setAddErr('Email and hub are required.'); return; }
    setAdding(true);
    const { error } = await supabase.from('hub_members').upsert(
      { email: email.trim().toLowerCase(), hub_code: hubCode, role, active: true },
      { onConflict: 'email,hub_code' }
    );
    setAdding(false);
    if (error) { setAddErr(error.message); return; }
    setEmail(''); setHubCode(''); setRole('Operator'); setFormOpen(false);
    load();
  };

  const handleRemove = async (m: Member) => {
    if (!confirm(`Remove ${m.email} from ${hubName(m.hub_code)}?`)) return;
    await supabase.from('hub_members').update({ active: false }).eq('email', m.email).eq('hub_code', m.hub_code);
    load();
  };

  // Bulk import: expects CSV rows — email,hub_code,role
  const handleBulkImport = async () => {
    setBulkStatus('');
    const rows = bulkText.trim().split('\n').map(r => r.split(',').map(c => c.trim())).filter(r => r.length >= 2);
    if (!rows.length) { setBulkStatus('No valid rows found.'); return; }

    const records = rows.map(r => ({
      email:    r[0].toLowerCase(),
      hub_code: r[1].toUpperCase(),
      role:     (r[2] === 'Captain' ? 'Captain' : 'Operator') as string,
      active:   true,
    }));

    const { error } = await supabase.from('hub_members').upsert(records, { onConflict: 'email,hub_code' });
    if (error) { setBulkStatus(`Error: ${error.message}`); return; }
    setBulkStatus(`Imported ${records.length} members.`);
    setBulkText(''); setBulkOpen(false);
    load();
  };

  const captainCount  = filtered.filter(m => m.role === 'Captain'  && m.active).length;
  const operatorCount = filtered.filter(m => m.role === 'Operator' && m.active).length;

  return (
    <AdminLayout title="Hub Members">
      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 24 }}>
        {[
          { label: 'Total Active',  value: filtered.filter(m => m.active).length, color: '#9747FF', icon: Users },
          { label: 'Captains',      value: captainCount,                            color: '#F43397', icon: ShieldCheck },
          { label: 'Operators',     value: operatorCount,                           color: '#0ea5e9', icon: Users },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} style={{ background: '#fff', borderRadius: 12, padding: '18px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon size={18} color={color} />
            </div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#1a1a2e' }}>{value}</div>
              <div style={{ fontSize: 12, color: '#888' }}>{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: '#aaa' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by email…"
            style={{ width: '100%', paddingLeft: 32, paddingRight: 12, paddingTop: 9, paddingBottom: 9, border: '1.5px solid #e8eaed', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' as const }} />
        </div>
        <select value={hubFilter} onChange={e => setHubFilter(e.target.value)}
          style={{ padding: '9px 14px', border: '1.5px solid #e8eaed', borderRadius: 8, fontSize: 13, background: '#fff', minWidth: 160 }}>
          <option value="">All hubs</option>
          {hubs.map(h => <option key={h.hub_code} value={h.hub_code}>{h.hub_name}</option>)}
        </select>
        <button onClick={() => { setBulkOpen(!bulkOpen); setFormOpen(false); }}
          style={{ padding: '9px 16px', border: '1.5px solid #e8eaed', borderRadius: 8, fontSize: 13, background: '#fff', cursor: 'pointer', color: '#555' }}>
          Import CSV
        </button>
        <button onClick={() => { setFormOpen(!formOpen); setBulkOpen(false); }}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', background: 'linear-gradient(135deg,#F43397,#9747FF)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          <UserPlus size={14} /> Add Member
        </button>
      </div>

      {/* Add form */}
      {formOpen && (
        <div style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 4px 16px rgba(0,0,0,0.08)', marginBottom: 16, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 12, alignItems: 'end' }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#666', display: 'block', marginBottom: 5 }}>EMAIL</label>
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="employee@company.com"
              style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e8eaed', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' as const }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#666', display: 'block', marginBottom: 5 }}>HUB</label>
            <select value={hubCode} onChange={e => setHubCode(e.target.value)}
              style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e8eaed', borderRadius: 8, fontSize: 13, background: '#fff', boxSizing: 'border-box' as const }}>
              <option value="">Select hub…</option>
              {hubs.map(h => <option key={h.hub_code} value={h.hub_code}>{h.hub_name} ({h.hub_code})</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#666', display: 'block', marginBottom: 5 }}>ROLE</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {ROLES.map(r => (
                <button key={r} onClick={() => setRole(r)}
                  style={{ flex: 1, padding: '9px 0', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    background: role === r ? (r === 'Captain' ? '#F43397' : '#9747FF') : '#f0f0f5',
                    color: role === r ? '#fff' : '#555' }}>
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleAdd} disabled={adding}
              style={{ padding: '9px 20px', background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: adding ? 0.6 : 1 }}>
              {adding ? 'Adding…' : 'Add'}
            </button>
            <button onClick={() => { setFormOpen(false); setAddErr(''); }}
              style={{ padding: '9px 12px', background: '#f0f0f5', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', color: '#555' }}>
              Cancel
            </button>
          </div>
          {addErr && <div style={{ gridColumn: '1/-1', fontSize: 12, color: '#ef4444', marginTop: -4 }}>{addErr}</div>}
        </div>
      )}

      {/* Bulk import */}
      {bulkOpen && (
        <div style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 4px 16px rgba(0,0,0,0.08)', marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a2e', marginBottom: 4 }}>Paste CSV — one row per member</div>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 10 }}>Format: <code style={{ background: '#f5f5f5', padding: '1px 5px', borderRadius: 4 }}>email,hub_code,role</code> &nbsp;(role = Captain or Operator)</div>
          <textarea value={bulkText} onChange={e => setBulkText(e.target.value)}
            placeholder={"john@company.com,MUM-001,Operator\njane@company.com,MUM-001,Captain"}
            style={{ width: '100%', height: 120, padding: 10, border: '1.5px solid #e8eaed', borderRadius: 8, fontSize: 12, fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box' as const }} />
          <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center' }}>
            <button onClick={handleBulkImport} disabled={!bulkText.trim()}
              style={{ padding: '9px 20px', background: 'linear-gradient(135deg,#F43397,#9747FF)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: !bulkText.trim() ? 0.5 : 1 }}>
              Import
            </button>
            <button onClick={() => { setBulkOpen(false); setBulkStatus(''); }}
              style={{ padding: '9px 12px', background: '#f0f0f5', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', color: '#555' }}>
              Cancel
            </button>
            {bulkStatus && <span style={{ fontSize: 12, color: bulkStatus.startsWith('Error') ? '#ef4444' : '#22c55e', fontWeight: 600 }}>{bulkStatus}</span>}
          </div>
        </div>
      )}

      {/* Table */}
      <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#bbb' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 48, color: '#bbb' }}>
            <Users size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
            <div style={{ fontWeight: 600, marginBottom: 4 }}>No members found</div>
            <div style={{ fontSize: 13 }}>Add employees above or adjust your filters.</div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #f0f0f5', background: '#fafafa' }}>
                {['Email', 'Hub', 'Role', 'Status', 'Added', ''].map(h => (
                  <th key={h} style={{ padding: '11px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((m, i) => (
                <tr key={`${m.email}-${m.hub_code}`} style={{ borderBottom: i < filtered.length - 1 ? '1px solid #f9f9f9' : 'none', opacity: m.active ? 1 : 0.45 }}>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#1a1a2e', fontWeight: 500 }}>{m.email}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#555' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#555' }}>{hubName(m.hub_code)}</span>
                    <span style={{ fontSize: 10, color: '#aaa', marginLeft: 5 }}>{m.hub_code}</span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                      background: m.role === 'Captain' ? 'rgba(244,51,151,0.1)' : 'rgba(151,71,255,0.1)',
                      color: m.role === 'Captain' ? '#F43397' : '#9747FF' }}>
                      {m.role}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: m.active ? '#22c55e' : '#aaa' }}>
                      {m.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 12, color: '#aaa' }}>
                    {new Date(m.added_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {m.active && (
                      <button onClick={() => handleRemove(m)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ddd', padding: 4, display: 'flex', alignItems: 'center' }}
                        title="Remove member">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AdminLayout>
  );
}
