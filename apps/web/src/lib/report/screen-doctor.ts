/**
 * Screen Doctor: is this run trustworthy, and what should be checked first?
 *
 * WHAT IT IS AND IS NOT
 *
 * It is a reading of the QC the engine already recorded. It computes no new
 * statistic: every number it prints is a stored value, and every judgement is
 * that value compared with a threshold somebody published, named beside it.
 * There is no quality score, because a single number collapses "one sample's
 * reads are not guide amplicon" and "the library drifted" into a figure that
 * answers neither.
 *
 * It is also careful about causation. Representation widening from the plasmid
 * pool through to harvest is a fact about six recorded skew ratios. That cells
 * were lost during the screen is an interpretation of that fact, and the
 * sentence says "consistent with" rather than "caused by", because the QC
 * cannot distinguish a bottleneck from strong selection.
 *
 * THREE LAYERS
 *
 * `headline` and `concern` are the decision. `findings[].evidence` is the
 * measurement behind each one. The per-sample table the console puts under
 * "All QC metrics" is the detail. A reader should be able to stop after the
 * first and act, or carry on to the third and check the arithmetic.
 */
import { QC } from "./qc-thresholds";

export type Level = "fail" | "warn" | "ok";

/** One recorded measurement, with what it was judged against. */
export interface Evidence {
  label: string;
  value: string;
  /** The threshold and who set it, where there is one. */
  against?: string;
}

export interface Finding {
  id: string;
  level: Level;
  /** One line. The thing that is true. */
  title: string;
  /** One sentence. Why it matters for reading the hits. */
  detail: string;
  evidence: Evidence[];
  /** Sample labels this is about, where it is about particular samples. */
  samples: string[];
}

export interface Diagnosis {
  /** The run's own recorded verdict. Not recomputed here. */
  verdict: "fail" | "warn" | "pass" | "pending";
  headline: string;
  /** The one thing to look at first. Null when nothing needs attention. */
  concern: Finding | null;
  /** What to do before trusting the hit table. Null when there is nothing to do. */
  action: string | null;
  findings: Finding[];
  samples: SampleQc[];
}

/** A sample's recorded QC, as `run_qc.metrics.samples[]` stores it. */
export interface SampleQc {
  label: string;
  role: string;
  verdict: string;
  mapping_rate: number | null;
  zero_fraction: number | null;
  skew_ratio: number | null;
  mean_reads_per_guide: number | null;
  gini: number | null;
  total_reads: number | null;
}

export interface ReplicatePair {
  a: string;
  b: string;
  r: number | null;
}

/** What the diagnosis is built from. All of it recorded by the run. */
export interface QcEvidence {
  verdict: string | null;
  nnmd: number | null;
  nnmdContrast: string | null;
  auroc: number | null;
  samples: SampleQc[];
  replicates: ReplicatePair[];
  /** Samples the engine itself called bottlenecked. */
  bottlenecked: string[];
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const num = (value: number, places = 1) => value.toFixed(places);

function median(values: number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function list(labels: string[]): string {
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/** Roles that exist at the end of the screen, where representation has had time to drift. */
const ENDPOINT = new Set(["treatment", "control"]);

function mappingFinding(evidence: QcEvidence): Finding | null {
  const rated = evidence.samples.filter((s) => s.mapping_rate !== null);
  if (rated.length === 0) return null;
  const failing = rated.filter((s) => (s.mapping_rate as number) < QC.mappingRateMin.value);
  const low = rated.filter((s) => {
    const rate = s.mapping_rate as number;
    return rate >= QC.mappingRateMin.value && rate < QC.mappingRateWarn.value;
  });
  const affected = failing.length > 0 ? failing : low;
  if (affected.length === 0) {
    return {
      id: "mapping",
      level: "ok",
      title: "Reads map to the library",
      detail: "Every sample is above the floor, so the counts are of guides rather than of something else.",
      evidence: [{
        label: "Lowest mapping rate",
        value: pct(Math.min(...rated.map((s) => s.mapping_rate as number))),
        against: `${pct(QC.mappingRateMin.value)} floor, ${QC.mappingRateMin.source}`,
      }],
      samples: [],
    };
  }
  const others = rated.filter((s) => !affected.includes(s)).map((s) => s.mapping_rate as number);
  const typical = median(others);
  return {
    id: "mapping",
    level: failing.length > 0 ? "warn" : "warn",
    title: `${list(affected.map((s) => s.label))} ${affected.length === 1 ? "has" : "have"} a low mapping rate`,
    detail:
      "Reads that do not match a guide are not counted, so this sample's effective depth is lower than its "
      + "read count suggests and every fold change it enters is noisier.",
    evidence: [
      ...affected.map((s) => ({
        label: `${s.label} mapped`,
        value: pct(s.mapping_rate as number),
        against: `${pct(QC.mappingRateMin.value)} floor, ${QC.mappingRateMin.source}`,
      })),
      ...(typical === null ? [] : [{ label: "Median of the other samples", value: pct(typical) }]),
    ],
    samples: affected.map((s) => s.label),
  };
}

function representationFinding(evidence: QcEvidence): Finding | null {
  const rated = evidence.samples.filter((s) => s.zero_fraction !== null);
  if (rated.length === 0) return null;
  const bottlenecked = rated.filter((s) => (s.zero_fraction as number) > QC.zeroFractionWarn.value);
  const thin = rated.filter((s) => {
    const zero = s.zero_fraction as number;
    return zero > QC.zeroFractionMax.value && zero <= QC.zeroFractionWarn.value;
  });
  const affected = bottlenecked.length > 0 ? bottlenecked : thin;
  if (affected.length === 0) return null;

  // Descriptive first: does representation widen from the reference to the end
  // of the screen? That is six recorded numbers, not an inference.
  const early = median(rated.filter((s) => !ENDPOINT.has(s.role) && s.skew_ratio !== null)
    .map((s) => s.skew_ratio as number));
  const late = median(rated.filter((s) => ENDPOINT.has(s.role) && s.skew_ratio !== null)
    .map((s) => s.skew_ratio as number));
  const widened = early !== null && late !== null && late > early * 1.5;

  return {
    id: "representation",
    level: bottlenecked.length > 0 ? "warn" : "warn",
    title: `${list(affected.map((s) => s.label))} lost guides from the library`,
    detail: widened
      // "Consistent with", not "caused by": QC cannot tell a bottleneck from
      // selection strong enough to remove guides on its own.
      ? "Guide representation widens between the early samples and the end of the screen, which is consistent "
        + "with cells being lost during passage. A guide that drifted out by chance reads as depleted."
      : "A guide with no reads cannot be distinguished from one the screen removed, so depleted calls in these "
        + "samples carry an extra reason to be wrong.",
    evidence: [
      ...affected.map((s) => ({
        label: `${s.label} guides with no reads`,
        value: pct(s.zero_fraction as number),
        against: `${pct(QC.zeroFractionMax.value)} limit, ${QC.zeroFractionMax.source}`,
      })),
      ...(widened
        ? [{
            label: "Skew, early samples to harvest",
            value: `${num(early as number)} to ${num(late as number)}`,
            against: `${QC.skewRatioMax.value} limit, ${QC.skewRatioMax.source}`,
          }]
        : []),
    ],
    samples: affected.map((s) => s.label),
  };
}

function separationFinding(evidence: QcEvidence): Finding | null {
  if (evidence.nnmd === null) return null;
  const passes = evidence.nnmd <= QC.nnmdMax.value;
  const contrast = evidence.nnmdContrast ? ` on ${evidence.nnmdContrast}` : "";
  return {
    id: "separation",
    level: passes ? "ok" : "warn",
    title: passes
      ? "Essential genes separate from non-essential ones"
      : "Essential genes do not separate from non-essential ones",
    detail: passes
      ? "The screen detected a signal it should detect, so a weak result is more likely to be the biology than the assay."
      : "The positive control for the assay did not work, so no gene result from this run can be read as a dependency.",
    evidence: [
      { label: `NNMD${contrast}`, value: num(evidence.nnmd, 2), against: `${QC.nnmdMax.value} or lower, ${QC.nnmdMax.source}` },
      ...(evidence.auroc === null ? [] : [{ label: "AUROC, essentials against non-essentials", value: num(evidence.auroc, 2) }]),
    ],
    samples: [],
  };
}

function replicateFinding(evidence: QcEvidence): Finding | null {
  const rated = evidence.replicates.filter((pair) => pair.r !== null);
  if (rated.length === 0) return null;
  const weak = rated.filter((pair) => (pair.r as number) < QC.replicateRMin.value);
  return {
    id: "replicates",
    level: weak.length > 0 ? "warn" : "ok",
    title: weak.length > 0 ? "Replicates disagree" : "Replicates agree",
    detail: weak.length > 0
      ? "Replicates of the same arm should see the same library, so a low correlation means at least one of them is not measuring the experiment."
      : "Replicates of the same arm track each other, so a difference between arms is more likely to be the treatment.",
    evidence: rated.map((pair) => ({
      label: `${pair.a} against ${pair.b}`,
      value: num(pair.r as number, 3),
      against: `${QC.replicateRMin.value} floor, ${QC.replicateRMin.source}`,
    })),
    samples: weak.flatMap((pair) => [pair.a, pair.b]),
  };
}

function depthFinding(evidence: QcEvidence): Finding | null {
  const rated = evidence.samples.filter((s) => s.mean_reads_per_guide !== null);
  if (rated.length === 0) return null;
  const shallow = rated.filter((s) => (s.mean_reads_per_guide as number) < QC.meanReadsPerGuideMin.value);
  if (shallow.length === 0) return null;
  const worst = shallow.reduce((a, b) =>
    (a.mean_reads_per_guide as number) <= (b.mean_reads_per_guide as number) ? a : b);
  return {
    id: "depth",
    level: "warn",
    title: shallow.length === rated.length
      ? "Every sample was sequenced below the usual depth"
      : `${list(shallow.map((s) => s.label))} ${shallow.length === 1 ? "was" : "were"} sequenced below the usual depth`,
    detail:
      "Shallow counting widens every guide's fold change, which costs power on small effects rather than "
      + "creating false ones.",
    evidence: [{
      label: `${worst.label} mean reads per guide`,
      value: num(worst.mean_reads_per_guide as number, 0),
      against: `${QC.meanReadsPerGuideMin.value} floor, ${QC.meanReadsPerGuideMin.source}`,
    }],
    samples: shallow.map((s) => s.label),
  };
}

/** Worst first, and a finding naming particular samples outranks one that does not. */
const RANK: Record<Level, number> = { fail: 0, warn: 1, ok: 2 };

function order(a: Finding, b: Finding): number {
  if (RANK[a.level] !== RANK[b.level]) return RANK[a.level] - RANK[b.level];
  // A failed separation outranks everything of the same severity. It is the
  // assay's own positive control: if essentials did not separate from
  // non-essentials then no gene result from the run is readable, and telling a
  // researcher to go and check one sample's mapping rate first would send them
  // to fix a detail of an experiment that did not work.
  const assay = (finding: Finding) => Number(finding.id === "separation" && finding.level === "fail");
  if (assay(a) !== assay(b)) return assay(b) - assay(a);
  return Number(b.samples.length > 0) - Number(a.samples.length > 0);
}

/** What to do about the thing that needs looking at first. */
function actionFor(concern: Finding | null): string | null {
  if (concern === null || concern.level === "ok") return null;
  switch (concern.id) {
    case "mapping":
      return `Check the library call and the guide offset for ${list(concern.samples)} before reading any result that sample enters.`;
    case "representation":
      return "Treat depleted calls with caution: in these samples a guide that drifted out reads the same as one the screen removed.";
    case "separation":
      return "Do not read gene results from this run. The assay's own positive control did not separate.";
    case "replicates":
      return `Review ${list(concern.samples)} before interpreting the arm they belong to.`;
    case "depth":
      return "Expect to miss small effects rather than to see false ones. Sequence deeper if a weak candidate matters.";
    default:
      return null;
  }
}

function headlineFor(verdict: Diagnosis["verdict"], concern: Finding | null, findings: Finding[]): string {
  if (verdict === "pending") return "This run recorded no QC, so nothing here says the screen is sound.";
  const failing = findings.filter((f) => f.level === "fail").length;
  const warning = findings.filter((f) => f.level === "warn").length;
  if (concern === null || (failing === 0 && warning === 0)) {
    return "Every check the engine ran passed.";
  }
  const separation = findings.find((f) => f.id === "separation");
  const assayWorked = separation?.level === "ok";
  const counted = `${failing > 0 ? `${failing} check${failing === 1 ? "" : "s"} failed` : ""}`
    + `${failing > 0 && warning > 0 ? " and " : ""}`
    + `${warning > 0 ? `${warning} need${warning === 1 ? "s" : ""} attention` : ""}`;
  return assayWorked
    ? `The assay worked, but ${counted}.`
    : `${counted.charAt(0).toUpperCase()}${counted.slice(1)}.`;
}

/**
 * Read the recorded QC.
 *
 * `verdict` is the run's own, copied, never recomputed: the engine decided it
 * and the screen header shows the same word.
 */
export function diagnose(evidence: QcEvidence | null): Diagnosis {
  if (evidence === null) {
    return {
      verdict: "pending",
      headline: "This run recorded no QC, so nothing here says the screen is sound.",
      concern: null,
      action: null,
      findings: [],
      samples: [],
    };
  }
  const findings = [
    separationFinding(evidence),
    mappingFinding(evidence),
    representationFinding(evidence),
    replicateFinding(evidence),
    depthFinding(evidence),
  ].filter((finding): finding is Finding => finding !== null).sort(order);

  const verdict = (["fail", "warn", "pass"] as const).includes(evidence.verdict as never)
    ? (evidence.verdict as "fail" | "warn" | "pass")
    : "pending";
  const concern = findings.find((finding) => finding.level !== "ok") ?? null;

  return {
    verdict,
    headline: headlineFor(verdict, concern, findings),
    concern,
    action: actionFor(concern),
    findings,
    samples: evidence.samples,
  };
}
