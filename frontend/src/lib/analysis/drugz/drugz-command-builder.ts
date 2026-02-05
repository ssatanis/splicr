/**
 * DrugZ Command Builder
 *
 * Translates SplicR analysis parameters into DrugZ CLI arguments.
 * DrugZ is a single-step tool: one invocation produces all results.
 */

export interface DrugzParams {
  /** -i: Path to the tab-delimited count table */
  inputCountTable: string;
  /** -o: Output file path */
  outputPath: string;
  /** -c: Comma-separated control sample column names */
  controlColumns: string[];
  /** -x: Comma-separated treatment sample column names */
  treatmentColumns: string[];
  /** -f: Optional fold-change output path */
  foldchangeOutputPath?: string;
  /** -p: Pseudocount added to all readcounts (default 5) */
  pseudocount?: number;
  /** --half_window_size: Window size for std estimation (default 500) */
  halfWindowSize?: number;
  /** -unpaired: Use unpaired approach (default false) */
  unpaired?: boolean;
  /** -r: Comma-separated list of genes to remove before analysis */
  removeGenes?: string[];
  /** -I: Index column (default 0) */
  indexColumn?: number;
  /** --minobs: Minimum observations per gene (default 1) */
  minObs?: number;
}

/** Build drugz.py command args (excludes the python3/script prefix). */
export function buildDrugzCommand(params: DrugzParams): string[] {
  if (params.controlColumns.length === 0) {
    throw new Error('At least one control column is required for DrugZ');
  }
  if (params.treatmentColumns.length === 0) {
    throw new Error('At least one treatment column is required for DrugZ');
  }

  const args: string[] = [
    '-i', params.inputCountTable,
    '-o', params.outputPath,
    '-c', params.controlColumns.join(','),
    '-x', params.treatmentColumns.join(','),
  ];

  if (params.foldchangeOutputPath) {
    args.push('-f', params.foldchangeOutputPath);
  }

  const pseudocount = params.pseudocount ?? 5;
  args.push('-p', String(pseudocount));

  if (params.halfWindowSize != null) {
    args.push('--half_window_size', String(params.halfWindowSize));
  }

  if (params.unpaired) {
    args.push('-unpaired');
  }

  if (params.removeGenes && params.removeGenes.length > 0) {
    args.push('-r', params.removeGenes.join(','));
  }

  if (params.indexColumn != null) {
    args.push('-I', String(params.indexColumn));
  }

  if (params.minObs != null) {
    args.push('--minobs', String(params.minObs));
  }

  return args;
}
