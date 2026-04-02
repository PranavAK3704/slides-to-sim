import React, { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  LayoutDashboard, Users, BookOpen, BarChart3,
  Settings, LogOut, Zap, Loader, ClipboardList, Building2, UserCheck
} from 'lucide-react';
import { useAdminAuth } from '@/hooks/useAdminAuth';

const NAV = [
  { href: '/admin',                label: 'Dashboard',        icon: LayoutDashboard },
  { href: '/admin/agents',         label: 'Captains',         icon: Users           },
  { href: '/admin/hubs',           label: 'Hub Intelligence', icon: Building2       },
  { href: '/admin/members',        label: 'Members',          icon: UserCheck       },
  { href: '/admin/content',        label: 'Content',          icon: BookOpen        },
  { href: '/admin/assessments',    label: 'Assessments',      icon: ClipboardList   },
  { href: '/admin/reports',        label: 'Reports',          icon: BarChart3       },
  { href: '/admin/settings',       label: 'Settings',         icon: Settings, adminOnly: true },
];

interface Props {
  children:  ReactNode;
  title?:    string;
}

export default function AdminLayout({ children, title = 'Dashboard' }: Props) {
  const router              = useRouter();
  const { admin, loading, signOut } = useAdminAuth();

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f6fa' }}>
        <Loader size={28} style={{ animation: 'spin 1s linear infinite', color: '#9747FF' }} />
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const visibleNav = NAV.filter(n => !n.adminOnly || admin?.role === 'admin');

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#f5f6fa', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      {/* Sidebar */}
      <aside style={{ width: 220, background: '#1a1a2e', color: '#fff', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        {/* Brand */}
        <div style={{ padding: '24px 20px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg,#F43397,#9747FF)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Zap size={18} color="#fff" />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: '-0.3px' }}>Valmo LMS</div>
              <div style={{ fontSize: 10, opacity: 0.5, marginTop: 1 }}>
                {admin?.role === 'admin' ? 'Admin Portal' : 'Educator Portal'}
              </div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '12px 0' }}>
          {visibleNav.map(({ href, label, icon: Icon }) => {
            const active = router.pathname === href || (href !== '/admin' && router.pathname.startsWith(href));
            return (
              <Link key={href} href={href} style={{ textDecoration: 'none' }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 20px', margin: '2px 8px', borderRadius: 8,
                  background: active ? 'linear-gradient(135deg,rgba(244,51,151,0.25),rgba(151,71,255,0.15))' : 'transparent',
                  color: active ? '#F43397' : 'rgba(255,255,255,0.6)',
                  fontWeight: active ? 600 : 400, fontSize: 13,
                  borderLeft: active ? '2px solid #F43397' : '2px solid transparent',
                  transition: 'all 0.15s', cursor: 'pointer'
                }}>
                  <Icon size={16} />
                  {label}
                </div>
              </Link>
            );
          })}
        </nav>

        {/* User + Logout */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          {admin && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: 'linear-gradient(135deg,#F43397,#9747FF)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                {admin.name[0].toUpperCase()}
              </div>
              <div style={{ overflow: 'hidden' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{admin.name}</div>
                <div style={{ fontSize: 10, color: admin.role === 'admin' ? '#F43397' : '#9747FF', textTransform: 'capitalize' }}>{admin.role}</div>
              </div>
            </div>
          )}
          <button onClick={signOut} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 10px', background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: 8, color: 'rgba(255,255,255,0.5)', fontSize: 12, cursor: 'pointer' }}>
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <header style={{ background: '#fff', borderBottom: '1px solid #e8eaed', padding: '0 28px', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#1a1a2e', margin: 0 }}>{title}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px rgba(34,197,94,0.6)' }} />
            <span style={{ fontSize: 12, color: '#666' }}>Live</span>
          </div>
        </header>

        {/* Content */}
        <main style={{ flex: 1, overflow: 'auto', padding: 28 }}>
          {children}
        </main>
      </div>
    </div>
  );
}
