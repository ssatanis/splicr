/**
 * Bench outcomes, as the Truth Loop reasons about them.
 *
 * An outcome is what happened when somebody put a gene back on a plate. It is
 * never a verdict on the screen and never something the model said, and the four
 * results stay four:
 *
 *   validated     an independent assay supported the hit
 *   failed        the assay ran and did not support it
 *   inconclusive  the assay ran and could not decide
 *   pending       the assay has not finished
 *
 * "Did not validate" is not "artifact", "inconclusive" is not "failed", and
 * "pending" is not a result at all, so a rate is stated only over the two
 * results that answer the question and says how many that is.
 */

export const OUTCOME_RESULTS = ["validated", "failed", "inconclusive", "pending"] as const;
export type OutcomeResult = (typeof OUTCOME_RESULTS)[number];

export function isOutcomeResult(value: unknown): value is OutcomeResult {
  return typeof value === "string" && (OUTCOME_RESULTS as readonly string[]).includes(value);
}

export const RESULT_COPY: Record<OutcomeResult, { label: string; short: string; help: string }> = {
  validated: {
    label: "Validated at the bench",
    short: "Validated",
    help: "An independent assay supported the hit.",
  },
  failed: {
    label: "Did not validate",
    short: "Did not validate",
    help: "The assay ran and did not support the hit.",
  },
  inconclusive: {
    label: "Inconclusive",
    short: "Inconclusive",
    help: "The assay ran and could not decide either way.",
  },
  pending: {
    label: "Still at the bench",
    short: "Pending",
    help: "The assay has not finished. Come back and record the result.",
  },
};

/** One outcome, in the shape both the workspace reader and the demo produce. */
export interface OutcomeRow {
  id: string;
  screenId: string;
  screenName: string | null;
  gene: string;
  result: OutcomeResult;
  assay: string | null;
  effectSize: number | null;
  nGuides: number | null;
  /** The model output stored at the time of the call. Uncalibrated; never a probability. */
  predicted: number | null;
  modelVersion: string | null;
  notes: string | null;
  evidenceUrl: string | null;
  loggedAt: string;
  loggedBy: string | null;
  /** Whether the outcome is tied to a hit recorded for the screen. */
  hitLinked: boolean;
}

export interface OutcomeCounts {
  validated: number;
  failed: number;
  inconclusive: number;
  pending: number;
  total: number;
}

export function emptyCounts(): OutcomeCounts {
  return { validated: 0, failed: 0, inconclusive: 0, pending: 0, total: 0 };
}

export function countOutcomes(rows: readonly { result: OutcomeResult }[]): OutcomeCounts {
  const counts = emptyCounts();
  for (const row of rows) {
    counts[row.result]++;
    counts.total++;
  }
  return counts;
}

export interface DecidedRate {
  decided: number;
  validated: number;
  /** Validated over decided. Null when nothing has been decided: no rate, not zero. */
  rate: number | null;
  lower: number | null;
  upper: number | null;
}

/**
 * The share of decided outcomes that validated, with a Wilson interval.
 *
 * Pending and inconclusive are out of the denominator on purpose: the first has
 * no answer yet and the second is not a "no". The interval is here because 4 of
 * 5 and 400 of 500 are both 80% and only one of them is evidence.
 */
export function decidedRate(counts: OutcomeCounts): DecidedRate {
  const decided = counts.validated + counts.failed;
  if (decided === 0) return { decided: 0, validated: 0, rate: null, lower: null, upper: null };
  const z = 1.959963984540054;
  const p = counts.validated / decided;
  const denominator = 1 + (z * z) / decided;
  const centre = p + (z * z) / (2 * decided);
  const spread = z * Math.sqrt((p * (1 - p)) / decided + (z * z) / (4 * decided * decided));
  return {
    decided,
    validated: counts.validated,
    rate: p,
    // At the edges the interval is exactly 0 or 1, not a float that rounds
    // toward it, so "0 of 3 validated" never prints as 0.0000000000000000487.
    lower: counts.validated === 0 ? 0 : Math.max(0, (centre - spread) / denominator),
    upper: counts.validated === decided ? 1 : Math.min(1, (centre + spread) / denominator),
  };
}

// ---------------------------------------------------------------------------
// Filters, shared by the address, the demo and the server query
// ---------------------------------------------------------------------------

export const OUTCOME_PAGE_SIZE = 50;

export interface OutcomeFilters {
  result: OutcomeResult | null;
  screen: string | null;
  q: string;
  page: number;
}

type Raw = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string =>
  ((Array.isArray(value) ? value[0] : value) ?? "").trim();

const UUID_OR_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function parseOutcomeFilters(params: Raw): OutcomeFilters {
  const result = first(params.result);
  const screen = first(params.screen);
  const page = Number(first(params.page));
  return {
    result: isOutcomeResult(result) ? result : null,
    screen: screen !== "" && UUID_OR_ID.test(screen) ? screen : null,
    q: first(params.q).slice(0, 40),
    page: Number.isSafeInteger(page) && page >= 1 && page <= 10000 ? page : 1,
  };
}

/** The address for a view. Changing a filter returns to page one. */
export function outcomeHref(base: string, current: OutcomeFilters, patch: Partial<Record<keyof OutcomeFilters, string | number | null>>): string {
  const merged: Record<string, string | number | null> = {
    result: current.result,
    screen: current.screen,
    q: current.q || null,
    page: current.page > 1 ? current.page : null,
  };
  const touchesFilter = Object.keys(patch).some((key) => key !== "page");
  if (touchesFilter && !("page" in patch)) merged.page = null;
  Object.assign(merged, patch);
  const params = new URLSearchParams();
  for (const key of ["result", "screen", "q", "page"]) {
    const value = merged[key];
    if (value !== null && value !== undefined && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export function matchesOutcome(row: OutcomeRow, filters: OutcomeFilters): boolean {
  if (filters.result !== null && row.result !== filters.result) return false;
  if (filters.screen !== null && row.screenId !== filters.screen) return false;
  const needle = filters.q.trim().toLowerCase();
  return needle === "" || row.gene.toLowerCase().includes(needle);
}

/** Newest first, ties by id, so a page is the same page every time. */
export function sortOutcomes<T extends { loggedAt: string; id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => Date.parse(b.loggedAt) - Date.parse(a.loggedAt) || a.id.localeCompare(b.id));
}

export function filterOutcomes(rows: readonly OutcomeRow[], filters: OutcomeFilters): OutcomeRow[] {
  return sortOutcomes(rows.filter((row) => matchesOutcome(row, filters)));
}

/** Counts over the screen filter only, so the tiles do not vanish when a result is chosen. */
export function countsInScope(rows: readonly OutcomeRow[], filters: OutcomeFilters): OutcomeCounts {
  return countOutcomes(rows.filter((row) => filters.screen === null || row.screenId === filters.screen));
}
