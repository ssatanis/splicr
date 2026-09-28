/**
 * The three row shapes the overview draws.
 *
 * Both branches of the page, a signed-in workspace read out of Postgres and the
 * sample workspace read out of the fixtures, map onto these. That is what stops
 * the two from drifting into two different products, and it is why every field
 * that a read might not be able to answer is nullable: a field the caller could
 * not supply arrives as null and is drawn as "not recorded", because a dash that
 * looks like a zero is the failure this console exists to avoid.
 */
import type { ScreenStatus, Verdict } from "@/lib/mock/data";

/** A gene competing for one of the slots in the next validation round. */
export interface CandidateRow {
  id: string;
  gene: string;
  /** Null until the artifact stage has classified the hit. */
  verdict: Verdict | null;
  /** Uncalibrated stored model score, or null when unscored. */
  chance: number | null;
  /** Recorded signed log2 fold change for the recorded comparison. */
  lfc: number | null;
  /** Recorded method-specific false-discovery estimate. */
  fdr: number | null;
  /**
   * How little of the Atlas has called this gene, 0 to 1.
   *
   * The second of the three constraints the page serves. A gene can be as real as
   * the statistics allow and still be worthless to take to a bench, because it is
   * called in a third of every screen ever run: that is a core essential, and the
   * reader needs to see it in the row rather than infer it from a flag.
   */
  novelty: number | null;
  /** BAGEL2 Bayes factor. Evidence the score is derived from, not a restatement. */
  bayes: number | null;
  guides: number | null;
  guidesAgree: number | null;
  flags: string[];
  why: string | null;
  atlasHits: number | null;
  atlasScreens: number | null;
  screenId: string;
  screenName: string | null;
  /** The re-test this gene's screen would order, which is the testable part. */
  benchAssay: string | null;
}

/** A screen, reduced to the four things this page asks about it. */
export interface RunRow {
  id: string;
  name: string;
  status: ScreenStatus;
  qc: "pass" | "warn" | "fail" | "pending";
  /** Stages finished out of nine, or null when no run has started. */
  stage: number | null;
  hits: number | null;
  realHits: number | null;
  /** Why this run wants a look today, or null when it does not. */
  attention: string | null;
  /** What the expanded row adds: phenotype, library, model, owner, created. */
  detail: string;
}

/** A candidate the bench has already answered. */
export interface OutcomeRow {
  id: string;
  gene: string;
  /** Null when the read cannot say which screen the outcome belongs to. */
  screenId: string | null;
  assay: string | null;
  /** The model score recorded when called, not recomputed or assumed calibrated. */
  predicted: number | null;
  result: "validated" | "failed" | "inconclusive" | "pending";
}
