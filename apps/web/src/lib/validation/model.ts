/**
 * The Validation Network, as the console reasons about it.
 *
 * This file is a mirror of `engine/splicr/validation/` and of the enums in
 * `supabase/migrations/20261003000100_validation_network.sql`. Three copies of
 * one vocabulary is two copies too many, and the thing that makes it safe is
 * that `apps/web/tests/validation-contract.test.mjs` reads all three files and
 * fails when they disagree. If you add a validation type here, that test tells
 * you which other two places to add it to, by name.
 *
 * WHAT THIS MODULE IS FOR
 *
 * One rule, in one place: a probability may be displayed only alongside the
 * cohort that licensed it. `describeEstimate` is the only function that turns a
 * number into text, it refuses on the unavailable branch, and the sentence it
 * returns always names the experiment the probability is about. A component
 * that wants to print "79%" has to go through it, and it cannot get 79% out of
 * it without also getting "of reproducing the phenotype with an independent
 * perturbation in the same model" and "calibrated on 327 outcomes from 7
 * laboratories".
 *
 * WHY FOUR NUMBERS AND NOT ONE
 *
 * A hit can validate genetically and fail pharmacologically. PRKDC in
 * doi:10.1158/0008-5472.CAN-24-0775 did: individual gRNAs reduced organoid
 * growth, and the LTURM34 and AZD7648 inhibitors showed no potent activity at
 * the tested concentrations. A single "validation probability" would have to
 * average those two facts, and the average would describe neither experiment.
 */

// ---------------------------------------------------------------------------
// The four questions
// ---------------------------------------------------------------------------

export const QUESTIONS = [
  "reproduces",
  "target_specific",
  "cross_model",
  "pharmacologic",
] as const;
export type Question = (typeof QUESTIONS)[number];

export function isQuestion(value: unknown): value is Question {
  return typeof value === "string" && (QUESTIONS as readonly string[]).includes(value);
}

export const QUESTION_LABEL: Record<Question, string> = {
  reproduces: "Independent genetic reproduction in the same model",
  target_specific: "Target specificity under an orthogonal perturbation",
  cross_model: "Reproduction in another model or context",
  pharmacologic: "Pharmacologic recapitulation with a selective compound",
};

/** Short enough for a column heading. Never used in place of the sentence. */
export const QUESTION_SHORT: Record<Question, string> = {
  reproduces: "Reproduces",
  target_specific: "Target-specific",
  cross_model: "Another model",
  pharmacologic: "Pharmacologic",
};

/**
 * The clause a percentage must appear inside.
 *
 * "79%" is not a scientific statement. "79% estimated probability of
 * reproducing the depletion phenotype with an independent guide in this model"
 * is. These strings are byte-identical to the engine's QUESTION_SENTENCE, and
 * the contract test checks that.
 */
export const QUESTION_SENTENCE: Record<Question, string> = {
  reproduces:
    "estimated probability of reproducing the phenotype with an independent perturbation in the same model",
  target_specific:
    "estimated probability that the effect survives an orthogonal perturbation of the same target",
  cross_model:
    "estimated probability of reproducing the phenotype in another model or biological context",
  pharmacologic:
    "estimated probability of recapitulating the phenotype pharmacologically with a selective inhibitor",
};

// ---------------------------------------------------------------------------
// What was done at the bench
// ---------------------------------------------------------------------------

export const VALIDATION_TYPES = [
  "independent_guide",
  "independent_guide_set",
  "crispri",
  "crispra",
  "rescue",
  "orthogonal_genetic",
  "small_molecule",
  "another_model",
  "organoid",
  "in_vivo",
  "other",
] as const;
export type ValidationType = (typeof VALIDATION_TYPES)[number];

export function isValidationType(value: unknown): value is ValidationType {
  return (
    typeof value === "string" && (VALIDATION_TYPES as readonly string[]).includes(value)
  );
}

export const VALIDATION_TYPE_LABEL: Record<ValidationType, string> = {
  independent_guide: "Independent CRISPR guide",
  independent_guide_set: "Independent guide set",
  crispri: "CRISPRi",
  crispra: "CRISPRa",
  rescue: "Rescue experiment",
  orthogonal_genetic: "Orthogonal genetic assay",
  small_molecule: "Small-molecule inhibition",
  another_model: "Another cellular model",
  organoid: "Organoid",
  in_vivo: "In vivo",
  other: "Other",
};

/**
 * Which question each type bears on.
 *
 * `other` maps to null on purpose. The outcome is kept, shown and exported, and
 * it enters no head, because a model cannot learn from a label whose meaning
 * was never fixed. A form that forced a type here would get one picked at
 * random by somebody at 6pm.
 */
export const TYPE_QUESTION: Record<ValidationType, Question | null> = {
  independent_guide: "reproduces",
  independent_guide_set: "reproduces",
  crispri: "target_specific",
  crispra: "target_specific",
  rescue: "target_specific",
  orthogonal_genetic: "target_specific",
  small_molecule: "pharmacologic",
  another_model: "cross_model",
  organoid: "cross_model",
  in_vivo: "cross_model",
  other: null,
};

/** One line under each option in the form, so the choice is made knowingly. */
export const VALIDATION_TYPE_HELP: Record<ValidationType, string> = {
  independent_guide:
    "One guide that was not in the screening library, in the same model.",
  independent_guide_set: "Two or more independent guides against the same target.",
  crispri: "Transcriptional knockdown rather than cutting. Orthogonal to knockout.",
  crispra: "Transcriptional activation. Records the direction you prespecified.",
  rescue: "Re-expression restores the phenotype. Validates by going the other way.",
  orthogonal_genetic: "Another genetic route to the same target, named in the notes.",
  small_molecule:
    "A selective inhibitor. A negative result here is often about the compound.",
  another_model: "The same perturbation in a different line or background.",
  organoid: "An arrayed organoid assay.",
  in_vivo: "An animal experiment.",
  other: "Kept and exported, and it enters no model, because its meaning is not fixed.",
};

// ---------------------------------------------------------------------------
// Cohort vocabulary
// ---------------------------------------------------------------------------

export const ASSAY_CLASSES = [
  "ko_fitness",
  "drug_modifier",
  "reporter",
  "organoid_growth",
  "in_vivo_growth",
  "other",
] as const;
export type AssayClass = (typeof ASSAY_CLASSES)[number];

export const ASSAY_CLASS_LABEL: Record<AssayClass, string> = {
  ko_fitness: "Knockout fitness",
  drug_modifier: "Drug modifier",
  reporter: "Reporter",
  organoid_growth: "Organoid growth",
  in_vivo_growth: "In vivo growth",
  other: "Other",
};

export const PHENOTYPE_FAMILIES = [
  "fitness",
  "drug_resistance",
  "drug_sensitisation",
  "reporter",
  "differentiation",
  "other",
] as const;
export type PhenotypeFamily = (typeof PHENOTYPE_FAMILIES)[number];

export const MODEL_TYPES = [
  "cancer_cell_line",
  "immortalised_line",
  "primary_cell",
  "organoid",
  "ipsc_derived",
  "in_vivo",
  "other",
] as const;
export type ModelType = (typeof MODEL_TYPES)[number];

export const VALIDATION_ARMS = [
  "splicr",
  "fdr",
  "investigator",
  "random",
  "unassigned",
] as const;
export type ValidationArm = (typeof VALIDATION_ARMS)[number];

export const ARM_LABEL: Record<ValidationArm, string> = {
  splicr: "SplicR",
  fdr: "FDR ranking",
  investigator: "Investigator's choice",
  random: "Random across ranks",
  unassigned: "Not part of a round",
};

export function isValidationArm(value: unknown): value is ValidationArm {
  return typeof value === "string" && (VALIDATION_ARMS as readonly string[]).includes(value);
}

export const ROUND_STATES = ["draft", "frozen", "revealed"] as const;
export type RoundState = (typeof ROUND_STATES)[number];

export const ROUND_STATE_LABEL: Record<RoundState, string> = {
  draft: "Draft",
  frozen: "Frozen",
  revealed: "Revealed",
};

export const ROUND_STATE_HELP: Record<RoundState, string> = {
  draft: "The validation set is designed and nothing is committed yet.",
  frozen:
    "A receipt exists and its hash can leave the building. The candidate set, the ranking and the model are fixed and cannot change.",
  revealed: "Outcomes have been attached. A revealed round cannot be reopened.",
};

/**
 * The fifth decision state, which exists only when scoring a record against an
 * endpoint and never in the outcome table.
 *
 * `insufficient_record` means this record cannot be scored, because a criterion
 * the endpoint requires was not written down. It is not `failed` (the assay did
 * not run and come out against the hit) and it is not `inconclusive` (the assay
 * did not run and fail to decide). Collapsing it into either would put an
 * unmeasured experiment into a rate's numerator or denominator.
 */
export const ENDPOINT_DECISIONS = [
  "validated",
  "failed",
  "inconclusive",
  "insufficient_record",
] as const;
export type EndpointDecision = (typeof ENDPOINT_DECISIONS)[number];

export function isEndpointDecision(value: unknown): value is EndpointDecision {
  return (
    typeof value === "string" && (ENDPOINT_DECISIONS as readonly string[]).includes(value)
  );
}

export const ENDPOINT_DECISION_LABEL: Record<EndpointDecision, string> = {
  validated: "Met the endpoint",
  failed: "Did not meet the endpoint",
  inconclusive: "Inconclusive",
  insufficient_record: "Not scorable",
};

export const ENDPOINT_DECISION_HELP: Record<EndpointDecision, string> = {
  validated: "Every prespecified criterion was met.",
  failed: "The assay ran against this endpoint and did not meet it.",
  inconclusive: "Recorded inconclusive by the laboratory that ran it.",
  insufficient_record:
    "A criterion this endpoint requires was not recorded, so the record cannot be scored against it. This is not a failure.",
};

// ---------------------------------------------------------------------------
// The validation ladder
// ---------------------------------------------------------------------------

export const RUNG_STATES = ["met", "not_met", "mixed", "not_tested"] as const;
export type RungState = (typeof RUNG_STATES)[number];

export const RUNG_STATE_LABEL: Record<RungState, string> = {
  met: "Met",
  not_met: "Not met",
  mixed: "Mixed",
  not_tested: "Not tested",
};

export const RUNG_STATE_GLOSS: Record<RungState, string> = {
  met: "An outcome met the prespecified endpoint for this rung.",
  not_met: "An outcome ran against this endpoint and did not meet it.",
  mixed:
    "Outcomes of this kind disagree with each other. Both are kept; neither is averaged away.",
  not_tested:
    "Nobody has run this experiment. It is not a negative result.",
};

export interface RungSpec {
  key: string;
  label: string;
  question: Question | null;
  types: readonly ValidationType[];
  gloss: string;
}

/** The rungs, in the order a project climbs them. Mirrors report.RUNGS. */
export const RUNGS: readonly RungSpec[] = [
  {
    key: "primary",
    label: "Primary screen",
    question: null,
    types: [],
    gloss: "The screen's own statistics called this gene.",
  },
  {
    key: "guide",
    label: "Guide reproducibility",
    question: "reproduces",
    types: ["independent_guide", "independent_guide_set"],
    gloss:
      "An independent perturbation reproduced the phenotype in the same model.",
  },
  {
    key: "orthogonal",
    label: "Orthogonal genetic evidence",
    question: "target_specific",
    types: ["crispri", "crispra", "rescue", "orthogonal_genetic"],
    gloss: "A different way of perturbing the same target agreed.",
  },
  {
    key: "pharmacologic",
    label: "Pharmacologic evidence",
    question: "pharmacologic",
    types: ["small_molecule"],
    gloss:
      "A selective compound recapitulated the phenotype. Failure here is often about the compound, not the gene.",
  },
  {
    key: "another_model",
    label: "Another model",
    question: "cross_model",
    types: ["another_model", "organoid"],
    gloss: "The phenotype reproduced in a different model or context.",
  },
  {
    key: "in_vivo",
    label: "In vivo",
    question: "cross_model",
    types: ["in_vivo"],
    gloss: "The phenotype reproduced in an animal.",
  },
];

export interface RungCounts {
  met: number;
  notMet: number;
  inconclusive: number;
  pending: number;
}

/**
 * Which state a rung is in, from its counts.
 *
 * `mixed` exists because of PTK2 in doi:10.1158/0008-5472.CAN-24-0775: of two
 * inhibitors, GSK2256098 had no effect on either organoid line and PF-573228
 * produced a partial response in one. Neither "validated" nor "failed" is a
 * true statement about that rung, and a ladder that could not say "mixed"
 * would have to pick one of them and be wrong.
 *
 * An inconclusive outcome never marks a rung against a gene. Nor does a pending
 * one. Both leave the rung at `not_tested`, with the count shown separately so
 * a reader can tell "nobody ran it" from "it ran and could not decide".
 */
export function rungState(counts: RungCounts): RungState {
  if (counts.met > 0 && counts.notMet > 0) return "mixed";
  if (counts.met > 0) return "met";
  if (counts.notMet > 0) return "not_met";
  return "not_tested";
}

export function rungBecause(counts: RungCounts): string {
  const plural = (n: number) => (n === 1 ? "outcome" : "outcomes");
  if (counts.met > 0 && counts.notMet > 0) {
    return `${counts.met} ${plural(counts.met)} met this endpoint and ${counts.notMet} did not. Both are recorded; a gene can reproduce under one perturbation and not another, and that disagreement is information rather than noise.`;
  }
  if (counts.met > 0) {
    return `${counts.met} ${plural(counts.met)} met the prespecified endpoint.`;
  }
  if (counts.notMet > 0) {
    return `${counts.notMet} ${plural(counts.notMet)} ran against this endpoint and did not meet it.`;
  }
  if (counts.inconclusive > 0) {
    return `${counts.inconclusive} ${plural(counts.inconclusive)} ran and could not decide. An inconclusive result is not a negative one, so this rung is not marked against the gene.`;
  }
  if (counts.pending > 0) {
    return `${counts.pending} ${plural(counts.pending)} still at the bench.`;
  }
  return "No experiment of this kind has been recorded.";
}

/** The rung a validation type belongs to, or null for `other`. */
export function rungOf(type: ValidationType): RungSpec | null {
  return RUNGS.find((rung) => rung.types.includes(type)) ?? null;
}

// ---------------------------------------------------------------------------
// Probabilities, and the one function allowed to format one
// ---------------------------------------------------------------------------

/**
 * A calibrated probability is never certainty.
 *
 * 100% asserts that an experiment cannot fail and 0% that it cannot succeed,
 * and no finite cohort evidences either. These bounds are the engine's
 * CERTAINTY_FLOOR and CERTAINTY_CEILING, and the contract test checks they
 * still match.
 */
export const CERTAINTY_FLOOR = 0.005;
export const CERTAINTY_CEILING = 0.995;

/**
 * The only probability formatter in the console.
 *
 * Every surface goes through this, so there is exactly one place that could
 * ever print a certainty and it does not.
 */
export function formatProbability(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "not available";
  }
  if (value >= CERTAINTY_CEILING) return ">99%";
  if (value <= CERTAINTY_FLOOR) return "<1%";
  return `${Math.round(value * 100)}%`;
}

export type Bounded = "none" | "upper" | "lower";

/** An estimate the gate licensed, as the console holds it. */
export interface AvailableEstimate {
  available: true;
  question: Question;
  gene: string;
  probability: number;
  lower: number;
  upper: number;
  bounded: Bounded;
  boundNote: string;
  cohortNDecided: number;
  cohortNLabs: number;
  cohortNScreens: number;
  cohortSentence: string;
  /** Stratum dimensions the cohort had to give up to cover this experiment. */
  relaxed: readonly string[];
  contributions: Record<string, number> | null;
  missingChannels: readonly string[];
  modelVersion: string | null;
}

/** The gate's refusal. There is no probability field, on purpose. */
export interface UnavailableEstimate {
  available: false;
  question: Question;
  gene: string;
  reason: string;
  because: string;
  shortfall: readonly string[];
}

export type EstimateView = AvailableEstimate | UnavailableEstimate;

export interface DescribedEstimate {
  /** The number as text, or the refusal's heading. */
  headline: string;
  /** The full sentence, with the clause that makes it a claim. */
  sentence: string;
  /** What licensed it, or what is outstanding. */
  support: string;
  available: boolean;
}

/**
 * Turn an estimate into the three strings a panel shows, and nothing else.
 *
 * This is the chokepoint. On the unavailable branch there is no number to
 * return, so a component cannot render one; on the available branch the
 * sentence always carries the question clause and the support always names the
 * cohort. A view that bypassed this and printed `estimate.probability` would be
 * printing a bare percentage, which is the thing this whole subsystem exists to
 * prevent, and `validation-network.test.mjs` greps the components for exactly
 * that.
 */
export function describeEstimate(estimate: EstimateView): DescribedEstimate {
  if (!estimate.available) {
    return {
      headline: "Not available",
      sentence: `No ${QUESTION_LABEL[estimate.question].toLowerCase()} probability is available for this candidate.`,
      support: estimate.because,
      available: false,
    };
  }
  const display = formatProbability(estimate.probability);
  const lead =
    estimate.bounded === "upper"
      ? "At least "
      : estimate.bounded === "lower"
        ? "At most "
        : "";
  const interval = `95% calibration interval ${formatProbability(estimate.lower)} to ${formatProbability(estimate.upper)}`;
  return {
    headline: `${lead}${display}`.trim(),
    sentence: `${lead}${display} ${QUESTION_SENTENCE[estimate.question]}, ${interval}.`,
    support: estimate.boundNote
      ? `${estimate.cohortSentence} ${estimate.boundNote}`
      : estimate.cohortSentence,
    available: true,
  };
}

// ---------------------------------------------------------------------------
// Evidence families, for the "why" panel
// ---------------------------------------------------------------------------

export const FAMILIES = [
  "primary",
  "guides",
  "screen_quality",
  "artifacts",
  "context",
  "independent",
  "biology",
] as const;
export type Family = (typeof FAMILIES)[number];

export const FAMILY_LABEL: Record<Family, string> = {
  primary: "Primary experiment",
  guides: "Guide consistency",
  screen_quality: "Screen quality",
  artifacts: "Artefact evidence",
  context: "Biological context",
  independent: "Independent evidence",
  biology: "Gene biology",
};

export interface Contribution {
  family: Family;
  label: string;
  /** Log-odds. Signed, and never rendered as a percentage. */
  value: number;
  /** Which way it pushed the estimate, in the reader's words. */
  direction: "toward" | "against" | "neutral";
}

/**
 * Per-family contributions, largest first.
 *
 * These are log-odds, not probabilities, and they are never formatted with a
 * percent sign. The hierarchical model's decomposition is exact — the families
 * plus the intercept sum to the linear predictor — which is why the console
 * shows it at all, and why the boosted tree returns null here rather than an
 * approximation that would look identical on screen.
 */
export function contributionRows(
  contributions: Record<string, number> | null,
): Contribution[] {
  if (!contributions) return [];
  return FAMILIES.filter((family) => family in contributions)
    .map((family) => {
      const value = Number(contributions[family]);
      return {
        family,
        label: FAMILY_LABEL[family],
        value: Number.isFinite(value) ? value : 0,
        direction:
          !Number.isFinite(value) || Math.abs(value) < 1e-9
            ? ("neutral" as const)
            : value > 0
              ? ("toward" as const)
              : ("against" as const),
      };
    })
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

// ---------------------------------------------------------------------------
// Coverage floors, mirrored so the console can say what is outstanding
// ---------------------------------------------------------------------------

export const COVERAGE_THRESHOLDS = {
  minStratumOutcomes: 40,
  minStratumLabs: 3,
  minStratumScreens: 5,
  minNetworkOutcomes: 100,
  minNetworkLabs: 3,
  maxDisagreementRate: 0.15,
} as const;

/**
 * What is outstanding before a probability can be stated, in the reader's words.
 *
 * Pure, and in this module rather than beside the database reads, because the
 * page that renders it is a component and a component has no business importing
 * a `server-only` module to get a sentence. The figures are the floors the
 * engine's coverage gate enforces, pinned to it by
 * `apps/web/tests/validation-contract.test.mjs`.
 *
 * A laboratory that reads "3 of 5 primary screens" knows what would change it.
 * "Insufficient data" tells them nothing.
 */
export function outstandingFor(available: boolean): string[] {
  if (available) return [];
  return [
    `${COVERAGE_THRESHOLDS.minNetworkOutcomes} decided outcomes across the network`,
    `${COVERAGE_THRESHOLDS.minNetworkLabs} contributing laboratories`,
    `${COVERAGE_THRESHOLDS.minStratumOutcomes} decided outcomes, ${COVERAGE_THRESHOLDS.minStratumLabs} laboratories and ${COVERAGE_THRESHOLDS.minStratumScreens} primary screens in the experiment's own context`,
    "a held-out-laboratory evaluation on record",
  ];
}

/**
 * The two validation-set designs a round can be drawn under.
 *
 * Here rather than beside the server actions, because a `"use server"` module
 * may export only async functions: a constant exported from one is a build
 * error, and a form that needs the list is a client component anyway.
 */
export const ROUND_DESIGNS = ["stratified_arms", "rank_stratified"] as const;
export type RoundDesign = (typeof ROUND_DESIGNS)[number];

export const DESIGN_LABEL: Record<RoundDesign, string> = {
  stratified_arms: "Arms: SplicR, FDR, investigator, random",
  rank_stratified: "Rank-stratified (doi:10.1038/s43586-022-00098-7)",
};

export function isRoundDesign(value: unknown): value is RoundDesign {
  return typeof value === "string" && (ROUND_DESIGNS as readonly string[]).includes(value);
}

/**
 * The strategies a round can draw an arm from.
 *
 * 'unassigned' is not here: it is what an outcome recorded outside a round
 * carries, never something anybody chooses.
 */
export const SELECTABLE_ARMS = ["splicr", "fdr", "investigator", "random"] as const;
export type SelectableArm = (typeof SELECTABLE_ARMS)[number];

/** What each strategy ranks by, so the choice is made knowingly. */
export const ARM_RANKS_BY: Record<SelectableArm, string> = {
  splicr: "SplicR evidence order: significance weighted by effect size",
  fdr: "The screen's own q-value, smallest first",
  investigator: "MAGeCK's own ranking, which is what most labs scan first",
  random: "Spread across the rank range, so the screen is assessed and not just its top",
};

/** A budget below this cannot carry a stratified design worth analysing. */
export const MIN_BUDGET = 4;
export const MAX_BUDGET = 500;

/**
 * The published rank-stratified validation design.
 *
 * doi:10.1038/s43586-022-00098-7: "For a representative assessment of the
 * screening hits, some hits should be selected for validation solely based on
 * their ranks - for example, the top 20 hits as well as 10 hits each around the
 * 5th, 10th, 25th, 50th and 75th percentiles."
 *
 * Carried here so the round form can show a scientist where its default came
 * from rather than presenting a stratification SplicR invented.
 */
export const RANK_STRATIFIED_REFERENCE = {
  source: "doi:10.1038/s43586-022-00098-7",
  topN: 20,
  percentiles: [5, 10, 25, 50, 75] as const,
  perPercentile: 10,
  total: 70,
} as const;

/**
 * Precedence for attributing a candidate several arms chose.
 *
 * SplicR last, so a candidate the investigator would have picked anyway is
 * credited to the investigator. Every lift this design measures is therefore a
 * conservative one, and the round page says so.
 */
export const ARM_PRECEDENCE = ["investigator", "fdr", "random", "splicr"] as const;
