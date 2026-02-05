/**
 * BAGEL2 Real-Time Progress Parser
 *
 * Parses BAGEL2 stdout/stderr output to extract progress for live UI updates.
 * BAGEL2 is a two-phase process (fc then bf), so progress is scaled per phase.
 */

export type Bagel2Step =
  | 'initializing'
  | 'calculating_foldchange'
  | 'bayes_factor'
  | 'precision_recall'
  | 'writing_results'
  | 'complete';

export interface Bagel2Progress {
  step: Bagel2Step;
  progress: number; // 0-100
  message: string;
}

const PATTERNS = {
  reading: /reading|loading|opening/i,
  foldchange: /fold.?change|fc calculation|processing control/i,
  bayesFactor: /bayes.*factor|BF.*calculation|bootstrap|iteration\s+(\d+)/i,
  precisionRecall: /precision|recall|PR.*curve/i,
  writing: /writing|output|saving|results.*written|done/i,
  columns: /columns?:\s*(.+)/i,
  genes: /(\d+)\s*genes?/i,
} as const;

/**
 * Parse a line of BAGEL2 output and return a progress update if relevant.
 *
 * @param line     Raw stdout/stderr line
 * @param phase    Which BAGEL2 step is running: 'fc' (0-40%) or 'bf' (40-100%)
 */
export function parseBagel2OutputLine(
  line: string,
  phase: 'fc' | 'bf'
): Bagel2Progress | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  if (phase === 'fc') {
    if (PATTERNS.reading.test(trimmed)) {
      return { step: 'initializing', progress: 5, message: 'Reading count table' };
    }
    if (PATTERNS.foldchange.test(trimmed)) {
      return { step: 'calculating_foldchange', progress: 20, message: 'Calculating fold changes' };
    }
    if (PATTERNS.writing.test(trimmed)) {
      return { step: 'calculating_foldchange', progress: 38, message: 'Writing fold-change file' };
    }
    if (PATTERNS.genes.test(trimmed)) {
      const m = trimmed.match(PATTERNS.genes);
      if (m) {
        return { step: 'calculating_foldchange', progress: 30, message: `Processing ${m[1]} genes` };
      }
    }
  }

  if (phase === 'bf') {
    if (PATTERNS.reading.test(trimmed)) {
      return { step: 'bayes_factor', progress: 42, message: 'Reading fold-change data' };
    }

    const iterMatch = trimmed.match(/iteration\s+(\d+)\s*(?:\/\s*(\d+))?/i);
    if (iterMatch) {
      const current = parseInt(iterMatch[1], 10);
      const total = iterMatch[2] ? parseInt(iterMatch[2], 10) : 1000;
      const pct = Math.min(85, 45 + (current / total) * 40);
      return { step: 'bayes_factor', progress: Math.floor(pct), message: `Bootstrap iteration ${current}/${total}` };
    }

    if (PATTERNS.bayesFactor.test(trimmed)) {
      return { step: 'bayes_factor', progress: 60, message: 'Computing Bayes Factors' };
    }
    if (PATTERNS.precisionRecall.test(trimmed)) {
      return { step: 'precision_recall', progress: 88, message: 'Calculating precision-recall' };
    }
    if (PATTERNS.writing.test(trimmed)) {
      return { step: 'writing_results', progress: 95, message: 'Writing results' };
    }
  }

  return null;
}
