/**
 * BAGEL2 Output File Parser
 *
 * Parses the tab-delimited output files produced by BAGEL2:
 *   - .foldchange   (sgRNA-level fold changes)
 *   - .bf           (gene-level Bayes Factors)
 *   - .pr           (precision-recall data)
 */

import type { BAGEL2GeneResult, BAGEL2SgRNAStats } from '../bagel2';

// ---------------------------------------------------------------------------
// CLI result types
// ---------------------------------------------------------------------------

export interface Bagel2BfResult {
  gene: string;
  bf: number;
  std: number;
  numObs: number;
}

export interface Bagel2PrResult {
  gene: string;
  precision: number;
  recall: number;
}

export interface Bagel2FoldchangeRow {
  sgRNA: string;
  gene: string;
  foldchanges: number[]; // one per replicate column
  meanFc: number;
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/** Parse the .bf file (tab-delimited: GENE  BF  STD  NumObs). */
export function parseBfFile(content: string): Bagel2BfResult[] {
  const lines = content.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const header = lines[0].split('\t');
  const results: Bagel2BfResult[] = [];

  const col = (key: string) => {
    const idx = header.findIndex((h) => h.toLowerCase() === key.toLowerCase());
    return idx >= 0 ? idx : -1;
  };

  const geneIdx = Math.max(col('GENE'), col('Gene'), 0);
  const bfIdx = Math.max(col('BF'), col('bf'), 1);
  const stdIdx = Math.max(col('STD'), col('std'), 2);
  const numIdx = Math.max(col('NumObs'), col('numobs'), col('num'), 3);

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split('\t');
    if (parts.length < 2) continue;

    results.push({
      gene: parts[geneIdx] ?? '',
      bf: parseFloat(parts[bfIdx]) || 0,
      std: parseFloat(parts[stdIdx]) || 0,
      numObs: parseInt(parts[numIdx], 10) || 0,
    });
  }

  return results;
}

/** Parse the .pr file (tab-delimited: GENE  Precision  Recall). */
export function parsePrFile(content: string): Bagel2PrResult[] {
  const lines = content.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const header = lines[0].split('\t');
  const results: Bagel2PrResult[] = [];

  const col = (key: string) =>
    header.findIndex((h) => h.toLowerCase() === key.toLowerCase());

  const geneIdx = Math.max(col('GENE'), col('Gene'), 0);
  const precIdx = Math.max(col('Precision'), col('precision'), 1);
  const recIdx = Math.max(col('Recall'), col('recall'), 2);

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split('\t');
    if (parts.length < 2) continue;

    results.push({
      gene: parts[geneIdx] ?? '',
      precision: parseFloat(parts[precIdx]) || 0,
      recall: parseFloat(parts[recIdx]) || 0,
    });
  }

  return results;
}

/** Parse the .foldchange file. Columns: REAGENT_ID, GENE, then one or more FC columns. */
export function parseFoldchangeFile(content: string): Bagel2FoldchangeRow[] {
  const lines = content.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const header = lines[0].split('\t');
  const results: Bagel2FoldchangeRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split('\t');
    if (parts.length < 3) continue;

    const sgRNA = parts[0];
    const gene = parts[1];
    const fcs = parts.slice(2).map((v) => parseFloat(v) || 0);
    const mean = fcs.length > 0 ? fcs.reduce((a, b) => a + b, 0) / fcs.length : 0;

    results.push({ sgRNA, gene, foldchanges: fcs, meanFc: mean });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Adapter: convert CLI results → existing BAGEL2GeneResult[]
// ---------------------------------------------------------------------------

/**
 * Convert BAGEL2 CLI output to the legacy `BAGEL2GeneResult[]` interface
 * used by `pipeline.ts` mergeResults().
 */
export function bagel2CliToLegacy(
  bfResults: Bagel2BfResult[],
  prResults: Bagel2PrResult[],
  fcRows: Bagel2FoldchangeRow[]
): BAGEL2GeneResult[] {
  // Build lookup maps
  const prMap = new Map<string, Bagel2PrResult>();
  for (const pr of prResults) prMap.set(pr.gene, pr);

  // Group fold-change rows by gene for sgRNA stats and mean log2FC
  const fcByGene = new Map<string, Bagel2FoldchangeRow[]>();
  for (const row of fcRows) {
    if (!fcByGene.has(row.gene)) fcByGene.set(row.gene, []);
    fcByGene.get(row.gene)!.push(row);
  }

  const results: BAGEL2GeneResult[] = [];

  for (let i = 0; i < bfResults.length; i++) {
    const bf = bfResults[i];
    const pr = prMap.get(bf.gene);
    const geneRows = fcByGene.get(bf.gene) ?? [];

    // Compute log2FC stats from fold-change data
    const log2FCs = geneRows.map((r) => Math.log2(Math.max(r.meanFc, 1e-10)));
    const meanLog2FC =
      log2FCs.length > 0 ? log2FCs.reduce((a, b) => a + b, 0) / log2FCs.length : 0;
    const variance =
      log2FCs.length > 1
        ? log2FCs.reduce((acc, v) => acc + (v - meanLog2FC) ** 2, 0) / log2FCs.length
        : 0;

    const sgRNAs: BAGEL2SgRNAStats[] = geneRows.map((r) => ({
      sgRNA: r.sgRNA,
      gene: r.gene,
      foldChange: r.meanFc,
      log2FC: Math.log2(Math.max(r.meanFc, 1e-10)),
    }));

    results.push({
      gene: bf.gene,
      numSgRNAs: bf.numObs || sgRNAs.length,
      bayesFactor: bf.bf,
      precision: pr?.precision ?? 0,
      recall: pr?.recall ?? 0,
      log2FC: meanLog2FC,
      log2FC_std: Math.sqrt(variance),
      essentialProbability: 1 / (1 + Math.exp(-bf.bf)),
      rank: i + 1,
      sgRNAs,
    });
  }

  // Sort by BF descending (most essential first), re-rank
  results.sort((a, b) => b.bayesFactor - a.bayesFactor);
  results.forEach((r, idx) => {
    r.rank = idx + 1;
  });

  return results;
}
