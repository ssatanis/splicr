/**
 * BAGEL2 Error Detection and User-Friendly Messages
 *
 * Maps technical BAGEL2 / Python error patterns to actionable messages.
 */

export type Bagel2ErrorType =
  | 'missing_reference_genes'
  | 'input_format_error'
  | 'no_matching_columns'
  | 'memory_error'
  | 'file_not_found'
  | 'python_error'
  | 'unknown';

export interface Bagel2Error {
  type: Bagel2ErrorType;
  userMessage: string;
  suggestedAction?: string;
  technicalMessage: string;
}

const ERROR_PATTERNS: Array<{ pattern: RegExp; type: Bagel2ErrorType }> = [
  { pattern: /KeyError|column not found|not in index|no matching/i, type: 'no_matching_columns' },
  { pattern: /CEGv2|NEGv1|essential.*not found|nonessential.*not found/i, type: 'missing_reference_genes' },
  { pattern: /FileNotFoundError|No such file|IOError/i, type: 'file_not_found' },
  { pattern: /MemoryError|Killed|OOM|Cannot allocate/i, type: 'memory_error' },
  { pattern: /ValueError|invalid|could not convert|parse/i, type: 'input_format_error' },
  { pattern: /ImportError|ModuleNotFoundError/i, type: 'python_error' },
];

const USER_MESSAGES: Record<Bagel2ErrorType, string> = {
  no_matching_columns:
    "The control or treatment column names don't match your count table headers. Verify your sample labels match the count file columns exactly.",
  missing_reference_genes:
    'Essential or non-essential gene reference files could not be found. This may indicate a Docker image misconfiguration.',
  file_not_found:
    "An input file couldn't be found. Please verify files were uploaded and the count table was generated successfully.",
  memory_error:
    'BAGEL2 ran out of memory. Try reducing the dataset size or contact support for resource allocation.',
  input_format_error:
    'The count table format is invalid for BAGEL2. Ensure it is a tab-delimited file with sgRNA and Gene columns.',
  python_error:
    'BAGEL2 Python dependencies are missing or incompatible. Check the Docker image configuration.',
  unknown:
    'BAGEL2 analysis failed due to an unexpected error. Contact support if this persists.',
};

const SUGGESTED_ACTIONS: Partial<Record<Bagel2ErrorType, string>> = {
  no_matching_columns:
    'Check that the sample labels in your experiment configuration match the column headers in the count table.',
  missing_reference_genes:
    'Ensure the Docker image includes /opt/bagel2/CEGv2.txt and /opt/bagel2/NEGv1.txt.',
  input_format_error:
    'Re-run MAGeCK count to regenerate the count table, then retry BAGEL2.',
  memory_error:
    'Use fewer samples or a smaller library to reduce memory usage.',
};

export function detectBagel2Error(stderr: string): Bagel2Error {
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
