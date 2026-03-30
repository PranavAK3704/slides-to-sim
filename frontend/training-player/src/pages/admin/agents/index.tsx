import { useEffect, useState } from 'react';
import AdminLayout from '@/components/AdminLayout';
import Link from 'next/link';
import { supabase, AgentProfile } from '@/lib/supabase';
import { Search, Filter, ChevronRight, TrendingUp, TrendingDown, Minus } from 'lucide-react';

function timeAgo(ts: string) {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60)    return `${Math.floor(diff)}s ago`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function AgentsPage() {
  const [agents, setAgents]     = useState<AgentProfile[]>([]);
  const [filtered, setFiltered] = useState<AgentProfile[]>([]);
  const [query, setQuery]       = useState('');
  const [roleFilter, setRole]   = useState('all');
  const [hubFilter, setHub]     = useState('all');
  const [sortBy, setSortBy]     = useState<keyof AgentProfile>('total_xp');
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    supabase.from('agent_profiles').select('*').then(({ data }) => {
      if (data) { setAgents(data); setFiltered(data); }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    let result = [...agents];
    if (query)                  result = result.filter(a => a.email.toLowerCase().includes(query.toLowerCase()));
    if (roleFilter !== 'all')   result = result.filter(a => a.role === roleFilter);
    if (hubFilter  !== 'all')   result = result.filter(a => a.hub  === hubFilter);
    result.sort((a, b) => ((b[sortBy] as number) || 0) - ((a[sortBy] as number) || 0));
    setFiltered(result);
  }, [query, roleFilter, hubFilter, sortBy, agents]);

  const hubs  = [...new Set(agents.map(a => a.hub).filter(Boolean))] as string[];
  const roles = [...new Set(agents.map(a => a.role).filter(Boolean))] as string[];

  const sel: React.CSSProperties = { padding: '8px 12px', border: '1px solid #e8eaed', borderRadius: 8, fontSize: 13, background: '#fff', color: '#333', cursor: 'pointer' };

  return (
    <AdminLayout title="Agents">
      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#aaa' }} />
          <input
            value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search by email..."
            style={{ width: '100%', padding: '8px 12px 8px 30px', border: '1px solid #e8eaed', borderRadius: 8, fontSize: 13 }}
          />
        </div>
        <select value={roleFilter}  onChange={e => setRole(e.target.value)}  style={sel}>
          <option value="all">All Roles</option>
          {roles.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={hubFilter}   onChange={e => setHub(e.target.value)}   style={sel}>
          <option value="all">All Hubs</option>
          {hubs.map(h => <option key={h} value={h}>{h}</option>)}
        </select>
        <select value={sortBy as string} onChange={e => setSortBy(e.target.value as keyof AgentProfile)} style={sel}>
          <option value="total_xp">Sort: XP</option>
          <option value="level">Sort: Level</option>
          <option value="streak_current">Sort: Streak</option>
          <option value="assessments_passed">Sort: Assessments</option>
          <option value="last_active">Sort: Last Active</option>
        </select>
        <div style={{ fontSize: 12, color: '#888' }}>{filtered.length} agents</div>
      </div>

      {/* Table */}
      <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8f9fa', borderBottom: '1px solid #e8eaed' }}>
              {['Agent', 'Role', 'Hub', 'Level', 'Total XP', 'Streak', 'Assessments', 'Avg Score', 'Last Active', ''].map(h => (
                <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#666', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} style={{ padding: 40, textAlign: 'center', color: '#bbb' }}>Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={10} style={{ padding: 40, textAlign: 'center', color: '#bbb' }}>No agents match the filters</td></tr>
            ) : filtered.map((a, i) => (
              <tr key={a.email} style={{ borderBottom: '1px solid #f5f5f5', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                <td style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg,#F43397,#9747FF)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#fff', fontWeight: 700, flexShrink: 0 }}>
                      {a.email[0].toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, color: '#1a1a2e' }}>{a.email.split('@')[0]}</div>
                      <div style={{ fontSize: 11, color: '#aaa' }}>{a.email}</div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: a.role === 'Captain' ? 'rgba(244,51,151,0.1)' : a.role === 'L1 Agent' ? 'rgba(14,165,233,0.1)' : 'rgba(151,71,255,0.1)', color: a.role === 'Captain' ? '#F43397' : a.role === 'L1 Agent' ? '#0ea5e9' : '#9747FF' }}>
                    {a.role}
                  </span>
                </td>
                <td style={{ padding: '12px 16px', color: '#555' }}>{a.hub || '—'}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ background: 'rgba(151,71,255,0.1)', color: '#9747FF', padding: '3px 10px', borderRadius: 12, fontWeight: 700, fontSize: 12 }}>L{a.level}</span>
                </td>
                <td style={{ padding: '12px 16px', fontWeight: 600, color: '#1a1a2e' }}>{(a.total_xp || 0).toLocaleString()}</td>
                <td style={{ padding: '12px 16px', color: '#555' }}>
                  {a.streak_current > 0 ? <span style={{ color: '#f59e0b' }}>🔥 {a.streak_current}d</span> : '—'}
                </td>
                <td style={{ padding: '12px 16px', color: '#555' }}>{a.assessments_passed || 0}</td>
                <td style={{ padding: '12px 16px', color: '#555' }}>{a.avg_score ? `${a.avg_score}%` : '—'}</td>
                <td style={{ padding: '12px 16px', color: '#888', fontSize: 11 }}>{a.last_active ? timeAgo(a.last_active) : '—'}</td>
                <td style={{ padding: '12px 16px' }}>
                  <Link href={`/admin/agents/${encodeURIComponent(a.email)}`} style={{ display: 'flex', alignItems: 'center', color: '#9747FF', textDecoration: 'none', fontSize: 12, fontWeight: 600 }}>
                    View <ChevronRight size={14} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminLayout>
  );
}
