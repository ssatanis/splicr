/** Illustrative demo settings, not the versions or methods of an executed run.
 * Workspace reports must load recorded provenance with a separate adapter.
 */
export const PIPELINE = {
  name: "splicr-pipeline",
  version: "2.6.0",
  /** Bumped whenever a stage changes a number, so two reports are comparable. */
  analysisSchema: "hit-report/2",
} as const;

export interface ToolRecord {
  /** Stage key from the run record, so the table lines up with the stage rail. */
  stage: string;
  name: string;
  version: string | null;
  role: string;
}

/**
 * Versions below are illustrative demo metadata; they do not assert execution
 * or identify the currently deployed engine configuration.
 */
export const TOOLS: ToolRecord[] = [
  { stage: "ingest", name: "splicr.ingest", version: "2.6.0", role: "Resumable upload, checksum verification, FASTQ validation" },
  { stage: "detect", name: "splicr.library-fingerprint", version: "1.3.0", role: "Library and guide anchor identification from sampled reads" },
  { stage: "count", name: "mageck count", version: "0.5.9.5", role: "Guide by sample count matrix" },
  { stage: "qc", name: "splicr.qc", version: "0.9.2", role: "Per-sample distribution metrics and control separation" },
  { stage: "hits", name: "mageck test (RRA)", version: "0.5.9.5", role: "Gene-level ranking and FDR" },
  { stage: "hits", name: "mageck mle", version: "0.5.9.5", role: "Effect size under the sample design matrix" },
  { stage: "hits", name: "BAGEL2", version: "2.0", role: "Bayes factors against reference essential and non-essential sets" },
  { stage: "hits", name: "CRISPRcleanR", version: "3.0.0", role: "Copy-number bias correction of guide fold changes" },
  { stage: "artifacts", name: "splicr.artifacts", version: "0.7.4", role: "Positional clustering, guide dominance, off-target multiplicity" },
  { stage: "atlas", name: "splicr.atlas", version: "1.2.0", role: "Novelty and frequent-hitter context from public screens" },
  { stage: "score", name: "splicr.score", version: "0.3.0", role: "Illustrative heuristic score; no fitted validation probability" },
  { stage: "report", name: "splicr.report", version: "1.0.0", role: "Report document, CSV, JSON and PDF rendering" },
];

export interface ParameterRecord {
  label: string;
  value: string;
  /** Why the threshold is what it is. Thresholds are not portable, so say so. */
  note?: string;
}

/** Screen-independent settings. Anything that varies per screen is derived. */
export const PARAMETERS: ParameterRecord[] = [
  { label: "Guide matching", value: "Exact, with a one-mismatch fallback" },
  { label: "Count normalisation", value: "Median ratio", note: "mageck count default" },
  { label: "Candidate threshold", value: "FDR < 0.10", note: "Benjamini and Hochberg over gene-level p-values" },
  {
    label: "Fitness threshold",
    value: "Bayes factor > 7",
    note: "Illustrative threshold; Bayes factor cutoffs require validation for the chosen method and screen",
  },
  {
    label: "Minimum non-targeting controls",
    value: "300 guides",
    note: "Illustrative QC threshold; sufficient control coverage depends on the experimental design",
  },
  { label: "Gini index ceiling", value: "0.30 at the endpoint", note: "0.10 for plasmid and T0, where unevenness is synthesis or transduction rather than selection" },
  { label: "Zero-count guide ceiling", value: "5% of the library" },
  { label: "Skew ratio ceiling", value: "10 (90th over 10th percentile)" },
  { label: "Bottlenecked replicate policy", value: "Down-weighted, not dropped" },
  {
    label: "Score interpretation",
    value: "Illustrative, uncalibrated model score",
    note: "No validated probability or uncertainty interval is available",
  },
];

/**
 * Genome and annotation releases used for off-target counting, keyed by the
 * organism on the screen. A mouse screen must not be reported against GRCh38.
 */
export const GENOME_BUILDS = {
  Human: { assembly: "GRCh38.p14", annotation: "GENCODE 47" },
  Mouse: { assembly: "GRCm39", annotation: "GENCODE M36" },
} as const;

/** Atlas and control-set releases. */
export const REFERENCE_RELEASES = {
  orcs: { name: "BioGRID ORCS", release: "1.1.17" },
  depmap: { name: "DepMap", release: "26Q1" },
  essentials: { name: "CEGv2", release: "Hart core essential genes, v2" },
  nonEssentials: { name: "NEGv1", release: "Hart non-essential genes, v1" },
} as const;
