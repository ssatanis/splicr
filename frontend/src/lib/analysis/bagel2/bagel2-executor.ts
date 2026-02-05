/**
 * BAGEL2 Executor
 *
 * Spawns the BAGEL2 Python script, orchestrates the two-step pipeline (fc → bf),
 * streams stdout/stderr for real-time progress, and returns parsed results.
 *
 * Follows the same patterns as mageck-executor.ts.
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildBagel2FcCommand,
  buildBagel2BfCommand,
  type Bagel2FcParams,
  type Bagel2BfParams,
} from './bagel2-command-builder';
import { parseBagel2OutputLine, type Bagel2Progress } from './bagel2-progress-parser';
import { detectBagel2Error } from './bagel2-errors';
import {
  parseBfFile,
  parsePrFile,
  parseFoldchangeFile,
  type Bagel2BfResult,
  type Bagel2PrResult,
  type Bagel2FoldchangeRow,
} from './bagel2-result-parser';
import { formatCommandForLog } from '../cli-utils';

export interface Bagel2ExecutorOptions {
  bagel2Script?: string; // default '/opt/bagel2/BAGEL.py'
  pythonBinary?: string; // default 'python3'
  workingDir: string;
  essentialGenePath?: string; // default '/opt/bagel2/CEGv2.txt'
  nonEssentialGenePath?: string; // default '/opt/bagel2/NEGv1.txt'
  env?: Record<string, string>;
  progressThrottleMs?: number; // default 2000
}

export interface Bagel2ExecutorProgress {
  step: string;
  progress: number;
  message: string;
  logs?: string[];
}

export interface Bagel2ExecutorResult {
  success: boolean;
  bfResults: Bagel2BfResult[];
  prResults: Bagel2PrResult[];
  foldchangeResults: Bagel2FoldchangeRow[];
  error?: string;
  userMessage?: string;
  suggestedAction?: string;
  commandLog?: string;
}

/**
 * Execute a single BAGEL2 command with real-time progress streaming.
 */
export function executeBagel2Command(
  scriptArgs: string[],
  options: Bagel2ExecutorOptions,
  phase: 'fc' | 'bf',
  onProgress?: (p: Bagel2ExecutorProgress) => void
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const python = options.pythonBinary ?? 'python3';
  const script = options.bagel2Script ?? '/opt/bagel2/BAGEL.py';
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

        const parsed = parseBagel2OutputLine(line, phase);
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
      // BAGEL2 prints progress info to stderr as well
      const lines = text.split(/\n/);
      for (const line of lines) {
        if (line.trim()) {
          logs.push(`[stderr] ${line.trim()}`);
          const parsed = parseBagel2OutputLine(line, phase);
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
      reject(new Error(`Failed to start BAGEL2: ${err.message}. Is Python3 installed?`));
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
 * Run the full BAGEL2 pipeline: fc → bf.
 *
 * @param params.countTablePath   Path to MAGeCK count output (tab-delimited)
 * @param params.controlColumns   Control sample column names
 * @param params.treatmentColumns Treatment sample column names
 * @param params.outputPrefix     Base output prefix
 */
export async function runBagel2Pipeline(
  params: {
    countTablePath: string;
    controlColumns: string[];
    treatmentColumns: string[];
    outputPrefix: string;
  },
  options: Bagel2ExecutorOptions,
  onProgress?: (p: Bagel2ExecutorProgress) => void
): Promise<Bagel2ExecutorResult> {
  const workingDir = options.workingDir;
  const essentialPath = options.essentialGenePath ?? '/opt/bagel2/CEGv2.txt';
  const nonEssentialPath = options.nonEssentialGenePath ?? '/opt/bagel2/NEGv1.txt';

  const commandLog: string[] = [];

  try {
    // ---------------------------------------------------------------
    // Step 1: BAGEL.py fc (fold change)
    // ---------------------------------------------------------------
    const fcParams: Bagel2FcParams = {
      inputCountTable: params.countTablePath,
      outputPrefix: params.outputPrefix,
      controlColumns: params.controlColumns,
      treatmentColumns: params.treatmentColumns,
    };
    const fcArgs = buildBagel2FcCommand(fcParams);
    const python = options.pythonBinary ?? 'python3';
    const script = options.bagel2Script ?? '/opt/bagel2/BAGEL.py';
    commandLog.push(formatCommandForLog(python, [script, ...fcArgs]));

    onProgress?.({ step: 'initializing', progress: 2, message: 'Starting BAGEL2 fold-change calculation' });

    const fcResult = await executeBagel2Command(fcArgs, options, 'fc', (p) => {
      // Scale fc progress to 0-40%
      onProgress?.({ ...p, progress: Math.min(40, p.progress * 0.4) });
    });

    if (fcResult.exitCode !== 0) {
      const err = detectBagel2Error(fcResult.stderr || fcResult.stdout);
      return {
        success: false,
        bfResults: [],
        prResults: [],
        foldchangeResults: [],
        error: err.technicalMessage,
        userMessage: err.userMessage,
        suggestedAction: err.suggestedAction,
        commandLog: commandLog.join('\n'),
      };
    }

    // Verify foldchange file was produced
    const foldchangePath = path.join(workingDir, `${params.outputPrefix}.foldchange`);
    if (!fs.existsSync(foldchangePath)) {
      return {
        success: false,
        bfResults: [],
        prResults: [],
        foldchangeResults: [],
        error: 'BAGEL2 fc did not produce a fold-change file',
        userMessage: 'Fold-change step completed but the output file was not found.',
        commandLog: commandLog.join('\n'),
      };
    }

    onProgress?.({ step: 'calculating_foldchange', progress: 42, message: 'Fold-change calculation complete' });

    // ---------------------------------------------------------------
    // Step 2: BAGEL.py bf (Bayes Factor)
    // ---------------------------------------------------------------
    const bfOutputPrefix = `${params.outputPrefix}_bf`;
    const bfParams: Bagel2BfParams = {
      inputFoldchange: foldchangePath,
      outputPrefix: bfOutputPrefix,
      essentialGenePath: essentialPath,
      nonEssentialGenePath: nonEssentialPath,
    };
    const bfArgs = buildBagel2BfCommand(bfParams);
    commandLog.push(formatCommandForLog(python, [script, ...bfArgs]));

    const bfResult = await executeBagel2Command(bfArgs, options, 'bf', (p) => {
      // Scale bf progress to 40-95%
      onProgress?.({ ...p, progress: 40 + Math.min(55, (p.progress - 40) * (55 / 60)) });
    });

    if (bfResult.exitCode !== 0) {
      const err = detectBagel2Error(bfResult.stderr || bfResult.stdout);
      return {
        success: false,
        bfResults: [],
        prResults: [],
        foldchangeResults: [],
        error: err.technicalMessage,
        userMessage: err.userMessage,
        suggestedAction: err.suggestedAction,
        commandLog: commandLog.join('\n'),
      };
    }

    // ---------------------------------------------------------------
    // Step 3: Parse results
    // ---------------------------------------------------------------
    onProgress?.({ step: 'writing_results', progress: 96, message: 'Parsing BAGEL2 results' });

    const bfFilePath = path.join(workingDir, `${bfOutputPrefix}.bf`);
    const prFilePath = path.join(workingDir, `${bfOutputPrefix}.pr`);

    let bfResults: Bagel2BfResult[] = [];
    let prResults: Bagel2PrResult[] = [];
    let foldchangeResults: Bagel2FoldchangeRow[] = [];

    if (fs.existsSync(bfFilePath)) {
      bfResults = parseBfFile(fs.readFileSync(bfFilePath, 'utf-8'));
    }
    if (fs.existsSync(prFilePath)) {
      prResults = parsePrFile(fs.readFileSync(prFilePath, 'utf-8'));
    }
    if (fs.existsSync(foldchangePath)) {
      foldchangeResults = parseFoldchangeFile(fs.readFileSync(foldchangePath, 'utf-8'));
    }

    onProgress?.({ step: 'complete', progress: 100, message: 'BAGEL2 analysis complete' });

    return {
      success: true,
      bfResults,
      prResults,
      foldchangeResults,
      commandLog: commandLog.join('\n'),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      bfResults: [],
      prResults: [],
      foldchangeResults: [],
      error: msg,
      userMessage: msg,
      commandLog: commandLog.join('\n'),
    };
  }
}
