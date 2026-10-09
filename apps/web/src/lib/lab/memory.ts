import type { GeneIndex } from "@/lib/atlas/types";

/** Bounded deterministic edit distance. Suggestions are labelled, never hidden aliases. */
export function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, prev[j] + 1, prev[j - 1] + Number(a[i - 1] !== b[j - 1]));
    prev = next;
  }
  return prev[b.length];
}
export interface GeneResolution { query: string; symbol: string | null; kind: "exact" | "alias" | "suggested" | "ambiguous" | "unrecognized"; suggestions: string[] }
export function resolveGene(raw: string, index: GeneIndex): GeneResolution {
  const query = raw.trim().toUpperCase().slice(0, 64);
  if (!/^[A-Z0-9._-]{1,64}$/.test(query)) return { query, symbol: null, kind: "unrecognized", suggestions: [] };
  if (index.bySymbol.has(query)) return { query, symbol: query, kind: "exact", suggestions: [] };
  const alias = index.byAlias.get(query);
  if (alias) return { query, symbol: alias, kind: "alias", suggestions: [] };
  const candidates = index.table.symbols.filter(s => !s.includes("_") && Math.abs(s.length - query.length) <= 2)
    .map(symbol => ({ symbol, distance: editDistance(query, symbol) }))
    .filter(s => s.distance <= (query.length < 5 ? 1 : 2))
    .sort((a, b) => a.distance - b.distance || a.symbol.localeCompare(b.symbol));
  const nearest = candidates.filter(s => s.distance === candidates[0]?.distance);
  return { query, symbol: nearest.length === 1 ? nearest[0].symbol : nearest.length ? null : query,
    kind: nearest.length === 1 ? "suggested" : nearest.length ? "ambiguous" : "unrecognized",
    suggestions: candidates.slice(0, 8).map(s => s.symbol) };
}
export type MeasurementStatus = "hit" | "measured_not_hit" | "measured_uncalled" | "not_measured" | "not_analysed";
export const STATUS_LABEL: Record<MeasurementStatus, string> = {
  hit: "Hit", measured_not_hit: "Measured · not a hit", measured_uncalled: "Measured · call unavailable",
  not_measured: "No recorded measurement", not_analysed: "Analysis incomplete",
};
export interface MemoryRow {
  screen_id: string; screen_name: string; run_id: string | null; run_status: string | null;
  comparison_id: string | null; comparison_name: string | null; current_run: boolean | null;
  cell_line: string | null; phenotype: string | null; modality: string; library_id: string | null;
  qc_verdict: string | null; finished_at: string | null; hit_id: string | null; n_guides: number | null;
  lfc: number | null; fdr: number | null; depleted_fdr: number | null; enriched_fdr: number | null;
  mle_beta: number | null; mle_fdr: number | null; norm_z: number | null; drugz_fdr: number | null; bayes_factor: number | null;
  threshold: number | null; threshold_source: string; measurement_status: MeasurementStatus;
  completed_methods: string[] | null; reagent_lot: string | null;
  experiment_details: { date?: string; researcher_name?: string } | null;
  validation_outcomes: { assay: string | null; result: string; evidence: unknown; created_at: string }[] | null;
}
export interface MemoryPayload { schema: "splicr.lab-memory.v1"; gene: string; total: number; rows: MemoryRow[] }
export function isMemoryPayload(value: unknown): value is MemoryPayload {
  if (!value || typeof value !== "object") return false;
  const data = value as MemoryPayload;
  return data.schema === "splicr.lab-memory.v1" && typeof data.gene === "string" && Number.isSafeInteger(data.total) && data.total >= 0
    && Array.isArray(data.rows) && data.rows.every(row => row && typeof row.screen_id === "string" && typeof row.screen_name === "string" && Object.hasOwn(STATUS_LABEL,row.measurement_status)
      && ["lfc","fdr","threshold","n_guides","depleted_fdr","enriched_fdr","mle_beta","mle_fdr","norm_z","drugz_fdr","bayes_factor"].every(key => {
        const value = row[key as keyof MemoryRow]; return value === null || (typeof value === "number" && Number.isFinite(value));
      })
      && (row.completed_methods === null || (Array.isArray(row.completed_methods) && row.completed_methods.every(m => typeof m === "string")))
      && (row.validation_outcomes === null || (Array.isArray(row.validation_outcomes) && row.validation_outcomes.every(o => o && typeof o.result === "string"))));
}
