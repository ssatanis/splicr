/**
 * MAGeCK Output File Parser
 *
 * Parses gene_summary.txt, sgrna_summary.txt, and count files
 * per MAGeCK official output format (SourceForge Wiki).
 */

export interface MageckGeneResult {
  id: string;
  num: number;
  negScore: number;
  negPValue: number;
  negFdr: number;
  negRank: number;
  negGoodSgrna: number;
  negLfc?: number;
  posScore: number;
  posPValue: number;
  posFdr: number;
  posRank: number;
  posGoodSgrna: number;
  posLfc?: number;
}

export interface MageckSgrnaResult {
  sgrna: string;
  gene: string;
  controlCount: string;
  treatmentCount: string;
  controlMean: number;
  treatMean: number;
  lfc: number;
  score: number;
  pLow: number;
  pHigh: number;
  fdr: number;
  highInTreatment: boolean;
}

/** Parse gene_summary.txt (tab-delimited) */
export function parseGeneSummary(content: string): MageckGeneResult[] {
  const lines = content.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const header = lines[0].split('\t');
  const results: MageckGeneResult[] = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split('\t');
    if (parts.length < 10) continue;

    const get = (key: string, def: number = 0) => {
      const idx = header.indexOf(key);
      if (idx < 0) return def;
      const v = parts[idx];
      const n = parseFloat(v);
      return isNaN(n) ? def : n;
    };
    const getStr = (key: string) => {
      const idx = header.indexOf(key);
      return idx >= 0 ? parts[idx] : '';
    };

    results.push({
      id: getStr('id') || parts[0],
      num: get('num', 0),
      negScore: get('neg|score', 1),
      negPValue: get('neg|p-value', 1),
      negFdr: get('neg|fdr', 1),
      negRank: get('neg|rank', 0),
      negGoodSgrna: get('neg|goodsgrna', 0),
      negLfc: header.includes('neg|lfc') ? get('neg|lfc') : undefined,
      posScore: get('pos|score', 1),
      posPValue: get('pos|p-value', 1),
      posFdr: get('pos|fdr', 1),
      posRank: get('pos|rank', 0),
      posGoodSgrna: get('pos|goodsgrna', 0),
      posLfc: header.includes('pos|lfc') ? get('pos|lfc') : undefined,
    });
  }

  return results;
}

/** Parse sgrna_summary.txt */
export function parseSgrnaSummary(content: string): MageckSgrnaResult[] {
  const lines = content.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const header = lines[0].split('\t');
  const results: MageckSgrnaResult[] = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split('\t');
    if (parts.length < 8) continue;

    const get = (key: string, def: number = 0) => {
      const idx = header.indexOf(key);
      if (idx < 0) return def;
      const v = parts[idx];
      const n = parseFloat(v);
      return isNaN(n) ? def : n;
    };
    const getStr = (key: string) => {
      const idx = header.indexOf(key);
      return idx >= 0 ? parts[idx] : '';
    };

    const highInTreatmentStr = getStr('high_in_treatment') || parts[parts.length - 1];
    results.push({
      sgrna: getStr('sgrna') || parts[0],
      gene: getStr('Gene') || parts[1],
      controlCount: getStr('control_count') || '',
      treatmentCount: getStr('treatment_count') || '',
      controlMean: get('control_mean', 0),
      treatMean: get('treat_mean', 0),
      lfc: get('LFC', 0),
      score: get('score', 0),
      pLow: get('p.low', 1),
      pHigh: get('p.high', 1),
      fdr: get('FDR', 1),
      highInTreatment: /true|1|yes/i.test(highInTreatmentStr),
    });
  }

  return results;
}

/** Convert parsed gene results to SplicR pipeline format */
export function mageckGeneToUnified(
  r: MageckGeneResult,
  fdrThreshold: number
): {
  gene: string;
  numSgRNAs: number;
  log2FC: number;
  pValue: number;
  fdr: number;
  rank: number;
  mageck?: { rhoNeg: number; rhoPos: number; pValueNeg: number; pValuePos: number; fdrNeg: number; fdrPos: number };
} {
  const fdr = Math.min(r.negFdr, r.posFdr);
  const pValue = Math.min(r.negPValue, r.posPValue);
  const log2FC = (r.negLfc ?? 0) !== 0 ? (r.negLfc as number) : (r.posLfc ?? 0);

  return {
    gene: r.id,
    numSgRNAs: r.num,
    log2FC,
    pValue,
    fdr,
    rank: r.negFdr < r.posFdr ? r.negRank : r.posRank,
    mageck: {
      rhoNeg: r.negScore,
      rhoPos: r.posScore,
      pValueNeg: r.negPValue,
      pValuePos: r.posPValue,
      fdrNeg: r.negFdr,
      fdrPos: r.posFdr,
    },
  };
}
