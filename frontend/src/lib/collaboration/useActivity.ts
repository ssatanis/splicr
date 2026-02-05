'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';

export interface ActivityItem {
  id: string;
  analysisId: string;
  userId: string;
  activityType: string;
  description: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export function useActivity(analysisId: string) {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchActivities = useCallback(async () => {
    if (!analysisId) return;
    setLoading(true);

    try {
      const { data: activityData, error: activityError } = await supabase
        .from('analysis_activity')
        .select('*')
        .eq('analysis_id', analysisId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (!activityError && activityData?.length) {
        setActivities(
          activityData.map((a: any) => ({
            id: a.id,
            analysisId: a.analysis_id,
            userId: a.user_id,
            activityType: a.activity_type ?? a.action_type ?? 'unknown',
            description: a.description ?? '',
            metadata: a.metadata ?? {},
            createdAt: a.created_at,
          }))
        );
        setLoading(false);
        return;
      }
    } catch {
      // analysis_activity table may not exist
    }

    // PERFORMANCE OPTIMIZATION: Query activity_logs with indexed resource_id instead of
    // loading all logs and filtering client-side. The (resource_type, resource_id) composite
    // index makes this query very fast.
    try {
      const { data: logs } = await supabase
        .from('activity_logs')
        .select('*')
        .eq('resource_type', 'analysis')
        .eq('resource_id', analysisId) // Use indexed column instead of JSONB metadata filter
        .order('id', { ascending: false })
        .limit(50);

      setActivities(
        (logs ?? []).map((a: any) => ({
          id: a.id,
          analysisId: analysisId,
          userId: a.user_id,
          activityType: a.action_type ?? 'unknown',
          description: a.action_type ?? 'Activity',
          metadata: a.metadata ?? {},
          createdAt: a.recorded_at ?? a.created_at ?? new Date().toISOString(),
        }))
      );
    } catch {
      setActivities([]);
    }
    setLoading(false);
  }, [analysisId]);

  useEffect(() => {
    if (!analysisId) return;
    fetchActivities();

    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel(`activity:${analysisId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'analysis_activity',
            filter: `analysis_id=eq.${analysisId}`,
          },
          () => fetchActivities()
        )
        .subscribe();
    } catch {
      // Realtime / table may not exist
    }

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [analysisId, fetchActivities]);

  return { activities, loading, refetch: fetchActivities };
}
