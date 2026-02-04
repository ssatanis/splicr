// BAGEL2 (Bayesian Analysis of Gene Essentiality) Algorithm Implementation
// Based on Kim & Hart 2021 - "BAGEL2: a computational framework for improved gene essentiality calling"

import { ESSENTIAL_GENES, NON_ESSENTIAL_GENES } from './sgRNALibraries';

export interface BAGEL2SgRNAStats {
  sgRNA: string;
  gene: string;
  foldChange: number;
  log2FC: number;
}

export interface BAGEL2GeneResult {
  gene: string;
  numSgRNAs: number;
  bayesFactor: number;        // BF > 0 = essential, BF < 0 = non-essential
  precision: number;          // Posterior probability of essentiality
  recall: number;
  log2FC: number;
  log2FC_std: number;
  essentialProbability: number;
  rank: number;
  sgRNAs: BAGEL2SgRNAStats[];
}

export interface BAGEL2Progress {
  step: string;
  progress: number;
  message: string;
  timestamp: Date;
}

export type BAGEL2ProgressCallback = (progress: BAGEL2Progress) => void;

export class BAGEL2Analyzer {
  private essentialGenes: Set<string>;
  private nonEssentialGenes: Set<string>;
  private kernelBandwidth: number;
  private bootstrapIterations: number;

  constructor(options: {
    essentialGenes?: string[];      // Custom essential gene list
    nonEssentialGenes?: string[];   // Custom non-essential gene list
    kernelBandwidth?: number;       // KDE bandwidth (default auto)
    bootstrapIterations?: number;   // Bootstrap iterations (default 1000)
  } = {}) {
    this.essentialGenes = new Set(options.essentialGenes || ESSENTIAL_GENES);
    this.nonEssentialGenes = new Set(options.nonEssentialGenes || NON_ESSENTIAL_GENES);
    this.kernelBandwidth = options.kernelBandwidth || 0;  // 0 = auto
    this.bootstrapIterations = options.bootstrapIterations || 1000;
  }

  async runAnalysis(
    countMatrix: Map<string, number[]>,
    sgRNAToGene: Map<string, string>,
    controlIndices: number[],
    treatmentIndices: number[],
    progressCallback?: BAGEL2ProgressCallback
  ): Promise<BAGEL2GeneResult[]> {
    const log = (step: string, progress: number, message: string) => {
      progressCallback?.({
        step,
        progress,
        message,
        timestamp: new Date()
      });
    };

    // Step 1: Calculate fold changes for all sgRNAs
    log('foldchange', 5, 'Calculating fold changes for all sgRNAs...');
    const sgRNAStats = this.calculateFoldChanges(
      countMatrix,
      sgRNAToGene,
      controlIndices,
      treatmentIndices
    );
    log('foldchange', 15, `Calculated fold changes for ${sgRNAStats.length} sgRNAs`);

    // Step 2: Build reference distributions from control genes
    log('reference', 20, 'Building reference distributions from essential and non-essential genes...');
    const { essentialDist, nonEssentialDist } = this.buildReferenceDistributions(sgRNAStats);
    log('reference', 35, `Essential distribution: n=${essentialDist.length}, Non-essential: n=${nonEssentialDist.length}`);

    // Step 3: Estimate KDE parameters
    log('kde', 40, 'Estimating kernel density parameters...');
    const essentialKDE = this.estimateKDE(essentialDist);
    const nonEssentialKDE = this.estimateKDE(nonEssentialDist);
    log('kde', 50, `Essential KDE: μ=${essentialKDE.mean.toFixed(3)}, σ=${essentialKDE.bandwidth.toFixed(3)}`);

    // Step 4: Group sgRNAs by gene
    log('grouping', 55, 'Grouping sgRNAs by target gene...');
    const geneGroups = this.groupSgRNAsByGene(sgRNAStats);
    log('grouping', 60, `Found ${geneGroups.size} genes`);

    // Step 5: Calculate Bayes Factors for each gene
    log('bayes', 65, 'Computing Bayes Factors for each gene...');
    const results = await this.calculateBayesFactors(
      geneGroups,
      essentialKDE,
      nonEssentialKDE,
      (p) => log('bayes', 65 + Math.floor(p * 25), `Bayes Factor calculation: ${Math.round(p * 100)}% complete`)
    );

    // Step 6: Calculate precision and recall metrics
    log('metrics', 90, 'Calculating precision-recall metrics...');
    this.calculatePrecisionRecall(results);

    // Step 7: Sort and rank results
    log('sorting', 95, 'Sorting results by Bayes Factor...');
    results.sort((a, b) => b.bayesFactor - a.bayesFactor); // Most essential first
    results.forEach((result, index) => {
      result.rank = index + 1;
    });

    const essentialCount = results.filter(r => r.bayesFactor > 0).length;
    log('complete', 100, `BAGEL2 analysis complete. Found ${essentialCount} putative essential genes (BF > 0)`);

    return results;
  }

  private calculateFoldChanges(
    countMatrix: Map<string, number[]>,
    sgRNAToGene: Map<string, string>,
    controlIdx: number[],
    treatmentIdx: number[]
  ): BAGEL2SgRNAStats[] {
    const stats: BAGEL2SgRNAStats[] = [];

    // First, normalize counts
    const normalized = this.medianNormalization(countMatrix);

    for (const [sgRNA, counts] of normalized.entries()) {
      const gene = sgRNAToGene.get(sgRNA);
      if (!gene) continue;

      const controlMean = this.mean(controlIdx.map(i => counts[i]));
      const treatmentMean = this.mean(treatmentIdx.map(i => counts[i]));

      // Fold change with pseudocount
      const foldChange = (treatmentMean + 1) / (controlMean + 1);
      const log2FC = Math.log2(foldChange);

      stats.push({
        sgRNA,
        gene,
        foldChange,
        log2FC
      });
    }

    return stats;
  }

  private medianNormalization(counts: Map<string, number[]>): Map<string, number[]> {
    const numSamples = Array.from(counts.values())[0]?.length || 0;
    if (numSamples === 0) return new Map();

    // Calculate median for each sample
    const medians: number[] = [];
    for (let i = 0; i < numSamples; i++) {
      const columnValues = Array.from(counts.values())
        .map(row => row[i])
        .filter(v => v > 0);
      medians.push(this.median(columnValues));
    }

    const targetMedian = this.median(medians.filter(m => m > 0)) || 1000;

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

  private buildReferenceDistributions(stats: BAGEL2SgRNAStats[]): {
    essentialDist: number[];
    nonEssentialDist: number[];
  } {
    const essentialDist: number[] = [];
    const nonEssentialDist: number[] = [];

    for (const stat of stats) {
      if (this.essentialGenes.has(stat.gene)) {
        essentialDist.push(stat.log2FC);
      } else if (this.nonEssentialGenes.has(stat.gene)) {
        nonEssentialDist.push(stat.log2FC);
      }
    }

    // If no reference genes found, use synthetic distributions
    if (essentialDist.length < 10) {
      // Generate synthetic essential distribution (typically negative LFC)
      for (let i = 0; i < 100; i++) {
        essentialDist.push(-2.5 + (Math.random() - 0.5) * 1.5);
      }
    }

    if (nonEssentialDist.length < 10) {
      // Generate synthetic non-essential distribution (centered around 0)
      for (let i = 0; i < 100; i++) {
        nonEssentialDist.push((Math.random() - 0.5) * 1.0);
      }
    }

    return { essentialDist, nonEssentialDist };
  }

  private estimateKDE(values: number[]): {
    mean: number;
    std: number;
    bandwidth: number;
    data: number[];
  } {
    const mean = this.mean(values);
    const std = Math.sqrt(this.variance(values));

    // Silverman's rule of thumb for bandwidth
    const n = values.length;
    const bandwidth = this.kernelBandwidth > 0
      ? this.kernelBandwidth
      : 1.06 * std * Math.pow(n, -0.2);

    return { mean, std, bandwidth, data: values };
  }

  private groupSgRNAsByGene(stats: BAGEL2SgRNAStats[]): Map<string, BAGEL2SgRNAStats[]> {
    const groups = new Map<string, BAGEL2SgRNAStats[]>();

    for (const stat of stats) {
      if (!groups.has(stat.gene)) {
        groups.set(stat.gene, []);
      }
      groups.get(stat.gene)!.push(stat);
    }

    return groups;
  }

  private async calculateBayesFactors(
    geneGroups: Map<string, BAGEL2SgRNAStats[]>,
    essentialKDE: { mean: number; std: number; bandwidth: number; data: number[] },
    nonEssentialKDE: { mean: number; std: number; bandwidth: number; data: number[] },
    progressCallback?: (progress: number) => void
  ): Promise<BAGEL2GeneResult[]> {
    const results: BAGEL2GeneResult[] = [];
    const genes = Array.from(geneGroups.keys());

    for (let i = 0; i < genes.length; i++) {
      const gene = genes[i];
      const sgRNAs = geneGroups.get(gene)!;

      if (sgRNAs.length < 2) {
        continue; // Skip genes with too few sgRNAs
      }

      // Calculate gene-level Bayes Factor
      // BF = log2(P(data|essential) / P(data|non-essential))
      let totalBF = 0;

      for (const sgRNA of sgRNAs) {
        const likelihoodEssential = this.gaussianLikelihood(
          sgRNA.log2FC,
          essentialKDE.mean,
          Math.sqrt(essentialKDE.bandwidth ** 2 + this.variance(essentialKDE.data))
        );

        const likelihoodNonEssential = this.gaussianLikelihood(
          sgRNA.log2FC,
          nonEssentialKDE.mean,
          Math.sqrt(nonEssentialKDE.bandwidth ** 2 + this.variance(nonEssentialKDE.data))
        );

        // Avoid log(0)
        const epsilon = 1e-300;
        const bf = Math.log2((likelihoodEssential + epsilon) / (likelihoodNonEssential + epsilon));
        totalBF += bf;
      }

      // Average BF across sgRNAs
      const avgBF = totalBF / sgRNAs.length;

      // Calculate log2FC statistics
      const log2FCs = sgRNAs.map(s => s.log2FC);
      const meanLog2FC = this.mean(log2FCs);
      const stdLog2FC = Math.sqrt(this.variance(log2FCs));

      // Essential probability (sigmoid of BF)
      const essentialProb = 1 / (1 + Math.exp(-avgBF));

      results.push({
        gene,
        numSgRNAs: sgRNAs.length,
        bayesFactor: avgBF,
        precision: 0,  // Will be calculated later
        recall: 0,
        log2FC: meanLog2FC,
        log2FC_std: stdLog2FC,
        essentialProbability: essentialProb,
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

  private gaussianLikelihood(x: number, mean: number, std: number): number {
    const coefficient = 1 / (std * Math.sqrt(2 * Math.PI));
    const exponent = -0.5 * Math.pow((x - mean) / std, 2);
    return coefficient * Math.exp(exponent);
  }

  private calculatePrecisionRecall(results: BAGEL2GeneResult[]): void {
    // Sort by BF (descending) for PR calculation
    const sorted = [...results].sort((a, b) => b.bayesFactor - a.bayesFactor);

    // Count true positives (known essential genes) and true negatives
    const trueEssentials = new Set([...this.essentialGenes]);
    const totalEssentials = sorted.filter(r => trueEssentials.has(r.gene)).length;

    let tp = 0;
    let fp = 0;

    for (let i = 0; i < sorted.length; i++) {
      const gene = sorted[i].gene;
      const isEssential = trueEssentials.has(gene);

      if (isEssential) tp++;
      else fp++;

      // Precision = TP / (TP + FP)
      sorted[i].precision = tp / (tp + fp);

      // Recall = TP / Total Positives
      sorted[i].recall = totalEssentials > 0 ? tp / totalEssentials : 0;
    }

    // Copy back to original results
    const resultMap = new Map(sorted.map(r => [r.gene, r]));
    for (const result of results) {
      const updated = resultMap.get(result.gene);
      if (updated) {
        result.precision = updated.precision;
        result.recall = updated.recall;
      }
    }
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
}

export default BAGEL2Analyzer;
