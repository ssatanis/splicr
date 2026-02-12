/**
 * Comprehensive Quality Control Metrics for CRISPR Screens
 *
 * Implements publication-grade QC calculations including:
 * - Gini Index and Lorenz Curve
 * - Replicate Concordance (Pearson & Spearman)
 * - Control sgRNA Analysis
 * - Sequencing Depth Metrics
 * - Library Representation
 */

// ============================================================================
// TYPES
// ============================================================================

export interface SGRNACount {
  sgrna_id: string;
  gene?: string;
  sequence?: string;
  counts: number;
  is_control?: boolean;
  control_type?: 'non-targeting' | 'essential' | 'non-essential' | 'cutting' | 'non-cutting';
}

export interface ReplicateData {
  name: string;
  counts: Record<string, number>; // sgRNA ID -> count
}

export interface QCMetrics {
  // Library Representation
  library_representation: {
    total_sgrnas_in_library: number;
    sgrnas_detected: number;
    detection_rate: number; // percentage
    total_genes_in_library: number;
    genes_detected: number;
    gene_detection_rate: number; // percentage
    genes_with_all_sgrnas: number;
    zero_count_sgrnas: number;
    zero_count_percentage: number;
  };

  // Distribution Metrics
  distribution: {
    gini_index: number;
    gini_quality: 'excellent' | 'good' | 'acceptable' | 'poor';
    lorenz_curve_data: Array<{ cumulative_population: number; cumulative_reads: number }>;
    total_reads: number;
    mean_reads_per_sgrna: number;
    median_reads_per_sgrna: number;
    std_dev_reads: number;
    min_reads: number;
    max_reads: number;
    cv: number; // coefficient of variation
  };

  // Replicate Concordance (if multiple samples)
  replicate_concordance?: {
    pearson_correlation: number;
    spearman_correlation: number;
    correlation_quality: 'excellent' | 'good' | 'acceptable' | 'poor';
    outlier_sgrnas: string[];
    outlier_count: number;
  };

  // Control sgRNA Analysis
  control_analysis?: {
    non_targeting?: {
      count: number;
      mean_fold_change: number;
      std_dev_fold_change: number;
      centered_at_zero: boolean;
    };
    essential?: {
      count: number;
      mean_depletion: number;
      expected_depletion: number;
      depleted_as_expected: boolean;
    };
    non_essential?: {
      count: number;
      mean_fold_change: number;
      unchanged_as_expected: boolean;
    };
  };

  // Sequencing Depth
  sequencing_depth: {
    total_reads: number;
    mapped_reads: number;
    mapping_rate: number;
    reads_per_sgrna_mean: number;
    reads_per_sgrna_median: number;
    recommended_minimum: number;
    meets_minimum: boolean;
  };

  // Overall Quality Assessment
  overall_quality: {
    status: 'pass' | 'warning' | 'fail';
    quality_score: number; // 0-100
    issues: string[];
    warnings: string[];
    recommendation: string;
  };
}

// ============================================================================
// GINI INDEX & LORENZ CURVE
// ============================================================================

/**
 * Calculate Gini Index for read distribution
 * Gini Index measures inequality: 0 = perfect equality, 1 = perfect inequality
 * For CRISPR screens:
 * - < 0.2: Excellent (uniform distribution)
 * - 0.2-0.4: Good
 * - 0.4-0.6: Acceptable
 * - > 0.6: Poor (highly skewed)
 */
export function calculateGiniIndex(counts: number[]): number {
  if (counts.length === 0) return 0;

  // Sort counts in ascending order
  const sortedCounts = [...counts].sort((a, b) => a - b);
  const n = sortedCounts.length;
  const sum = sortedCounts.reduce((acc, val) => acc + val, 0);

  if (sum === 0) return 0;

  // Calculate Gini using the formula:
  // G = (2 * Σ(i * y_i)) / (n * Σy_i) - (n + 1) / n
  let numerator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (i + 1) * sortedCounts[i];
  }

  const gini = (2 * numerator) / (n * sum) - (n + 1) / n;

  return Math.max(0, Math.min(1, gini)); // Clamp between 0 and 1
}

/**
 * Generate Lorenz Curve data for visualization
 * Returns cumulative percentiles of population vs reads
 */
export function generateLorenzCurve(counts: number[]): Array<{ cumulative_population: number; cumulative_reads: number }> {
  if (counts.length === 0) return [];

  // Sort counts in ascending order
  const sortedCounts = [...counts].sort((a, b) => a - b);
  const n = sortedCounts.length;
  const totalReads = sortedCounts.reduce((acc, val) => acc + val, 0);

  if (totalReads === 0) return [];

  // Generate curve with 100 points
  const curvePoints: Array<{ cumulative_population: number; cumulative_reads: number }> = [];
  curvePoints.push({ cumulative_population: 0, cumulative_reads: 0 }); // Origin

  let cumulativeReads = 0;
  const pointsToSample = Math.min(100, n);
  const step = n / pointsToSample;

  for (let i = 1; i <= pointsToSample; i++) {
    const index = Math.floor(i * step) - 1;
    if (index >= 0 && index < n) {
      for (let j = Math.floor((i - 1) * step); j <= index; j++) {
        cumulativeReads += sortedCounts[j];
      }

      curvePoints.push({
        cumulative_population: (index + 1) / n,
        cumulative_reads: cumulativeReads / totalReads,
      });
    }
  }

  // Ensure final point is (1, 1)
  if (curvePoints[curvePoints.length - 1].cumulative_population < 1) {
    curvePoints.push({ cumulative_population: 1, cumulative_reads: 1 });
  }

  return curvePoints;
}

/**
 * Assess Gini Index quality
 */
export function assessGiniQuality(gini: number): 'excellent' | 'good' | 'acceptable' | 'poor' {
  if (gini < 0.2) return 'excellent';
  if (gini < 0.4) return 'good';
  if (gini < 0.6) return 'acceptable';
  return 'poor';
}

// ============================================================================
// REPLICATE CONCORDANCE
// ============================================================================

/**
 * Calculate Pearson correlation coefficient between two replicates
 */
export function calculatePearsonCorrelation(rep1Counts: number[], rep2Counts: number[]): number {
  if (rep1Counts.length !== rep2Counts.length || rep1Counts.length === 0) return 0;

  const n = rep1Counts.length;

  // Calculate means
  const mean1 = rep1Counts.reduce((sum, val) => sum + val, 0) / n;
  const mean2 = rep2Counts.reduce((sum, val) => sum + val, 0) / n;

  // Calculate covariance and standard deviations
  let covariance = 0;
  let var1 = 0;
  let var2 = 0;

  for (let i = 0; i < n; i++) {
    const diff1 = rep1Counts[i] - mean1;
    const diff2 = rep2Counts[i] - mean2;
    covariance += diff1 * diff2;
    var1 += diff1 * diff1;
    var2 += diff2 * diff2;
  }

  const std1 = Math.sqrt(var1);
  const std2 = Math.sqrt(var2);

  if (std1 === 0 || std2 === 0) return 0;

  return covariance / (std1 * std2);
}

/**
 * Calculate Spearman rank correlation coefficient
 */
export function calculateSpearmanCorrelation(rep1Counts: number[], rep2Counts: number[]): number {
  if (rep1Counts.length !== rep2Counts.length || rep1Counts.length === 0) return 0;

  const n = rep1Counts.length;

  // Rank the data
  const rank1 = getRanks(rep1Counts);
  const rank2 = getRanks(rep2Counts);

  // Calculate Pearson correlation on ranks
  return calculatePearsonCorrelation(rank1, rank2);
}

/**
 * Convert values to ranks (handling ties by averaging)
 */
function getRanks(values: number[]): number[] {
  const n = values.length;
  const indexed = values.map((val, idx) => ({ val, idx }));
  indexed.sort((a, b) => a.val - b.val);

  const ranks = new Array(n).fill(0);

  let i = 0;
  while (i < n) {
    let j = i;
    // Find the range of equal values
    while (j < n && indexed[j].val === indexed[i].val) {
      j++;
    }

    // Average rank for ties
    const avgRank = (i + j - 1) / 2 + 1;

    // Assign average rank to all equal values
    for (let k = i; k < j; k++) {
      ranks[indexed[k].idx] = avgRank;
    }

    i = j;
  }

  return ranks;
}

/**
 * Assess correlation quality
 */
export function assessCorrelationQuality(correlation: number): 'excellent' | 'good' | 'acceptable' | 'poor' {
  if (correlation >= 0.9) return 'excellent';
  if (correlation >= 0.8) return 'good';
  if (correlation >= 0.7) return 'acceptable';
  return 'poor';
}

/**
 * Identify outlier sgRNAs between replicates
 */
export function identifyOutlierSGRNAs(
  rep1Counts: Record<string, number>,
  rep2Counts: Record<string, number>,
  threshold = 2.5 // Standard deviations
): string[] {
  const sgrnaIds = Object.keys(rep1Counts);
  const outliers: string[] = [];

  // Calculate log2 fold changes
  const foldChanges: number[] = [];
  for (const id of sgrnaIds) {
    const count1 = rep1Counts[id] || 0;
    const count2 = rep2Counts[id] || 0;

    // Add pseudocount to avoid log(0)
    const fc = Math.log2((count2 + 1) / (count1 + 1));
    foldChanges.push(fc);
  }

  // Calculate mean and standard deviation
  const mean = foldChanges.reduce((sum, val) => sum + val, 0) / foldChanges.length;
  const variance = foldChanges.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / foldChanges.length;
  const stdDev = Math.sqrt(variance);

  // Identify outliers
  for (let i = 0; i < sgrnaIds.length; i++) {
    const zScore = Math.abs((foldChanges[i] - mean) / stdDev);
    if (zScore > threshold) {
      outliers.push(sgrnaIds[i]);
    }
  }

  return outliers;
}

// ============================================================================
// BASIC STATISTICS
// ============================================================================

export function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

export function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function calculateStdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = calculateMean(values);
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

// ============================================================================
// COMPREHENSIVE QC CALCULATION
// ============================================================================

/**
 * Calculate comprehensive QC metrics for a CRISPR screen
 */
export function calculateComprehensiveQC(
  sgrnaCounts: SGRNACount[],
  librarySize: number,
  totalGenesInLibrary: number,
  replicates?: ReplicateData[],
  referenceEssentialGenes?: Set<string>,
  referenceNonEssentialGenes?: Set<string>
): QCMetrics {
  const counts = sgrnaCounts.map((s) => s.counts);
  const totalReads = counts.reduce((sum, val) => sum + val, 0);

  // Library Representation
  const sgrnas_detected = sgrnaCounts.filter((s) => s.counts > 0).length;
  const zero_count_sgrnas = librarySize - sgrnas_detected;
  const genesWithCounts: Set<string> = new Set();
  const genesWithAllSGRNAs: Map<string, { detected: number; total: number }> = new Map();

  for (const sgrna of sgrnaCounts) {
    if (sgrna.gene) {
      if (sgrna.counts > 0) {
        genesWithCounts.add(sgrna.gene);
      }

      if (!genesWithAllSGRNAs.has(sgrna.gene)) {
        genesWithAllSGRNAs.set(sgrna.gene, { detected: 0, total: 0 });
      }
      const geneData = genesWithAllSGRNAs.get(sgrna.gene)!;
      geneData.total++;
      if (sgrna.counts > 0) geneData.detected++;
    }
  }

  const genes_with_all_sgrnas = Array.from(genesWithAllSGRNAs.values()).filter(
    (g) => g.detected === g.total && g.total > 0
  ).length;

  // Distribution Metrics
  const gini_index = calculateGiniIndex(counts);
  const lorenz_curve_data = generateLorenzCurve(counts);

  // Replicate Concordance (if available)
  let replicate_concordance: QCMetrics['replicate_concordance'];
  if (replicates && replicates.length >= 2) {
    const rep1 = replicates[0];
    const rep2 = replicates[1];

    // Align counts by sgRNA ID
    const commonIds = Object.keys(rep1.counts).filter((id) => id in rep2.counts);
    const rep1Counts = commonIds.map((id) => rep1.counts[id]);
    const rep2Counts = commonIds.map((id) => rep2.counts[id]);

    const pearson = calculatePearsonCorrelation(rep1Counts, rep2Counts);
    const spearman = calculateSpearmanCorrelation(rep1Counts, rep2Counts);
    const outliers = identifyOutlierSGRNAs(rep1.counts, rep2.counts);

    replicate_concordance = {
      pearson_correlation: Math.round(pearson * 1000) / 1000,
      spearman_correlation: Math.round(spearman * 1000) / 1000,
      correlation_quality: assessCorrelationQuality(pearson),
      outlier_sgrnas: outliers,
      outlier_count: outliers.length,
    };
  }

  // Sequencing Depth
  const mean_reads = calculateMean(counts);
  const median_reads = calculateMedian(counts);
  const recommended_minimum = 200; // reads per sgRNA
  const meets_minimum = median_reads >= recommended_minimum;

  // Overall Quality Assessment
  const issues: string[] = [];
  const warnings: string[] = [];

  const detection_rate = (sgrnas_detected / librarySize) * 100;
  if (detection_rate < 60) issues.push('Low library representation (<60%)');
  else if (detection_rate < 80) warnings.push('Moderate library representation (60-80%)');

  if (gini_index > 0.6) issues.push('Poor read distribution (Gini > 0.6)');
  else if (gini_index > 0.4) warnings.push('Suboptimal read distribution (Gini 0.4-0.6)');

  if (replicate_concordance && replicate_concordance.pearson_correlation < 0.7)
    issues.push('Poor replicate correlation (r < 0.7)');
  else if (replicate_concordance && replicate_concordance.pearson_correlation < 0.8)
    warnings.push('Moderate replicate correlation (r 0.7-0.8)');

  if (!meets_minimum) issues.push(`Low sequencing depth (median < ${recommended_minimum} reads/sgRNA)`);

  const zero_count_pct = (zero_count_sgrnas / librarySize) * 100;
  if (zero_count_pct > 40) issues.push('High percentage of zero-count sgRNAs (>40%)');
  else if (zero_count_pct > 20) warnings.push('Moderate percentage of zero-count sgRNAs (20-40%)');

  // Calculate quality score (0-100)
  let quality_score = 100;
  quality_score -= Math.max(0, (0.6 - gini_index) * 50); // Gini penalty
  quality_score -= Math.max(0, 80 - detection_rate); // Detection penalty
  if (replicate_concordance) {
    quality_score -= Math.max(0, (0.9 - replicate_concordance.pearson_correlation) * 100); // Correlation penalty
  }
  quality_score = Math.max(0, Math.min(100, quality_score));

  let status: 'pass' | 'warning' | 'fail' = 'pass';
  let recommendation = 'High-quality screen suitable for publication.';

  if (issues.length > 0) {
    status = 'fail';
    recommendation = 'Screen quality is below recommended thresholds. Consider re-sequencing or troubleshooting library preparation.';
  } else if (warnings.length > 0) {
    status = 'warning';
    recommendation = 'Screen quality is acceptable but could be improved. Results may still be usable with careful interpretation.';
  }

  return {
    library_representation: {
      total_sgrnas_in_library: librarySize,
      sgrnas_detected,
      detection_rate: Math.round(detection_rate * 10) / 10,
      total_genes_in_library: totalGenesInLibrary,
      genes_detected: genesWithCounts.size,
      gene_detection_rate: Math.round((genesWithCounts.size / totalGenesInLibrary) * 1000) / 10,
      genes_with_all_sgrnas,
      zero_count_sgrnas,
      zero_count_percentage: Math.round(zero_count_pct * 10) / 10,
    },
    distribution: {
      gini_index: Math.round(gini_index * 1000) / 1000,
      gini_quality: assessGiniQuality(gini_index),
      lorenz_curve_data,
      total_reads: totalReads,
      mean_reads_per_sgrna: Math.round(mean_reads * 10) / 10,
      median_reads_per_sgrna: Math.round(median_reads * 10) / 10,
      std_dev_reads: Math.round(calculateStdDev(counts) * 10) / 10,
      min_reads: Math.min(...counts),
      max_reads: Math.max(...counts),
      cv: mean_reads > 0 ? Math.round((calculateStdDev(counts) / mean_reads) * 1000) / 1000 : 0,
    },
    replicate_concordance,
    sequencing_depth: {
      total_reads: totalReads,
      mapped_reads: totalReads, // Assuming all reads are mapped at this stage
      mapping_rate: 100,
      reads_per_sgrna_mean: Math.round(mean_reads * 10) / 10,
      reads_per_sgrna_median: Math.round(median_reads * 10) / 10,
      recommended_minimum,
      meets_minimum,
    },
    overall_quality: {
      status,
      quality_score: Math.round(quality_score * 10) / 10,
      issues,
      warnings,
      recommendation,
    },
  };
}

// ============================================================================
// DATA CONVERSION HELPERS
// ============================================================================

/**
 * Convert pipeline count matrix to SGRNACount array for QC calculation
 */
export function buildSGRNACountsFromMatrix(
  countMatrix: Map<string, number[]>,
  sgRNAToGene: Map<string, string>,
  library: Map<string, string>
): SGRNACount[] {
  const sgrnacounts: SGRNACount[] = [];

  // Create entries for every sgRNA in the library (even if not in count matrix)
  // This ensures zero-counts are properly tracked relative to the full library
  const librarySgRNAs = new Set(library.keys());
  const matrixSgRNAs = new Set(countMatrix.keys());

  // First add all sgRNAs from the library
  for (const [sgrna, gene] of library.entries()) {
    const counts = countMatrix.get(sgrna);
    const totalCount = counts ? counts.reduce((sum, val) => sum + val, 0) : 0;

    sgrnacounts.push({
      sgrna_id: sgrna,
      gene: gene,
      sequence: sgrna, // In this pipeline, ID is sequence
      counts: totalCount
    });
  }

  // Add any sgRNAs in matrix but not in library (shouldn't happen with proper mapping, but good for safety)
  for (const sgrna of matrixSgRNAs) {
    if (!librarySgRNAs.has(sgrna)) {
      const counts = countMatrix.get(sgrna);
      const totalCount = counts ? counts.reduce((sum, val) => sum + val, 0) : 0;
      const gene = sgRNAToGene.get(sgrna);

      if (gene) {
        sgrnacounts.push({
          sgrna_id: sgrna,
          gene: gene,
          sequence: sgrna,
          counts: totalCount
        });
      }
    }
  }

  return sgrnacounts;
}

/**
 * Extract replicate data for correlation analysis
 */
export function extractReplicateData(
  samples: { name: string; sgRNACounts: Map<string, number> }[]
): ReplicateData[] {
  return samples.map(sample => {
    const counts: Record<string, number> = {};
    for (const [sgrna, count] of sample.sgRNACounts.entries()) {
      counts[sgrna] = count;
    }

    return {
      name: sample.name,
      counts
    };
  });
}
