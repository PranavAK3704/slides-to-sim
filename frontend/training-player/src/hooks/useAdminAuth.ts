import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';

export interface AdminUser {
  user:    User;
  role:    'admin' | 'educator';
  email:   string;
  name:    string;
}

export function useAdminAuth() {
  const router  = useRouter();
  const [admin, setAdmin]     = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace(`/login?next=${encodeURIComponent(router.asPath)}`);
        return;
      }
      const role = (session.user.user_metadata?.lms_role as 'admin' | 'educator') || 'educator';
      setAdmin({
        user:  session.user,
        role,
        email: session.user.email || '',
        name:  session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'User',
      });
      setLoading(false);
    };

    check();

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        router.replace('/login');
      }
    });

    return () => listener.subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    router.replace('/login');
  };

  return { admin, loading, signOut };
}
