/**
 * DrugZ Real-Time Progress Parser
 *
 * Parses DrugZ stdout/stderr output to extract progress for live UI updates.
 * DrugZ is a single-step tool, so progress maps across the entire execution.
 */

export type DrugzStep =
  | 'initializing'
  | 'reading_input'
  | 'normalizing'
  | 'calculating_scores'
  | 'ranking_genes'
  | 'writing_results'
  | 'complete';

export interface DrugzProgress {
  step: DrugzStep;
  progress: number; // 0-100
  message: string;
}

const PATTERNS = {
  reading: /reading|loading|opening|input/i,
  normalizing: /normaliz|fold.?change|log2/i,
  calculating: /calculat|scoring|window|rank|z.?score|estimat/i,
  geneScoring: /gene.*score|normZ|summariz/i,
  writing: /writing|output|saving|results|done|complet/i,
  processing: /processing|running/i,
} as const;

/**
 * Parse a line of DrugZ output and return a progress update if relevant.
 * Returns null if no progress-relevant pattern matched.
 */
export function parseDrugzOutputLine(line: string): DrugzProgress | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  if (PATTERNS.reading.test(trimmed)) {
    return { step: 'reading_input', progress: 10, message: 'Reading count table' };
  }

  if (PATTERNS.normalizing.test(trimmed)) {
    return { step: 'normalizing', progress: 25, message: 'Normalizing read counts' };
  }

  if (PATTERNS.geneScoring.test(trimmed)) {
    return { step: 'ranking_genes', progress: 75, message: 'Computing gene-level scores' };
  }

  if (PATTERNS.calculating.test(trimmed)) {
    return { step: 'calculating_scores', progress: 50, message: 'Calculating Z-scores' };
  }

  if (PATTERNS.writing.test(trimmed)) {
    return { step: 'writing_results', progress: 92, message: 'Writing results' };
  }

  if (PATTERNS.processing.test(trimmed)) {
    return { step: 'calculating_scores', progress: 40, message: 'Processing data' };
  }

  return null;
}
