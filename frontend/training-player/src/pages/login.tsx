import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '@/lib/supabase';
import { Zap, Eye, EyeOff, Loader } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const next   = (router.query.next as string) || '/admin';

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [mode,     setMode]     = useState<'login' | 'forgot'>('login');
  const [sent,     setSent]     = useState(false);

  // If already logged in, redirect
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace(next);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) {
      setError(err.message);
      setLoading(false);
    } else {
      router.replace(next);
    }
  };

  const handleForgot = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/admin/settings?tab=password`
    });
    setLoading(false);
    if (err) { setError(err.message); } else { setSent(true); }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg,#0f0c29,#302b63,#24243e)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif' }}>
      <div style={{ width: '100%', maxWidth: 400, padding: '0 24px' }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg,#F43397,#9747FF)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16, boxShadow: '0 8px 32px rgba(244,51,151,0.4)' }}>
            <Zap size={28} color="#fff" />
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#fff', letterSpacing: '-0.5px' }}>Valmo LMS</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>
            {mode === 'login' ? 'Sign in to the admin portal' : 'Reset your password'}
          </div>
        </div>

        {/* Card */}
        <div style={{ background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: '32px 28px' }}>

          {mode === 'login' ? (
            <form onSubmit={handleLogin}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                  Email
                </label>
                <input
                  type="email" required
                  value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@valmo.in"
                  style={{ width: '100%', padding: '11px 14px', background: 'rgba(255,255,255,0.08)', border: '1.5px solid rgba(255,255,255,0.12)', borderRadius: 10, fontSize: 14, color: '#fff', boxSizing: 'border-box', outline: 'none' }}
                />
              </div>

              <div style={{ marginBottom: 20, position: 'relative' }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                  Password
                </label>
                <input
                  type={showPw ? 'text' : 'password'} required
                  value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  style={{ width: '100%', padding: '11px 40px 11px 14px', background: 'rgba(255,255,255,0.08)', border: '1.5px solid rgba(255,255,255,0.12)', borderRadius: 10, fontSize: 14, color: '#fff', boxSizing: 'border-box', outline: 'none' }}
                />
                <button type="button" onClick={() => setShowPw(!showPw)} style={{ position: 'absolute', right: 12, bottom: 11, background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', padding: 0 }}>
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
                <button type="button" onClick={() => { setMode('forgot'); setError(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9747FF', fontSize: 12, float: 'right', marginTop: 6, padding: 0 }}>
                  Forgot password?
                </button>
              </div>

              {error && (
                <div style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#fca5a5', marginBottom: 16 }}>
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading} style={{ width: '100%', padding: '13px', background: 'linear-gradient(135deg,#F43397,#9747FF)', border: 'none', borderRadius: 10, color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: loading ? 0.7 : 1 }}>
                {loading ? <><Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> Signing in…</> : 'Sign in'}
              </button>
            </form>

          ) : sent ? (
            <div style={{ textAlign: 'center', padding: '8px 0' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>📧</div>
              <div style={{ fontWeight: 700, color: '#fff', fontSize: 15, marginBottom: 8 }}>Check your email</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 20 }}>We sent a password reset link to <strong style={{ color: '#fff' }}>{email}</strong></div>
              <button onClick={() => { setMode('login'); setSent(false); }} style={{ color: '#9747FF', background: 'none', border: 'none', fontSize: 13, cursor: 'pointer' }}>← Back to login</button>
            </div>

          ) : (
            <form onSubmit={handleForgot}>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                  Your email
                </label>
                <input
                  type="email" required
                  value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@valmo.in"
                  style={{ width: '100%', padding: '11px 14px', background: 'rgba(255,255,255,0.08)', border: '1.5px solid rgba(255,255,255,0.12)', borderRadius: 10, fontSize: 14, color: '#fff', boxSizing: 'border-box', outline: 'none' }}
                />
              </div>
              {error && <div style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#fca5a5', marginBottom: 16 }}>{error}</div>}
              <button type="submit" disabled={loading} style={{ width: '100%', padding: '13px', background: 'linear-gradient(135deg,#F43397,#9747FF)', border: 'none', borderRadius: 10, color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: loading ? 0.7 : 1 }}>
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
              <button type="button" onClick={() => { setMode('login'); setError(''); }} style={{ width: '100%', marginTop: 10, padding: '10px', background: 'none', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, color: 'rgba(255,255,255,0.5)', fontSize: 13, cursor: 'pointer' }}>
                ← Back to login
              </button>
            </form>
          )}
        </div>

        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>
          Valmo Operations · Internal Tool
        </div>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } input::placeholder { color: rgba(255,255,255,0.25); }`}</style>
    </div>
  );
}
