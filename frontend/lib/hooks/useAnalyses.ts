'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/client';
import type { Analysis } from '@/lib/types';

type DbAnalysis = Database['public']['Tables']['analyses']['Row'];
type AnalysisInsert = Database['public']['Tables']['analyses']['Insert'];
type AnalysisUpdate = Database['public']['Tables']['analyses']['Update'];

// ═══════════════════════════════════════════════════════════
// QUERY KEYS (Centralized for cache invalidation)
// ═══════════════════════════════════════════════════════════

export const analysisKeys = {
  all: ['analyses'] as const,
  lists: () => [...analysisKeys.all, 'list'] as const,
  list: (filters?: string) => [...analysisKeys.lists(), { filters }] as const,
  details: () => [...analysisKeys.all, 'detail'] as const,
  detail: (id: string) => [...analysisKeys.details(), id] as const,
  results: (id: string) => [...analysisKeys.detail(id), 'results'] as const,
  status: (id: string) => [...analysisKeys.detail(id), 'status'] as const,
};

// ═══════════════════════════════════════════════════════════
// FETCH ANALYSES (WITH INSTANT LOADING)
// ═══════════════════════════════════════════════════════════

export function useAnalyses() {
  return useQuery({
    queryKey: analysisKeys.lists(),
    queryFn: async () => {
      const startTime = performance.now();
      console.log('⏱️ [useAnalyses] Fetching analyses from API...');
      
      try {
        // Use the API route which has better fallback logic for unauthenticated users
        const response = await fetch('/api/analysis/list', {
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        
        if (!response.ok) {
          console.error('❌ [useAnalyses] Failed to fetch analyses:', response.status, response.statusText);
          return [];
        }

        const data = await response.json();
        const elapsed = performance.now() - startTime;
        console.log(`⚡ [useAnalyses] Loaded ${data?.length || 0} analyses in ${elapsed.toFixed(0)}ms`);

        return data as Analysis[];
      } catch (error) {
        console.error('❌ [useAnalyses] Exception fetching analyses:', error);
        return [];
      }
    },
    // CRITICAL: Enable instant feel
    staleTime: 30 * 1000, // Fresh for 30 seconds (analyses change frequently)
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
  });
}

// ═══════════════════════════════════════════════════════════
// FETCH SINGLE ANALYSIS (WITH INSTANT LOADING)
// ═══════════════════════════════════════════════════════════

export function useAnalysis(id: string | undefined | null) {
  const supabase = createClient();

  return useQuery({
    queryKey: analysisKeys.detail(id || ''),
    queryFn: async () => {
      if (!id) throw new Error('Analysis ID required');
      
      console.log(`⏱️ [useAnalysis] Fetching analysis ${id}...`);
      const startTime = performance.now();

      const { data, error } = await supabase
        .from('analyses')
        .select('*')
        .eq('id', id)
        .single();

      const elapsed = performance.now() - startTime;
      console.log(`⚡ [useAnalysis] Loaded in ${elapsed.toFixed(0)}ms`);

      if (error) throw error;
      return data as DbAnalysis;
    },
    enabled: !!id, // Only run if ID exists
    staleTime: 20 * 1000, // Fresh for 20 seconds
    gcTime: 5 * 60 * 1000,
  });
}

// ═══════════════════════════════════════════════════════════
// CREATE ANALYSIS (WITH OPTIMISTIC UPDATE)
// ═══════════════════════════════════════════════════════════

export function useCreateAnalysis() {
  const queryClient = useQueryClient();
  const supabase = createClient();

  return useMutation({
    mutationFn: async (newAnalysis: AnalysisInsert) => {
      console.log('🚀 [useCreateAnalysis] Creating analysis...');
      const startTime = performance.now();

      const { data, error } = await (supabase
        .from('analyses') as any)
        .insert([newAnalysis])
        .select()
        .single();

      const elapsed = performance.now() - startTime;
      console.log(`✅ [useCreateAnalysis] Created in ${elapsed.toFixed(0)}ms`);

      if (error) throw error;
      return data as DbAnalysis;
    },

    // OPTIMISTIC UPDATE (INSTANT UI FEEDBACK)
    onMutate: async (newAnalysis) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: analysisKeys.lists() });

      // Snapshot previous value
      const previousAnalyses = queryClient.getQueryData<Analysis[]>(analysisKeys.lists());

      // Optimistically update cache
      queryClient.setQueryData<Analysis[]>(analysisKeys.lists(), (old) => {
        const optimisticAnalysis = {
          id: `temp-${Date.now()}`,
          status: 'created',
          algorithm: [],
          libraryType: 'brunello',
          fileKeys: [],
          sampleLabels: [],
          parameters: {},
          createdAt: new Date().toISOString(),
          progress: 0,
          ...newAnalysis,
          name: newAnalysis.name || 'New Analysis',
        } as unknown as Analysis;

        return old ? [optimisticAnalysis, ...old] : [optimisticAnalysis];
      });

      console.log('⚡ [useCreateAnalysis] Optimistic update applied');

      return { previousAnalyses };
    },

    // On error, rollback
    onError: (err, newAnalysis, context) => {
      console.error('❌ [useCreateAnalysis] Failed:', err);
      if (context?.previousAnalyses) {
        queryClient.setQueryData(analysisKeys.lists(), context.previousAnalyses);
      }
    },

    // On success, refetch to get real data
    onSuccess: (data) => {
      console.log('✨ [useCreateAnalysis] Success, invalidating cache');
      queryClient.invalidateQueries({ queryKey: analysisKeys.lists() });
    },
  });
}

// ═══════════════════════════════════════════════════════════
// UPDATE ANALYSIS (WITH OPTIMISTIC UPDATE)
// ═══════════════════════════════════════════════════════════

export function useUpdateAnalysis() {
  const queryClient = useQueryClient();
  const supabase = createClient();

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: AnalysisUpdate }) => {
      console.log(`🔄 [useUpdateAnalysis] Updating ${id}...`);
      const startTime = performance.now();

      const { data, error } = await (supabase
        .from('analyses') as any)
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      const elapsed = performance.now() - startTime;
      console.log(`✅ [useUpdateAnalysis] Updated in ${elapsed.toFixed(0)}ms`);

      if (error) throw error;
      return data as DbAnalysis;
    },

    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: analysisKeys.lists() });
      await queryClient.cancelQueries({ queryKey: analysisKeys.detail(id) });

      const previousAnalyses = queryClient.getQueryData<Analysis[]>(analysisKeys.lists());
      const previousAnalysis = queryClient.getQueryData<DbAnalysis>(analysisKeys.detail(id));

      // Optimistically update list
      queryClient.setQueryData<Analysis[]>(analysisKeys.lists(), (old) =>
        old?.map((analysis) =>
          analysis.id === id
            ? { ...analysis, ...updates as any }
            : analysis
        )
      );

      // Optimistically update detail
      queryClient.setQueryData<DbAnalysis>(analysisKeys.detail(id), (old) =>
        old ? { ...old, ...updates, updated_at: new Date().toISOString() } : old
      );

      console.log('⚡ [useUpdateAnalysis] Optimistic update applied');

      return { previousAnalyses, previousAnalysis };
    },

    onError: (err, { id }, context) => {
      console.error('❌ [useUpdateAnalysis] Failed:', err);
      if (context?.previousAnalyses) {
        queryClient.setQueryData(analysisKeys.lists(), context.previousAnalyses);
      }
      if (context?.previousAnalysis) {
        queryClient.setQueryData(analysisKeys.detail(id), context.previousAnalysis);
      }
    },

    onSuccess: (data, { id }) => {
      console.log('✨ [useUpdateAnalysis] Success, invalidating cache');
      queryClient.invalidateQueries({ queryKey: analysisKeys.lists() });
      queryClient.invalidateQueries({ queryKey: analysisKeys.detail(id) });
    },
  });
}

// ═══════════════════════════════════════════════════════════
// DELETE ANALYSIS (WITH OPTIMISTIC UPDATE)
// ═══════════════════════════════════════════════════════════

export function useDeleteAnalysis() {
  const queryClient = useQueryClient();
  const supabase = createClient();

  return useMutation({
    mutationFn: async (id: string) => {
      console.log(`🗑️ [useDeleteAnalysis] Deleting ${id}...`);
      const startTime = performance.now();

      const { error } = await supabase
        .from('analyses')
        .delete()
        .eq('id', id);

      const elapsed = performance.now() - startTime;
      console.log(`✅ [useDeleteAnalysis] Deleted in ${elapsed.toFixed(0)}ms`);

      if (error) throw error;
    },

    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: analysisKeys.lists() });

      const previousAnalyses = queryClient.getQueryData<Analysis[]>(analysisKeys.lists());

      // Optimistically remove
      queryClient.setQueryData<Analysis[]>(analysisKeys.lists(), (old) =>
        old?.filter((analysis) => analysis.id !== id)
      );

      console.log('⚡ [useDeleteAnalysis] Optimistic removal applied');

      return { previousAnalyses };
    },

    onError: (err, id, context) => {
      console.error('❌ [useDeleteAnalysis] Failed:', err);
      if (context?.previousAnalyses) {
        queryClient.setQueryData(analysisKeys.lists(), context.previousAnalyses);
      }
    },

    onSuccess: () => {
      console.log('✨ [useDeleteAnalysis] Success, invalidating cache');
      queryClient.invalidateQueries({ queryKey: analysisKeys.lists() });
    },
  });
}

// ═══════════════════════════════════════════════════════════
// PARALLEL LOADING - Load multiple analyses at once
// ═══════════════════════════════════════════════════════════

export function useAnalysesBatch(ids: string[]) {
  const supabase = createClient();

  return useQuery({
    queryKey: [...analysisKeys.all, 'batch', ids],
    queryFn: async () => {
      console.log(`⏱️ [useAnalysesBatch] Fetching ${ids.length} analyses in parallel...`);
      const startTime = performance.now();

      const { data, error } = await supabase
        .from('analyses')
        .select('*')
        .in('id', ids);

      const elapsed = performance.now() - startTime;
      console.log(`⚡ [useAnalysesBatch] Loaded ${data?.length || 0} in ${elapsed.toFixed(0)}ms`);

      if (error) throw error;
      return data as DbAnalysis[];
    },
    enabled: ids.length > 0,
    staleTime: 30 * 1000,
  });
}
