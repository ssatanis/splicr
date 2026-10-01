/**
 * Server side reads for the dashboard overview.
 *
 * The overview used to render `@/lib/mock/data` outright, which meant a
 * signed-in lab saw somebody else's invented screens, an invented calibration
 * curve and an invented validated rate. Everything here comes out of Postgres
 * instead, scoped to one organization, and anything the database cannot answer
 * yet is returned as empty or null so the page can say so rather than fill the
 * gap with a fixture.
 *
 * Same contract as `@/lib/data/org`: reads run with the caller's own session, so
 * Row Level Security decides what comes back, and nothing here throws at a page.
 */
import "server-only";

import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/env";

import { isUuid, type Modality } from "./types";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** Screen statuses the dashboard's StatusBadge knows how to draw. */
export type OverviewScreenStatus = "complete" | "running" | "queued" | "failed" | "draft";
export type OverviewQc = "pass" | "warn" | "fail" | "pending";

export interface OverviewScreen {
  id: string;
  name: string;
  cell_line: string | null;
  modality: Modality;
  phenotype: string | null;
  status: OverviewScreenStatus;
  qc: OverviewQc;
  /** atlas.libraries.id, or null when the library was never called. */
  library_id: string | null;
  n_hits: number;
  n_real_hits: number;
  created_at: string;
}

export interface OverviewHit {
  id: string;
  screen_id: string;
  gene: string;
  direction: "depleted" | "enriched";
  verdict: string;
  chance_real: number | null;
  fdr: number | null;
  lfc: number | null;
  /**
   * The per-hit evidence the console draws its tier and its guide chart from.
   *
   * These were not read before, and the overview filled them with nulls and an
   * empty flag array. An empty array is the positive claim "artifact screening
   * ran and raised nothing", which was false: the one real screen carries 10,938
   * flag rows. Every field here is nullable because the engine genuinely does not
   * write all of them yet, and a field it did not write must read "not recorded"
   * rather than zero.
   */
  n_guides: number | null;
  n_good_guides: number | null;
  /** Per-guide log2 fold change, the concordance view's whole input. */
  guide_lfcs: number[] | null;
  bayes_factor: number | null;
  novelty: number | null;
  /**
   * The gene's hit rate across the published Atlas, and whether that makes it a
   * frequent hitter. Both come from atlas.gene_stats, which holds 84,262 genes
   * and is refreshed by the splicr-refresh-gene-stats cron.
   *
   * The per-hit atlas_hit_count columns are never written --- they are absent
   * from the COPY list at engine/splicr/db.py:347 --- so reading them gave null
   * on all 20,916 rows and the tier could never reach four recorded legs. The
   * public.hit_report view already joins the live table, which is both cheaper
   * and fresher than the denormalised snapshot would have been.
   */
  atlas_hit_rate: number | null;
  is_frequent_hitter: boolean | null;
  /** Null when the flag read failed; empty only when the screen truly has none. */
  flags: string[] | null;
}


/**
 * Headline hits plus whether the scoring model has actually run.
 *
 * `scored` false means no hit in the workspace carries a `chance_real`, which is
 * the real state of a screen whose `score` stage was skipped for want of a
 * fitted model. The page then ranks by FDR and says that is what it is doing,
 * instead of printing a confidence nobody computed.
 */
export interface HeadlineHits {
  hits: OverviewHit[];
  scored: boolean;
}

export interface OverviewOutcome {
  id: string;
  gene: string;
  predicted: number | null;
  result: "validated" | "failed" | "inconclusive" | "pending";
  assay: string | null;
  logged_at: string;
}

export type OverviewStageStatus = "done" | "running" | "queued" | "failed" | "skipped";

export interface OverviewStage {
  key: string;
  title: string;
  status: OverviewStageStatus;
  detail: string;
  durationSec: number | null;
}

export interface LatestRun {
  id: string;
  screenId: string;
  screenName: string;
  status: string;
  stages: OverviewStage[];
}

/** One point of the reliability curve, derived from logged outcomes. */
export interface CalibrationBin {
  bin: string;
  predicted: number;
  observed: number;
  n: number;
}

export interface Calibration {
  /** Descriptive bins alone do not establish validation probabilities. */
  interpretation: "descriptive_only";
  bins: CalibrationBin[];
  /** Descriptive binned score/outcome discrepancy; not proof of calibration. */
  error: number;
  /** Outcomes that actually resolved, so validated or failed. */
  resolved: number;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const SCREEN_STATUSES: readonly OverviewScreenStatus[] = [
  "complete",
  "running",
  "queued",
  "failed",
  "draft",
];
const QC_VERDICTS: readonly OverviewQc[] = ["pass", "warn", "fail", "pending"];
const STAGE_STATUSES: readonly OverviewStageStatus[] = [
  "done",
  "running",
  "queued",
  "failed",
  "skipped",
];
const OUTCOME_RESULTS: readonly OverviewOutcome["result"][] = [
  "validated",
  "failed",
  "inconclusive",
  "pending",
];

/** The nine engine stages, in order, with the wording the pipeline page uses. */
const STAGE_TITLE: Record<string, string> = {
  ingest: "Ingest",
  detect: "Detect library",
  count: "Count",
  qc: "QC",
  hits: "Call hits",
  artifacts: "Flag artifacts",
  atlas: "Atlas context",
  score: "Score",
  report: "Report",
};

function note(scope: string, detail: unknown): void {
  const message =
    detail instanceof Error
      ? detail.message
      : typeof detail === "object" && detail !== null && "message" in detail
        ? String((detail as { message: unknown }).message)
        : String(detail);
  console.error(`[data/overview] ${scope}: ${message}`);
}

function rows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

function queryable(orgId: string | null | undefined): orgId is string {
  return isUuid(orgId) && supabaseConfigured;
}

/**
 * `archived` is a real screen status that the badge has no colour for, so it is
 * drawn as a draft. Anything unrecognised is treated the same way.
 */
function toScreenStatus(value: unknown): OverviewScreenStatus {
  return typeof value === "string" && (SCREEN_STATUSES as readonly string[]).includes(value)
    ? (value as OverviewScreenStatus)
    : "draft";
}

function toQc(value: unknown): OverviewQc {
  return typeof value === "string" && (QC_VERDICTS as readonly string[]).includes(value)
    ? (value as OverviewQc)
    : "pending";
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

interface ScreenRow {
  id: string;
  name: string;
  cell_line: string | null;
  modality: string | null;
  phenotype: string | null;
  status: string | null;
  qc: string | null;
  library_id: string | null;
  n_hits: number | null;
  n_real_hits: number | null;
  created_at: string;
}

const SCREEN_COLUMNS =
  "id, name, cell_line, modality, phenotype, status, qc, library_id, n_hits, n_real_hits, created_at";

/**
 * The workspace's own screens, newest first.
 *
 * `org_id` is filtered explicitly as well as relied on: the screens policy also
 * exposes public screens belonging to other organizations, and the overview must
 * only ever show the lab its own work. Backed by `screens_org_ix`.
 */
export async function listRecentScreens(orgId: string, limit = 5): Promise<OverviewScreen[]> {
  if (!queryable(orgId)) return [];

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("screens")
      .select(SCREEN_COLUMNS)
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      note("listRecentScreens", error);
      return [];
    }

    return rows<ScreenRow>(data).map((row) => ({
      id: row.id,
      name: row.name,
      cell_line: row.cell_line,
      modality: (row.modality ?? "knockout") as Modality,
      phenotype: row.phenotype,
      status: toScreenStatus(row.status),
      qc: toQc(row.qc),
      library_id: row.library_id,
      n_hits: row.n_hits ?? 0,
      n_real_hits: row.n_real_hits ?? 0,
      created_at: row.created_at,
    }));
  } catch (error) {
    note("listRecentScreens", error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Hits
// ---------------------------------------------------------------------------

interface HitRow {
  id: string;
  screen_id: string;
  gene_symbol: string;
  direction: string | null;
  verdict: string | null;
  chance_real: number | null;
  fdr: number | null;
  lfc: number | null;
  n_guides: number | null;
  n_good_guides: number | null;
  guide_lfcs: number[] | null;
  bayes_factor: number | null;
  novelty: number | null;
  atlas_gene_hit_rate: number | null;
  is_frequent_hitter: boolean | null;
  flags: string[] | null;
}

/**
 * The embed follows the shape already in production at `screen-report.ts`, which
 * keeps the read to one round trip. The query plan is unchanged: this is still a
 * `comparison_id` equality with an indexed order and a limit, which the file's own
 * measurements put at 1.5ms against 3.9-5.3s for an `in (...)` form, because the
 * RLS predicate is re-evaluated per row under an 8s statement timeout.
 */
const HIT_COLUMNS =
  "id, screen_id, gene_symbol, direction, verdict, chance_real, fdr, lfc, " +
  "n_guides, n_good_guides, guide_lfcs, bayes_factor, novelty, " +
  "flags, atlas_gene_hit_rate, is_frequent_hitter";

/** Postgres real[] arrives as an array; anything else is treated as not recorded. */
function toNumberArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const out = value.map((v) => toNumber(v)).filter((v): v is number => v !== null);
  return out.length === 0 ? null : out;
}

function toHit(row: HitRow): OverviewHit {
  return {
    id: row.id,
    screen_id: row.screen_id,
    gene: row.gene_symbol,
    direction: row.direction === "enriched" ? "enriched" : "depleted",
    verdict: row.verdict ?? "uncertain",
    chance_real: toNumber(row.chance_real),
    fdr: toNumber(row.fdr),
    lfc: toNumber(row.lfc),
    n_guides: toNumber(row.n_guides),
    n_good_guides: toNumber(row.n_good_guides),
    guide_lfcs: toNumberArray(row.guide_lfcs),
    bayes_factor: toNumber(row.bayes_factor),
    novelty: toNumber(row.novelty),
    atlas_hit_rate: toNumber(row.atlas_gene_hit_rate),
    is_frequent_hitter: typeof row.is_frequent_hitter === "boolean" ? row.is_frequent_hitter : null,
    flags: Array.isArray(row.flags) ? row.flags.filter((f) => typeof f === "string") : null,
  };
}

/**
 * How many comparisons the overview will read hits from. Each one is a separate
 * indexed lookup, so this bounds the work rather than the result.
 */
const MAX_HIT_SOURCES = 4;

/**
 * Hits from one comparison, ordered by the column named, cheaply.
 *
 * The `comparison_id` predicate has to be an equality test and the order has to
 * match an index, because the "read hits" policy is
 * `private.can_read_screen(hits.screen_id)`, which takes the row's own column.
 * Postgres cannot hoist that out of the scan, so it runs once per row it has to
 * consider, and whether that is 6 rows or 20,000 comes down to the plan:
 *
 *   comparison_id = <uuid>   order by fdr   limit 6  ->  Index Scan on
 *     hits_fdr_ix, RLS evaluated 6 times, 1.5ms
 *   comparison_id = any(...) order by fdr   limit 6  ->  sort over the whole
 *     filtered set, RLS evaluated ~19,000 times, 3.9s
 *   screen_id     = any(...) order by fdr   limit 6  ->  same, 5.3s
 *
 * Measured on this project's database with one screen of 20,916 hits. The
 * `authenticated` role has `statement_timeout=8s`, so the array forms are not
 * merely slow, they start failing outright at roughly twice today's data. Hence
 * one equality query per comparison, merged in TypeScript.
 */
async function hitsFromComparison(
  supabase: Awaited<ReturnType<typeof createClient>>,
  comparisonId: string,
  column: "chance_real" | "fdr",
  limit: number,
): Promise<OverviewHit[]> {
  let query = supabase
    .from("hit_report")
    .select(HIT_COLUMNS)
    .eq("comparison_id", comparisonId)
    .not(column, "is", null);

  // An artifact is never a headline hit. On the scored path the model has
  // already said so through `chance_real`, so the filter only applies here.
  if (column === "fdr") query = query.neq("verdict", "artifact");

  const { data, error } = await query
    .order(column, { ascending: column === "fdr" })
    .limit(limit);

  if (error) {
    note(`listHeadlineHits ${column}`, error);
    return [];
  }
  return rows<HitRow>(data).map(toHit);
}

/**
 * The hits worth looking at first, across the workspace's screens.
 *
 * Scored hits win when they exist, ranked by recorded model score (calibration is not established). Otherwise the
 * strongest by FDR come back with `scored` false, and the page words the card
 * differently rather than implying a confidence nobody computed.
 */
export async function listHeadlineHits(orgId: string, limit = 6): Promise<HeadlineHits> {
  if (!queryable(orgId)) return { hits: [], scored: false };

  try {
    const supabase = await createClient();

    // The primary comparison of each recent screen. `comparisons` is one row per
    // screen, so this read is small whatever the hit count.
    const { data: screenData, error: screenError } = await supabase
      .from("screens")
      .select("id")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(MAX_HIT_SOURCES);

    if (screenError) {
      note("listHeadlineHits screens", screenError);
      return { hits: [], scored: false };
    }

    const screenIds = rows<{ id: string }>(screenData).map((row) => row.id);
    if (screenIds.length === 0) return { hits: [], scored: false };

    const { data: comparisonData, error: comparisonError } = await supabase
      .from("comparisons")
      .select("id, screen_id, is_primary")
      .in("screen_id", screenIds)
      .order("is_primary", { ascending: false });

    if (comparisonError) {
      note("listHeadlineHits comparisons", comparisonError);
      return { hits: [], scored: false };
    }

    // One comparison per screen, the primary one where a screen has several.
    const perScreen = new Map<string, string>();
    for (const row of rows<{ id: string; screen_id: string }>(comparisonData)) {
      if (!perScreen.has(row.screen_id)) perScreen.set(row.screen_id, row.id);
    }

    const comparisonIds = [...perScreen.values()].slice(0, MAX_HIT_SOURCES);
    if (comparisonIds.length === 0) return { hits: [], scored: false };

    const scored = (
      await Promise.all(
        comparisonIds.map((id) => hitsFromComparison(supabase, id, "chance_real", limit)),
      )
    ).flat();

    if (scored.length > 0) {
      const top = scored
        .sort((a, b) => (b.chance_real ?? 0) - (a.chance_real ?? 0))
        .slice(0, limit);
      return { hits: top, scored: true };
    }

    // No recorded model score anywhere in the workspace. Fall back to statistical
    // strength, which is a different claim, and the page says which one it is.
    const byFdr = (
      await Promise.all(comparisonIds.map((id) => hitsFromComparison(supabase, id, "fdr", limit)))
    ).flat();

    const top = byFdr
      .sort((a, b) => (a.fdr ?? Number.POSITIVE_INFINITY) - (b.fdr ?? Number.POSITIVE_INFINITY))
      .slice(0, limit);

    return { hits: top, scored: false };
  } catch (error) {
    note("listHeadlineHits", error);
    return { hits: [], scored: false };
  }
}

// ---------------------------------------------------------------------------
// Validation outcomes
// ---------------------------------------------------------------------------

interface OutcomeRow {
  id: string;
  gene_symbol: string | null;
  predicted: number | null;
  result: string | null;
  assay: string | null;
  logged_at: string;
}

/** Outcomes the lab has logged, newest first. Backed by `validation_outcomes_org_ix`. */
export async function listRecentOutcomes(orgId: string, limit = 5): Promise<OverviewOutcome[]> {
  if (!queryable(orgId)) return [];

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("validation_outcomes")
      .select("id, gene_symbol, predicted, result, assay, logged_at")
      .eq("org_id", orgId)
      .order("logged_at", { ascending: false })
      .limit(limit);

    if (error) {
      note("listRecentOutcomes", error);
      return [];
    }

    return rows<OutcomeRow>(data).map((row) => ({
      id: row.id,
      gene: row.gene_symbol ?? "Unnamed gene",
      predicted: toNumber(row.predicted),
      result:
        typeof row.result === "string" &&
        (OUTCOME_RESULTS as readonly string[]).includes(row.result)
          ? (row.result as OverviewOutcome["result"])
          : "pending",
      assay: row.assay,
      logged_at: row.logged_at,
    }));
  } catch (error) {
    note("listRecentOutcomes", error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

const CALIBRATION_BANDS: { bin: string; lower: number; upper: number }[] = [
  { bin: "0-10%", lower: 0, upper: 0.1 },
  { bin: "10-20%", lower: 0.1, upper: 0.2 },
  { bin: "20-40%", lower: 0.2, upper: 0.4 },
  { bin: "40-60%", lower: 0.4, upper: 0.6 },
  { bin: "60-80%", lower: 0.6, upper: 0.8 },
  { bin: "80-100%", lower: 0.8, upper: 1.01 },
];

/** Below this there is no curve worth drawing, only noise. */
const MIN_RESOLVED_FOR_CALIBRATION = 10;

/**
 * Descriptive score/outcome bins from the lab's logged outcomes.
 * These pooled, selected observations do not establish calibrated probabilities.
 * Model/assay/study grouping and an independent calibration cohort are required
 * before any probability interpretation. This diagnostic is not shown by the UI.
 *
 * Only outcomes that actually resolved count: `inconclusive` and `pending` say
 * nothing about whether a prediction held. Returns null when too few have been
 * logged to plot, which is the honest answer for a young workspace and is what
 * the page renders an empty state for.
 */
export async function getCalibration(orgId: string): Promise<Calibration | null> {
  if (!queryable(orgId)) return null;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("validation_outcomes")
      .select("predicted, result")
      .eq("org_id", orgId)
      .in("result", ["validated", "failed"])
      .not("predicted", "is", null)
      .limit(5000);

    if (error) {
      note("getCalibration", error);
      return null;
    }

    const resolved = rows<{ predicted: number | null; result: string | null }>(data)
      .map((row) => ({ predicted: toNumber(row.predicted), validated: row.result === "validated" }))
      .filter((row): row is { predicted: number; validated: boolean } => row.predicted !== null && row.predicted >= 0 && row.predicted <= 1);

    if (resolved.length < MIN_RESOLVED_FOR_CALIBRATION) return null;

    const bins: CalibrationBin[] = [];
    let weightedError = 0;

    for (const band of CALIBRATION_BANDS) {
      const inBand = resolved.filter(
        (row) => row.predicted >= band.lower && row.predicted < band.upper,
      );
      if (inBand.length === 0) continue;

      const predicted = inBand.reduce((sum, row) => sum + row.predicted, 0) / inBand.length;
      const observed = inBand.filter((row) => row.validated).length / inBand.length;

      bins.push({ bin: band.bin, predicted, observed, n: inBand.length });
      weightedError += Math.abs(predicted - observed) * inBand.length;
    }

    if (bins.length === 0) return null;

    return { interpretation: "descriptive_only", bins, error: weightedError / resolved.length, resolved: resolved.length };
  } catch (error) {
    note("getCalibration", error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Latest run
// ---------------------------------------------------------------------------

interface RunRow {
  id: string;
  screen_id: string;
  status: string | null;
}

interface StageRow {
  stage: string | null;
  status: string | null;
  detail: string | null;
  duration_sec: number | string | null;
  position: number | null;
}

/**
 * The most recent run in the workspace, with its real stage rail.
 *
 * Stages come back in `position` order, which is the order the engine writes
 * them, so a skipped stage stays visible in place rather than being quietly
 * dropped. A skipped `score` or `atlas` stage is exactly what the overview needs
 * to show, because it explains why hits carry no recorded model score.
 */
export async function getLatestRun(orgId: string): Promise<LatestRun | null> {
  if (!queryable(orgId)) return null;

  try {
    const supabase = await createClient();
    const { data: runData, error: runError } = await supabase
      .from("runs")
      .select("id, screen_id, status")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (runError) {
      note("getLatestRun run", runError);
      return null;
    }

    const run = (runData ?? null) as RunRow | null;
    if (!run?.id) return null;

    const [stageResult, screenResult] = await Promise.all([
      supabase
        .from("run_stages")
        .select("stage, status, detail, duration_sec, position")
        .eq("run_id", run.id)
        .order("position", { ascending: true }),
      supabase.from("screens").select("name").eq("id", run.screen_id).maybeSingle(),
    ]);

    if (stageResult.error) note("getLatestRun stages", stageResult.error);
    if (screenResult.error) note("getLatestRun screen", screenResult.error);

    const stages: OverviewStage[] = rows<StageRow>(stageResult.data).map((row) => {
      const key = row.stage ?? "stage";
      return {
        key,
        title: STAGE_TITLE[key] ?? key,
        status:
          typeof row.status === "string" && (STAGE_STATUSES as readonly string[]).includes(row.status)
            ? (row.status as OverviewStageStatus)
            : "queued",
        detail: row.detail ?? "",
        durationSec: toNumber(row.duration_sec),
      };
    });

    const screenName =
      ((screenResult.data ?? null) as { name?: string } | null)?.name ?? "this screen";

    return {
      id: run.id,
      screenId: run.screen_id,
      screenName,
      status: run.status ?? "queued",
      stages,
    };
  } catch (error) {
    note("getLatestRun", error);
    return null;
  }
}
