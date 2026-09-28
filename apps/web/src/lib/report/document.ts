/**
 * The Hit Report document.
 *
 * One structure is built here and then rendered four ways: the Report tab, the
 * CSV, the JSON and the PDF. That is deliberate. The previous report had the
 * card computing its own counts, a Methods paragraph with a different library
 * hardcoded into it, and three download buttons that did nothing, so there was
 * no single answer to "what does this screen actually say". Everything a report
 * claims now comes through this builder.
 *
 * Provenance is not decoration. A supplementary table that cannot say which
 * library, which tool versions, which thresholds and which reference releases
 * produced it is not reproducible, so the document carries all four and every
 * export writes them out.
 *
 * This builder uses illustrative fixtures only. It refuses workspace source
 * labels; real reports require a separate adapter backed by recorded run data.
 */
import {
  ATLAS_SCREENS_TOTAL,
  BOTTLENECK_WEIGHT,
  controlSeparation,
  FDR_THRESHOLD,
  hitsForScreen as hitTableFor,
  libraries,
  LIKELY_REAL_THRESHOLD,
  QC_SCREEN_ID,
  replicateCorr,
  samples,
  stagesForScreen,
  testsForScreen,
  type Direction,
  type Hit,
  type Sample,
  type Screen,
  type Verdict,
} from "@/lib/mock/data";
import { formatNumber } from "@/lib/utils";

import {
  GENOME_BUILDS,
  PARAMETERS,
  PIPELINE,
  REFERENCE_RELEASES,
  TOOLS,
  type ParameterRecord,
} from "./pipeline";

export const VERDICT_ORDER: Verdict[] = [
  "Real and new",
  "Real and known",
  "Real but generic",
  "Artifact",
  "Uncertain",
];

export type ReportSource = "sample" | "workspace";

export const SAMPLE_NOTICE =
  "Sample data. Every number in this report comes from the SplicR demo dataset. It is not a measurement of any real screen and must not be cited.";

export interface ReportTiming {
  stage: string;
  title: string;
  tool: string | null;
  durationSec: number | null;
  startedAt: string | null;
}

export interface ReportReference {
  name: string;
  release: string;
  detail: string;
}

export interface ReportQc {
  /** Absent when the run has no per-sample QC recorded, which is not the same as zero. */
  samples: Sample[];
  meanMapped: number;
  totalReads: number;
  giniRange: [number, number];
  zeroGuideRange: [number, number];
  flagged: Sample[];
  replicates: number;
  auroc: number;
  nnmd: number;
  essentialGenes: number;
  nonEssentialGenes: number;
  worstReplicateCorr: number;
}

export interface ReportHitRow {
  rank: number;
  gene: string;
  verdict: Verdict;
  chance: number;
  novelty: number;
  lfc: number;
  direction: Direction;
  pValue: number;
  fdr: number;
  bayesFactor: number;
  guides: number;
  guidesAgree: number;
  guideConcordance: number;
  atlasHits: number;
  atlasScreens: number;
  atlasHitRate: number;
  flags: string[];
  evidence: string;
}

export interface ReportLibrary {
  /** What the screen recorded, always. */
  label: string;
  /** Present only when the exact library version is in the library registry. */
  guides: number | null;
  genes: number | null;
  guidesPerGene: number | null;
  cas: string | null;
}

export interface ReportDocument {
  reportId: string;
  source: ReportSource;
  notice: string | null;
  screen: {
    id: string;
    name: string;
    cellLine: string;
    organism: "Human" | "Mouse";
    modality: string;
    phenotype: string;
    status: string;
    qcVerdict: string;
    createdAt: string;
  };
  library: ReportLibrary;
  run: {
    id: string;
    pipeline: string;
    pipelineVersion: string;
    analysisSchema: string;
    startedAt: string | null;
    completedAt: string | null;
    wallClockSec: number;
    stages: ReportTiming[];
  };
  counts: {
    candidates: number;
    likelyReal: number;
    flagged: number;
    /** Candidates from the positive-selection arm. Zero is a real answer. */
    enriched: number;
    byVerdict: Record<Verdict, number>;
  };
  /** Gene-level tests the FDR correction ran over, without which a q-value is not reproducible. */
  nTests: number;
  /** Size of the Atlas corpus. Each hit's own denominator is a subset of it. */
  atlasScreensTotal: number;
  qc: ReportQc | null;
  tools: typeof TOOLS;
  parameters: ParameterRecord[];
  references: ReportReference[];
  summary: string;
  methods: { heading: string; body: string }[];
  hits: ReportHitRow[];
}

/** Stable id from a screen id, so a report can be referenced without a clock. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * The hit set for a screen. The Report tab, the hit table and the exports all
 * call this, so a download can never disagree with what is on the screen.
 *
 * Null when hit calling has not run. It used to serve the A375 human table to
 * every screen, sliced by `screen.hits % 120`, so a Mouse screen declared under
 * GRCm39 exported 96 human symbols, a screen advertising 1,804 hits exported 12,
 * and a running screen with no hits at all showed a tab badge of 12.
 */
export function hitsForScreen(screen: Screen): Hit[] | null {
  return hitTableFor(screen.id);
}

/** Exact match only. A near match would report guide counts from another version. */
function resolveLibrary(label: string): ReportLibrary {
  const found = libraries.find((l) => l.name === label);
  return {
    label,
    guides: found?.guides ?? null,
    genes: found?.genes ?? null,
    guidesPerGene: found?.perGene ?? null,
    cas: found?.cas ?? null,
  };
}

/**
 * The fixture records per-sample QC, replicate correlations and control
 * separation for one screen only, the A375 ferroptosis run. Attaching them to
 * every screen is how the console ended up reporting a bottlenecked RSL3
 * replicate on screens that never saw RSL3, so the report attaches them only
 * where they belong and says nothing where it has nothing.
 */
function buildQc(screenId: string): ReportQc | null {
  if (screenId !== QC_SCREEN_ID) return null;
  const ginis = samples.map((s) => s.gini);
  const zeros = samples.map((s) => s.zeroGuides);
  return {
    samples,
    meanMapped: samples.reduce((a, s) => a + s.mapped, 0) / samples.length,
    totalReads: samples.reduce((a, s) => a + s.reads, 0),
    giniRange: [Math.min(...ginis), Math.max(...ginis)],
    zeroGuideRange: [Math.min(...zeros), Math.max(...zeros)],
    flagged: samples.filter((s) => s.verdict !== "pass"),
    replicates: Math.max(...samples.map((s) => s.replicate)),
    auroc: controlSeparation.auroc,
    nnmd: controlSeparation.nnmd,
    essentialGenes: controlSeparation.essential,
    nonEssentialGenes: controlSeparation.nonessential,
    worstReplicateCorr: Math.min(...replicateCorr.map((c) => c.r)),
  };
}

function buildStages(screen: Screen): ReportTiming[] {
  return stagesForScreen(screen)
    .filter((s) => s.status === "done")
    .map((s) => ({
      stage: s.key,
      title: s.title,
      tool: s.tool ?? null,
      durationSec: s.durationSec ?? null,
      startedAt: s.startedAt ?? null,
    }));
}

function buildReferences(screen: Screen, library: ReportLibrary): ReportReference[] {
  const genome = GENOME_BUILDS[screen.organism];
  const refs: ReportReference[] = [
    {
      name: "sgRNA library",
      release: library.label,
      detail:
        library.guides !== null
          ? `${formatNumber(library.guides)} guides over ${formatNumber(library.genes ?? 0)} genes, ${library.guidesPerGene} per gene, ${library.cas}`
          : "Guide and gene counts are not registered for this library version, so none are reported",
    },
    { name: "Genome assembly", release: genome.assembly, detail: "Off-target multiplicity and positional clustering" },
    { name: "Gene annotation", release: genome.annotation, detail: "Guide to gene assignment" },
    {
      name: REFERENCE_RELEASES.essentials.name,
      release: REFERENCE_RELEASES.essentials.release,
      detail: `${formatNumber(controlSeparation.essential)} core essential genes, used as the positive set for separation and for BAGEL2`,
    },
    {
      name: REFERENCE_RELEASES.nonEssentials.name,
      release: REFERENCE_RELEASES.nonEssentials.release,
      detail: `${formatNumber(controlSeparation.nonessential)} non-essential genes, used as the negative set`,
    },
    {
      name: REFERENCE_RELEASES.orcs.name,
      release: REFERENCE_RELEASES.orcs.release,
      detail: `${formatNumber(ATLAS_SCREENS_TOTAL)} public screens behind the novelty and frequent-hitter calls. Each gene's own denominator is the subset that assayed it, reported per row`,
    },
    {
      name: REFERENCE_RELEASES.depmap.name,
      release: REFERENCE_RELEASES.depmap.release,
      detail: "Copy number for the cell line and cross-context gene effect",
    },
  ];
  return refs;
}

function buildParameters(screen: Screen, library: ReportLibrary, hits: Hit[], qc: ReportQc | null): ParameterRecord[] {
  const perGene = library.guidesPerGene ?? hits[0]?.guides ?? null;
  const derived: ParameterRecord[] = [];
  if (perGene !== null) {
    derived.push({
      label: "Guides per gene",
      value: String(perGene),
      note:
        perGene >= 4
          ? "At or above the four-guide floor below which gene-level ranking degrades sharply"
          : "Below the four-guide floor, so gene-level ranking is unreliable and the report says so",
    });
  }
  if (qc) {
    derived.push({ label: "Replicates per condition", value: String(qc.replicates) });
  }
  derived.push({ label: "Modality", value: screen.modality });
  derived.push({
    label: "Gene-level tests",
    value: formatNumber(testsForScreen(screen)),
    note: "The multiple-testing denominator. A q-value cannot be reproduced without it, because Benjamini-Hochberg corrects over every gene tested, not over the candidates that survived",
  });
  return [...derived, ...PARAMETERS];
}

function buildSummary(screen: Screen, counts: ReportDocument["counts"], hits: Hit[], qc: ReportQc | null): string {
  const parts: string[] = [];
  parts.push(
    `${formatNumber(counts.candidates)} genes clear Benjamini-Hochberg FDR ${FDR_THRESHOLD.toFixed(2)} over ${formatNumber(testsForScreen(screen))} gene-level tests in ${screen.name} (${screen.cellLine}, ${screen.modality}, ${screen.phenotype}).`,
  );
  parts.push(
    `${formatNumber(counts.likelyReal)} carry an illustrative model score of ${LIKELY_REAL_THRESHOLD.toFixed(2)} or above, of which ${formatNumber(counts.byVerdict["Real and new"])} are new in this context and ${formatNumber(counts.byVerdict["Real and known"])} recover known biology.`,
  );
  // A survival screen has two arms and a reader has to be told which one a gene
  // came out of. Reporting only the depleted arm is how a resistance gene gets
  // filed as a sensitiser.
  parts.push(
    counts.enriched === 0
      ? "Every candidate came out of the depleted arm; none was enriched."
      : `${formatNumber(counts.enriched)} came out of the enriched arm and ${formatNumber(counts.candidates - counts.enriched)} out of the depleted arm.`,
  );
  // Zero is a real answer here, so it is worded as one rather than printed as a
  // digit in a sentence that then reads as a template with a blank in it.
  parts.push(
    `${
      counts.byVerdict.Artifact === 0
        ? "No candidate is called an artifact"
        : `${formatNumber(counts.byVerdict.Artifact)} are called artifacts`
    } and ${
      counts.byVerdict.Uncertain === 0 ? "none remain uncertain" : `${formatNumber(counts.byVerdict.Uncertain)} remain uncertain`
    }. ${
      counts.flagged === 0
        ? "No candidate carries an artifact flag."
        : `${formatNumber(counts.flagged)} of the ${formatNumber(counts.candidates)} candidates carry at least one flag, each with the evidence that raised it.`
    }`,
  );
  if (qc && qc.flagged.length > 0) {
    parts.push(
      `${qc.flagged.map((s) => s.label).join(" and ")} exceeded the distribution thresholds and ${qc.flagged.length === 1 ? "was" : "were"} down-weighted to ${BOTTLENECK_WEIGHT.toFixed(2)} rather than dropped; the ${formatNumber(hits.filter((h) => h.flags.includes("Bottlenecked replicate")).length)} candidates whose signal concentrates there carry the Bottlenecked replicate flag and lost score for it.`,
    );
  }
  const strongest = hits.find((h) => h.verdict === "Real and new");
  if (strongest) {
    parts.push(
      `The strongest new candidate is ${strongest.gene} at illustrative model score ${strongest.chance.toFixed(2)}, log2 fold change ${strongest.lfc.toFixed(2)}, ${strongest.guidesAgree} of ${strongest.guides} guides agreeing.`,
    );
  }
  return `Illustrative example; no analysis was executed. ${parts.join(" ")}`;
}

function buildMethods(): { heading: string; body: string }[] {
  return [
    {
      heading: "Illustrative analysis",
      body: "This report is generated from demo fixtures. No sequencing, counting, MAGeCK, BAGEL2, copy-number correction or independent validation experiment was performed to produce these numbers. Tool versions, timing, sample metrics and reference releases are illustrative settings, not an execution record.",
    },
    {
      heading: "Illustrative statistics and artifacts",
      body: "Effects, p-values, FDR values, Bayes factors, guide concordance and artifact labels demonstrate the report layout. They are not measured results. A real report must identify the actual contrast, method, correction, run version and evidence behind every flag. A shared input does not make two statistics independent evidence.",
    },
    {
      heading: "Model score and historical context",
      body: "The legacy chance_real field contains an illustrative heuristic score. It is not a calibrated validation probability. No fitted uncertainty interval is available. Novelty, similar screens and validation outcomes here are illustrative fixtures; they do not establish biological validity or prospective performance. Demo feedback does not retrain any model.",
    },
  ];
}

export function buildReport(screen: Screen, source: ReportSource = "sample"): ReportDocument {
  if (source !== "sample") throw new Error("Sample report builder cannot produce workspace reports");
  // A screen that never reached hit calling has no table. The export route
  // refuses those with a 409 before this is called, so an empty table here means
  // the run called nothing, which is a result and is reported as one.
  const hits = hitsForScreen(screen) ?? [];
  const library = resolveLibrary(screen.library);
  const qc = buildQc(screen.id);
  const stages = buildStages(screen);

  const byVerdict = Object.fromEntries(
    VERDICT_ORDER.map((v) => [v, hits.filter((h) => h.verdict === v).length]),
  ) as Record<Verdict, number>;

  const counts = {
    candidates: hits.length,
    likelyReal: hits.filter((h) => h.chance >= LIKELY_REAL_THRESHOLD).length,
    flagged: hits.filter((h) => h.flags.length > 0).length,
    enriched: hits.filter((h) => h.direction === "enriched").length,
    byVerdict,
  };

  const started = stages.find((s) => s.startedAt)?.startedAt ?? null;
  const last = [...stages].reverse().find((s) => s.startedAt) ?? null;
  const completedAt =
    last?.startedAt && last.durationSec !== null
      ? new Date(new Date(last.startedAt).getTime() + last.durationSec * 1000).toISOString()
      : (last?.startedAt ?? null);

  const runId = `run_${fnv1a(screen.id).toString(16).padStart(8, "0")}`;

  return {
    reportId: `SPLICR-HR-${screen.id.replace(/_/g, "-").toUpperCase()}-${runId.slice(4).toUpperCase()}`,
    source,
    notice: source === "sample" ? SAMPLE_NOTICE : null,
    screen: {
      id: screen.id,
      name: screen.name,
      cellLine: screen.cellLine,
      organism: screen.organism,
      modality: screen.modality,
      phenotype: screen.phenotype,
      status: screen.status,
      qcVerdict: screen.qc,
      createdAt: screen.createdAt,
    },
    library,
    run: {
      id: runId,
      pipeline: PIPELINE.name,
      pipelineVersion: PIPELINE.version,
      analysisSchema: PIPELINE.analysisSchema,
      startedAt: started,
      completedAt,
      wallClockSec: stages.reduce((a, s) => a + (s.durationSec ?? 0), 0),
      stages,
    },
    counts,
    nTests: testsForScreen(screen),
    atlasScreensTotal: ATLAS_SCREENS_TOTAL,
    qc,
    tools: TOOLS,
    parameters: buildParameters(screen, library, hits, qc),
    references: buildReferences(screen, library),
    summary: buildSummary(screen, counts, hits, qc),
    methods: buildMethods(),
    hits: hits.map((h) => ({
      rank: h.rank,
      gene: h.gene,
      verdict: h.verdict,
      chance: h.chance,
      novelty: h.novelty,
      lfc: h.lfc,
      direction: h.direction,
      pValue: h.pValue,
      fdr: h.fdr,
      bayesFactor: h.bayesFactor,
      guides: h.guides,
      guidesAgree: h.guidesAgree,
      guideConcordance: h.guides > 0 ? h.guidesAgree / h.guides : 0,
      atlasHits: h.atlasHits,
      atlasScreens: h.atlasScreens,
      atlasHitRate: h.atlasScreens > 0 ? h.atlasHits / h.atlasScreens : 0,
      flags: h.flags,
      evidence: h.why,
    })),
  };
}

/**
 * Gene symbols Excel rewrites as dates when a CSV is opened by double-click.
 * Detected rather than guessed, so the CSV preamble can name the exact symbols
 * at risk in this export instead of issuing a general warning nobody reads.
 */
const DATE_LIKE_SYMBOL = /^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC|MARCH|MARCHF)-?\d{1,2}$/i;

export function excelAmbiguousSymbols(hits: ReportHitRow[]): string[] {
  return hits.map((h) => h.gene).filter((g) => DATE_LIKE_SYMBOL.test(g));
}

/** `splicr-hit-report_scr_demo_2026-09-27_SAMPLE.csv` */
export function reportFilename(doc: ReportDocument, extension: string, now: Date): string {
  const day = now.toISOString().slice(0, 10);
  const suffix = doc.source === "sample" ? "_SAMPLE" : "";
  return `splicr-hit-report_${doc.screen.id}_${day}${suffix}.${extension}`;
}
