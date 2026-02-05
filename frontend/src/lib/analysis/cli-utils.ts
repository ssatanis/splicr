/**
 * CLI Utilities for CRISPR Analysis Tools
 *
 * Shared helpers for detecting CLI availability, managing temp directories,
 * and writing count tables to disk for BAGEL2/DrugZ consumption.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';

type CliTool = 'mageck' | 'bagel2' | 'drugz';

const cliCache = new Map<CliTool, boolean>();

/** Check whether a CLI tool is available on the system. Result is cached. */
export function isCliAvailable(tool: CliTool): boolean {
  if (cliCache.has(tool)) return cliCache.get(tool)!;

  let available = false;
  try {
    switch (tool) {
      case 'mageck':
        execSync('mageck --version', { stdio: 'ignore', timeout: 5000 });
        available = true;
        break;
      case 'bagel2':
        available = fs.existsSync('/opt/bagel2/BAGEL.py');
        break;
      case 'drugz':
        available = fs.existsSync('/opt/drugz/drugz.py');
        break;
    }
  } catch {
    available = false;
  }

  cliCache.set(tool, available);
  return available;
}

/** Create (and return) a temporary working directory for an analysis run. */
export function createWorkingDir(analysisId: string): string {
  const dir = path.join(os.tmpdir(), `splicr-analysis-${analysisId}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Remove a working directory and all its contents. */
export function cleanupWorkingDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    console.warn('Failed to clean up working directory:', dir, err);
  }
}

/**
 * Write an in-memory count matrix to a tab-delimited file on disk.
 *
 * Output format matches MAGeCK count output:
 *   sgRNA\tGene\tSample1\tSample2\t...
 *   AACG...\tBRCA1\t100\t200\t...
 */
export function writeCountTableToDisk(
  countMatrix: Map<string, number[]>,
  sgRNAToGene: Map<string, string>,
  sampleNames: string[],
  outputPath: string
): void {
  const lines: string[] = [];

  // Header
  lines.push(['sgRNA', 'Gene', ...sampleNames].join('\t'));

  // Data rows
  for (const [sgRNA, counts] of countMatrix.entries()) {
    const gene = sgRNAToGene.get(sgRNA) ?? 'UNKNOWN';
    lines.push([sgRNA, gene, ...counts.map(String)].join('\t'));
  }

  fs.writeFileSync(outputPath, lines.join('\n') + '\n', 'utf-8');
}

/** Format a command + args as a single string for logging / reproducibility. */
export function formatCommandForLog(binary: string, args: string[]): string {
  const escaped = args.map((a) =>
    a.includes(' ') ? `"${a.replace(/"/g, '\\"')}"` : a
  );
  return [binary, ...escaped].join(' ');
}
