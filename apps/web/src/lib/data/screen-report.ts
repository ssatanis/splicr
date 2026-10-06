/**
 * Everything a workspace Hit Report export needs, read with the caller's session.
 *
 * The export is the recorded run and nothing else: the statistics the engine
 * wrote, the flags it raised and the model output it stored, for this screen's
 * current run. It does not recompute a statistic, re-rank a gene or add a
 * probability. The organization comes from the session, the screen must belong
 * to it, and a failed read is `unavailable`, never an empty report, because a
 * downloaded table with no rows cannot tell a screen with no hits from a read
 * that did not finish.
 */
import "server-only";

import { getCurrentContext } from "@/lib/data/org";
import { isUuid } from "@/lib/data/types";
import { createClient } from "@/lib/supabase/server";

import type { Comparison, WorkspaceRun, WorkspaceScreen } from "./screen-detail";

/** An export is a file, not a page, but a file still has a limit. */
export const REPORT_ROW_CAP = 50_000;
const CHUNK = 1000;

export interface ReportHitRow {
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
  cn_corrected: boolean | null;
  chance_real: number | null;
  novelty: number | null;
  verdict: string | null;
  reason: string | null;
  model_version: string | null;
  atlas_hit_count: number | null;
  atlas_screen_count: number | null;
  atlas_hit_rate: number | null;
  hit_flags: { flag: string; severity: string; message: string }[] | null;
  stat_rank?: number | null;
  rra_score?: number | null;
  chronos_effect?: number | null;
  max_guide_share?: number | null;
  guide_lfcs?: number[] | null;
  chance_lower?: number | null;
  chance_upper?: number | null;
  reason_features?: Record<string, unknown> | null;
}

export interface ReportData {
  screen: WorkspaceScreen;
  run: WorkspaceRun | null;
  comparisons: Comparison[];
  hits: ReportHitRow[];
  /** True when the run has more rows than the cap and the file stops at it. */
  truncated: boolean;
}

export type ScreenReportResult =
  | { status: "found"; data: ReportData }
  | { status: "not_found" }
  | { status: "workspace_required" }
  | { status: "unavailable" };

const HIT_COLUMNS =
  "id, comparison_id, gene_symbol, direction, lfc, p_value, fdr, bayes_factor, depleted_fdr, enriched_fdr, norm_z, drugz_fdr, mle_beta, mle_fdr, n_guides, n_good_guides, cn_corrected, chance_real, novelty, verdict, reason, model_version, atlas_hit_count, atlas_screen_count, atlas_hit_rate, stat_rank, rra_score, chronos_effect, max_guide_share, guide_lfcs, chance_lower, chance_upper, reason_features, hit_flags(flag, severity, message)";

export async function getScreenReportData(screenId: string): Promise<ScreenReportResult> {
  if (!isUuid(screenId)) return { status: "not_found" };
  const context = await getCurrentContext();
  if (!context.user || !context.org) return { status: "workspace_required" };
  const orgId = context.org.id;

  try {
    const client = await createClient();
    const screenResult = await client
      .from("screens")
      .select("id, name, description, cell_line, modality, phenotype, status, qc, current_run_id, taxid, source_ref")
      .eq("id", screenId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (screenResult.error) throw screenResult.error;
    if (!screenResult.data) return { status: "not_found" };
    const screen = screenResult.data as WorkspaceScreen;

    let runQuery = client
      .from("runs")
      .select("id, status, engine_version, image_digest, created_at, started_at, finished_at, error, settings")
      .eq("screen_id", screenId)
      .eq("org_id", orgId);
    if (screen.current_run_id) runQuery = runQuery.eq("id", screen.current_run_id);
    const runResult = await runQuery.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (runResult.error) throw runResult.error;
    const run = runResult.data as WorkspaceRun | null;
    // A dangling pointer is an inconsistent record, not proof that no analysis exists.
    if (!run) {
      if (screen.current_run_id) return { status: "unavailable" };
      return { status: "found", data: { screen, run: null, comparisons: [], hits: [], truncated: false } };
    }

    const comparisonsResult = await client
      .from("comparisons")
      .select("id, name, kind, is_primary")
      .eq("screen_id", screenId)
      .order("is_primary", { ascending: false });
    if (comparisonsResult.error || !Array.isArray(comparisonsResult.data)) throw comparisonsResult.error ?? new Error("Comparison read unavailable");

    const hits: ReportHitRow[] = [];
    let truncated = false;
    for (let from = 0; ; from += CHUNK) {
      const chunk = await client
        .from("hits")
        .select(HIT_COLUMNS)
        .eq("screen_id", screenId)
        .eq("run_id", run.id)
        .order("fdr", { ascending: true, nullsFirst: false })
        .order("gene_symbol")
        .order("id")
        .range(from, from + CHUNK - 1);
      if (chunk.error || !Array.isArray(chunk.data)) throw chunk.error ?? new Error("Result read unavailable");
      const rows = (chunk.data ?? []) as unknown as ReportHitRow[];
      hits.push(...rows);
      if (rows.length < CHUNK) break;
      if (hits.length >= REPORT_ROW_CAP) {
        const extra = await client.from("hits").select("id")
          .eq("screen_id", screenId).eq("run_id", run.id)
          .order("fdr", { ascending: true, nullsFirst: false }).order("gene_symbol").order("id")
          .range(REPORT_ROW_CAP, REPORT_ROW_CAP);
        if (extra.error || !Array.isArray(extra.data)) throw extra.error ?? new Error("Result limit check unavailable");
        truncated = (extra.data ?? []).length > 0;
        break;
      }
    }

    return {
      status: "found",
      data: {
        screen,
        run,
        comparisons: (comparisonsResult.data ?? []) as Comparison[],
        hits: hits.slice(0, REPORT_ROW_CAP),
        truncated,
      },
    };
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "read_error";
    console.error(`[data/screen-report] ${code}`);
    return { status: "unavailable" };
  }
}
