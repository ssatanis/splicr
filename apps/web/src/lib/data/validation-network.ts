/**
 * Reads for the Validation Network page.
 *
 * The page's job is to answer one question honestly: can SplicR state a
 * validation probability, and if not, what is outstanding? Today the answer is
 * no for all four questions, and this module's job is to make that answer come
 * from the database rather than from a hard-coded string, so that the page
 * changes by itself the moment a cohort exists.
 *
 * WHAT A FAILED READ IS NOT
 *
 * It is not an unfitted network. `unavailable` and "no model is fitted" are
 * different statements and only one of them is good news, so a read error never
 * degrades into the empty state. Every other workspace page in this console
 * follows the same rule.
 *
 * WHAT IS COUNTED HERE AND WHAT IS NOT
 *
 * The per-question status comes from `validation_network_status`, which is
 * global: a fitted head is a property of the whole validation cohort, not of
 * one workspace. The outcome counts beside it are the caller's own workspace,
 * because "you have contributed 12 outcomes" and "the network holds 400" are
 * both worth knowing and are not the same number. The page labels each one.
 */
import "server-only";

import { getCurrentContext } from "@/lib/data/org";
import { isOutcomeResult, type OutcomeResult } from "@/lib/outcomes/model";
import { createClient } from "@/lib/supabase/server";
import {
  armRate,
  compareArms,
  differenceSentence,
  discordance,
  progress,
  type ArmDifference,
  type ArmRate,
  type Discordance,
  type RoundProgress,
} from "@/lib/validation/evaluate";
import {
  COVERAGE_THRESHOLDS,
  QUESTIONS,
  QUESTION_LABEL,
  RUNGS,
  isEndpointDecision,
  isQuestion,
  isValidationArm,
  isValidationType,
  outstandingFor,
  rungBecause,
  rungState,
  type EndpointDecision,
  type Question,
  type RoundState,
  type ValidationArm,
  type RungState,
  type ValidationType,
} from "@/lib/validation/model";

export interface HeadStatus {
  question: Question;
  available: boolean;
  modelVersion: string | null;
  algorithm: string | null;
  calibrator: string | null;
  calibrationSource: string | null;
  nDecided: number | null;
  nLabs: number | null;
  nTest: number | null;
  testLabs: readonly string[];
  brier: number | null;
  brierBaseRate: number | null;
  beatsBaseRate: boolean | null;
  ece: number | null;
  calibrationSlope: number | null;
  calibrationIntercept: number | null;
  evidencedLow: number | null;
  evidencedHigh: number | null;
  reliabilityBins: readonly ReliabilityBin[];
  cohortSha256: string | null;
  fittedAt: string | null;
  nOpenStrata: number;
  nStrata: number;
}

export interface ReliabilityBin {
  label: string;
  n: number;
  predicted: number | null;
  observed: number | null;
  observedLower: number | null;
  observedUpper: number | null;
  /** True when the bin holds too few outcomes to be read as a measurement. */
  sparse: boolean;
}

export interface TypeCount {
  type: ValidationType | null;
  total: number;
  validated: number;
  failed: number;
  inconclusive: number;
  pending: number;
  nLabs: number;
}

export interface NetworkView {
  status: "ready";
  /** One entry per question, always four, fitted or not. */
  heads: HeadStatus[];
  /** This workspace's own contribution, by experiment. */
  contribution: TypeCount[];
  /** Outcomes in this workspace with no experiment recorded. */
  nUnclassified: number;
  nRounds: number;
  nFrozenRounds: number;
  nReceipts: number;
  canWrite: boolean;
}

export type NetworkViewResult =
  | NetworkView
  | { status: "workspace_required" | "unavailable" };

const finite = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const integer = (value: unknown): number | null => {
  const n = finite(value);
  return n === null ? null : Math.round(n);
};

interface StatusRow {
  question: string;
  is_available: boolean | null;
  model_version: string | null;
  algorithm: string | null;
  calibrator: string | null;
  calibration_source: string | null;
  n_decided: number | null;
  n_labs: number | null;
  n_test: number | null;
  test_labs: string[] | null;
  brier: number | string | null;
  brier_base_rate: number | string | null;
  beats_base_rate: boolean | null;
  ece: number | string | null;
  calibration_slope: number | string | null;
  calibration_intercept: number | string | null;
  evidenced_low: number | string | null;
  evidenced_high: number | string | null;
  reliability_bins: unknown;
  cohort_sha256: string | null;
  fitted_at: string | null;
  n_open_strata: number | string | null;
  n_strata: number | string | null;
}

/**
 * Reliability bins as the chart holds them.
 *
 * A bin with no outcomes keeps null for predicted and observed rather than a
 * zero, so the chart can draw a gap where there is no evidence instead of
 * interpolating across it. `sparse` is the engine's own flag, not recomputed
 * here, so the console and the engine agree about which bins are too thin to
 * quote.
 */
function toBins(value: unknown): ReliabilityBin[] {
  if (!Array.isArray(value)) return [];
  const out: ReliabilityBin[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const bin = raw as Record<string, unknown>;
    const n = integer(bin.n) ?? 0;
    out.push({
      label: typeof bin.label === "string" ? bin.label : "",
      n,
      predicted: finite(bin.predicted),
      observed: finite(bin.observed),
      observedLower: finite(bin.observed_lower),
      observedUpper: finite(bin.observed_upper),
      sparse: bin.sparse === true || n < 10,
    });
  }
  return out;
}

function emptyHead(question: Question): HeadStatus {
  return {
    question,
    available: false,
    modelVersion: null,
    algorithm: null,
    calibrator: null,
    calibrationSource: null,
    nDecided: null,
    nLabs: null,
    nTest: null,
    testLabs: [],
    brier: null,
    brierBaseRate: null,
    beatsBaseRate: null,
    ece: null,
    calibrationSlope: null,
    calibrationIntercept: null,
    evidencedLow: null,
    evidencedHigh: null,
    reliabilityBins: [],
    cohortSha256: null,
    fittedAt: null,
    nOpenStrata: 0,
    nStrata: 0,
  };
}

function toHead(row: StatusRow): HeadStatus | null {
  if (!isQuestion(row.question)) return null;
  const base = emptyHead(row.question);
  // A model version is what makes a head real. The view left-joins, so a
  // question with no current model comes back with nulls and `is_available`
  // false, and that row is the unfitted state rather than a missing one.
  if (row.is_available !== true || !row.model_version) return base;
  return {
    ...base,
    available: true,
    modelVersion: row.model_version,
    algorithm: row.algorithm,
    calibrator: row.calibrator,
    calibrationSource: row.calibration_source,
    nDecided: integer(row.n_decided),
    nLabs: integer(row.n_labs),
    nTest: integer(row.n_test),
    testLabs: Array.isArray(row.test_labs) ? row.test_labs : [],
    brier: finite(row.brier),
    brierBaseRate: finite(row.brier_base_rate),
    beatsBaseRate: row.beats_base_rate,
    ece: finite(row.ece),
    calibrationSlope: finite(row.calibration_slope),
    calibrationIntercept: finite(row.calibration_intercept),
    evidencedLow: finite(row.evidenced_low),
    evidencedHigh: finite(row.evidenced_high),
    reliabilityBins: toBins(row.reliability_bins),
    cohortSha256: row.cohort_sha256,
    fittedAt: row.fitted_at,
    nOpenStrata: integer(row.n_open_strata) ?? 0,
    nStrata: integer(row.n_strata) ?? 0,
  };
}

interface OutcomeTypeRow {
  validation_type: string | null;
  result: string;
  lab_id: string | null;
}

export async function getNetworkView(): Promise<NetworkViewResult> {
  const context = await getCurrentContext();
  if (!context.user || !context.org) return { status: "workspace_required" };
  const orgId = context.org.id;

  try {
    const client = await createClient();
    const [statusResult, outcomesResult, roundsResult, receiptsResult] =
      await Promise.all([
        client.from("validation_network_status").select("*"),
        client
          .from("validation_outcomes")
          .select("validation_type, result, lab_id")
          .eq("org_id", orgId)
          // The 1,000-row PostgREST ceiling applies here. A workspace with more
          // than a thousand outcomes needs an aggregate, and the panel says so
          // rather than quietly reporting the first thousand.
          .limit(1001),
        client
          .from("validation_rounds")
          .select("id, state")
          .eq("org_id", orgId)
          .limit(1001),
        client
          .from("prediction_receipts")
          .select("id")
          .eq("org_id", orgId)
          .limit(1001),
      ]);

    if (statusResult.error) throw statusResult.error;
    if (outcomesResult.error) throw outcomesResult.error;
    if (roundsResult.error) throw roundsResult.error;
    if (receiptsResult.error) throw receiptsResult.error;

    const rows = (statusResult.data ?? []) as unknown as StatusRow[];
    const byQuestion = new Map<Question, HeadStatus>();
    for (const row of rows) {
      const head = toHead(row);
      if (head) byQuestion.set(head.question, head);
    }
    // Always four, in the declared order. A page that showed only the fitted
    // heads would tell the reader the product does four things well.
    const heads = QUESTIONS.map((question) => byQuestion.get(question) ?? emptyHead(question));

    const outcomes = (outcomesResult.data ?? []) as unknown as OutcomeTypeRow[];
    const buckets = new Map<ValidationType | null, TypeCount & { labs: Set<string> }>();
    let nUnclassified = 0;
    for (const row of outcomes) {
      const type = isValidationType(row.validation_type) ? row.validation_type : null;
      if (type === null) nUnclassified++;
      let bucket = buckets.get(type);
      if (!bucket) {
        bucket = {
          type,
          total: 0,
          validated: 0,
          failed: 0,
          inconclusive: 0,
          pending: 0,
          nLabs: 0,
          labs: new Set<string>(),
        };
        buckets.set(type, bucket);
      }
      bucket.total++;
      if (
        row.result === "validated" ||
        row.result === "failed" ||
        row.result === "inconclusive" ||
        row.result === "pending"
      ) {
        bucket[row.result]++;
      }
      if (row.lab_id) bucket.labs.add(row.lab_id);
    }
    const contribution = [...buckets.values()]
      .map(({ labs, ...rest }) => ({ ...rest, nLabs: labs.size }))
      .sort((a, b) => b.total - a.total || String(a.type).localeCompare(String(b.type)));

    const rounds = (roundsResult.data ?? []) as { id: string; state: string }[];

    return {
      status: "ready",
      heads,
      contribution,
      nUnclassified,
      nRounds: rounds.length,
      nFrozenRounds: rounds.filter((r) => r.state !== "draft").length,
      nReceipts: (receiptsResult.data ?? []).length,
      canWrite:
        context.role === "owner" || context.role === "admin" || context.role === "member",
    };
  } catch (error) {
    console.error("[data/validation-network] read failed", error);
    return { status: "unavailable" };
  }
}

/**
 * What is outstanding before a probability can be stated, for one head.
 *
 * The wording lives in `@/lib/validation/model`, which is pure, so the page
 * that renders it does not have to import this `server-only` module to get a
 * sentence.
 */
export function outstanding(head: HeadStatus): string[] {
  return outstandingFor(head.available);
}

// ---------------------------------------------------------------------------
// The validation ladder, for one candidate
// ---------------------------------------------------------------------------

export interface LadderRung {
  key: string;
  label: string;
  gloss: string;
  question: Question | null;
  state: RungState;
  because: string;
  nOutcomes: number;
  nMet: number;
  nNotMet: number;
  nInconclusive: number;
  nPending: number;
  nUnscored?: number;
  /** The gate's answer for this rung's question, or null for the primary rung. */
  estimateAvailable: boolean;
  estimateBecause: string | null;
}

export interface LadderView {
  status: "ready";
  gene: string;
  rungs: LadderRung[];
  nOutcomes: number;
  nUnplaced: number;
  /** The earliest rung with nothing on it, or a mixed rung worth repeating. */
  next: { label: string; why: string } | null;
}

export type LadderViewResult =
  | LadderView
  | { status: "workspace_required" | "unavailable" | "not_found" };

interface LadderDbRow {
  gene_symbol: string;
  rung_key: string;
  state: string;
  n_outcomes: number | string | null;
  n_met: number | string | null;
  n_not_met: number | string | null;
  n_inconclusive: number | string | null;
  n_pending: number | string | null;
  n_unscored?: number | string | null;
}

/**
 * One candidate's ladder, from the database view plus the console's rung specs.
 *
 * The view has no primary rung: the screen's own call lives on the hit, not in
 * `validation_outcomes`, so the view cannot see it. The caller passes
 * `primarySignificant` from the hit row, and null means no primary call is
 * recorded — which is not the same as the screen not calling the gene.
 */
export async function getLadderView(
  gene: string,
  options: { primarySignificant?: boolean | null; screenId?: string | null } = {},
): Promise<LadderViewResult> {
  const context = await getCurrentContext();
  if (!context.user || !context.org) return { status: "workspace_required" };
  const symbol = gene.trim();
  if (symbol === "") return { status: "not_found" };

  try {
    const client = await createClient();
    let query = client
      .from("validation_ladder")
      .select("gene_symbol, rung_key, state, n_outcomes, n_met, n_not_met, n_inconclusive, n_pending, n_unscored")
      .eq("org_id", context.org.id)
      .ilike("gene_symbol", symbol);
    if (options.screenId) query = query.eq("screen_id", options.screenId);
    const result = await query;
    if (result.error) throw result.error;

    const rows = (result.data ?? []) as unknown as LadderDbRow[];
    const byKey = new Map<string, LadderDbRow>();
    for (const row of rows) {
      // One screen filter already applied; without it a gene validated in two
      // screens of the same workspace contributes to both, and the counts add.
      const existing = byKey.get(row.rung_key);
      if (!existing) {
        byKey.set(row.rung_key, { ...row });
        continue;
      }
      existing.n_outcomes = (integer(existing.n_outcomes) ?? 0) + (integer(row.n_outcomes) ?? 0);
      existing.n_met = (integer(existing.n_met) ?? 0) + (integer(row.n_met) ?? 0);
      existing.n_not_met = (integer(existing.n_not_met) ?? 0) + (integer(row.n_not_met) ?? 0);
      existing.n_inconclusive =
        (integer(existing.n_inconclusive) ?? 0) + (integer(row.n_inconclusive) ?? 0);
      existing.n_pending = (integer(existing.n_pending) ?? 0) + (integer(row.n_pending) ?? 0);
      existing.n_unscored = (integer(existing.n_unscored) ?? 0) + (integer(row.n_unscored) ?? 0);
    }

    // The gate, per question. Read once here rather than per rung, because two
    // rungs share the cross_model question and must not disagree about it, and
    // read from the status view alone rather than through `getNetworkView` -
    // the ladder does not need this workspace's outcome counts, its rounds or
    // its receipts, and pulling them would cost four queries to render one
    // panel.
    const availability = await headAvailability(client);
    let primarySignificant = options.primarySignificant ?? null;
    if (options.primarySignificant === undefined && options.screenId) {
      const screen = await client.from("screens").select("current_run_id").eq("org_id", context.org.id).eq("id", options.screenId).maybeSingle();
      if (screen.error) throw screen.error;
      if (screen.data?.current_run_id) {
        const [hit, run] = await Promise.all([
          client.from("hits").select("fdr").eq("run_id", screen.data.current_run_id).ilike("gene_symbol", symbol).maybeSingle(),
          client.from("runs").select("settings").eq("id", screen.data.current_run_id).maybeSingle(),
        ]);
        if (hit.error) throw hit.error;
        if (run.error) throw run.error;
        const threshold = Number(run.data?.settings?.fdr_threshold ?? 0.1);
        if (hit.data?.fdr !== null && hit.data?.fdr !== undefined && Number.isFinite(threshold)) primarySignificant = Number(hit.data.fdr) < threshold;
      }
    }

    const rungs: LadderRung[] = RUNGS.map((spec) => {
      if (spec.key === "primary") {
        const significant = primarySignificant;
        return {
          key: spec.key,
          label: spec.label,
          gloss: spec.gloss,
          question: null,
          state:
            significant === true ? "met" : significant === false ? "not_met" : "not_tested",
          because:
            significant === true
              ? "The screen called this gene."
              : significant === false
                ? "The screen did not call this gene."
                : "No primary call is recorded for this gene in this workspace.",
          nOutcomes: 0,
          nMet: 0,
          nNotMet: 0,
          nInconclusive: 0,
          nPending: 0,
          estimateAvailable: false,
          estimateBecause: null,
        };
      }
      const row = byKey.get(spec.key);
      const counts = {
        met: integer(row?.n_met) ?? 0,
        notMet: integer(row?.n_not_met) ?? 0,
        inconclusive: integer(row?.n_inconclusive) ?? 0,
        pending: integer(row?.n_pending) ?? 0,
      };
      const head = spec.question ? availability.get(spec.question) : undefined;
      const unscored = integer(row?.n_unscored) ?? 0;
      const headAvailable = head?.available ?? false;
      return {
        key: spec.key,
        label: spec.label,
        gloss: spec.gloss,
        question: spec.question,
        state: rungState(counts),
        because: unscored === (integer(row?.n_outcomes) ?? 0) && unscored > 0
          ? "Reported bench evidence is retained. The prespecified endpoint could not score these records because required criteria were not recorded."
          : rungBecause(counts) + (unscored > 0 ? ` ${unscored} reported outcomes lack the criteria needed for endpoint scoring.` : ""),
        nOutcomes: integer(row?.n_outcomes) ?? 0,
        nMet: counts.met,
        nNotMet: counts.notMet,
        nInconclusive: counts.inconclusive,
        nPending: counts.pending,
        nUnscored: unscored,
        estimateAvailable: headAvailable,
        estimateBecause:
          spec.question && !headAvailable
            ? `No calibrated probability is available for ${QUESTION_LABEL[spec.question].toLowerCase()}.`
            : null,
      };
    });

    return {
      status: "ready",
      gene: rows[0]?.gene_symbol ?? symbol,
      rungs,
      nOutcomes: rungs.reduce((sum, rung) => sum + rung.nOutcomes, 0),
      nUnplaced: 0,
      next: nextRung(rungs),
    };
  } catch (error) {
    console.error("[data/validation-network] ladder read failed", error);
    return { status: "unavailable" };
  }
}

/**
 * Which questions have a current model, from the status view alone.
 *
 * A failed read comes back as "nothing is fitted", which is the same thing the
 * page would show anyway and is the safe direction to fail in: the ladder then
 * says no probability is available, which is true, rather than claiming one
 * exists that it cannot describe.
 */
async function headAvailability(
  client: Awaited<ReturnType<typeof createClient>>,
): Promise<Map<Question, { available: boolean }>> {
  const out = new Map<Question, { available: boolean }>();
  for (const question of QUESTIONS) out.set(question, { available: false });
  try {
    const result = await client
      .from("validation_network_status")
      .select("question, is_available");
    if (result.error) throw result.error;
    for (const row of (result.data ?? []) as { question: string; is_available: boolean | null }[]) {
      if (isQuestion(row.question)) out.set(row.question, { available: row.is_available === true });
    }
  } catch (error) {
    console.error("[data/validation-network] head availability read failed", error);
  }
  return out;
}

/**
 * Which rung to climb next, and why.
 *
 * A rung whose outcomes disagree with each other comes first: another replicate
 * of that rung resolves more than climbing a new one, and that is the PTK2
 * situation in doi:10.1158/0008-5472.CAN-24-0775, where one inhibitor did
 * nothing and another produced a partial response in one line.
 */
function nextRung(rungs: LadderRung[]): { label: string; why: string } | null {
  const mixed = rungs.find((rung) => rung.state === "mixed");
  if (mixed) {
    return {
      label: mixed.label,
      why: `Outcomes on this rung disagree with each other. Another replicate of it resolves more than climbing a new rung.`,
    };
  }
  const untested = rungs.find(
    (rung) => rung.key !== "primary" && rung.state === "not_tested",
  );
  if (!untested) return null;
  return {
    label: untested.label,
    why: `${untested.label} is the earliest rung with no outcome. ${untested.gloss}`,
  };
}

// ---------------------------------------------------------------------------
// Coverage, endpoints and rounds: the surfaces the console had no read for
// ---------------------------------------------------------------------------

export interface StratumRow {
  key: string;
  question: Question;
  describe: string;
  nDecided: number;
  nValidated: number;
  nFailed: number;
  nLabs: number;
  nScreens: number;
  isOpen: boolean;
  shortfall: readonly string[];
  minOutcomes: number;
  minLabs: number;
  minScreens: number;
}

export interface EndpointRow {
  key: string;
  label: string;
  question: Question;
  assayClass: string;
  direction: string;
  effectMetric: string;
  thresholdOwner: string;
  minPerturbations: number;
  minReplicates: number;
  controls: readonly string[];
  negativeMeans: string;
  source: string | null;
}

export interface RoundRow {
  id: string;
  name: string;
  screenId: string;
  screenName: string | null;
  state: RoundState;
  design: string;
  budget: number;
  endpoint: string | null;
  laboratoryThreshold: number | null;
  receiptSha256: string | null;
  frozenAt: string | null;
  revealedAt: string | null;
  createdAt: string;
  nSlots: number;
  nRecorded: number;
  nDecided: number;
}

const finiteOrNull = finite;

/**
 * Every stratum the current models were judged against, open or shut.
 *
 * Shut strata are the useful ones: they say which contexts are close to
 * licensing a number and exactly how far off they are. Returning only the open
 * ones would turn a coverage table into a list of successes.
 */
export async function getCoverage(): Promise<StratumRow[]> {
  try {
    const client = await createClient();
    const result = await client
      .from("validation_coverage")
      .select(
        "stratum_key, question, describe, n_decided, n_validated, n_failed, n_labs, n_screens, is_open, shortfall, min_outcomes, min_labs, min_screens, model_version",
      )
      .order("n_decided", { ascending: false })
      .limit(200);
    if (result.error) throw result.error;
    const rows = (result.data ?? []) as Record<string, unknown>[];
    const out: StratumRow[] = [];
    for (const row of rows) {
      if (!isQuestion(row.question)) continue;
      out.push({
        key: String(row.stratum_key ?? ""),
        question: row.question,
        describe: String(row.describe ?? ""),
        nDecided: integer(row.n_decided) ?? 0,
        nValidated: integer(row.n_validated) ?? 0,
        nFailed: integer(row.n_failed) ?? 0,
        nLabs: integer(row.n_labs) ?? 0,
        nScreens: integer(row.n_screens) ?? 0,
        isOpen: row.is_open === true,
        shortfall: Array.isArray(row.shortfall) ? (row.shortfall as string[]) : [],
        minOutcomes: integer(row.min_outcomes) ?? COVERAGE_THRESHOLDS.minStratumOutcomes,
        minLabs: integer(row.min_labs) ?? COVERAGE_THRESHOLDS.minStratumLabs,
        minScreens: integer(row.min_screens) ?? COVERAGE_THRESHOLDS.minStratumScreens,
      });
    }
    return out;
  } catch (error) {
    console.error("[data/validation-network] coverage read failed", error);
    return [];
  }
}

/** The endpoint registry: what "validated" means, per assay class. */
export async function getEndpoints(): Promise<EndpointRow[]> {
  try {
    const client = await createClient();
    const result = await client
      .from("validation_endpoints")
      .select(
        "endpoint_id, version, label, question, assay_class, direction, effect_metric, threshold_owner, min_independent_perturbations, min_biological_replicates, control_criteria, negative_means, published_example",
      )
      .order("question")
      .order("endpoint_id");
    if (result.error) throw result.error;
    const out: EndpointRow[] = [];
    for (const row of (result.data ?? []) as Record<string, unknown>[]) {
      if (!isQuestion(row.question)) continue;
      const example = row.published_example as Record<string, unknown> | null;
      out.push({
        key: `${row.endpoint_id}.v${row.version}`,
        label: String(row.label ?? ""),
        question: row.question,
        assayClass: String(row.assay_class ?? ""),
        direction: String(row.direction ?? ""),
        effectMetric: String(row.effect_metric ?? ""),
        thresholdOwner: String(row.threshold_owner ?? ""),
        minPerturbations: integer(row.min_independent_perturbations) ?? 1,
        minReplicates: integer(row.min_biological_replicates) ?? 1,
        controls: Array.isArray(row.control_criteria) ? (row.control_criteria as string[]) : [],
        negativeMeans: String(row.negative_means ?? ""),
        source: example && typeof example.doi === "string" ? example.doi : null,
      });
    }
    return out;
  } catch (error) {
    console.error("[data/validation-network] endpoint read failed", error);
    return [];
  }
}

interface RoundDbRow {
  id: string;
  name: string;
  screen_id: string;
  state: string;
  design: string;
  budget: number;
  endpoint_id: string | null;
  endpoint_version: number | null;
  laboratory_threshold: number | string | null;
  receipt_sha256: string | null;
  frozen_at: string | null;
  revealed_at: string | null;
  created_at: string;
  screens?: { name: string | null } | { name: string | null }[] | null;
}

function isRoundState(value: unknown): value is RoundState {
  return value === "draft" || value === "frozen" || value === "revealed";
}

/** The workspace's rounds, with how much of each has come back. */
export async function getRounds(limit = 50): Promise<RoundRow[]> {
  const context = await getCurrentContext();
  if (!context.user || !context.org) return [];
  try {
    const client = await createClient();
    const result = await client
      .from("validation_rounds")
      .select(
        "id, name, screen_id, state, design, budget, endpoint_id, endpoint_version, laboratory_threshold, receipt_sha256, frozen_at, revealed_at, created_at, screens(name)",
      )
      .eq("org_id", context.org.id)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (result.error) throw result.error;
    const rounds = (result.data ?? []) as unknown as RoundDbRow[];
    if (rounds.length === 0) return [];

    const ids = rounds.map((r) => r.id);
    const [slots, outcomes] = await Promise.all([
      client.from("validation_slots").select("round_id").in("round_id", ids).limit(5000),
      client
        .from("validation_outcomes")
        .select("round_id, result")
        .in("round_id", ids)
        .limit(5000),
    ]);
    const slotCount = new Map<string, number>();
    for (const row of (slots.data ?? []) as { round_id: string }[]) {
      slotCount.set(row.round_id, (slotCount.get(row.round_id) ?? 0) + 1);
    }
    const recorded = new Map<string, { n: number; decided: number }>();
    for (const row of (outcomes.data ?? []) as { round_id: string; result: string }[]) {
      const entry = recorded.get(row.round_id) ?? { n: 0, decided: 0 };
      entry.n++;
      if (row.result === "validated" || row.result === "failed") entry.decided++;
      recorded.set(row.round_id, entry);
    }

    return rounds.map((row) => {
      const screen = Array.isArray(row.screens) ? row.screens[0] : row.screens;
      const counts = recorded.get(row.id) ?? { n: 0, decided: 0 };
      return {
        id: row.id,
        name: row.name,
        screenId: row.screen_id,
        screenName: screen?.name ?? null,
        state: isRoundState(row.state) ? row.state : "draft",
        design: row.design,
        budget: integer(row.budget) ?? 0,
        endpoint:
          row.endpoint_id && row.endpoint_version !== null
            ? `${row.endpoint_id}.v${row.endpoint_version}`
            : null,
        laboratoryThreshold: finiteOrNull(row.laboratory_threshold),
        receiptSha256: row.receipt_sha256,
        frozenAt: row.frozen_at,
        revealedAt: row.revealed_at,
        createdAt: row.created_at,
        nSlots: slotCount.get(row.id) ?? 0,
        nRecorded: counts.n,
        nDecided: counts.decided,
      };
    });
  } catch (error) {
    console.error("[data/validation-network] rounds read failed", error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// A round's results, once the bench has started answering
// ---------------------------------------------------------------------------

export interface RoundCandidate {
  gene: string;
  /** The arm shown in a table. Display only; `wantedBy` is what is scored. */
  arm: ValidationArm;
  /** Every strategy that reached this candidate. A shared one counts for each. */
  wantedBy: readonly string[];
  rankOverall: number | null;
  result: OutcomeResult | null;
  endpointDecision: EndpointDecision | null;
  effectSize: number | null;
  labId: string | null;
  outcomeId: string | null;
}

export interface RoundResults {
  round: RoundRow;
  progress: RoundProgress;
  arms: ArmRate[];
  /** SplicR against each other arm that has a decided outcome. */
  comparisons: { difference: ArmDifference; sentence: string }[];
  /** The same pairs, over the candidates only one of them chose. */
  discordances: Discordance[];
  candidates: RoundCandidate[];
  /** True once every drawn candidate has an outcome recorded. */
  complete: boolean;
}

/**
 * One round, scored.
 *
 * Reads the frozen slots and whatever outcomes have come back for those genes
 * in this round, and computes the per-arm rates the engine would compute. A
 * candidate with no outcome yet is a row with nulls rather than an absence,
 * because "not yet validated" and "not drawn" are different states and the
 * person chasing the bench needs to tell them apart.
 */
export async function getRoundResults(roundId: string): Promise<RoundResults | null> {
  const context = await getCurrentContext();
  if (!context.user || !context.org) return null;
  try {
    const client = await createClient();
    const [rounds, slotsResult, outcomesResult] = await Promise.all([
      getRounds(200),
      client
        .from("validation_slots")
        .select("gene_symbol, arm, rank_overall, wanted_by")
        .eq("round_id", roundId)
        .order("rank_overall", { ascending: true, nullsFirst: false })
        .limit(1000),
      client
        .from("validation_outcomes")
        .select("id, gene_symbol, result, endpoint_decision, effect_size, lab_id")
        .eq("round_id", roundId)
        .limit(2000),
    ]);
    const round = rounds.find((r) => r.id === roundId);
    if (!round) return null;
    if (slotsResult.error) throw slotsResult.error;
    if (outcomesResult.error) throw outcomesResult.error;

    const slots = (slotsResult.data ?? []) as {
      gene_symbol: string;
      arm: string;
      rank_overall: number | null;
      wanted_by: string[] | null;
    }[];
    const outcomes = (outcomesResult.data ?? []) as {
      id: string;
      gene_symbol: string;
      result: string;
      endpoint_decision: string | null;
      effect_size: number | string | null;
      lab_id: string | null;
    }[];

    // A gene can carry more than one outcome in a round if the bench repeated
    // it. The most decisive one stands for the candidate: a decided result
    // beats an inconclusive one, which beats a pending one, because a repeat
    // that reached an answer is the answer.
    const rankOf = (result: string) =>
      result === "validated" || result === "failed" ? 3 : result === "inconclusive" ? 2 : 1;
    const byGene = new Map<string, (typeof outcomes)[number]>();
    for (const outcome of outcomes) {
      const key = outcome.gene_symbol.toUpperCase();
      const existing = byGene.get(key);
      if (!existing || rankOf(outcome.result) > rankOf(existing.result)) {
        byGene.set(key, outcome);
      }
    }

    const candidates: RoundCandidate[] = slots.map((slot) => {
      const outcome = byGene.get(slot.gene_symbol.toUpperCase());
      const arm = isValidationArm(slot.arm) ? slot.arm : "unassigned";
      // A slot written before the arms overlapped has no `wanted_by`; the arm
      // it was assigned to is then the only strategy known to have wanted it.
      const wantedBy =
        Array.isArray(slot.wanted_by) && slot.wanted_by.length > 0 ? slot.wanted_by : [arm];
      return {
        gene: slot.gene_symbol,
        arm,
        wantedBy,
        rankOverall: integer(slot.rank_overall),
        result: outcome && isOutcomeResult(outcome.result) ? outcome.result : null,
        endpointDecision:
          outcome && isEndpointDecision(outcome.endpoint_decision)
            ? outcome.endpoint_decision
            : null,
        effectSize: outcome ? finite(outcome.effect_size) : null,
        labId: outcome?.lab_id ?? null,
        outcomeId: outcome?.id ?? null,
      };
    });

    const label = (candidate: RoundCandidate): number | null =>
      candidate.result === "validated" ? 1 : candidate.result === "failed" ? 0 : null;

    // Scored over `wantedBy`, not over the displayed arm: a candidate two
    // strategies both reached counts for both, which is what makes the arms
    // comparable at all.
    const armsPresent = [
      ...new Set(candidates.flatMap((c) => c.wantedBy)),
    ]
      .filter(isValidationArm)
      .sort((a, b) => (a === "splicr" ? -1 : b === "splicr" ? 1 : a.localeCompare(b)));
    const arms = armsPresent.map((arm) => {
      const mine = candidates.filter((c) => c.wantedBy.includes(arm));
      return armRate(
        arm,
        mine.filter((c) => c.result !== null).map(label),
        mine.length,
      );
    });

    const scored = candidates.map((c) => ({ wantedBy: c.wantedBy, label: label(c) }));
    const splicr = arms.find((a) => a.arm === "splicr");
    const comparisons = splicr
      ? arms
          .filter((a) => a.arm !== "splicr")
          .map((other) => {
            const difference = compareArms(splicr, other);
            return { difference, sentence: differenceSentence(difference) };
          })
      : [];
    const discordances = splicr
      ? arms.filter((a) => a.arm !== "splicr").map((other) => discordance("splicr", other.arm, scored))
      : [];

    const counts = {
      drawn: candidates.length,
      validated: candidates.filter((c) => c.result === "validated").length,
      failed: candidates.filter((c) => c.result === "failed").length,
      inconclusive: candidates.filter((c) => c.result === "inconclusive").length,
      pending: candidates.filter((c) => c.result === "pending").length,
    };
    const summary = progress(counts);

    return {
      round,
      progress: summary,
      arms,
      comparisons,
      discordances,
      candidates,
      complete: summary.complete,
    };
  } catch (error) {
    console.error("[data/validation-network] round results read failed", error);
    return null;
  }
}
