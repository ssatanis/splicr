/**
 * DrugZ Executor
 *
 * Spawns the DrugZ Python script, streams stdout/stderr for real-time progress,
 * and returns parsed results.
 *
 * Follows the same patterns as mageck-executor.ts.
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import {
  buildDrugzCommand,
  type DrugzParams,
} from './drugz-command-builder';
import { parseDrugzOutputLine, type DrugzProgress } from './drugz-progress-parser';
import { detectDrugzError } from './drugz-errors';
import { parseDrugzOutput, type DrugzCliResult } from './drugz-result-parser';
import { formatCommandForLog } from '../cli-utils';

export interface DrugzExecutorOptions {
  drugzScript?: string; // default '/opt/drugz/drugz.py'
  pythonBinary?: string; // default 'python3'
  workingDir: string;
  env?: Record<string, string>;
  progressThrottleMs?: number; // default 2000
}

export interface DrugzExecutorProgress {
  step: string;
  progress: number;
  message: string;
  logs?: string[];
}

export interface DrugzExecutorResult {
  success: boolean;
  geneResults: DrugzCliResult[];
  error?: string;
  userMessage?: string;
  suggestedAction?: string;
  commandLog?: string;
}

/**
 * Execute the DrugZ command with real-time progress streaming.
 */
export function executeDrugzCommand(
  scriptArgs: string[],
  options: DrugzExecutorOptions,
  onProgress?: (p: DrugzExecutorProgress) => void
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const python = options.pythonBinary ?? 'python3';
  const script = options.drugzScript ?? '/opt/drugz/drugz.py';
  const throttleMs = options.progressThrottleMs ?? 2000;

  const env = {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    ...options.env,
  };

  const args = [script, ...scriptArgs];

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let lastProgressTime = 0;
    const logs: string[] = [];

    const proc: ChildProcess = spawn(python, args, {
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

        const parsed = parseDrugzOutputLine(line);
        if (parsed) {
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
      const lines = text.split(/\n/);
      for (const line of lines) {
        if (line.trim()) {
          logs.push(`[stderr] ${line.trim()}`);
          const parsed = parseDrugzOutputLine(line);
          if (parsed) {
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
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to start DrugZ: ${err.message}. Is Python3 installed?`));
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
 * Run the DrugZ pipeline (single-step).
 *
 * @param params  DrugZ command parameters
 * @param options Executor options (working dir, binary paths, etc.)
 */
export async function runDrugzPipeline(
  params: DrugzParams,
  options: DrugzExecutorOptions,
  onProgress?: (p: DrugzExecutorProgress) => void
): Promise<DrugzExecutorResult> {
  const commandLog: string[] = [];

  try {
    const scriptArgs = buildDrugzCommand(params);
    const python = options.pythonBinary ?? 'python3';
    const script = options.drugzScript ?? '/opt/drugz/drugz.py';
    commandLog.push(formatCommandForLog(python, [script, ...scriptArgs]));

    onProgress?.({ step: 'initializing', progress: 2, message: 'Starting DrugZ analysis' });

    const result = await executeDrugzCommand(scriptArgs, options, onProgress);

    if (result.exitCode !== 0) {
      const err = detectDrugzError(result.stderr || result.stdout);
      return {
        success: false,
        geneResults: [],
        error: err.technicalMessage,
        userMessage: err.userMessage,
        suggestedAction: err.suggestedAction,
        commandLog: commandLog.join('\n'),
      };
    }

    // Verify output file exists
    if (!fs.existsSync(params.outputPath)) {
      return {
        success: false,
        geneResults: [],
        error: 'DrugZ did not produce an output file',
        userMessage: 'DrugZ completed but the output file was not found.',
        commandLog: commandLog.join('\n'),
      };
    }

    onProgress?.({ step: 'writing_results', progress: 95, message: 'Parsing DrugZ results' });

    const geneResults = parseDrugzOutput(fs.readFileSync(params.outputPath, 'utf-8'));

    onProgress?.({ step: 'complete', progress: 100, message: 'DrugZ analysis complete' });

    return {
      success: true,
      geneResults,
      commandLog: commandLog.join('\n'),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      geneResults: [],
      error: msg,
      userMessage: msg,
      commandLog: commandLog.join('\n'),
    };
  }
}
