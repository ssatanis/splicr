'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useUser } from '@/lib/context/UserContext';

export interface AuthUser {
  id: string;
  email: string | null;
  display_name: string;
  avatar_url: string | null;
}

export function useAuth() {
  const { userData } = useUser();
  const [sessionUser, setSessionUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    const loadSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setSessionUser({
          id: session.user.id,
          email: session.user.email ?? null,
          display_name:
            (session.user.user_metadata?.display_name as string) ??
            (session.user.user_metadata?.full_name as string) ??
            session.user.email ??
            'User',
          avatar_url: session.user.user_metadata?.avatar_url ?? null,
        });
      } else {
        setSessionUser(null);
      }
    };
    loadSession();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      loadSession();
    });
    return () => subscription.unsubscribe();
  }, []);

  // Prefer Supabase session; fallback to UserContext (local/stored user)
  const user: AuthUser | null =
    sessionUser ??
    (userData
      ? {
          id: userData.userId,
          email: userData.email ?? null,
          display_name: userData.email ?? 'User',
          avatar_url: null,
        }
      : null);

  return { user };
}
