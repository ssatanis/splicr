export interface SampleData {
  name: string;
  group: 'control' | 'treatment';
  replicate: number;
  sgRNACounts: Map<string, number>;
}

export interface GeneResult {
  gene: string;
  sgRNAs: string[];
  controlMean: number;
  treatmentMean: number;
  log2FC: number;
  pValue: number;
  fdr: number;
  rank: number;
}

export class AnalysisEngine {
  /**
   * Map sgRNAs to genes using library
   */
  static mapSgRNAsToGenes(
    sgRNACounts: Map<string, number>,
    library: Map<string, string>
  ): Map<string, Map<string, number>> {
    const geneCounts = new Map<string, Map<string, number>>();

    for (const [sgRNA, count] of sgRNACounts.entries()) {
      const gene = library.get(sgRNA);

      if (gene) {
        if (!geneCounts.has(gene)) {
          geneCounts.set(gene, new Map());
        }
        geneCounts.get(gene)!.set(sgRNA, count);
      }
    }

    return geneCounts;
  }

  /**
   * Normalize counts (Median normalization)
   */
  static normalizeCounts(samples: SampleData[]): SampleData[] {
    const normalized: SampleData[] = [];

    for (const sample of samples) {
      const counts = Array.from(sample.sgRNACounts.values());
      const median = this.calculateMedian(counts);
      const globalMedian = 1000;
      const normFactor = globalMedian / median;

      const normalizedCounts = new Map<string, number>();
      for (const [sgRNA, count] of sample.sgRNACounts.entries()) {
        normalizedCounts.set(sgRNA, count * normFactor);
      }

      normalized.push({
        ...sample,
        sgRNACounts: normalizedCounts
      });
    }

    return normalized;
  }

  private static calculateMedian(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  /**
   * Perform gene-level analysis
   */
  static async analyzeGenes(
    samples: SampleData[],
    library: Map<string, string>
  ): Promise<GeneResult[]> {
    const normalizedSamples = this.normalizeCounts(samples);

    const controlSamples = normalizedSamples.filter(s => s.group === 'control');
    const treatmentSamples = normalizedSamples.filter(s => s.group === 'treatment');

    const allGenes = new Set(library.values());
    const results: GeneResult[] = [];

    for (const gene of allGenes) {
      const geneSgRNAs = Array.from(library.entries())
        .filter(([_, g]) => g === gene)
        .map(([sgRNA]) => sgRNA);

      if (geneSgRNAs.length === 0) continue;

      const controlCounts: number[][] = controlSamples.map(sample =>
        geneSgRNAs.map(sgRNA => sample.sgRNACounts.get(sgRNA) || 0)
      );

      const treatmentCounts: number[][] = treatmentSamples.map(sample =>
        geneSgRNAs.map(sgRNA => sample.sgRNACounts.get(sgRNA) || 0)
      );

      const controlMeans = this.calculateMeanAcrossReplicates(controlCounts);
      const treatmentMeans = this.calculateMeanAcrossReplicates(treatmentCounts);

      const controlMean = this.mean(controlMeans);
      const treatmentMean = this.mean(treatmentMeans);

      const log2FC = Math.log2((treatmentMean + 1) / (controlMean + 1));
      const pValue = this.tTest(controlMeans, treatmentMeans);

      results.push({
        gene,
        sgRNAs: geneSgRNAs,
        controlMean,
        treatmentMean,
        log2FC,
        pValue,
        fdr: 0,
        rank: 0
      });
    }

    // FDR correction (Benjamini-Hochberg)
    const sortedByPValue = [...results].sort((a, b) => a.pValue - b.pValue);
    const m = sortedByPValue.length;

    for (let i = 0; i < sortedByPValue.length; i++) {
      sortedByPValue[i].fdr = (sortedByPValue[i].pValue * m) / (i + 1);
      sortedByPValue[i].rank = i + 1;
    }

    for (let i = sortedByPValue.length - 2; i >= 0; i--) {
      if (sortedByPValue[i].fdr > sortedByPValue[i + 1].fdr) {
        sortedByPValue[i].fdr = sortedByPValue[i + 1].fdr;
      }
    }

    return sortedByPValue;
  }

  private static calculateMeanAcrossReplicates(counts: number[][]): number[] {
    if (counts.length === 0) return [];
    const numSgRNAs = counts[0]?.length || 0;
    const means: number[] = [];

    for (let i = 0; i < numSgRNAs; i++) {
      const values = counts.map(replicate => replicate[i]);
      means.push(this.mean(values));
    }

    return means;
  }

  private static mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  private static stdDev(values: number[]): number {
    const avg = this.mean(values);
    const squareDiffs = values.map(val => Math.pow(val - avg, 2));
    return Math.sqrt(this.mean(squareDiffs));
  }

  private static tTest(group1: number[], group2: number[]): number {
    if (group1.length === 0 || group2.length === 0) return 1.0;

    const mean1 = this.mean(group1);
    const mean2 = this.mean(group2);
    const std1 = this.stdDev(group1);
    const std2 = this.stdDev(group2);
    const n1 = group1.length;
    const n2 = group2.length;

    const numerator = mean1 - mean2;
    const denominator = Math.sqrt((std1 * std1 / n1) + (std2 * std2 / n2));

    if (denominator === 0) return 1.0;

    const tStat = Math.abs(numerator / denominator);

    const df = Math.pow(
      (std1 * std1 / n1) + (std2 * std2 / n2), 2
    ) / (
      Math.pow(std1 * std1 / n1, 2) / (n1 - 1) +
      Math.pow(std2 * std2 / n2, 2) / (n2 - 1)
    );

    const pValue = 2 * (1 - this.tCDF(tStat, df));
    return Math.max(0.0, Math.min(1.0, pValue));
  }

  private static tCDF(t: number, df: number): number {
    const z = t / Math.sqrt(1 + t * t / df);
    return this.normalCDF(z);
  }

  private static normalCDF(x: number): number {
    return 0.5 * (1 + this.erf(x / Math.sqrt(2)));
  }

  private static erf(x: number): number {
    const sign = x >= 0 ? 1 : -1;
    x = Math.abs(x);

    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return sign * y;
  }

  /**
   * Calculate sample correlations
   */
  static calculateCorrelations(samples: SampleData[]): number[][] {
    const n = samples.length;
    const correlations: number[][] = Array(n).fill(0).map(() => Array(n).fill(0));

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) {
          correlations[i][j] = 1.0;
        } else {
          correlations[i][j] = this.pearsonCorrelation(
            samples[i].sgRNACounts,
            samples[j].sgRNACounts
          );
        }
      }
    }

    return correlations;
  }

  private static pearsonCorrelation(
    counts1: Map<string, number>,
    counts2: Map<string, number>
  ): number {
    const allSgRNAs = new Set([...counts1.keys(), ...counts2.keys()]);
    const pairs: [number, number][] = [];

    for (const sgRNA of allSgRNAs) {
      const count1 = counts1.get(sgRNA) || 0;
      const count2 = counts2.get(sgRNA) || 0;
      pairs.push([count1, count2]);
    }

    if (pairs.length === 0) return 0;

    const x = pairs.map(p => p[0]);
    const y = pairs.map(p => p[1]);

    const meanX = this.mean(x);
    const meanY = this.mean(y);

    let numerator = 0;
    let denomX = 0;
    let denomY = 0;

    for (let i = 0; i < pairs.length; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      numerator += dx * dy;
      denomX += dx * dx;
      denomY += dy * dy;
    }

    if (denomX === 0 || denomY === 0) return 0;

    return numerator / Math.sqrt(denomX * denomY);
  }
}
