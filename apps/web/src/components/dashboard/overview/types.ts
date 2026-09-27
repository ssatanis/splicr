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
  /** Calibrated probability the hit is real, 0 to 1, or null when unscored. */
  chance: number | null;
  /** log2 fold change at the endpoint against T0, signed. */
  lfc: number | null;
  /** Benjamini-Hochberg q-value. */
  fdr: number | null;
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
  /** Cell line and modality, the one line of context the name needs. */
  context: string;
  status: ScreenStatus;
  qc: "pass" | "warn" | "fail" | "pending";
  /** Stages finished out of nine, or null when no run has started. */
  stage: number | null;
  hits: number | null;
  realHits: number | null;
  /** Why this run wants a look today, or null when it does not. */
  attention: string | null;
  /** What the expanded row adds: phenotype, library, owner, created. */
  detail: string;
}

/** A candidate the bench has already answered. */
export interface OutcomeRow {
  id: string;
  gene: string;
  /** Null when the read cannot say which screen the outcome belongs to. */
  screenId: string | null;
  assay: string | null;
  /** The chance real this gene carried when it was called, not recomputed. */
  predicted: number | null;
  result: "validated" | "failed" | "inconclusive" | "pending";
}
