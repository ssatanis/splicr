'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';

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

  const fetchNotifications = useCallback(async () => {
    if (!user?.id) return;

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
      }
    } catch {
      setNotifications([]);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
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
  }, [user?.id, fetchNotifications]);

  const markAsRead = useCallback(async (id: string) => {
    await (supabase.from('user_notifications') as any).update({ read: true }).eq('id', id);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }, []);

  const markAllAsRead = useCallback(async () => {
    if (!user?.id) return;
    await (supabase.from('user_notifications') as any).update({ read: true }).eq('user_id', user.id);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, [user?.id]);

  return {
    notifications,
    markAsRead,
    markAllAsRead,
    refetch: fetchNotifications,
  };
}
