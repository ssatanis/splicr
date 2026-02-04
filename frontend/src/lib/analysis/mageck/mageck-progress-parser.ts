/**
 * MAGeCK Real-Time Progress Parser
 *
 * Parses MAGeCK's INFO output to extract progress and step for live UI updates.
 * Based on actual MAGeCK 0.5.9 output patterns from SourceForge / NIH Biowulf.
 *
 * Example MAGeCK output:
 *   INFO  @ Tue, 18 Feb 2020 11:37:55: Loading 87437 predefined sgRNAs.
 *   INFO  @ Tue, 18 Feb 2020 11:37:56: Processing 0M reads ...
 *   INFO  @ Tue, 18 Feb 2020 11:38:04: Processing 2M reads ..
 *   INFO  @ Tue, 18 Feb 2020 11:38:30: Total: 10093905.
 *   INFO  @ Tue, 18 Feb 2020 11:38:30: Mapped: 8615587.
 */

export type MageckStep =
  | 'initializing'
  | 'loading_library'
  | 'processing_fastq'
  | 'mapping_reads'
  | 'normalizing'
  | 'qc_metrics'
  | 'statistical_test'
  | 'generating_plots'
  | 'writing_results'
  | 'complete';

export interface MageckProgress {
  step: MageckStep;
  progress: number; // 0-100
  message: string;
  totalReads?: number;
  mappedReads?: number;
  millionReadsProcessed?: number;
}

/** Weight allocation for progress calculation (must sum to ~100) */
const STEP_WEIGHTS = {
  loading_library: 2,
  processing_fastq: 60,
  mapping_reads: 5,
  normalizing: 10,
  statistical_test: 18,
  generating_plots: 3,
  writing_results: 2,
} as const;

/** Regex patterns for MAGeCK stdout (INFO lines) */
const PATTERNS = {
  loadingSgrnas: /Loading\s+(\d+)\s+predefined\s+sgRNAs/i,
  processingReads: /Processing\s+(\d+)M\s+reads/i,
  totalReads: /Total:\s*(\d+)/i,
  mappedReads: /Mapped:\s*(\d+)/i,
  normalization: /normaliz|size factor|median/i,
  statisticalTest: /Running.*test|RRA|permutation/i,
  generatingReport: /Generating|report|pdf/i,
  parsingFastq: /Parsing\s+FASTQ|Parsing\s+fastq/i,
  autoTrim: /Auto determination of trim5|trim-5 test/i,
} as const;

/** Estimate total reads for progress (typical CRISPR screen: 5-50M reads per sample) */
const DEFAULT_ESTIMATED_TOTAL_MILLION = 50;

/**
 * Parse a line of MAGeCK output and return progress update if matched.
 * Returns null if no progress-relevant pattern found.
 */
export function parseMageckOutputLine(
  line: string,
  currentState: { step: MageckStep; progress: number; totalMillion?: number }
): MageckProgress | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Extract content after "INFO  @ ... :" prefix
  const colonIdx = trimmed.indexOf(':');
  const content = colonIdx >= 0 ? trimmed.slice(colonIdx + 1).trim() : trimmed;

  // Loading library
  const loadMatch = content.match(PATTERNS.loadingSgrnas);
  if (loadMatch) {
    return {
      step: 'loading_library',
      progress: STEP_WEIGHTS.loading_library,
      message: `Loading ${parseInt(loadMatch[1], 10).toLocaleString()} sgRNAs`,
    };
  }

  // Processing reads (count command) - main progress driver
  const procMatch = content.match(PATTERNS.processingReads);
  if (procMatch) {
    const millionReads = parseInt(procMatch[1], 10);
    const estimatedTotal = currentState.totalMillion ?? DEFAULT_ESTIMATED_TOTAL_MILLION;
    const readProgress = Math.min(
      STEP_WEIGHTS.loading_library + (millionReads / estimatedTotal) * STEP_WEIGHTS.processing_fastq,
      STEP_WEIGHTS.loading_library + STEP_WEIGHTS.processing_fastq
    );
    return {
      step: 'processing_fastq',
      progress: Math.floor(readProgress),
      message: `Processing ${millionReads}M reads`,
      millionReadsProcessed: millionReads,
    };
  }

  // Total reads (helps refine progress)
  const totalMatch = content.match(PATTERNS.totalReads);
  if (totalMatch) {
    const total = parseInt(totalMatch[1], 10);
    const totalMillion = Math.ceil(total / 1e6);
    return {
      step: 'mapping_reads',
      progress: STEP_WEIGHTS.loading_library + STEP_WEIGHTS.processing_fastq + STEP_WEIGHTS.mapping_reads,
      message: `Mapped ${total.toLocaleString()} reads`,
      totalReads: total,
    };
  }

  const mappedMatch = content.match(PATTERNS.mappedReads);
  if (mappedMatch) {
    const mapped = parseInt(mappedMatch[1], 10);
    return {
      step: 'mapping_reads',
      progress: STEP_WEIGHTS.loading_library + STEP_WEIGHTS.processing_fastq + STEP_WEIGHTS.mapping_reads,
      message: `Mapped ${mapped.toLocaleString()} reads`,
      mappedReads: mapped,
    };
  }

  if (PATTERNS.normalization.test(content)) {
    return {
      step: 'normalizing',
      progress: 75,
      message: 'Normalizing read counts',
    };
  }

  if (PATTERNS.statisticalTest.test(content)) {
    return {
      step: 'statistical_test',
      progress: 80,
      message: 'Running statistical tests',
    };
  }

  if (PATTERNS.generatingReport.test(content)) {
    return {
      step: 'generating_plots',
      progress: 95,
      message: 'Generating report',
    };
  }

  if (PATTERNS.parsingFastq.test(content)) {
    return {
      step: 'processing_fastq',
      progress: 15,
      message: 'Parsing FASTQ files',
    };
  }

  return null;
}
