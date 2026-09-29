/** Real screen detail reads. Session authorization and RLS apply to every query. */
import "server-only";

import { getCurrentContext } from "@/lib/data/org";
import { isUuid } from "@/lib/data/types";
import { DEFAULT_HIT_QUERY, type HitQuery } from "@/lib/report/hit-query";
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
  /** NCBI taxonomy id. The Atlas holds human screens only, so evidence is shown for 9606. */
  taxid: number | null;
}

export interface WorkspaceRun {
  id: string;
  status: string;
  engine_version: string | null;
  image_digest: string | null;
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
}

export interface ScreenDetail {
  screen: WorkspaceScreen;
  run: WorkspaceRun | null;
  stages: WorkspaceStage[];
  comparisons: Comparison[];
  hits: WorkspaceHit[];
  /** Rows matching the filter, before paging. */
  total: number;
  page: number;
  summary: HitSummary;
}

export const EMPTY_SUMMARY: HitSummary = { recorded: 0, depleted: 0, enriched: 0, significant: 0, flagged: 0 };

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
  if (context.isDemo || !context.user || !context.org) return { status: "not_found" };
  try {
    const client = await createClient();
    const screenResult = await client.from("screens")
      .select("id, name, description, cell_line, modality, phenotype, status, qc, current_run_id, taxid")
      .eq("id", screenId).eq("org_id", context.org.id).maybeSingle();
    if (screenResult.error) throw screenResult.error;
    if (!screenResult.data) return { status: "not_found" };
    const screen = screenResult.data as WorkspaceScreen;
    let runQuery = client.from("runs")
      .select("id, status, engine_version, image_digest, created_at, error")
      .eq("screen_id", screenId).eq("org_id", context.org.id);
    if (screen.current_run_id) runQuery = runQuery.eq("id", screen.current_run_id);
    const runResult = await runQuery.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (runResult.error) throw runResult.error;
    const run = runResult.data as WorkspaceRun | null;
    if (!run) {
      // A dangling current-run pointer is an inconsistent record, not proof no analysis exists.
      if (screen.current_run_id) return { status: "unavailable" };
      return { status: "found", detail: { screen, run: null, stages: [], comparisons: [], hits: [], total: 0, page, summary: EMPTY_SUMMARY } };
    }
    const flagJoin = query.flagged ? "hit_flags!inner(flag, severity, message)" : "hit_flags(flag, severity, message)";
    const columns =
      `id, comparison_id, gene_symbol, direction, lfc, p_value, fdr, bayes_factor, n_guides, n_good_guides, guide_lfcs, chance_real, model_version, ${flagJoin}`;

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

    const [stagesResult, comparisonsResult, hitsResult, depleted, enriched, significant, flagged] = await Promise.all([
      client.from("run_stages").select("stage, status, detail, tool")
        .eq("run_id", run.id).order("position"),
      client.from("comparisons").select("id, name, kind, is_primary")
        .eq("screen_id", screenId).order("is_primary", { ascending: false }),
      hitsQuery,
      base("id").eq("direction", "depleted"),
      base("id").eq("direction", "enriched"),
      base("id").lte("fdr", SIGNIFICANT_FDR),
      base("id, hit_flags!inner(flag)"),
    ]);
    for (const result of [stagesResult, comparisonsResult, hitsResult, depleted, enriched, significant, flagged]) {
      if (result.error) throw result.error;
    }
    // Every recorded row has a direction, so the two arms are the whole run.
    const recorded = (depleted.count ?? 0) + (enriched.count ?? 0);
    return {
      status: "found",
      detail: { screen, run, stages: (stagesResult.data ?? []) as WorkspaceStage[],
        comparisons: (comparisonsResult.data ?? []) as Comparison[],
        hits: (hitsResult.data ?? []) as unknown as WorkspaceHit[], total: hitsResult.count ?? 0, page,
        summary: {
          recorded,
          depleted: depleted.count ?? 0,
          enriched: enriched.count ?? 0,
          significant: significant.count ?? 0,
          flagged: flagged.count ?? 0,
        } },
    };
  } catch (error) {
    // Avoid raw database errors, which can contain private record values.
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "read_error";
    console.error(`[data/screen-detail] ${code}`);
    return { status: "unavailable" };
  }
}
