/**
 * DrugZ Error Detection and User-Friendly Messages
 *
 * Maps technical DrugZ / Python error patterns to actionable messages.
 */

export type DrugzErrorType =
  | 'column_not_found'
  | 'input_format_error'
  | 'insufficient_data'
  | 'memory_error'
  | 'file_not_found'
  | 'python_error'
  | 'unknown';

export interface DrugzError {
  type: DrugzErrorType;
  userMessage: string;
  suggestedAction?: string;
  technicalMessage: string;
}

const ERROR_PATTERNS: Array<{ pattern: RegExp; type: DrugzErrorType }> = [
  { pattern: /KeyError|not in.*column|column.*not found|not in index/i, type: 'column_not_found' },
  { pattern: /too few|insufficient|not enough|empty/i, type: 'insufficient_data' },
  { pattern: /FileNotFoundError|No such file|IOError/i, type: 'file_not_found' },
  { pattern: /MemoryError|Killed|OOM|Cannot allocate/i, type: 'memory_error' },
  { pattern: /ValueError|cannot convert|invalid|could not broadcast/i, type: 'input_format_error' },
  { pattern: /ImportError|ModuleNotFoundError/i, type: 'python_error' },
];

const USER_MESSAGES: Record<DrugzErrorType, string> = {
  column_not_found:
    "The specified control or treatment columns were not found in the count table. Verify your sample labels match the count file column headers.",
  input_format_error:
    'The count table format is invalid for DrugZ. Ensure it is a tab-delimited file with sgRNA and Gene columns followed by sample counts.',
  insufficient_data:
    'Not enough data to run DrugZ analysis. Ensure you have sufficient sgRNAs per gene and enough replicates.',
  memory_error:
    'DrugZ ran out of memory. Try reducing the dataset size or contact support.',
  file_not_found:
    "An input file couldn't be found. Please verify files were uploaded and the count table was generated successfully.",
  python_error:
    'DrugZ Python dependencies are missing or incompatible. Check the Docker image configuration.',
  unknown:
    'DrugZ analysis failed due to an unexpected error. Contact support if this persists.',
};

const SUGGESTED_ACTIONS: Partial<Record<DrugzErrorType, string>> = {
  column_not_found:
    'Ensure the sample labels in your analysis configuration exactly match the column headers in the count table.',
  input_format_error:
    'Re-run MAGeCK count to regenerate the count table, then retry DrugZ.',
  insufficient_data:
    'Ensure each gene has at least 3 targeting sgRNAs in your library.',
  memory_error:
    'Use fewer samples or a smaller library to reduce memory usage.',
};

export function detectDrugzError(stderr: string): DrugzError {
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
