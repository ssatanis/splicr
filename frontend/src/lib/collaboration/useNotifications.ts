'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { getCollaborationAvailable } from './collaborationAvailable';

export interface NotificationItem {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export function useNotifications() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    getCollaborationAvailable().then(setEnabled);
  }, []);

  const fetchNotifications = useCallback(async () => {
    if (!user?.id || enabled !== true) return;

    try {
      const { data, error } = await supabase
        .from('user_notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(30);

      if (error) {
        setNotifications([]);
        return;
      }
      if (data) {
        setNotifications(
          data.map((n: any) => ({
            id: n.id,
            userId: n.user_id,
            title: n.title ?? 'Notification',
            message: n.message ?? '',
            type: n.type ?? 'info',
            read: !!n.read,
            createdAt: n.created_at,
            metadata: n.metadata,
          }))
        );
      } else {
        setNotifications([]);
      }
    } catch {
      setNotifications([]);
    }
  }, [user?.id, enabled]);

  useEffect(() => {
    if (!user?.id || enabled !== true) return;
    fetchNotifications();

    try {
      const channel = supabase
        .channel(`notifications:${user.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'user_notifications',
            filter: `user_id=eq.${user.id}`,
          },
          () => fetchNotifications()
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    } catch {
      return undefined;
    }
  }, [user?.id, fetchNotifications, enabled]);

  const markAsRead = useCallback(async (id: string) => {
    if (enabled !== true) return;
    try {
      await (supabase.from('user_notifications') as any).update({ read: true }).eq('id', id);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    } catch {
      // Table may not exist
    }
  }, [enabled]);

  const markAllAsRead = useCallback(async () => {
    if (!user?.id || enabled !== true) return;
    try {
      await (supabase.from('user_notifications') as any).update({ read: true }).eq('user_id', user.id);
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch {
      // Table may not exist
    }
  }, [user?.id, enabled]);

  return {
    notifications,
    markAsRead,
    markAllAsRead,
    refetch: fetchNotifications,
  };
}
