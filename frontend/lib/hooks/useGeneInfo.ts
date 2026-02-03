'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// ═══════════════════════════════════════════════════════════
// QUERY KEYS
// ═══════════════════════════════════════════════════════════

export const geneInfoKeys = {
  all: ['geneInfo'] as const,
  detail: (gene: string) => [...geneInfoKeys.all, gene] as const,
  drugGene: (gene: string) => [...geneInfoKeys.all, 'drugGene', gene] as const,
  expression: (gene: string) => [...geneInfoKeys.all, 'expression', gene] as const,
  literature: (gene: string) => [...geneInfoKeys.all, 'literature', gene] as const,
  structure: (gene: string) => [...geneInfoKeys.all, 'structure', gene] as const,
};

// ═══════════════════════════════════════════════════════════
// FETCH GENE INFO (with caching)
// ═══════════════════════════════════════════════════════════

export function useGeneInfo(geneSymbol: string | undefined | null) {
  return useQuery({
    queryKey: geneInfoKeys.detail(geneSymbol || ''),
    queryFn: async () => {
      if (!geneSymbol) throw new Error('Gene symbol required');
      
      console.log(`⏱️ [useGeneInfo] Fetching ${geneSymbol}...`);
      const startTime = performance.now();

      const response = await fetch(`/api/gene-info?symbol=${encodeURIComponent(geneSymbol)}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch gene info: ${response.statusText}`);
      }

      const data = await response.json();
      const elapsed = performance.now() - startTime;
      console.log(`⚡ [useGeneInfo] Loaded ${geneSymbol} in ${elapsed.toFixed(0)}ms`);

      return data;
    },
    enabled: !!geneSymbol,
    staleTime: 10 * 60 * 1000, // 10 minutes (gene info doesn't change often)
    gcTime: 30 * 60 * 1000, // 30 minutes cache retention
  });
}

// ═══════════════════════════════════════════════════════════
// FETCH DRUG-GENE INTERACTIONS (with caching)
// ═══════════════════════════════════════════════════════════

export function useDrugGene(geneSymbol: string | undefined | null) {
  return useQuery({
    queryKey: geneInfoKeys.drugGene(geneSymbol || ''),
    queryFn: async () => {
      if (!geneSymbol) throw new Error('Gene symbol required');
      
      console.log(`⏱️ [useDrugGene] Fetching drugs for ${geneSymbol}...`);
      const startTime = performance.now();

      const response = await fetch(`/api/drug-gene?gene=${encodeURIComponent(geneSymbol)}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch drug interactions: ${response.statusText}`);
      }

      const data = await response.json();
      const elapsed = performance.now() - startTime;
      console.log(`⚡ [useDrugGene] Loaded drugs in ${elapsed.toFixed(0)}ms`);

      return data;
    },
    enabled: !!geneSymbol,
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 30 * 60 * 1000,
  });
}

// ═══════════════════════════════════════════════════════════
// FETCH GENE EXPRESSION (with caching)
// ═══════════════════════════════════════════════════════════

export function useGeneExpression(geneSymbol: string | undefined | null) {
  return useQuery({
    queryKey: geneInfoKeys.expression(geneSymbol || ''),
    queryFn: async () => {
      if (!geneSymbol) throw new Error('Gene symbol required');
      
      console.log(`⏱️ [useGeneExpression] Fetching expression for ${geneSymbol}...`);
      const startTime = performance.now();

      const response = await fetch(`/api/expression?gene=${encodeURIComponent(geneSymbol)}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch expression data: ${response.statusText}`);
      }

      const data = await response.json();
      const elapsed = performance.now() - startTime;
      console.log(`⚡ [useGeneExpression] Loaded expression in ${elapsed.toFixed(0)}ms`);

      return data;
    },
    enabled: !!geneSymbol,
    staleTime: 15 * 60 * 1000, // 15 minutes (expression data doesn't change)
    gcTime: 60 * 60 * 1000, // 1 hour cache
  });
}

// ═══════════════════════════════════════════════════════════
// FETCH LITERATURE (with caching)
// ═══════════════════════════════════════════════════════════

export function useGeneLiterature(geneSymbol: string | undefined | null) {
  return useQuery({
    queryKey: geneInfoKeys.literature(geneSymbol || ''),
    queryFn: async () => {
      if (!geneSymbol) throw new Error('Gene symbol required');
      
      console.log(`⏱️ [useGeneLiterature] Fetching literature for ${geneSymbol}...`);
      const startTime = performance.now();

      const response = await fetch(`/api/literature?gene=${encodeURIComponent(geneSymbol)}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch literature: ${response.statusText}`);
      }

      const data = await response.json();
      const elapsed = performance.now() - startTime;
      console.log(`⚡ [useGeneLiterature] Loaded literature in ${elapsed.toFixed(0)}ms`);

      return data;
    },
    enabled: !!geneSymbol,
    staleTime: 30 * 60 * 1000, // 30 minutes
    gcTime: 2 * 60 * 60 * 1000, // 2 hours cache
  });
}

// ═══════════════════════════════════════════════════════════
// FETCH PROTEIN STRUCTURE (with caching)
// ═══════════════════════════════════════════════════════════

export function useGeneStructure(geneSymbol: string | undefined | null, uniprotId?: string) {
  return useQuery({
    queryKey: [...geneInfoKeys.structure(geneSymbol || ''), uniprotId],
    queryFn: async () => {
      if (!geneSymbol) throw new Error('Gene symbol required');
      
      console.log(`⏱️ [useGeneStructure] Fetching structure for ${geneSymbol}...`);
      const startTime = performance.now();

      const url = new URL('/api/structure', window.location.origin);
      url.searchParams.set('gene', geneSymbol);
      if (uniprotId) {
        url.searchParams.set('uniprotId', uniprotId);
      }

      const response = await fetch(url.toString());
      
      if (!response.ok) {
        throw new Error(`Failed to fetch structure: ${response.statusText}`);
      }

      const data = await response.json();
      const elapsed = performance.now() - startTime;
      console.log(`⚡ [useGeneStructure] Loaded structure in ${elapsed.toFixed(0)}ms`);

      return data;
    },
    enabled: !!geneSymbol,
    staleTime: 60 * 60 * 1000, // 1 hour (structures don't change)
    gcTime: 24 * 60 * 60 * 1000, // 24 hours cache
  });
}

// ═══════════════════════════════════════════════════════════
// PARALLEL GENE DATA LOADING
// Load all gene data at once (info, drugs, expression, etc.)
// ═══════════════════════════════════════════════════════════

export function useCompleteGeneData(geneSymbol: string | undefined | null) {
  const geneInfo = useGeneInfo(geneSymbol);
  const drugGene = useDrugGene(geneSymbol);
  const expression = useGeneExpression(geneSymbol);
  const literature = useGeneLiterature(geneSymbol);

  return {
    geneInfo,
    drugGene,
    expression,
    literature,
    isLoading: geneInfo.isLoading || drugGene.isLoading || expression.isLoading || literature.isLoading,
    isError: geneInfo.isError || drugGene.isError || expression.isError || literature.isError,
    error: geneInfo.error || drugGene.error || expression.error || literature.error,
  };
}

// ═══════════════════════════════════════════════════════════
// PREFETCH GENES (for instant navigation)
// ═══════════════════════════════════════════════════════════

export function usePrefetchGene() {
  const queryClient = useQueryClient();

  return (geneSymbol: string) => {
    // Prefetch all gene data in parallel
    queryClient.prefetchQuery({
      queryKey: geneInfoKeys.detail(geneSymbol),
      queryFn: async () => {
        const response = await fetch(`/api/gene-info?symbol=${encodeURIComponent(geneSymbol)}`);
        return response.json();
      },
      staleTime: 10 * 60 * 1000,
    });

    queryClient.prefetchQuery({
      queryKey: geneInfoKeys.drugGene(geneSymbol),
      queryFn: async () => {
        const response = await fetch(`/api/drug-gene?gene=${encodeURIComponent(geneSymbol)}`);
        return response.json();
      },
      staleTime: 10 * 60 * 1000,
    });

    console.log(`🔮 [Prefetch] Preloaded data for ${geneSymbol}`);
  };
}
