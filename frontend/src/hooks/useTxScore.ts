
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { TxScoreFilters, RankingOptions, TxScore } from '@sdk/txscore-client';

const API_BASE = '/api/txscore';

// --- TYPES ---
export interface RankingResponse {
    data: TxScore[];
    meta: {
        count: number;
        filters: TxScoreFilters;
        options: RankingOptions;
    };
}

export interface GeneProfile {
    gene: any;
    depmap: any[];
    gtex: any[];
    constraint: any;
    structure: any;
    clinvar: { all: any[]; pathogenic: any[] };
    drugs: { all: any[]; approved: any[] };
    trials: { all: any[]; advanced: any[] };
    txscores: TxScore[];
}

export interface SavedTarget {
    id: string;
    user_id: string;
    gene_id: string;
    list_name: string;
    created_at: string;
    gene: {
        gene_id: string;
        gene_symbol: string;
        gene_name: string;
    };
}

// --- HOOKS ---

export function useTargetRanking(
    filters: TxScoreFilters,
    options: RankingOptions
) {
    // Create a stable key hash from objects
    const filterKey = JSON.stringify(filters);
    const optionKey = JSON.stringify(options);

    return useQuery<RankingResponse>({
        queryKey: ['txscore', 'ranking', filterKey, optionKey],
        queryFn: async () => {
            const params = new URLSearchParams();

            // Add filters
            Object.entries(filters).forEach(([key, value]) => {
                if (value !== undefined) params.append(key, String(value));
            });

            // Add options
            Object.entries(options).forEach(([key, value]) => {
                if (value !== undefined) params.append(key, String(value));
            });

            const res = await fetch(`${API_BASE}/targets/ranking?${params.toString()}`);
            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.detail || errorData.message || 'Failed to fetch ranking');
            }
            return res.json();
        },
        // Keep data fresh but allow stale-while-revalidate for filters
        staleTime: 1000 * 60 * 5, // 5 mins
    });
}

export function useGeneOverview(symbol: string, cancerType?: string) {
    return useQuery<GeneProfile>({
        queryKey: ['txscore', 'overview', symbol, cancerType],
        queryFn: async () => {
            if (!symbol) throw new Error('Symbol required');
            const params = cancerType ? `?cancer_type=${cancerType}` : '';
            const res = await fetch(`${API_BASE}/targets/${symbol}/overview${params}`);
            if (!res.ok) throw new Error('Failed to fetch overview');
            return res.json();
        },
        enabled: !!symbol,
    });
}

export function useSavedTargets() {
    return useQuery<SavedTarget[]>({
        queryKey: ['txscore', 'saved'],
        queryFn: async () => {
            const res = await fetch(`${API_BASE}/user/saved`);
            if (!res.ok) throw new Error('Failed to fetch saved targets');
            return res.json();
        },
    });
}

export function useSaveTarget() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ geneId, listName }: { geneId: string; listName?: string }) => {
            const res = await fetch(`${API_BASE}/user/saved`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gene_id: geneId, list_name: listName }),
            });
            if (!res.ok) {
                if (res.status === 409) return; // Ignore duplicate
                throw new Error('Failed to save target');
            }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['txscore', 'saved'] });
        },
    });
}

export function useRemoveSavedTarget() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ geneId, listName }: { geneId: string; listName?: string }) => {
            const params = new URLSearchParams({ gene_id: geneId });
            if (listName) params.append('list_name', listName);

            const res = await fetch(`${API_BASE}/user/saved?${params.toString()}`, {
                method: 'DELETE',
            });
            if (!res.ok) throw new Error('Failed to delete target');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['txscore', 'saved'] });
        },
    });
}
