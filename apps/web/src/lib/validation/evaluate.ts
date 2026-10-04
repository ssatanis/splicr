/**
 * Scoring a round once the bench has answered.
 *
 * Mirrors `engine/splicr/validation/evaluation.py` and is pinned to it by
 * `apps/web/tests/fixtures/arm-comparison.json`, so the number a researcher
 * reads on the results page is the number the engine would compute.
 *
 * The arms of a round are disjoint: a candidate several strategies wanted is
 * assigned once, so comparing two arms is a comparison of two independent
 * proportions. Newcombe's method composes their Wilson intervals, which behaves
 * at the denominators a real round has. A normal approximation on 5 of 7
 * against 3 of 8 is not an interval anybody should quote.
 */

import { ARM_LABEL, type ValidationArm } from "./model";

const Z95 = 1.959963984540054;

/** A 95% interval that is exactly 0 or 1 at the edges rather than near it. */
export function wilson(successes: number, n: number): [number, number] {
  if (n <= 0) return [0, 1];
  const p = successes / n;
  const denominator = 1 + (Z95 * Z95) / n;
  const centre = p + (Z95 * Z95) / (2 * n);
  const spread = Z95 * Math.sqrt((p * (1 - p)) / n + (Z95 * Z95) / (4 * n * n));
  return [
    successes === 0 ? 0 : Math.max(0, (centre - spread) / denominator),
    successes === n ? 1 : Math.min(1, (centre + spread) / denominator),
  ];
}

export interface ArmRate {
  arm: ValidationArm;
  label: string;
  nDrawn: number;
  nRecorded: number;
  nDecided: number;
  nValidated: number;
  /** Null when nothing has been decided. Not zero: no rate, not a rate of nought. */
  rate: number | null;
  lower: number | null;
  upper: number | null;
  /** Validations spent per confirmed hit. Null when nothing was confirmed. */
  costPerConfirmation: number | null;
}

/**
 * One arm's confirmation rate.
 *
 * Pending and inconclusive leave the denominator: the first has no answer yet
 * and the second is not a "no". How much of the arm is still outstanding is
 * reported separately, so a rate over 3 of 20 cannot be read as a rate over 20.
 */
export function armRate(
  arm: ValidationArm,
  labels: readonly (number | null)[],
  nDrawn: number,
): ArmRate {
  const decided = labels.filter((v): v is number => v !== null);
  const validated = decided.filter((v) => v === 1).length;
  const base = {
    arm,
    label: ARM_LABEL[arm],
    nDrawn,
    nRecorded: labels.length,
    nDecided: decided.length,
    nValidated: validated,
    costPerConfirmation: validated > 0 ? decided.length / validated : null,
  };
  if (decided.length === 0) {
    return { ...base, nValidated: 0, rate: null, lower: null, upper: null, costPerConfirmation: null };
  }
  const [lower, upper] = wilson(validated, decided.length);
  return { ...base, rate: validated / decided.length, lower, upper };
}

export interface ArmDifference {
  arm: ValidationArm;
  comparator: ValidationArm;
  rate: number | null;
  comparatorRate: number | null;
  difference: number | null;
  lower: number | null;
  upper: number | null;
  /** True when the interval excludes zero, which is all this is entitled to say. */
  separated: boolean;
}

export function compareArms(a: ArmRate, b: ArmRate): ArmDifference {
  const base = { arm: a.arm, comparator: b.arm, rate: a.rate, comparatorRate: b.rate };
  if (a.rate === null || b.rate === null) {
    return { ...base, difference: null, lower: null, upper: null, separated: false };
  }
  const difference = a.rate - b.rate;
  const lower = Math.max(
    -1,
    difference - Math.sqrt((a.rate - (a.lower as number)) ** 2 + ((b.upper as number) - b.rate) ** 2),
  );
  const upper = Math.min(
    1,
    difference + Math.sqrt(((a.upper as number) - a.rate) ** 2 + (b.rate - (b.lower as number)) ** 2),
  );
  return { ...base, difference, lower, upper, separated: lower > 0 || upper < 0 };
}

/**
 * What the comparison is entitled to say, in one sentence.
 *
 * It never says one strategy is better. It says what this round measured and
 * whether the interval clears zero, because at a budget of twenty it very often
 * will not, and a results page that implies otherwise is the thing this whole
 * subsystem exists to avoid.
 */
export function differenceSentence(difference: ArmDifference): string {
  const pct = (value: number) => `${Math.round(value * 100)}%`;
  const signed = (value: number) =>
    `${value >= 0 ? "+" : "-"}${Math.round(Math.abs(value) * 100)}%`;
  if (difference.difference === null) {
    return `Not comparable yet: ${ARM_LABEL[difference.arm]} or ${ARM_LABEL[difference.comparator]} has no decided outcome.`;
  }
  const direction = difference.difference >= 0 ? "more" : "fewer";
  return (
    `${ARM_LABEL[difference.arm]} confirmed ${pct(Math.abs(difference.difference))} ${direction} of its candidates than ` +
    `${ARM_LABEL[difference.comparator]} (${pct(difference.rate as number)} against ${pct(difference.comparatorRate as number)}), ` +
    `95% interval ${signed(difference.lower as number)} to ${signed(difference.upper as number)}. ` +
    (difference.separated
      ? "The interval excludes zero."
      : "The interval includes zero, so this round does not separate them.")
  );
}

export interface RoundProgress {
  nDrawn: number;
  nRecorded: number;
  nDecided: number;
  nPending: number;
  nInconclusive: number;
  nOutstanding: number;
  /** Everything drawn has an outcome recorded. */
  complete: boolean;
}

export function progress(counts: {
  drawn: number;
  validated: number;
  failed: number;
  inconclusive: number;
  pending: number;
}): RoundProgress {
  const recorded = counts.validated + counts.failed + counts.inconclusive + counts.pending;
  return {
    nDrawn: counts.drawn,
    nRecorded: recorded,
    nDecided: counts.validated + counts.failed,
    nPending: counts.pending,
    nInconclusive: counts.inconclusive,
    nOutstanding: Math.max(0, counts.drawn - recorded),
    complete: recorded >= counts.drawn,
  };
}

// ---------------------------------------------------------------------------
// The discordant set
// ---------------------------------------------------------------------------

/**
 * Two-sided exact binomial probability, p = 0.5.
 *
 * Mirrors `scipy.stats.binomtest(k, n, 0.5)`: the sum of every outcome at most
 * as likely as the observed one. At p = 0.5 the distribution is symmetric, so
 * that is twice the tail, capped at 1. Exact rather than a chi-square
 * approximation because a real round has a dozen discordant candidates, not a
 * thousand, and the approximation is wrong there.
 */
export function binomialTwoSided(successes: number, n: number): number {
  if (n <= 0) return 1;
  const k = Math.min(successes, n - successes);
  // Sum the lower tail in log space; n is small here but a round could in
  // principle be large, and a factorial would overflow long before it matters.
  let logChoose = 0;
  let tail = 0;
  for (let i = 0; i <= k; i++) {
    if (i > 0) logChoose += Math.log(n - i + 1) - Math.log(i);
    tail += Math.exp(logChoose - n * Math.LN2);
  }
  return Math.min(1, 2 * tail);
}

export interface Discordance {
  arm: ValidationArm;
  comparator: ValidationArm;
  nShared: number;
  nOnlyArm: number;
  nOnlyComparator: number;
  armConfirmed: number;
  comparatorConfirmed: number;
  armDecided: number;
  comparatorDecided: number;
  pValue: number | null;
  because: string;
}

/**
 * The comparison that carries information.
 *
 * Candidates both strategies chose cannot distinguish them, however they turn
 * out, so they are counted and set aside. What is left is the set where the two
 * disagreed, and the test is whether the confirmations among those split evenly.
 */
export function discordance(
  arm: ValidationArm,
  comparator: ValidationArm,
  candidates: readonly { wantedBy: readonly string[]; label: number | null }[],
): Discordance {
  const inA = (c: { wantedBy: readonly string[] }) => c.wantedBy.includes(arm);
  const inB = (c: { wantedBy: readonly string[] }) => c.wantedBy.includes(comparator);
  const shared = candidates.filter((c) => inA(c) && inB(c));
  const onlyA = candidates.filter((c) => inA(c) && !inB(c));
  const onlyB = candidates.filter((c) => inB(c) && !inA(c));

  const decidedA = onlyA.filter((c) => c.label !== null);
  const decidedB = onlyB.filter((c) => c.label !== null);
  const confirmedA = decidedA.filter((c) => c.label === 1).length;
  const confirmedB = decidedB.filter((c) => c.label === 1).length;
  const n = confirmedA + confirmedB;

  const base = {
    arm,
    comparator,
    nShared: shared.length,
    nOnlyArm: onlyA.length,
    nOnlyComparator: onlyB.length,
    armConfirmed: confirmedA,
    comparatorConfirmed: confirmedB,
    armDecided: decidedA.length,
    comparatorDecided: decidedB.length,
  };
  if (n === 0) {
    return {
      ...base,
      pValue: null,
      because:
        onlyA.length + onlyB.length === 0
          ? `${ARM_LABEL[arm]} and ${ARM_LABEL[comparator]} chose the same candidates, so this round cannot tell them apart.`
          : `No candidate that only one of them chose has been confirmed yet, so there is nothing to compare.`,
    };
  }
  const p = binomialTwoSided(confirmedA, n);
  return {
    ...base,
    pValue: p,
    because:
      `Of ${n} confirmed candidates that only one strategy chose, ${confirmedA} came from ` +
      `${ARM_LABEL[arm]} and ${confirmedB} from ${ARM_LABEL[comparator]} (exact binomial p = ${p.toPrecision(2)}). ` +
      `The ${shared.length} they both chose are set aside: they cannot tell the two apart.`,
  };
}
