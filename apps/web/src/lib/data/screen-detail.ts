/** Real screen detail reads. Session authorization and RLS apply to every query. */
import "server-only";

import { getCurrentContext } from "@/lib/data/org";
import { isUuid } from "@/lib/data/types";
import { DEFAULT_HIT_QUERY, type HitQuery } from "@/lib/report/hit-query";
import type { QcEvidence } from "@/lib/report/screen-doctor";
import { createClient } from "@/lib/supabase/server";

export const DETAIL_PAGE_SIZE = 100;

/** The FDR the summary counts as "significant". The console's own threshold, stated on the page. */
export const SIGNIFICANT_FDR = 0.1;

/** `_` is a wildcard in ILIKE and can occur in a symbol, so it is escaped; `q` is already reduced to symbol characters. */
function likePattern(text: string): string {
  return `%${text.replace(/_/g, "\\_")}%`;
}

export interface WorkspaceScreen {
  id: string;
  name: string;
  description: string | null;
  cell_line: string | null;
  modality: string;
  phenotype: string | null;
  status: string;
  qc: string;
  current_run_id: string | null;
  source_ref?: string | null;
  /** NCBI taxonomy id. The Atlas holds human screens only, so evidence is shown for 9606. */
  taxid: number | null;
}

export interface WorkspaceRun {
  id: string;
  status: string;
  engine_version: string | null;
  image_digest: string | null;
  settings?: { fdr_threshold?: number; [key: string]: unknown } | null;
  created_at: string;
  error: string | null;
}

export interface WorkspaceHit {
  id: string;
  comparison_id: string;
  gene_symbol: string;
  direction: string;
  lfc: number | null;
  p_value: number | null;
  fdr: number | null;
  bayes_factor: number | null;
  depleted_fdr?: number | null;
  enriched_fdr?: number | null;
  norm_z?: number | null;
  drugz_fdr?: number | null;
  mle_beta?: number | null;
  mle_fdr?: number | null;
  n_guides: number | null;
  n_good_guides: number | null;
  guide_lfcs: number[] | null;
  chance_real: number | null;
  model_version: string | null;
  hit_flags: { flag: string; severity: string; message: string }[];
}

export interface WorkspaceStage {
  stage: string;
  status: string;
  detail: string | null;
  tool: string | null;
}

/** The run's recorded QC, which is also what screens.qc rolls up. */
export interface RunQc {
  verdict: string;
  notes: string | null;
  nnmd: number | null;
  auroc: number | null;
  min_replicate_r: number | null;
  median_replicate_r: number | null;
  bottlenecked_samples: number | null;
  /**
   * The engine's own QC document: per-sample metrics with their labels and
   * roles, the replicate correlations, and which contrast the NNMD was taken
   * on. The scalar columns above are a subset of it, kept for sorting.
   */
  metrics: Record<string, unknown> | null;
}

/**
 * The QC document, reduced to what Screen Doctor reads.
 *
 * It is validated rather than cast: the blob is written by the engine and a
 * field that changed shape should make the panel say it cannot read the QC,
 * not render `undefined` beside a threshold.
 */
export function qcEvidence(qc: RunQc | null): QcEvidence | null {
  if (qc === null) return null;
  const metrics = (qc.metrics ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(metrics.samples) ? (metrics.samples as Record<string, unknown>[]) : [];
  const number = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const text = (value: unknown): string => (typeof value === "string" ? value : "");

  return {
    verdict: qc.verdict ?? null,
    nnmd: qc.nnmd ?? number(metrics.nnmd),
    nnmdContrast: typeof metrics.nnmd_contrast === "string" ? metrics.nnmd_contrast : null,
    auroc: qc.auroc ?? number(metrics.auroc),
    samples: rows
      .filter((row) => text(row.label) !== "")
      .map((row) => ({
        label: text(row.label),
        role: text(row.role),
        verdict: text(row.verdict),
        mapping_rate: number(row.mapping_rate),
        zero_fraction: number(row.zero_fraction),
        skew_ratio: number(row.skew_ratio),
        mean_reads_per_guide: number(row.mean_reads_per_guide),
        gini: number(row.gini),
        total_reads: number(row.total_reads),
      })),
    replicates: (Array.isArray(metrics.replicate_correlations) ? metrics.replicate_correlations : [])
      .filter((pair): pair is Record<string, unknown> => typeof pair === "object" && pair !== null)
      .map((pair) => ({ a: text(pair.a), b: text(pair.b), r: number(pair.r) }))
      .filter((pair) => pair.a !== "" && pair.b !== ""),
    bottlenecked: (Array.isArray(metrics.bottlenecked) ? metrics.bottlenecked : []).map(String),
  };
}

export interface Comparison {
  id: string;
  name: string;
  kind: string;
  is_primary: boolean;
}

/** Counts over the whole run, whatever the current filter, so a filter never hides the size of the run. */
export interface HitSummary {
  recorded: number;
  depleted: number;
  enriched: number;
  /** Recorded FDR at or below SIGNIFICANT_FDR. A hit with no recorded FDR is not counted, and not treated as insignificant. */
  significant: number;
  flagged: number;
  /** Of the significant ones, how many carry at least one artifact flag. */
  significantFlagged: number;
}

export interface ScreenDetail {
  screen: WorkspaceScreen;
  run: WorkspaceRun | null;
  /** Null when the run recorded no QC row at all, which is not the same as passing. */
  qc: RunQc | null;
  stages: WorkspaceStage[];
  comparisons: Comparison[];
  hits: WorkspaceHit[];
  /** Rows matching the filter, before paging. */
  total: number;
  page: number;
  summary: HitSummary;
}

export const EMPTY_SUMMARY: HitSummary = { recorded: 0, depleted: 0, enriched: 0, significant: 0, flagged: 0, significantFlagged: 0 };

export type ScreenDetailResult =
  | { status: "found"; detail: ScreenDetail }
  | { status: "not_found" }
  | { status: "unavailable" };

/** Do not accept an organization from the URL or substitute sample rows on error. */
export async function getScreenDetail(
  screenId: string,
  page = 1,
  query: Omit<HitQuery, "page"> = DEFAULT_HIT_QUERY,
): Promise<ScreenDetailResult> {
  if (!isUuid(screenId) || !Number.isSafeInteger(page) || page < 1 || page > 10000) {
    return { status: "not_found" };
  }
  const context = await getCurrentContext();
  if (!context.user || !context.org) return { status: "not_found" };
  try {
    const client = await createClient();
    const screenResult = await client.from("screens")
      .select("id, name, description, cell_line, modality, phenotype, status, qc, current_run_id, taxid, source_ref")
      .eq("id", screenId).eq("org_id", context.org.id).maybeSingle();
    if (screenResult.error) throw screenResult.error;
    if (!screenResult.data) return { status: "not_found" };
    const screen = screenResult.data as WorkspaceScreen;
    let runQuery = client.from("runs")
      .select("id, status, engine_version, image_digest, created_at, error, settings")
      .eq("screen_id", screenId).eq("org_id", context.org.id);
    if (screen.current_run_id) runQuery = runQuery.eq("id", screen.current_run_id);
    const runResult = await runQuery.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (runResult.error) throw runResult.error;
    const run = runResult.data as WorkspaceRun | null;
    if (!run) {
      // A dangling current-run pointer is an inconsistent record, not proof no analysis exists.
      if (screen.current_run_id) return { status: "unavailable" };
      return { status: "found", detail: { screen, run: null, qc: null, stages: [], comparisons: [], hits: [], total: 0, page, summary: EMPTY_SUMMARY } };
    }
    const threshold = run.settings?.fdr_threshold ?? SIGNIFICANT_FDR;
    const flagJoin = query.flagged ? "hit_flags!inner(flag, severity, message)" : "hit_flags(flag, severity, message)";
    const columns =
      `id, comparison_id, gene_symbol, direction, lfc, p_value, fdr, bayes_factor, depleted_fdr, enriched_fdr, norm_z, drugz_fdr, mle_beta, mle_fdr, n_guides, n_good_guides, guide_lfcs, chance_real, model_version, ${flagJoin}`;

    // Filters are added only when set, so the default view issues exactly the
    // statement it always did: this screen's rows for this run.
    let hitsQuery = client.from("hits").select(columns, { count: "exact" }).eq("screen_id", screenId).eq("run_id", run.id);
    if (query.direction) hitsQuery = hitsQuery.eq("direction", query.direction);
    if (query.maxFdr !== null) hitsQuery = hitsQuery.lte("fdr", query.maxFdr);
    if (query.comparison) hitsQuery = hitsQuery.eq("comparison_id", query.comparison);
    if (query.q !== "") hitsQuery = hitsQuery.ilike("gene_symbol", likePattern(query.q));
    const ascending = query.dir === "asc";
    hitsQuery = (
      query.sort === "gene"
        ? hitsQuery.order("gene_symbol", { ascending })
        : hitsQuery.order(query.sort, { ascending, nullsFirst: false }).order("gene_symbol")
    )
      .order("id")
      .range((page - 1) * DETAIL_PAGE_SIZE, page * DETAIL_PAGE_SIZE - 1);

    // Head counts over the whole run. They ignore the filter on purpose.
    const base = (select: string) =>
      client.from("hits").select(select, { count: "exact", head: true }).eq("screen_id", screenId).eq("run_id", run.id);

    const [stagesResult, comparisonsResult, hitsResult, depleted, enriched, significant, flagged, significantFlagged, qcResult] = await Promise.all([
      client.from("run_stages").select("stage, status, detail, tool")
        .eq("run_id", run.id).order("position"),
      client.from("comparisons").select("id, name, kind, is_primary")
        .eq("screen_id", screenId).order("is_primary", { ascending: false }),
      hitsQuery,
      base("id").eq("direction", "depleted"),
      base("id").eq("direction", "enriched"),
      base("id").lt("fdr", threshold),
      base("id, hit_flags!inner(flag)"),
      base("id, hit_flags!inner(flag)").lt("fdr", threshold),
      client.from("run_qc")
        .select("verdict, notes, nnmd, auroc, min_replicate_r, median_replicate_r, bottlenecked_samples, metrics")
        .eq("run_id", run.id).maybeSingle(),
    ]);
    for (const result of [stagesResult, comparisonsResult, hitsResult, depleted, enriched, significant, flagged, significantFlagged, qcResult]) {
      if (result.error) throw result.error;
    }
    // Every recorded row has a direction, so the two arms are the whole run.
    const recorded = (depleted.count ?? 0) + (enriched.count ?? 0);
    return {
      status: "found",
      detail: { screen, run, qc: (qcResult.data ?? null) as RunQc | null,
        stages: (stagesResult.data ?? []) as WorkspaceStage[],
        comparisons: (comparisonsResult.data ?? []) as Comparison[],
        hits: (hitsResult.data ?? []) as unknown as WorkspaceHit[], total: hitsResult.count ?? 0, page,
        summary: {
          recorded,
          depleted: depleted.count ?? 0,
          enriched: enriched.count ?? 0,
          significant: significant.count ?? 0,
          flagged: flagged.count ?? 0,
          significantFlagged: significantFlagged.count ?? 0,
        } },
    };
  } catch (error) {
    // Avoid raw database errors, which can contain private record values.
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "read_error";
    console.error(`[data/screen-detail] ${code}`);
    return { status: "unavailable" };
  }
}
