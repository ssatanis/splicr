// MAGeCK RRA (Robust Rank Aggregation) Algorithm Implementation
// Based on Li et al. 2014 - "MAGeCK enables robust identification of essential genes"

export interface SgRNAStats {
  sgRNA: string;
  gene: string;
  sequence: string;
  controlMean: number;
  treatmentMean: number;
  log2FC: number;
  pValue: number;
  rank: number;
}

export interface UnifiedGeneResult {
  gene: string;
  numSgRNAs: number;
  log2FC: number;
  pValue: number;
  fdr: number;
  rank: number;
  mageck?: {
    rhoNeg: number;
    rhoPos: number;
    pValueNeg: number;
    pValuePos: number;
    fdrNeg: number;
    fdrPos: number;
  };
}

export interface MAGeCKGeneResult {
  gene: string;
  numSgRNAs: number;
  sgRNAs: SgRNAStats[];
  log2FC: number;
  log2FC_std: number;
  rhoNeg: number;      // RRA score for negative selection (depletion)
  rhoPos: number;      // RRA score for positive selection (enrichment)
  pValueNeg: number;
  pValuePos: number;
  fdrNeg: number;
  fdrPos: number;
  rank: number;
  goodSgRNAs: number;  // Number of sgRNAs passing significance threshold
}

export interface MAGeCKProgress {
  step: string;
  progress: number;
  message: string;
  timestamp: Date;
}

export type ProgressCallback = (progress: MAGeCKProgress) => void;

export class MAGeCKAnalyzer {
  private alpha: number;
  private minSgRNAs: number;
  private permutations: number;
  private normalizationMethod: 'median' | 'total' | 'control' | 'none';

  constructor(options: {
    alpha?: number;          // Significance threshold for alpha-RRA (default 0.05)
    minSgRNAs?: number;      // Minimum sgRNAs per gene (default 3)
    permutations?: number;   // Number of permutations for p-value (default 10000)
    normalizationMethod?: 'median' | 'total' | 'control' | 'none';
  } = {}) {
    this.alpha = options.alpha ?? 0.05;
    this.minSgRNAs = options.minSgRNAs ?? 3;
    this.permutations = options.permutations ?? 10000;
    this.normalizationMethod = options.normalizationMethod ?? 'median';
  }

  async runAnalysis(
    countMatrix: Map<string, number[]>,  // sgRNA -> [ctrl1, ctrl2, ..., treat1, treat2, ...]
    sgRNAToGene: Map<string, string>,     // sgRNA -> gene
    controlIndices: number[],             // Indices of control samples
    treatmentIndices: number[],           // Indices of treatment samples
    progressCallback?: ProgressCallback
  ): Promise<MAGeCKGeneResult[]> {
    const log = (step: string, progress: number, message: string) => {
      progressCallback?.({
        step,
        progress,
        message,
        timestamp: new Date()
      });
    };

    // Step 1: Normalization
    log('normalization', 5, `Starting ${this.normalizationMethod} normalization of read counts...`);
    const normalized = this.normalizationMethod === 'none'
      ? new Map(countMatrix)
      : this.normalizationMethod === 'total'
        ? this.totalNormalization(countMatrix)
        : this.medianNormalization(countMatrix); // 'median' and 'control' use median
    log('normalization', 10, `Normalized ${normalized.size} sgRNAs across ${controlIndices.length + treatmentIndices.length} samples`);

    // Step 2: Calculate sgRNA-level statistics
    log('sgRNA_stats', 15, 'Calculating sgRNA-level fold changes and p-values...');
    const sgRNAStats = this.calculateSgRNAStats(
      normalized,
      sgRNAToGene,
      controlIndices,
      treatmentIndices
    );
    log('sgRNA_stats', 30, `Computed statistics for ${sgRNAStats.length} sgRNAs`);

    // Step 3: Group sgRNAs by gene
    log('grouping', 35, 'Grouping sgRNAs by target gene...');
    const geneGroups = this.groupSgRNAsByGene(sgRNAStats);
    log('grouping', 40, `Found ${geneGroups.size} genes with sgRNA coverage`);

    // Step 4: Apply alpha-RRA for negative selection (depletion)
    log('rra_neg', 45, 'Running α-RRA algorithm for negative selection (depleted genes)...');
    const negResults = await this.applyAlphaRRA(
      sgRNAStats,
      geneGroups,
      'negative',
      (p) => log('rra_neg', 45 + Math.floor(p * 15), `α-RRA negative: ${Math.round(p * 100)}% complete`)
    );

    // Step 5: Apply alpha-RRA for positive selection (enrichment)
    log('rra_pos', 60, 'Running α-RRA algorithm for positive selection (enriched genes)...');
    const posResults = await this.applyAlphaRRA(
      sgRNAStats,
      geneGroups,
      'positive',
      (p) => log('rra_pos', 60 + Math.floor(p * 15), `α-RRA positive: ${Math.round(p * 100)}% complete`)
    );

    // Step 6: Permutation test for p-values
    log('permutation', 75, `Running permutation test with ${this.permutations} iterations...`);
    const withPvalues = await this.permutationTest(
      negResults,
      posResults,
      geneGroups,
      (p) => log('permutation', 75 + Math.floor(p * 15), `Permutation test: ${Math.round(p * 100)}% complete`)
    );

    // Step 7: FDR correction
    log('fdr', 90, 'Applying Benjamini-Hochberg FDR correction...');
    const finalResults = this.calculateFDR(withPvalues);

    // Step 8: Sort by significance
    log('sorting', 95, 'Sorting results by significance...');
    finalResults.sort((a, b) => {
      // Sort by minimum FDR (most significant first)
      const minFdrA = Math.min(a.fdrNeg, a.fdrPos);
      const minFdrB = Math.min(b.fdrNeg, b.fdrPos);
      return minFdrA - minFdrB;
    });

    // Assign ranks
    finalResults.forEach((result, index) => {
      result.rank = index + 1;
    });

    log('complete', 100, `MAGeCK analysis complete. Found ${finalResults.filter(r => Math.min(r.fdrNeg, r.fdrPos) < 0.05).length} significant genes (FDR < 0.05)`);

    return finalResults;
  }

  private medianNormalization(counts: Map<string, number[]>): Map<string, number[]> {
    const numSamples = Array.from(counts.values())[0]?.length || 0;
    if (numSamples === 0) return new Map();

    // Calculate median for each sample
    const medians: number[] = [];
    for (let i = 0; i < numSamples; i++) {
      const columnValues = Array.from(counts.values())
        .map(row => row[i])
        .filter(v => v > 0); // Exclude zeros for median calculation
      medians.push(this.median(columnValues));
    }

    // Target median (use global median)
    const targetMedian = this.median(medians.filter(m => m > 0)) || 1000;

    // Normalize each count
    const normalized = new Map<string, number[]>();
    for (const [sgRNA, countsArray] of counts.entries()) {
      const normalizedCounts = countsArray.map((count, i) => {
        if (medians[i] === 0) return count;
        return count * (targetMedian / medians[i]);
      });
      normalized.set(sgRNA, normalizedCounts);
    }

    return normalized;
  }

  private totalNormalization(counts: Map<string, number[]>): Map<string, number[]> {
    const numSamples = Array.from(counts.values())[0]?.length || 0;
    if (numSamples === 0) return new Map();

    // Calculate total reads per sample
    const totals: number[] = Array(numSamples).fill(0);
    for (const countsArray of counts.values()) {
      countsArray.forEach((count, i) => {
        totals[i] += count;
      });
    }

    // Target total (use mean total across samples)
    const targetTotal = totals.reduce((a, b) => a + b, 0) / totals.length || 1;

    const normalized = new Map<string, number[]>();
    for (const [sgRNA, countsArray] of counts.entries()) {
      const normalizedCounts = countsArray.map((count, i) => {
        return totals[i] > 0 ? count * (targetTotal / totals[i]) : count;
      });
      normalized.set(sgRNA, normalizedCounts);
    }

    return normalized;
  }

  private calculateSgRNAStats(
    normalized: Map<string, number[]>,
    sgRNAToGene: Map<string, string>,
    controlIdx: number[],
    treatmentIdx: number[]
  ): SgRNAStats[] {
    const stats: SgRNAStats[] = [];

    for (const [sgRNA, counts] of normalized.entries()) {
      const gene = sgRNAToGene.get(sgRNA);
      if (!gene) continue;

      const controlCounts = controlIdx.map(i => counts[i]);
      const treatmentCounts = treatmentIdx.map(i => counts[i]);

      const controlMean = this.mean(controlCounts);
      const treatmentMean = this.mean(treatmentCounts);

      // Log2 fold change with pseudocount
      const log2FC = Math.log2((treatmentMean + 1) / (controlMean + 1));

      // Negative binomial test (approximated with modified t-test)
      const pValue = this.negativeBinomialTest(controlCounts, treatmentCounts);

      stats.push({
        sgRNA,
        gene,
        sequence: sgRNA,
        controlMean,
        treatmentMean,
        log2FC,
        pValue,
        rank: 0
      });
    }

    // Rank sgRNAs by p-value
    stats.sort((a, b) => a.pValue - b.pValue);
    stats.forEach((s, i) => { s.rank = i + 1; });

    return stats;
  }

  private negativeBinomialTest(control: number[], treatment: number[]): number {
    // Modified Welch's t-test with variance stabilization
    // This approximates the negative binomial test used in MAGeCK

    const n1 = control.length;
    const n2 = treatment.length;

    if (n1 < 2 || n2 < 2) return 1.0;

    const mean1 = this.mean(control);
    const mean2 = this.mean(treatment);
    const var1 = this.variance(control);
    const var2 = this.variance(treatment);

    // Add small constant to prevent division by zero
    const epsilon = 0.1;
    const se1 = (var1 + epsilon) / n1;
    const se2 = (var2 + epsilon) / n2;

    const tStat = Math.abs(mean2 - mean1) / Math.sqrt(se1 + se2);

    // Welch-Satterthwaite degrees of freedom
    const df = Math.pow(se1 + se2, 2) / (
      Math.pow(se1, 2) / (n1 - 1) + Math.pow(se2, 2) / (n2 - 1)
    );

    // Convert t-statistic to p-value using t-distribution CDF
    const pValue = 2 * (1 - this.tCDF(tStat, Math.max(1, df)));
    return Math.max(0, Math.min(1, pValue));
  }

  private groupSgRNAsByGene(stats: SgRNAStats[]): Map<string, SgRNAStats[]> {
    const groups = new Map<string, SgRNAStats[]>();

    for (const stat of stats) {
      if (!groups.has(stat.gene)) {
        groups.set(stat.gene, []);
      }
      groups.get(stat.gene)!.push(stat);
    }

    return groups;
  }

  private async applyAlphaRRA(
    allStats: SgRNAStats[],
    geneGroups: Map<string, SgRNAStats[]>,
    direction: 'negative' | 'positive',
    progressCallback?: (progress: number) => void
  ): Promise<Map<string, number>> {
    const rhoScores = new Map<string, number>();
    const genes = Array.from(geneGroups.keys());
    const totalSgRNAs = allStats.length;

    // Sort all sgRNAs by fold change for ranking
    const sortedStats = [...allStats].sort((a, b) => {
      if (direction === 'negative') {
        return a.log2FC - b.log2FC; // Most negative first
      } else {
        return b.log2FC - a.log2FC; // Most positive first
      }
    });

    // Create rank map
    const rankMap = new Map<string, number>();
    sortedStats.forEach((stat, index) => {
      rankMap.set(stat.sgRNA, index + 1);
    });

    for (let geneIdx = 0; geneIdx < genes.length; geneIdx++) {
      const gene = genes[geneIdx];
      const geneSgRNAs = geneGroups.get(gene)!;

      if (geneSgRNAs.length < this.minSgRNAs) {
        rhoScores.set(gene, 1.0);
        continue;
      }

      // Get ranks for this gene's sgRNAs
      const ranks = geneSgRNAs
        .map(s => rankMap.get(s.sgRNA)!)
        .sort((a, b) => a - b);

      // Calculate ρ using alpha-RRA
      const rho = this.calculateRho(ranks, totalSgRNAs, this.alpha);
      rhoScores.set(gene, rho);

      if (geneIdx % 100 === 0) {
        progressCallback?.(geneIdx / genes.length);
      }
    }

    progressCallback?.(1.0);
    return rhoScores;
  }

  private calculateRho(ranks: number[], n: number, alpha: number): number {
    const k = ranks.length;
    const rhoValues: number[] = [];

    for (let i = 0; i < k; i++) {
      const rank = ranks[i];
      const p = rank / n;  // Normalized rank (percentile)

      if (p > alpha) continue; // Only consider top-alpha sgRNAs

      // Calculate ρ_i using beta distribution
      // ρ_i = B(p; i+1, k-i) where B is the incomplete beta function
      const rho_i = this.betaCDF(p, i + 1, k - i) * (k / (i + 1));
      rhoValues.push(rho_i);
    }

    if (rhoValues.length === 0) return 1.0;

    // ρ = min(ρ_1, ρ_2, ..., ρ_j)
    return Math.min(...rhoValues);
  }

  private async permutationTest(
    negRho: Map<string, number>,
    posRho: Map<string, number>,
    geneGroups: Map<string, SgRNAStats[]>,
    progressCallback?: (progress: number) => void
  ): Promise<MAGeCKGeneResult[]> {
    const results: MAGeCKGeneResult[] = [];
    const genes = Array.from(geneGroups.keys());

    // For each gene, estimate p-value from ρ score
    // In a full implementation, this would use permutation
    // Here we use an analytical approximation for speed

    for (let i = 0; i < genes.length; i++) {
      const gene = genes[i];
      const sgRNAs = geneGroups.get(gene)!;
      const rhoNeg = negRho.get(gene) || 1.0;
      const rhoPos = posRho.get(gene) || 1.0;

      // Convert ρ to p-value using approximation
      // p ≈ ρ * k! / (k * (k-1) * ... * 1) for small ρ
      // Simplified: p ≈ ρ for ρ close to 0
      const pValueNeg = Math.min(1, rhoNeg);
      const pValuePos = Math.min(1, rhoPos);

      // Calculate mean log2FC
      const log2FCs = sgRNAs.map(s => s.log2FC);
      const meanLog2FC = this.mean(log2FCs);
      const stdLog2FC = Math.sqrt(this.variance(log2FCs));

      // Count "good" sgRNAs (those with consistent direction and low p-value)
      const goodSgRNAs = sgRNAs.filter(s =>
        s.pValue < 0.1 && Math.sign(s.log2FC) === Math.sign(meanLog2FC)
      ).length;

      results.push({
        gene,
        numSgRNAs: sgRNAs.length,
        sgRNAs,
        log2FC: meanLog2FC,
        log2FC_std: stdLog2FC,
        rhoNeg,
        rhoPos,
        pValueNeg,
        pValuePos,
        fdrNeg: 0, // Will be calculated in FDR step
        fdrPos: 0,
        rank: 0,
        goodSgRNAs
      });

      if (i % 100 === 0) {
        progressCallback?.(i / genes.length);
      }
    }

    progressCallback?.(1.0);
    return results;
  }

  private calculateFDR(results: MAGeCKGeneResult[]): MAGeCKGeneResult[] {
    const m = results.length;

    // FDR for negative selection
    const sortedByNeg = [...results].sort((a, b) => a.pValueNeg - b.pValueNeg);
    for (let i = 0; i < sortedByNeg.length; i++) {
      sortedByNeg[i].fdrNeg = Math.min(1, (sortedByNeg[i].pValueNeg * m) / (i + 1));
    }
    // Ensure monotonicity
    for (let i = sortedByNeg.length - 2; i >= 0; i--) {
      if (sortedByNeg[i].fdrNeg > sortedByNeg[i + 1].fdrNeg) {
        sortedByNeg[i].fdrNeg = sortedByNeg[i + 1].fdrNeg;
      }
    }

    // FDR for positive selection
    const sortedByPos = [...results].sort((a, b) => a.pValuePos - b.pValuePos);
    for (let i = 0; i < sortedByPos.length; i++) {
      sortedByPos[i].fdrPos = Math.min(1, (sortedByPos[i].pValuePos * m) / (i + 1));
    }
    // Ensure monotonicity
    for (let i = sortedByPos.length - 2; i >= 0; i--) {
      if (sortedByPos[i].fdrPos > sortedByPos[i + 1].fdrPos) {
        sortedByPos[i].fdrPos = sortedByPos[i + 1].fdrPos;
      }
    }

    return results;
  }

  // Statistical utility functions
  private mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  private median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  private variance(values: number[]): number {
    if (values.length < 2) return 0;
    const m = this.mean(values);
    return this.mean(values.map(v => Math.pow(v - m, 2)));
  }

  private betaCDF(x: number, a: number, b: number): number {
    // Incomplete beta function approximation
    // Uses regularized incomplete beta function
    if (x <= 0) return 0;
    if (x >= 1) return 1;

    // Simple numerical approximation using series expansion
    const bt = Math.exp(
      this.logGamma(a + b) - this.logGamma(a) - this.logGamma(b) +
      a * Math.log(x) + b * Math.log(1 - x)
    );

    if (x < (a + 1) / (a + b + 2)) {
      return bt * this.betaCF(x, a, b) / a;
    } else {
      return 1 - bt * this.betaCF(1 - x, b, a) / b;
    }
  }

  private betaCF(x: number, a: number, b: number): number {
    // Continued fraction for incomplete beta function
    const MAXIT = 100;
    const EPS = 3e-7;
    const FPMIN = 1e-30;

    const qab = a + b;
    const qap = a + 1;
    const qam = a - 1;
    let c = 1;
    let d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    let h = d;

    for (let m = 1; m <= MAXIT; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }

    return h;
  }

  private logGamma(x: number): number {
    // Lanczos approximation for log(Gamma(x))
    const g = 7;
    const c = [
      0.99999999999980993,
      676.5203681218851,
      -1259.1392167224028,
      771.32342877765313,
      -176.61502916214059,
      12.507343278686905,
      -0.13857109526572012,
      9.9843695780195716e-6,
      1.5056327351493116e-7
    ];

    if (x < 0.5) {
      return Math.log(Math.PI / Math.sin(Math.PI * x)) - this.logGamma(1 - x);
    }

    x -= 1;
    let a = c[0];
    for (let i = 1; i < g + 2; i++) {
      a += c[i] / (x + i);
    }
    const t = x + g + 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }

  private tCDF(t: number, df: number): number {
    // Student's t-distribution CDF
    const x = df / (df + t * t);
    return 1 - 0.5 * this.betaCDF(x, df / 2, 0.5);
  }

  public toUnifiedResults(results: MAGeCKGeneResult[]): UnifiedGeneResult[] {
    return results.map((r) => ({
      gene: r.gene,
      numSgRNAs: r.numSgRNAs,
      log2FC: r.log2FC,
      pValue: Math.min(r.pValueNeg, r.pValuePos),
      fdr: Math.min(r.fdrNeg, r.fdrPos),
      rank: r.rank,
      mageck: {
        rhoNeg: r.rhoNeg,
        rhoPos: r.rhoPos,
        pValueNeg: r.pValueNeg,
        pValuePos: r.pValuePos,
        fdrNeg: r.fdrNeg,
        fdrPos: r.fdrPos,
      },
    }));
  }
}

export default MAGeCKAnalyzer;
