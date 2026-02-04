/**
 * MAGeCK Execution Engine
 *
 * Wraps the official MAGeCK binary for SplicR. Use this when MAGeCK is installed
 * (Docker, conda, or system). For in-process analysis without MAGeCK, use mageckRRA.ts.
 */

export {
  buildMageckCountCommand,
  buildMageckTestCommand,
  buildMageckMleCommand,
  formatCommandForLog,
  type MageckCountParams,
  type MageckTestParams,
  type MageckMleParams,
} from './mageck-command-builder';

export {
  parseMageckOutputLine,
  type MageckProgress,
  type MageckStep,
} from './mageck-progress-parser';

export {
  detectMageckError,
  type MageckError,
  type MageckErrorType,
} from './mageck-errors';

export {
  parseGeneSummary,
  parseSgrnaSummary,
  mageckGeneToUnified,
  type MageckGeneResult,
  type MageckSgrnaResult,
} from './mageck-result-parser';

export {
  executeMageckCommand,
  runMageckPipeline,
  type MageckExecutorOptions,
  type MageckExecutorProgress,
  type MageckExecutorResult,
} from './mageck-executor';
