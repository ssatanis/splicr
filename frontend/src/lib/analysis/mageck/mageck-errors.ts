/**
 * MAGeCK Error Detection and User-Friendly Messages
 *
 * Maps technical MAGeCK/stderr patterns to actionable messages for researchers.
 */

export type MageckErrorType =
  | 'library_mismatch'
  | 'low_mapping'
  | 'memory_error'
  | 'file_not_found'
  | 'permission_denied'
  | 'invalid_format'
  | 'parameter_error'
  | 'unknown';

export interface MageckError {
  type: MageckErrorType;
  userMessage: string;
  suggestedAction?: string;
  technicalMessage: string;
}

const ERROR_PATTERNS: Array<{ pattern: RegExp; type: MageckErrorType }> = [
  { pattern: /sgRNA.*not found|not in library|library mismatch/i, type: 'library_mismatch' },
  { pattern: /mapping rate.*below|low mapping|mapped.*<.*%/i, type: 'low_mapping' },
  { pattern: /MemoryError|out of memory|Killed|OOM/i, type: 'memory_error' },
  { pattern: /No such file|file not found|FileNotFoundError/i, type: 'file_not_found' },
  { pattern: /Permission denied|permission denied|EACCES/i, type: 'permission_denied' },
  { pattern: /Invalid.*format|unexpected format|parse error/i, type: 'invalid_format' },
  { pattern: /error:.*argument|required|invalid choice/i, type: 'parameter_error' },
];

const USER_MESSAGES: Record<MageckErrorType, string> = {
  library_mismatch:
    "Your FASTQ sequences don't match the selected sgRNA library. Please verify you selected the correct library (e.g., Brunello, GeCKO v2) that was used in your experiment.",
  low_mapping:
    'Less than 50% of your reads mapped to the library. This usually indicates incorrect library selection or poor sequencing quality. Check your QC metrics and library choice.',
  memory_error:
    'The analysis ran out of memory. This can happen with very large files. Try reducing file sizes or contact support to increase your resource allocation.',
  file_not_found:
    "One or more input files couldn't be found. Please re-upload your files and try again.",
  permission_denied:
    'Access to a file or directory was denied. Please check file permissions and try again.',
  invalid_format:
    'Your input file format is invalid. FASTQ files must be plain text or gzip-compressed (.fastq or .fastq.gz). Check your file format and re-upload.',
  parameter_error:
    'Invalid analysis parameters were passed to MAGeCK. Please check your sample labels, control/treatment assignments, and other settings.',
  unknown:
    'Analysis failed due to an unexpected error. Contact support if this persists.',
};

const SUGGESTED_ACTIONS: Partial<Record<MageckErrorType, string>> = {
  library_mismatch: 'Confirm the library used in your wet-lab experiment matches your SplicR selection.',
  low_mapping: 'Run QC on your FASTQ files. Ensure adapters are trimmed and library matches your data.',
  memory_error: 'Use smaller FASTQ subsets for testing, or split samples.',
  file_not_found: 'Verify all files were uploaded successfully before starting the analysis.',
  invalid_format: 'Ensure FASTQ files are not corrupted and use standard 4-line format.',
};

export function detectMageckError(stderr: string): MageckError {
  const combined = stderr.trim();
  if (!combined) {
    return {
      type: 'unknown',
      userMessage: USER_MESSAGES.unknown,
      technicalMessage: 'No error output captured',
    };
  }

  for (const { pattern, type } of ERROR_PATTERNS) {
    if (pattern.test(combined)) {
      return {
        type,
        userMessage: USER_MESSAGES[type],
        suggestedAction: SUGGESTED_ACTIONS[type],
        technicalMessage: combined.slice(0, 500),
      };
    }
  }

  return {
    type: 'unknown',
    userMessage: USER_MESSAGES.unknown,
    technicalMessage: combined.slice(0, 500),
  };
}
