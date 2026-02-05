/**
 * BAGEL2 Command Builder
 *
 * Translates SplicR analysis parameters into BAGEL2 CLI arguments.
 * BAGEL2 is a two-step process:
 *   1. `BAGEL.py fc` — compute fold changes from a count table
 *   2. `BAGEL.py bf` — compute Bayes Factors from fold changes
 */

export interface Bagel2FcParams {
  /** Path to the tab-delimited count table (sgRNA, Gene, Sample1, ...) */
  inputCountTable: string;
  /** Output prefix (produces <prefix>.foldchange) */
  outputPrefix: string;
  /** Column names (sample labels) for control samples */
  controlColumns: string[];
  /** Column names (sample labels) for treatment samples */
  treatmentColumns: string[];
}

export interface Bagel2BfParams {
  /** Path to .foldchange file produced by the fc step */
  inputFoldchange: string;
  /** Output prefix (produces <prefix>.bf and <prefix>.pr) */
  outputPrefix: string;
  /** Path to the essential gene reference list */
  essentialGenePath: string;
  /** Path to the non-essential gene reference list */
  nonEssentialGenePath: string;
  /** Specific column name from foldchange file to use (optional) */
  columnName?: string;
}

/** Build BAGEL.py fc command args (excludes the python3/script prefix). */
export function buildBagel2FcCommand(params: Bagel2FcParams): string[] {
  if (params.controlColumns.length === 0) {
    throw new Error('At least one control column is required for BAGEL2 fc');
  }
  if (params.treatmentColumns.length === 0) {
    throw new Error('At least one treatment column is required for BAGEL2 fc');
  }

  return [
    'fc',
    '-i', params.inputCountTable,
    '-o', params.outputPrefix,
    '-c', params.controlColumns.join(','),
  ];
}

/** Build BAGEL.py bf command args (excludes the python3/script prefix). */
export function buildBagel2BfCommand(params: Bagel2BfParams): string[] {
  const args = [
    'bf',
    '-i', params.inputFoldchange,
    '-o', params.outputPrefix,
    '-e', params.essentialGenePath,
    '-n', params.nonEssentialGenePath,
  ];

  if (params.columnName) {
    args.push('-c', params.columnName);
  }

  return args;
}
