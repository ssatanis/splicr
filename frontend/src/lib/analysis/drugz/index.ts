/**
 * DrugZ CLI Execution Engine
 *
 * Wraps the official DrugZ Python script for SplicR. Use this when DrugZ
 * is installed (Docker). For in-process analysis without the CLI, use ../drugz.ts.
 */

export {
  buildDrugzCommand,
  type DrugzParams,
} from './drugz-command-builder';

export {
  parseDrugzOutputLine,
  type DrugzProgress,
  type DrugzStep,
} from './drugz-progress-parser';

export {
  detectDrugzError,
  type DrugzError,
  type DrugzErrorType,
} from './drugz-errors';

export {
  parseDrugzOutput,
  drugzCliToLegacy,
  type DrugzCliResult,
} from './drugz-result-parser';

export {
  executeDrugzCommand,
  runDrugzPipeline,
  type DrugzExecutorOptions,
  type DrugzExecutorProgress,
  type DrugzExecutorResult,
} from './drugz-executor';
