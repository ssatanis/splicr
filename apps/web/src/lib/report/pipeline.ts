/**
 * The versions, thresholds and reference releases the analysis pipeline pins.
 *
 * This lives in one place because provenance is worthless when it is written
 * twice. The old Report tab carried a prose paragraph with "Brunello (76,441
 * guides)" baked into it, so a TKOv3 screen reported a library it never ran
 * against. Everything a report claims about how it was produced now comes from
 * here or from the run record, never from a sentence typed into a component.
 *
 * These are the values recorded for the sample dataset the console ships with.
 * A signed-in workspace reads the same shape out of the run row, so the report
 * builder does not care which one it was handed. Nothing here is a measurement,
 * so nothing here changes when a screen changes.
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
 * Third-party versions are the releases the pipeline pins, not a range. MAGeCK
 * 0.5.9.5 is the version the counting stage records on the run; the rest are the
 * releases that stage was built against.
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
  { stage: "score", name: "splicr.score", version: "0.3.0", role: "Chance real, calibrated on logged validation outcomes" },
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
    note: "BAGEL2 multi-target correction moves the operating point from 10 to 7, so the number is not portable to an uncorrected run",
  },
  {
    label: "Minimum non-targeting controls",
    value: "300 guides",
    note: "Below this the empirical null is too thin for an FDR to mean anything",
  },
  { label: "Gini index ceiling", value: "0.30 at the endpoint", note: "0.10 for plasmid and T0, where unevenness is synthesis or transduction rather than selection" },
  { label: "Zero-count guide ceiling", value: "5% of the library" },
  { label: "Skew ratio ceiling", value: "10 (90th over 10th percentile)" },
  { label: "Bottlenecked replicate policy", value: "Down-weighted, not dropped" },
  { label: "Calibration band", value: "Plus or minus 0.06 on chance real" },
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
