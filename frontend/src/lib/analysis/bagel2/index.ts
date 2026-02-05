/**
 * BAGEL2 CLI Execution Engine
 *
 * Wraps the official BAGEL2 Python script for SplicR. Use this when BAGEL2
 * is installed (Docker). For in-process analysis without the CLI, use ../bagel2.ts.
 */

export {
  buildBagel2FcCommand,
  buildBagel2BfCommand,
  type Bagel2FcParams,
  type Bagel2BfParams,
} from './bagel2-command-builder';

export {
  parseBagel2OutputLine,
  type Bagel2Progress,
  type Bagel2Step,
} from './bagel2-progress-parser';

export {
  detectBagel2Error,
  type Bagel2Error,
  type Bagel2ErrorType,
} from './bagel2-errors';

export {
  parseBfFile,
  parsePrFile,
  parseFoldchangeFile,
  bagel2CliToLegacy,
  type Bagel2BfResult,
  type Bagel2PrResult,
  type Bagel2FoldchangeRow,
} from './bagel2-result-parser';

export {
  executeBagel2Command,
  runBagel2Pipeline,
  type Bagel2ExecutorOptions,
  type Bagel2ExecutorProgress,
  type Bagel2ExecutorResult,
} from './bagel2-executor';
