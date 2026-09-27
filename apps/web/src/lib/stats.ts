/**
 * The one statistic the console computes for itself.
 *
 * WHY IT IS HERE. "4 of 6 resolved calls held up" was printed under a large
 * figure, in the place a reader looks for a rate, off a denominator of six. As a
 * rate that is 67%, and 67% off six re-tests is indistinguishable from 40% or
 * from 90%. The console's whole argument is that a figure without its precision
 * is a marketing number, so the one figure that rates the score itself cannot be
 * the exception.
 *
 * Wilson rather than the normal approximation, which gives intervals that run
 * past 100% and collapses to zero width at 0 of n, and rather than
 * Clopper-Pearson, which needs an incomplete beta function for a line of copy.
 * Wilson is the interval the literature recommends for exactly this size of n.
 */

/** 95%, two sided. */
const Z = 1.959964;

export interface Interval {
  /** Observed proportion, 0 to 1. */
  point: number;
  lower: number;
  upper: number;
  /** Trials. Printed alongside, because an interval without its n invites a rate. */
  n: number;
}

/**
 * The Wilson score interval for `hits` of `n`.
 *
 * Returns null at n = 0. There is no interval on no data, and a caller that gets
 * null prints the reason rather than a figure nobody measured.
 */
export function wilson(hits: number, n: number): Interval | null {
  if (n <= 0) return null;
  const p = hits / n;
  const z2 = Z * Z;
  const denominator = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denominator;
  const spread = (Z / denominator) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return {
    point: p,
    lower: Math.max(0, centre - spread),
    upper: Math.min(1, centre + spread),
    n,
  };
}

/** The interval as a reader would quote it: "30% to 90%". */
export function intervalText(interval: Interval): string {
  return `${Math.round(interval.lower * 100)}% to ${Math.round(interval.upper * 100)}%`;
}

/**
 * Below this the record is too short to rate at all, and the honest line says so
 * instead of offering an interval whose midpoint a reader will read anyway.
 * Matches `MIN_RESOLVED_FOR_CALIBRATION` in lib/data/overview.ts, which is the
 * same judgement about the same quantity.
 */
export const MIN_RESOLVED_TO_RATE = 10;
