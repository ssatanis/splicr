/**
 * DrugZ Output File Parser
 *
 * Parses the tab-delimited output file produced by DrugZ.
 * Columns: GENE, sumZ, numObs, normZ, pval_synth, rank_synth, fdr_synth,
 *          pval_supp, rank_supp, fdr_supp
 */

import type { DrugZGeneResult, DrugZSgRNAStats } from '../drugz';

// ---------------------------------------------------------------------------
// CLI result types
// ---------------------------------------------------------------------------

export interface DrugzCliResult {
  gene: string;
  sumZ: number;
  numObs: number;
  normZ: number;
  pvalSynth: number;
  rankSynth: number;
  fdrSynth: number;
  pvalSupp: number;
  rankSupp: number;
  fdrSupp: number;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/** Parse the DrugZ output file (tab-delimited). */
export function parseDrugzOutput(content: string): DrugzCliResult[] {
  const lines = content.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const header = lines[0].split('\t').map((h) => h.trim().toLowerCase());
  const results: DrugzCliResult[] = [];

  const col = (key: string): number => {
    const idx = header.indexOf(key.toLowerCase());
    return idx;
  };

  // DrugZ output columns (case-insensitive lookup)
  const geneIdx = Math.max(col('gene'), 0);
  const sumZIdx = col('sumz');
  const numObsIdx = col('numobs');
  const normZIdx = col('normz');
  const pvalSynthIdx = col('pval_synth');
  const rankSynthIdx = col('rank_synth');
  const fdrSynthIdx = col('fdr_synth');
  const pvalSuppIdx = col('pval_supp');
  const rankSuppIdx = col('rank_supp');
  const fdrSuppIdx = col('fdr_supp');

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split('\t');
    if (parts.length < 4) continue;

    const getNum = (idx: number, def: number = 0): number => {
      if (idx < 0 || idx >= parts.length) return def;
      const n = parseFloat(parts[idx]);
      return isNaN(n) ? def : n;
    };

    results.push({
      gene: parts[geneIdx] ?? '',
      sumZ: getNum(sumZIdx),
      numObs: Math.round(getNum(numObsIdx)),
      normZ: getNum(normZIdx),
      pvalSynth: getNum(pvalSynthIdx, 1),
      rankSynth: Math.round(getNum(rankSynthIdx)),
      fdrSynth: getNum(fdrSynthIdx, 1),
      pvalSupp: getNum(pvalSuppIdx, 1),
      rankSupp: Math.round(getNum(rankSuppIdx)),
      fdrSupp: getNum(fdrSuppIdx, 1),
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Adapter: convert CLI results → existing DrugZGeneResult[]
// ---------------------------------------------------------------------------

/**
 * Convert DrugZ CLI output to the legacy `DrugZGeneResult[]` interface
 * used by `pipeline.ts` mergeResults().
 */
export function drugzCliToLegacy(results: DrugzCliResult[]): DrugZGeneResult[] {
  const legacy: DrugZGeneResult[] = results.map((r) => {
    // Use the more significant direction for the unified p-value/FDR
    const useSynth = r.pvalSynth <= r.pvalSupp;
    const pValue = useSynth ? r.pvalSynth : r.pvalSupp;
    const fdr = useSynth ? r.fdrSynth : r.fdrSupp;

    // Estimate log2FC from normZ direction and magnitude
    // Negative normZ → depletion (negative log2FC)
    const log2FC = -r.normZ * 0.5; // rough linear mapping

    return {
      gene: r.gene,
      numSgRNAs: r.numObs,
      normZ: r.normZ,
      pValue,
      fdr,
      log2FC,
      log2FC_std: 0, // not available from CLI output
      syntheticScore: -r.normZ, // positive = depletion, matching existing convention
      rank: 0,
      sgRNAs: [] as DrugZSgRNAStats[], // sgRNA-level detail not in DrugZ output
    };
  });

  // Sort by absolute normZ (most significant first), assign ranks
  legacy.sort((a, b) => Math.abs(b.normZ) - Math.abs(a.normZ));
  legacy.forEach((r, idx) => {
    r.rank = idx + 1;
  });

  return legacy;
}
