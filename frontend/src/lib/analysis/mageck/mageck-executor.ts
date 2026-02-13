/**
 * MAGeCK Executor
 *
 * Spawns the actual MAGeCK binary, streams stdout/stderr, parses progress in real-time,
 * and returns parsed results. Use when MAGeCK is available (Docker, conda, or system).
 *
 * Key: Uses spawn() NOT exec() for real-time output streaming.
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildMageckCountCommand,
  buildMageckTestCommand,
  formatCommandForLog,
  type MageckCountParams,
  type MageckTestParams,
} from './mageck-command-builder';
import {
  parseMageckOutputLine,
  type MageckProgress,
  type MageckStep,
} from './mageck-progress-parser';
import { detectMageckError } from './mageck-errors';
import {
  parseGeneSummary,
  parseSgrnaSummary,
  mageckGeneToUnified,
  type MageckGeneResult,
} from './mageck-result-parser';

export interface MageckExecutorOptions {
  mageckBinary?: string; // default 'mageck'
  workingDir: string;
  env?: Record<string, string>;
  progressThrottleMs?: number; // min interval between progress callbacks (default 2000)
}

export interface MageckExecutorProgress {
  step: string;
  progress: number;
  message: string;
  logs?: string[];
}

export interface MageckExecutorResult {
  success: boolean;
  geneSummary: MageckGeneResult[];
  sgrnaSummary?: import('./mageck-result-parser').MageckSgrnaResult[];
  countTablePath?: string;
  error?: string;
  userMessage?: string;
  suggestedAction?: string;
  commandLog?: string;
}

/** Parse MAGeCK subcommand from first arg (count, test, mle) */
function getStepFromCommand(args: string[]): MageckStep {
  const first = (args[0] || '').toLowerCase();
  if (first === 'count') return 'processing_fastq';
  if (first === 'test' || first === 'mle') return 'statistical_test';
  return 'initializing';
}

/**
 * Execute a single MAGeCK command (count or test) with real-time progress.
 */
export function executeMageckCommand(
  args: string[],
  options: MageckExecutorOptions,
  onProgress?: (p: MageckExecutorProgress) => void
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const binary = options.mageckBinary ?? 'mageck';
  const throttleMs = options.progressThrottleMs ?? 2000;

  const env = {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    ...options.env,
  };

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let lastProgressTime = 0;
    const state = { step: getStepFromCommand(args) as MageckStep, progress: 0, totalMillion: undefined as number | undefined };
    const logs: string[] = [];

    const proc: ChildProcess = spawn(binary, args, {
      cwd: options.workingDir,
      env: env as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      const lines = text.split(/\n/);

      for (const line of lines) {
        if (line.trim()) logs.push(line.trim());

        const parsed = parseMageckOutputLine(line, state);
        if (parsed) {
          state.step = parsed.step;
          state.progress = parsed.progress;
          if (parsed.totalReads) state.totalMillion = Math.ceil(parsed.totalReads / 1e6);

          const now = Date.now();
          if (onProgress && now - lastProgressTime >= throttleMs) {
            lastProgressTime = now;
            onProgress({
              step: parsed.step,
              progress: parsed.progress,
              message: parsed.message,
              logs: logs.slice(-10),
            });
          }
        }
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      logs.push(`[stderr] ${text.trim()}`);
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to start MAGeCK: ${err.message}. Is MAGeCK installed?`));
    });

    proc.on('close', (code, signal) => {
      resolve({
        exitCode: code ?? (signal ? 1 : 0),
        stdout,
        stderr,
      });
    });
  });
}

/**
 * Run full MAGeCK pipeline: count → test.
 * Writes library file to workingDir if needed. Expects FASTQ and library paths to exist.
 */
export async function runMageckPipeline(
  countParams: MageckCountParams | null,
  testParams: Omit<MageckTestParams, 'countTablePath'>,
  options: MageckExecutorOptions,
  onProgress?: (p: MageckExecutorProgress) => void
): Promise<MageckExecutorResult> {
  const workingDir = options.workingDir;
  const commandLog: string[] = [];

  // Determine count table path: either from countParams output or explicitly provided in test context
  let countTablePath = '';
  if (countParams) {
    countTablePath = path.join(workingDir, `${countParams.outputPrefix}.count.txt`);
  } else {
    // If skipping count, we expect countTablePath to be passed or derived elsewhere.
    // However, the pipeline usually passes it as part of testParams if bypassing count.
    // For simplicity, let's assume if countParams is null, the caller provided it.
    countTablePath = (testParams as any).countTablePath || path.join(workingDir, 'mageck_counts.txt');
  }

  try {
    // Step 1: mageck count (only if countParams provided AND no input table)
    if (countParams) {
      // If inputCountTable is provided, we skip the actual 'mageck count' command
      // and just use that table for the test step.
      if (countParams.inputCountTable) {
        countTablePath = countParams.inputCountTable;
        onProgress?.({ step: 'initializing', progress: 45, message: 'Using existing count table, skipping MAGeCK count' });

        if (!fs.existsSync(countTablePath)) {
          return {
            success: false,
            geneSummary: [],
            error: `Input count table not found at: ${countTablePath}`,
            userMessage: 'The prepared count table file could not be found.',
            commandLog: commandLog.join('\n'),
          };
        }
      } else {
        // Regular flow: run mageck count
        const countArgs = buildMageckCountCommand(countParams);
        commandLog.push(formatCommandForLog(options.mageckBinary ?? 'mageck', countArgs));

        onProgress?.({ step: 'initializing', progress: 2, message: 'Starting MAGeCK count' });

        const countResult = await executeMageckCommand(countArgs, options, (p) => {
          onProgress?.({ ...p, progress: Math.min(45, p.progress * 0.45) });
        });

        if (countResult.exitCode !== 0) {
          const err = detectMageckError(countResult.stderr || countResult.stdout);
          return {
            success: false,
            geneSummary: [],
            error: err.technicalMessage,
            userMessage: err.userMessage,
            suggestedAction: err.suggestedAction,
            commandLog: commandLog.join('\n'),
          };
        }

        if (!fs.existsSync(countTablePath)) {
          return {
            success: false,
            geneSummary: [],
            error: 'MAGeCK count did not produce count table',
            userMessage: 'Count step completed but output file was not found.',
            commandLog: commandLog.join('\n'),
          };
        }
      }
    }

    onProgress?.({ step: 'normalizing', progress: 50, message: 'Count complete, starting statistical test' });

    // Step 2: mageck test
    const testArgs = buildMageckTestCommand({
      ...testParams,
      countTablePath,
      outputPrefix: testParams.outputPrefix,
    });
    commandLog.push(formatCommandForLog(options.mageckBinary ?? 'mageck', testArgs));

    const testResult = await executeMageckCommand(testArgs, options, (p) => {
      onProgress?.({ ...p, progress: 50 + Math.min(45, p.progress * 0.45) });
    });

    if (testResult.exitCode !== 0) {
      const err = detectMageckError(testResult.stderr || testResult.stdout);
      return {
        success: false,
        geneSummary: [],
        countTablePath,
        error: err.technicalMessage,
        userMessage: err.userMessage,
        suggestedAction: err.suggestedAction,
        commandLog: commandLog.join('\n'),
      };
    }

    const geneSummaryPath = path.join(workingDir, `${testParams.outputPrefix}.gene_summary.txt`);
    const sgrnaSummaryPath = path.join(workingDir, `${testParams.outputPrefix}.sgrna_summary.txt`);

    let geneSummary: MageckGeneResult[] = [];
    let sgrnaSummary: import('./mageck-result-parser').MageckSgrnaResult[] | undefined;

    if (fs.existsSync(geneSummaryPath)) {
      geneSummary = parseGeneSummary(fs.readFileSync(geneSummaryPath, 'utf-8'));
    }
    if (fs.existsSync(sgrnaSummaryPath)) {
      sgrnaSummary = parseSgrnaSummary(fs.readFileSync(sgrnaSummaryPath, 'utf-8'));
    }

    onProgress?.({ step: 'complete', progress: 100, message: 'Analysis complete' });

    return {
      success: true,
      geneSummary,
      sgrnaSummary,
      countTablePath,
      commandLog: commandLog.join('\n'),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      geneSummary: [],
      error: msg,
      userMessage: msg,
      commandLog: commandLog.join('\n'),
    };
  }
}

