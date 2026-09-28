/** Real screen detail reads. Session authorization and RLS apply to every query. */
import "server-only";

import { getCurrentContext } from "@/lib/data/org";
import { isUuid } from "@/lib/data/types";
import { createClient } from "@/lib/supabase/server";

export const DETAIL_PAGE_SIZE = 100;

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

interface Comparison {
  id: string;
  name: string;
  kind: string;
  is_primary: boolean;
}

export interface ScreenDetail {
  screen: WorkspaceScreen;
  run: WorkspaceRun | null;
  stages: WorkspaceStage[];
  comparisons: Comparison[];
  hits: WorkspaceHit[];
  total: number;
  page: number;
}

export type ScreenDetailResult =
  | { status: "found"; detail: ScreenDetail }
  | { status: "not_found" }
  | { status: "unavailable" };

/** Do not accept an organization from the URL or substitute sample rows on error. */
export async function getScreenDetail(screenId: string, page = 1): Promise<ScreenDetailResult> {
  if (!isUuid(screenId) || !Number.isSafeInteger(page) || page < 1 || page > 10000) {
    return { status: "not_found" };
  }
  const context = await getCurrentContext();
  if (context.isDemo || !context.user || !context.org) return { status: "not_found" };
  try {
    const client = await createClient();
    const screenResult = await client.from("screens")
      .select("id, name, description, cell_line, modality, phenotype, status, qc, current_run_id")
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
      return { status: "found", detail: { screen, run: null, stages: [], comparisons: [], hits: [], total: 0, page } };
    }
    const [stagesResult, comparisonsResult, hitsResult] = await Promise.all([
      client.from("run_stages").select("stage, status, detail, tool")
        .eq("run_id", run.id).order("position"),
      client.from("comparisons").select("id, name, kind, is_primary")
        .eq("screen_id", screenId).order("is_primary", { ascending: false }),
      client.from("hits").select(
        "id, comparison_id, gene_symbol, direction, lfc, p_value, fdr, bayes_factor, n_guides, n_good_guides, guide_lfcs, chance_real, model_version, hit_flags(flag, severity, message)",
        { count: "exact" },
      ).eq("screen_id", screenId).eq("run_id", run.id)
        .order("fdr", { ascending: true, nullsFirst: false })
        .order("gene_symbol").order("id")
        .range((page - 1) * DETAIL_PAGE_SIZE, page * DETAIL_PAGE_SIZE - 1),
    ]);
    for (const result of [stagesResult, comparisonsResult, hitsResult]) {
      if (result.error) throw result.error;
    }
    return {
      status: "found",
      detail: { screen, run, stages: (stagesResult.data ?? []) as WorkspaceStage[],
        comparisons: (comparisonsResult.data ?? []) as Comparison[],
        hits: (hitsResult.data ?? []) as WorkspaceHit[], total: hitsResult.count ?? 0, page },
    };
  } catch (error) {
    // Avoid raw database errors, which can contain private record values.
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "read_error";
    console.error(`[data/screen-detail] ${code}`);
    return { status: "unavailable" };
  }
}
