/**
 * MAGeCK Command Builder
 *
 * Translates SplicR analysis parameters into exact MAGeCK CLI commands.
 * Preserves all parameters for reproducibility. Uses the official MAGeCK
 * documentation format (see SourceForge MAGeCK Wiki).
 */

export interface MageckCountParams {
  libraryPath: string;
  fastqPaths: string[];
  sampleLabels: string[];
  outputPrefix: string;
  normMethod?: 'none' | 'median' | 'total' | 'control';
  controlSgrnaPath?: string;
  trim5?: number;
  sgrnaLen?: number;
  pdfReport?: boolean;
  day0Label?: string;
}

export interface MageckTestParams {
  countTablePath: string;
  treatmentId: string; // comma-separated sample labels or indices
  controlId: string;
  outputPrefix: string;
  normMethod?: 'none' | 'median' | 'total' | 'control';
  geneTestFdrThreshold?: number;
  adjustMethod?: 'fdr' | 'holm' | 'pounds';
  controlSgrnaPath?: string;
  paired?: boolean;
  pdfReport?: boolean;
}

export interface MageckMleParams {
  countTablePath: string;
  designMatrixPath?: string;
  day0Label?: string;
  outputPrefix: string;
  normMethod?: 'none' | 'median' | 'total' | 'control';
  controlSgrnaPath?: string;
  permutationRound?: number;
  threads?: number;
}

/** Build mageck count command args */
export function buildMageckCountCommand(params: MageckCountParams): string[] {
  const args: string[] = ['count', '-l', params.libraryPath];

  if (params.fastqPaths.length === 0) {
    throw new Error('At least one FASTQ file is required');
  }
  args.push('--fastq', ...params.fastqPaths);

  args.push('--sample-label', params.sampleLabels.join(','));
  args.push('-n', params.outputPrefix);

  const norm = params.normMethod ?? 'median';
  args.push('--norm-method', norm);

  if (params.controlSgrnaPath) {
    args.push('--control-sgrna', params.controlSgrnaPath);
  }
  if (params.trim5 != null) {
    args.push('--trim-5', String(params.trim5));
  }
  if (params.sgrnaLen != null) {
    args.push('--sgrna-len', String(params.sgrnaLen));
  }
  if (params.day0Label) {
    args.push('--day0-label', params.day0Label);
  }
  if (params.pdfReport) {
    args.push('--pdf-report');
  }

  return args;
}

/** Build mageck test (RRA) command args */
export function buildMageckTestCommand(params: MageckTestParams): string[] {
  const args: string[] = [
    'test',
    '-k', params.countTablePath,
    '-t', params.treatmentId,
    '-c', params.controlId,
    '-n', params.outputPrefix,
  ];

  const norm = params.normMethod ?? 'median';
  args.push('--norm-method', norm);

  const fdr = params.geneTestFdrThreshold ?? 0.25;
  args.push('--gene-test-fdr-threshold', String(fdr));

  if (params.adjustMethod) {
    args.push('--adjust-method', params.adjustMethod);
  }
  if (params.controlSgrnaPath) {
    args.push('--control-sgrna', params.controlSgrnaPath);
  }
  if (params.paired) {
    args.push('--paired');
  }
  if (params.pdfReport) {
    args.push('--pdf-report');
  }

  return args;
}

/** Build mageck mle command args */
export function buildMageckMleCommand(params: MageckMleParams): string[] {
  const args: string[] = ['mle', '-k', params.countTablePath, '-n', params.outputPrefix];

  if (params.designMatrixPath) {
    args.push('-d', params.designMatrixPath);
  } else if (params.day0Label) {
    args.push('--day0-label', params.day0Label);
  } else {
    throw new Error('MAGeCK MLE requires either design matrix (-d) or day0-label');
  }

  const norm = params.normMethod ?? 'median';
  args.push('--norm-method', norm);

  if (params.controlSgrnaPath) {
    args.push('--control-sgrna', params.controlSgrnaPath);
  }
  if (params.permutationRound != null) {
    args.push('--permutation-round', String(params.permutationRound));
  }
  if (params.threads != null && params.threads > 1) {
    args.push('--threads', String(params.threads));
  }

  return args;
}

/** Format full command string for logging/reproducibility */
export function formatCommandForLog(binary: string, args: string[]): string {
  const escaped = args.map((a) => (a.includes(' ') ? `"${a.replace(/"/g, '\\"')}"` : a));
  return [binary, ...escaped].join(' ');
}
