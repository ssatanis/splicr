'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface PresenceUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  currentView: string;
  cursorPosition?: { x: number; y: number; element?: string };
  lastSeen: string;
}

export function usePresence(analysisId: string) {
  const { user } = useAuth();
  const [activeUsers, setActiveUsers] = useState<PresenceUser[]>([]);

  const fetchActiveUsers = useCallback(async () => {
    if (!user?.id) return;
    try {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from('analysis_presence')
        .select('*')
        .eq('analysis_id', analysisId)
        .neq('user_id', user.id)
        .gte('last_seen', fiveMinAgo);

      if (data) {
        setActiveUsers(
          data.map((p: any) => ({
            id: p.user_id,
            displayName: p.display_name ?? 'Unknown',
            avatarUrl: p.avatar_url ?? null,
            currentView: p.current_view ?? 'results_table',
            cursorPosition: p.cursor_position ?? undefined,
            lastSeen: p.last_seen,
          }))
        );
      } else {
        setActiveUsers([]);
      }
    } catch {
      setActiveUsers([]);
    }
  }, [analysisId, user?.id]);

  useEffect(() => {
    if (!user || !analysisId) return;

    const updatePresence = async (view: string, cursor?: { x: number; y: number; element?: string }) => {
      try {
        await (supabase.from('analysis_presence') as any)
          .upsert({
            analysis_id: analysisId,
            user_id: user.id,
            display_name: user.display_name || user.email,
            avatar_url: user.avatar_url,
            current_view: view,
            cursor_position: cursor ?? null,
            last_seen: new Date().toISOString(),
          }, { onConflict: 'analysis_id,user_id' });
      } catch {
        // Table may not exist or RLS may block
      }
    };

    updatePresence('results_table');

    const heartbeat = setInterval(() => {
      updatePresence('results_table');
    }, 10000);

    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel(`presence:${analysisId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'analysis_presence',
            filter: `analysis_id=eq.${analysisId}`,
          },
          () => fetchActiveUsers()
        )
        .subscribe();
      fetchActiveUsers();
    } catch {
      setActiveUsers([]);
    }

    return () => {
      clearInterval(heartbeat);
      if (channel) supabase.removeChannel(channel);
      void (async () => {
        try {
          await (supabase.from('analysis_presence') as any)
            .delete()
            .eq('analysis_id', analysisId)
            .eq('user_id', user.id);
        } catch {
          // ignore
        }
      })();
    };
  }, [analysisId, user, fetchActiveUsers]);

  const updateView = useCallback(
    async (view: string) => {
      if (!user) return;
      try {
        await (supabase.from('analysis_presence') as any)
          .upsert({
            analysis_id: analysisId,
            user_id: user.id,
            display_name: user.display_name || user.email,
            avatar_url: user.avatar_url,
            current_view: view,
            last_seen: new Date().toISOString(),
          }, { onConflict: 'analysis_id,user_id' });
      } catch {
        // Table may not exist
      }
    },
    [analysisId, user]
  );

  const updateCursor = useCallback(
    async (x: number, y: number, element?: string) => {
      if (!user) return;
      try {
        await (supabase.from('analysis_presence') as any)
          .update({
            cursor_position: { x, y, element },
            last_seen: new Date().toISOString(),
          })
          .eq('analysis_id', analysisId)
          .eq('user_id', user.id);
      } catch {
        // Table may not exist
      }
    },
    [analysisId, user]
  );

  return {
    activeUsers,
    updateView,
    updateCursor,
  };
}
