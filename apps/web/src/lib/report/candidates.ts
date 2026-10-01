/**
 * A candidate, read as a decision rather than as a row.
 *
 * WHAT THIS MODULE DOES
 *
 * It takes a recorded hit, its artifact flags, its Atlas history and whatever
 * the lab has already decided about it, and arranges them around the questions
 * a researcher actually asks: why does this stand out, what supports it, what
 * could weaken it, where has it been seen before, and what would resolve the
 * doubt. Nothing is computed that the run did not record, and nothing is
 * ranked: there is no single score, because the reasons to doubt a candidate
 * are not commensurable with the reasons to believe it.
 *
 * THE RECOMMENDATION IS A PROPOSAL, AND IT SHOWS ITS WORKING
 *
 * `nextExperiment` names an objective, the reason it is being suggested, the
 * recorded evidence behind that reason, what it assumes, and what uncertainty
 * it would reduce. A reader who disagrees with the assumption can see it and
 * ignore the suggestion. There is no model here and no learned weighting: the
 * suggestion follows from flags and guide agreement by rules written out below,
 * which is the only kind of recommendation that can be argued with.
 */
import type { OutcomeResult } from "@/lib/outcomes/model";

export const CANDIDATE_STATES = [
  "shortlisted",
  "needs_validation",
  "hold",
  "excluded",
  "validated",
] as const;

export type CandidateState = (typeof CANDIDATE_STATES)[number];
/** No row in the decision log. Not a state anybody chose. */
export type CandidateStatus = CandidateState | "unreviewed";

export const STATE_COPY: Record<CandidateStatus, { label: string; help: string }> = {
  unreviewed: {
    label: "Unreviewed",
    help: "Nobody in this workspace has recorded a decision about this gene.",
  },
  shortlisted: {
    label: "Shortlisted",
    help: "Someone decided it is worth taking further. A decision about bench time, not a finding.",
  },
  needs_validation: {
    label: "Needs validation",
    help: "Chosen for a follow-up experiment. Record the outcome in the Truth Loop when it runs.",
  },
  hold: {
    label: "Hold",
    help: "Interesting, not now. The reason recorded with the decision says why.",
  },
  excluded: {
    label: "Excluded",
    help: "Someone decided it is not worth bench time. That is a judgement about this lab's priorities, not a finding that the gene has no phenotype.",
  },
  validated: {
    label: "Validated",
    help: "A bench outcome supported it. The outcome itself, with its assay and date, is in the Truth Loop.",
  },
};

export interface ArtifactFlag {
  flag: string;
  severity: string;
  message: string;
}

/** Everything the board shows for one candidate. All of it recorded. */
export interface Candidate {
  gene: string;
  comparison: string;
  direction: string;
  lfc: number | null;
  pValue: number | null;
  fdr: number | null;
  nGuides: number | null;
  /** Guides pointing the same way as the gene, over guides with a recorded effect. */
  guidesAgreeing: { agree: number; total: number } | null;
  flags: ArtifactFlag[];
  /** Atlas history, or null when it was not looked up. */
  atlas: { hits: number; tested: number; frequentHitter: boolean } | null;
  status: CandidateStatus;
  decision: { reason: string | null; at: string; by: string | null; count: number } | null;
  /** Every decision ever recorded for this gene, newest first. */
  history: DecisionEntry[];
  outcome: OutcomeResult | null;
}

/** One row of the append-only log, as the board shows it. */
export interface DecisionEntry {
  id: string;
  state: string;
  reason: string | null;
  at: string;
  /** The statistics as they stood when this decision was taken. */
  evidence: { fdr?: number | null; lfc?: number | null; engine_version?: string | null } | null;
}

/** One answer to one researcher question, with the values behind it. */
export interface Reading {
  question: string;
  /** Empty when the run recorded nothing that answers it. */
  points: string[];
  /** Said out loud when there is nothing, rather than left blank. */
  absent?: string;
}

const signed = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}`;

function stat(value: number | null): string {
  if (value === null) return "not recorded";
  if (value === 0) return "0";
  return value < 0.001 ? value.toExponential(1) : value.toFixed(4);
}

/** Why it stands out: the recorded statistics, in words. */
export function whyItStandsOut(candidate: Candidate): Reading {
  const points: string[] = [];
  if (candidate.lfc !== null) {
    points.push(
      `${candidate.direction === "depleted" ? "Depleted" : "Enriched"} at log2 fold change ${signed(candidate.lfc)} in ${candidate.comparison}.`,
    );
  }
  if (candidate.fdr !== null) {
    points.push(`Recorded FDR ${stat(candidate.fdr)}${candidate.pValue !== null ? `, from p ${stat(candidate.pValue)}` : ""}.`);
  }
  return {
    question: "Why it stands out",
    points,
    absent: points.length === 0 ? "This record has no effect or FDR, so nothing here makes it stand out." : undefined,
  };
}

/** What supports it: independent lines of evidence pointing the same way. */
export function whatSupportsIt(candidate: Candidate): Reading {
  const points: string[] = [];
  const agree = candidate.guidesAgreeing;
  if (agree && agree.total > 0) {
    points.push(
      agree.agree === agree.total
        ? `All ${agree.total} guides with a recorded effect point the same way as the gene.`
        : `${agree.agree} of ${agree.total} guides with a recorded effect point the same way as the gene.`,
    );
  }
  if (candidate.atlas && candidate.atlas.tested > 0 && candidate.atlas.hits > 0) {
    points.push(
      `Called a hit in ${candidate.atlas.hits.toLocaleString("en-US")} of the ${candidate.atlas.tested.toLocaleString("en-US")} background screens that measured it, each by its own authors' rule.`,
    );
  }
  if (candidate.outcome === "validated") {
    points.push("An independent assay recorded in the Truth Loop supported it.");
  }
  return {
    question: "What supports it",
    points,
    absent: points.length === 0
      ? "No independent line of evidence was recorded for this gene. That is an absence of evidence, not evidence against it."
      : undefined,
  };
}

/** What could weaken it: flags, thin guide support, promiscuity in the Atlas. */
export function whatCouldWeakenIt(candidate: Candidate): Reading {
  const points: string[] = [];
  for (const flag of candidate.flags) {
    points.push(`${flag.flag.replace(/_/g, " ")}: ${flag.message}`);
  }
  const agree = candidate.guidesAgreeing;
  if (agree && agree.total > 0 && agree.agree < agree.total) {
    points.push(`${agree.total - agree.agree} of ${agree.total} guides point the other way, so the gene mean is not unanimous.`);
  }
  if (candidate.nGuides !== null && candidate.nGuides < 3) {
    points.push(`Only ${candidate.nGuides} guide${candidate.nGuides === 1 ? "" : "s"} targeted this gene, so one bad sequence carries the call.`);
  }
  if (candidate.atlas?.frequentHitter) {
    points.push("The Atlas marks it a frequent hitter: it is called in many unrelated screens, which is a reason to ask whether the signal is specific to this one.");
  }
  if (candidate.outcome === "failed") {
    points.push("An assay recorded in the Truth Loop ran and did not support it.");
  }
  return {
    question: "What could weaken it",
    points,
    absent: points.length === 0
      ? "No artifact flag was recorded and the guides agree. That is not confirmation the hit is real."
      : undefined,
  };
}

export function whereItHasBeenSeen(candidate: Candidate): Reading {
  if (candidate.atlas === null) {
    return { question: "Where it has been seen before", points: [], absent: "The Atlas was not looked up for this gene." };
  }
  if (candidate.atlas.tested === 0) {
    return {
      question: "Where it has been seen before",
      points: [],
      absent: "No background screen in the Atlas measured this gene, so it has no hit rate. That is different from being measured and never called.",
    };
  }
  return {
    question: "Where it has been seen before",
    points: [
      `${candidate.atlas.hits.toLocaleString("en-US")} of ${candidate.atlas.tested.toLocaleString("en-US")} background screens that measured it called it a hit.`,
      ...(candidate.atlas.frequentHitter ? ["The Atlas marks it a frequent hitter."] : []),
    ],
  };
}

/**
 * A follow-up experiment, with its reasoning exposed.
 *
 * Each rule below is a statement about what is unresolved, and the experiment
 * proposed is the one that resolves it. Every rule names the recorded evidence
 * that fired it, what it assumes, and what uncertainty it would reduce, so a
 * reader who rejects the assumption can reject the suggestion.
 *
 * WHEN THERE IS NOTHING TO SAY, IT SAYS NOTHING
 *
 * The rules fire on recorded evidence. A run that stored no per-guide effects,
 * no artifact flags and no Atlas history gives them nothing to fire on, and the
 * honest answer is that no follow-up follows from what was recorded. An earlier
 * version fell through to "the guides do not agree unanimously" in that case,
 * which asserts a disagreement nobody measured. That is the failure mode this
 * whole module exists to avoid, so the absence is now a first-class result.
 */
export interface NextExperiment {
  objective: string;
  reason: string;
  evidence: string[];
  assumption: string;
  reduces: string;
  /** A second option, where one is genuinely different rather than a variant. */
  alternative?: { objective: string; reason: string };
}

export type NextExperimentResult =
  | ({ kind: "suggested" } & NextExperiment)
  /** Nothing follows from the recorded evidence, and this says which evidence was absent. */
  | { kind: "none"; because: string };

export function nextExperiment(candidate: Candidate): NextExperimentResult {
  if (candidate.outcome === "validated") {
    return {
      kind: "none",
      because: "An assay recorded in the Truth Loop already supported this candidate. What to do next is a question about the project, not about the evidence.",
    };
  }

  const promiscuous = candidate.flags.find((flag) =>
    ["promiscuous_guide", "multi_gene_guide", "single_guide"].includes(flag.flag));
  const frequent = candidate.atlas?.frequentHitter
    || candidate.flags.some((flag) => flag.flag === "frequent_hitter");
  const agree = candidate.guidesAgreeing;
  const measuredGuides = agree !== null && agree.total > 1;
  const unanimous = measuredGuides && agree.agree === agree.total;
  const divided = measuredGuides && agree.agree < agree.total;

  if (promiscuous) {
    return {
      kind: "suggested",
      objective: "Repeat the perturbation with independent guides",
      reason: `The phenotype could belong to a sequence rather than to the gene: ${promiscuous.flag.replace(/_/g, " ")} was recorded for this call.`,
      evidence: [
        promiscuous.message,
        ...(agree ? [`${agree.agree} of ${agree.total} guides point the same way as the gene.`] : []),
      ],
      assumption: "That guides not sharing the flagged sequence cut the same gene with comparable efficiency.",
      reduces: "Whether the effect follows the gene or the particular guides the library happened to carry.",
      alternative: {
        objective: "Suppress the gene with CRISPRi instead",
        reason: "A different perturbation chemistry shares none of the cutting artifacts, at the cost of knocking down rather than out.",
      },
    };
  }

  if (frequent) {
    return {
      kind: "suggested",
      objective: "Compare against an untreated arm of the same cells",
      reason: "The gene is called in many unrelated screens, so the signal may be general fitness rather than anything about this treatment.",
      evidence: [
        ...(candidate.atlas && candidate.atlas.tested > 0
          ? [`Called in ${candidate.atlas.hits.toLocaleString("en-US")} of ${candidate.atlas.tested.toLocaleString("en-US")} background screens that measured it.`]
          : ["An artifact flag recorded this call as a frequent hitter."]),
        ...(candidate.lfc !== null ? [`Effect here is ${signed(candidate.lfc)}.`] : []),
      ],
      assumption: "That the untreated arm is otherwise handled identically, so the only difference is the treatment.",
      reduces: "Whether the effect is specific to this phenotype or is this gene's behaviour everywhere.",
    };
  }

  if (divided) {
    return {
      kind: "suggested",
      objective: "Repeat the perturbation with independent guides",
      reason: "The guides recorded for this gene do not all point the same way, so the gene mean rests on a subset of them.",
      evidence: [`${agree.agree} of ${agree.total} guides point the same way as the gene.`],
      assumption: "That the disagreement is guide efficiency rather than a real difference between the regions they cut.",
      reduces: "Whether the gene-level call survives a different set of guides.",
    };
  }

  if (unanimous) {
    return {
      kind: "suggested",
      objective: "Validate in a second cell model",
      reason: "The call is internally consistent here, so the open question is whether it holds outside this line.",
      evidence: [
        `All ${agree.total} guides with a recorded effect point the same way.`,
        ...(candidate.fdr !== null ? [`Recorded FDR ${stat(candidate.fdr)}.`] : []),
        "No artifact flag was recorded.",
      ],
      assumption: "That the phenotype is measurable in the second model with the same readout.",
      reduces: "Whether the dependency is a property of this cell line or of the biology.",
      alternative: {
        objective: "Rescue with a guide-resistant construct",
        reason: "Restoring the gene is the most direct evidence that the phenotype follows it, and needs no second model.",
      },
    };
  }

  // Nothing fired. Name what was missing rather than reaching for a default.
  const absent: string[] = [];
  if (agree === null || agree.total <= 1) absent.push("per-guide effects");
  if (candidate.flags.length === 0) absent.push("artifact flags");
  if (candidate.atlas === null || candidate.atlas.tested === 0) absent.push("Atlas history");
  return {
    kind: "none",
    because: absent.length === 0
      ? "No specific follow-up can be recommended from the recorded evidence."
      : `No specific follow-up can be recommended from the recorded evidence: this run recorded no ${absent.join(", no ")} for this gene.`,
  };
}

/** The whole reading, in the order the questions get asked. */
export function readCandidate(candidate: Candidate): Reading[] {
  return [
    whyItStandsOut(candidate),
    whatSupportsIt(candidate),
    whatCouldWeakenIt(candidate),
    whereItHasBeenSeen(candidate),
  ];
}

/** How many candidates sit in each state, for the board's own header. */
export function tally(candidates: readonly Candidate[]): Record<CandidateStatus, number> {
  const counts = {
    unreviewed: 0, shortlisted: 0, needs_validation: 0, hold: 0, excluded: 0, validated: 0,
  } as Record<CandidateStatus, number>;
  for (const candidate of candidates) counts[candidate.status] += 1;
  return counts;
}
