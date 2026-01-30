// DrugZ Algorithm Implementation
// Based on Colic et al. 2019 - "Identifying chemogenetic interactions from CRISPR screens with drugZ"

export interface DrugZSgRNAStats {
  sgRNA: string;
  gene: string;
  foldChange: number;
  log2FC: number;
  zScore: number;
  normalizedRank: number;
}

export interface DrugZGeneResult {
  gene: string;
  numSgRNAs: number;
  normZ: number;          // Normalized Z-score (sum of normalized ranks)
  pValue: number;
  fdr: number;
  log2FC: number;
  log2FC_std: number;
  syntheticScore: number; // Positive = synthetic lethal, Negative = suppressor
  rank: number;
  sgRNAs: DrugZSgRNAStats[];
}

export interface DrugZProgress {
  step: string;
  progress: number;
  message: string;
  timestamp: Date;
}

export type DrugZProgressCallback = (progress: DrugZProgress) => void;

export class DrugZAnalyzer {
  private minSgRNAs: number;
  private unpaired: boolean;

  constructor(options: {
    minSgRNAs?: number;  // Minimum sgRNAs per gene (default 3)
    unpaired?: boolean;  // Use unpaired analysis (default false)
  } = {}) {
    this.minSgRNAs = options.minSgRNAs ?? 3;
    this.unpaired = options.unpaired ?? false;
  }

  async runAnalysis(
    countMatrix: Map<string, number[]>,
    sgRNAToGene: Map<string, string>,
    controlIndices: number[],
    treatmentIndices: number[],
    progressCallback?: DrugZProgressCallback
  ): Promise<DrugZGeneResult[]> {
    const log = (step: string, progress: number, message: string) => {
      progressCallback?.({
        step,
        progress,
        message,
        timestamp: new Date()
      });
    };

    // Step 1: Normalize counts
    log('normalization', 5, 'Normalizing read counts...');
    const normalized = this.normalizeReadCounts(countMatrix);
    log('normalization', 10, `Normalized ${normalized.size} sgRNAs`);

    // Step 2: Calculate fold changes
    log('foldchange', 15, 'Calculating fold changes for all sgRNAs...');
    const sgRNAStats = this.calculateFoldChanges(
      normalized,
      sgRNAToGene,
      controlIndices,
      treatmentIndices
    );
    log('foldchange', 25, `Calculated fold changes for ${sgRNAStats.length} sgRNAs`);

    // Step 3: Calculate Z-scores
    log('zscore', 30, 'Computing Z-scores for fold changes...');
    this.calculateZScores(sgRNAStats);
    log('zscore', 40, 'Z-scores calculated');

    // Step 4: Calculate normalized ranks
    log('ranking', 45, 'Computing normalized ranks...');
    this.calculateNormalizedRanks(sgRNAStats);
    log('ranking', 55, 'Ranks calculated');

    // Step 5: Group by gene
    log('grouping', 60, 'Grouping sgRNAs by target gene...');
    const geneGroups = this.groupSgRNAsByGene(sgRNAStats);
    log('grouping', 65, `Found ${geneGroups.size} genes`);

    // Step 6: Calculate gene-level normZ scores
    log('normz', 70, 'Computing gene-level normZ scores...');
    const results = await this.calculateGeneScores(
      geneGroups,
      sgRNAStats.length,
      (p) => log('normz', 70 + Math.floor(p * 15), `Gene scoring: ${Math.round(p * 100)}% complete`)
    );

    // Step 7: Calculate p-values using normal approximation
    log('pvalue', 85, 'Computing p-values...');
    this.calculatePValues(results, sgRNAStats.length);
    log('pvalue', 90, 'P-values computed');

    // Step 8: FDR correction
    log('fdr', 92, 'Applying FDR correction...');
    this.calculateFDR(results);

    // Step 9: Sort and rank
    log('sorting', 95, 'Sorting results by normZ score...');
    // Sort by absolute normZ (most significant effects first)
    results.sort((a, b) => Math.abs(b.normZ) - Math.abs(a.normZ));
    results.forEach((result, index) => {
      result.rank = index + 1;
    });

    const significantCount = results.filter(r => r.fdr < 0.05).length;
    log('complete', 100, `DrugZ analysis complete. Found ${significantCount} significant genes (FDR < 0.05)`);

    return results;
  }

  private normalizeReadCounts(counts: Map<string, number[]>): Map<string, number[]> {
    const numSamples = Array.from(counts.values())[0]?.length || 0;
    if (numSamples === 0) return new Map();

    // Calculate total reads per sample
    const totals: number[] = Array(numSamples).fill(0);
    for (const countsArray of counts.values()) {
      countsArray.forEach((count, i) => {
        totals[i] += count;
      });
    }

    // Normalize to reads per million (RPM)
    const normalized = new Map<string, number[]>();
    for (const [sgRNA, countsArray] of counts.entries()) {
      const normalizedCounts = countsArray.map((count, i) => {
        return totals[i] > 0 ? (count / totals[i]) * 1e6 : 0;
      });
      normalized.set(sgRNA, normalizedCounts);
    }

    return normalized;
  }

  private calculateFoldChanges(
    normalized: Map<string, number[]>,
    sgRNAToGene: Map<string, string>,
    controlIdx: number[],
    treatmentIdx: number[]
  ): DrugZSgRNAStats[] {
    const stats: DrugZSgRNAStats[] = [];

    for (const [sgRNA, counts] of normalized.entries()) {
      const gene = sgRNAToGene.get(sgRNA);
      if (!gene) continue;

      const controlMean = this.mean(controlIdx.map(i => counts[i]));
      const treatmentMean = this.mean(treatmentIdx.map(i => counts[i]));

      // Fold change with pseudocount
      const pseudocount = 0.5;
      const foldChange = (treatmentMean + pseudocount) / (controlMean + pseudocount);
      const log2FC = Math.log2(foldChange);

      stats.push({
        sgRNA,
        gene,
        foldChange,
        log2FC,
        zScore: 0,      // Will be calculated
        normalizedRank: 0
      });
    }

    return stats;
  }

  private calculateZScores(stats: DrugZSgRNAStats[]): void {
    // Calculate mean and std of all log2FC values
    const log2FCs = stats.map(s => s.log2FC);
    const mean = this.mean(log2FCs);
    const std = Math.sqrt(this.variance(log2FCs));

    // Calculate Z-score for each sgRNA
    for (const stat of stats) {
      stat.zScore = std > 0 ? (stat.log2FC - mean) / std : 0;
    }
  }

  private calculateNormalizedRanks(stats: DrugZSgRNAStats[]): void {
    // Sort by Z-score
    const sorted = [...stats].sort((a, b) => a.zScore - b.zScore);
    const n = sorted.length;

    // Create rank map
    const rankMap = new Map<string, number>();
    sorted.forEach((stat, index) => {
      // Normalized rank: (rank - 0.5) / n
      // This gives values between 0 and 1
      const normalizedRank = (index + 0.5) / n;
      rankMap.set(stat.sgRNA, normalizedRank);
    });

    // Assign normalized ranks
    for (const stat of stats) {
      stat.normalizedRank = rankMap.get(stat.sgRNA) || 0.5;
    }
  }

  private groupSgRNAsByGene(stats: DrugZSgRNAStats[]): Map<string, DrugZSgRNAStats[]> {
    const groups = new Map<string, DrugZSgRNAStats[]>();

    for (const stat of stats) {
      if (!groups.has(stat.gene)) {
        groups.set(stat.gene, []);
      }
      groups.get(stat.gene)!.push(stat);
    }

    return groups;
  }

  private async calculateGeneScores(
    geneGroups: Map<string, DrugZSgRNAStats[]>,
    totalSgRNAs: number,
    progressCallback?: (progress: number) => void
  ): Promise<DrugZGeneResult[]> {
    const results: DrugZGeneResult[] = [];
    const genes = Array.from(geneGroups.keys());

    for (let i = 0; i < genes.length; i++) {
      const gene = genes[i];
      const sgRNAs = geneGroups.get(gene)!;

      if (sgRNAs.length < this.minSgRNAs) {
        continue;
      }

      // Calculate normZ using sum of normalized ranks
      // normZ = sum(qnorm(normalized_rank)) / sqrt(n)
      // where qnorm is the inverse normal CDF

      let sumInvNorm = 0;
      for (const sgRNA of sgRNAs) {
        // Convert normalized rank to Z-score via inverse normal CDF
        const invNorm = this.inverseNormalCDF(sgRNA.normalizedRank);
        sumInvNorm += invNorm;
      }

      const k = sgRNAs.length;
      const normZ = sumInvNorm / Math.sqrt(k);

      // Calculate log2FC statistics
      const log2FCs = sgRNAs.map(s => s.log2FC);
      const meanLog2FC = this.mean(log2FCs);
      const stdLog2FC = Math.sqrt(this.variance(log2FCs));

      // Synthetic score (positive = depletion/synthetic lethal, negative = enrichment/suppressor)
      const syntheticScore = -normZ; // Negative normZ = depletion

      results.push({
        gene,
        numSgRNAs: k,
        normZ,
        pValue: 0, // Will be calculated
        fdr: 0,
        log2FC: meanLog2FC,
        log2FC_std: stdLog2FC,
        syntheticScore,
        rank: 0,
        sgRNAs
      });

      if (i % 100 === 0) {
        progressCallback?.(i / genes.length);
      }
    }

    progressCallback?.(1.0);
    return results;
  }

  private calculatePValues(results: DrugZGeneResult[], totalSgRNAs: number): void {
    // Under null hypothesis, normZ follows standard normal distribution
    for (const result of results) {
      // Two-tailed p-value
      const absNormZ = Math.abs(result.normZ);
      result.pValue = 2 * (1 - this.normalCDF(absNormZ));
    }
  }

  private calculateFDR(results: DrugZGeneResult[]): void {
    const m = results.length;

    // Sort by p-value
    const sorted = [...results].sort((a, b) => a.pValue - b.pValue);

    // Benjamini-Hochberg procedure
    for (let i = 0; i < sorted.length; i++) {
      sorted[i].fdr = Math.min(1, (sorted[i].pValue * m) / (i + 1));
    }

    // Ensure monotonicity
    for (let i = sorted.length - 2; i >= 0; i--) {
      if (sorted[i].fdr > sorted[i + 1].fdr) {
        sorted[i].fdr = sorted[i + 1].fdr;
      }
    }

    // Copy back
    const fdrMap = new Map(sorted.map(r => [r.gene, r.fdr]));
    for (const result of results) {
      result.fdr = fdrMap.get(result.gene) || 1;
    }
  }

  // Statistical utility functions
  private mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  private variance(values: number[]): number {
    if (values.length < 2) return 0;
    const m = this.mean(values);
    return this.mean(values.map(v => Math.pow(v - m, 2)));
  }

  private normalCDF(x: number): number {
    // Standard normal CDF using error function
    return 0.5 * (1 + this.erf(x / Math.sqrt(2)));
  }

  private inverseNormalCDF(p: number): number {
    // Inverse of standard normal CDF (probit function)
    // Using rational approximation

    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    if (p === 0.5) return 0;

    // Coefficients for rational approximation
    const a = [
      -3.969683028665376e1,
      2.209460984245205e2,
      -2.759285104469687e2,
      1.383577518672690e2,
      -3.066479806614716e1,
      2.506628277459239e0
    ];

    const b = [
      -5.447609879822406e1,
      1.615858368580409e2,
      -1.556989798598866e2,
      6.680131188771972e1,
      -1.328068155288572e1
    ];

    const c = [
      -7.784894002430293e-3,
      -3.223964580411365e-1,
      -2.400758277161838e0,
      -2.549732539343734e0,
      4.374664141464968e0,
      2.938163982698783e0
    ];

    const d = [
      7.784695709041462e-3,
      3.224671290700398e-1,
      2.445134137142996e0,
      3.754408661907416e0
    ];

    const pLow = 0.02425;
    const pHigh = 1 - pLow;

    let q: number, r: number;

    if (p < pLow) {
      // Lower region
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0]*q + c[1])*q + c[2])*q + c[3])*q + c[4])*q + c[5]) /
             ((((d[0]*q + d[1])*q + d[2])*q + d[3])*q + 1);
    } else if (p <= pHigh) {
      // Central region
      q = p - 0.5;
      r = q * q;
      return (((((a[0]*r + a[1])*r + a[2])*r + a[3])*r + a[4])*r + a[5])*q /
             (((((b[0]*r + b[1])*r + b[2])*r + b[3])*r + b[4])*r + 1);
    } else {
      // Upper region
      q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c[0]*q + c[1])*q + c[2])*q + c[3])*q + c[4])*q + c[5]) /
              ((((d[0]*q + d[1])*q + d[2])*q + d[3])*q + 1);
    }
  }

  private erf(x: number): number {
    // Error function approximation
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
}

export default DrugZAnalyzer;
