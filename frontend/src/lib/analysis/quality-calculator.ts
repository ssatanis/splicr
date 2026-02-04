/**
 * Real quality control assessment for CRISPR screen results.
 * Part 4 of the real sequencing implementation: PASS/WARNING/FAIL and recommendations.
 * Uses actual metrics from the pipeline (mapping rate, coverage, Gini, zero counts, depth).
 */

export interface QualityMetricsInput {
  totalReads: number;
  mappedReads?: number;
  mappingRate: number; // 0-100 when from DB, 0-1 when from pipeline
  libraryCoverage: number; // 0-100 when from DB, 0-1 when from pipeline
  zeroCounts: number; // 0-100 (percentage)
  giniCoefficient?: number; // 0-1
  /** Total sgRNAs in library (optional; used for sufficient-depth check). */
  librarySize?: number;
  /** Number of sgRNAs in count matrix (optional fallback for depth). */
  sgRNAsDetected?: number;
}

export interface QCAssessment {
  status: 'PASS' | 'WARNING' | 'FAIL';
  issues: string[];
  recommendations: string[];
}

/**
 * Assess overall QC status from real metrics.
 * Different files → different metrics → different status (no fake data).
 */
export function assessQCStatus(metrics: QualityMetricsInput): QCAssessment {
  const issues: string[] = [];
  const recommendations: string[] = [];

  const mappingRatePct = metrics.mappingRate <= 1 ? metrics.mappingRate * 100 : metrics.mappingRate;
  const coveragePct = metrics.libraryCoverage <= 1 ? metrics.libraryCoverage * 100 : metrics.libraryCoverage;
  const gini = metrics.giniCoefficient ?? 0;

  // Coverage
  if (coveragePct < 60) {
    issues.push(`Low library coverage: ${coveragePct.toFixed(1)}%`);
    recommendations.push('Increase sequencing depth or check library quality');
  } else if (coveragePct < 80) {
    issues.push(`Moderate library coverage: ${coveragePct.toFixed(1)}%`);
  }

  // Gini (inequality in read distribution)
  if (gini > 0.4) {
    issues.push(`High Gini coefficient: ${gini.toFixed(3)} (poor uniformity)`);
    recommendations.push('Consider re-amplifying library with fewer PCR cycles');
  } else if (gini > 0.2) {
    issues.push(`Moderate Gini coefficient: ${gini.toFixed(3)}`);
  }

  // Zero counts
  if (metrics.zeroCounts > 20) {
    issues.push(`High zero-count percentage: ${metrics.zeroCounts.toFixed(1)}%`);
    recommendations.push('Increase sequencing depth or check for bottlenecks');
  }

  // Sequencing depth (reads per sgRNA)
  const librarySize = metrics.librarySize ?? metrics.sgRNAsDetected;
  const mappedReads = metrics.mappedReads ?? Math.round((metrics.totalReads * mappingRatePct) / 100);
  if (librarySize != null && librarySize > 0) {
    const readsPerSgRNA = mappedReads / librarySize;
    if (readsPerSgRNA < 200) {
      issues.push(
        `Insufficient sequencing depth: ${readsPerSgRNA.toFixed(0)} reads/sgRNA (recommended: ≥200)`
      );
      recommendations.push('Increase sequencing depth for more reliable results');
    }
  }

  // Mapping rate
  if (mappingRatePct < 70) {
    issues.push(`Low mapping rate: ${mappingRatePct.toFixed(1)}%`);
    recommendations.push('Check adapter sequence and library design');
  }

  let status: QCAssessment['status'];
  if (coveragePct < 60 || gini > 0.4 || (librarySize != null && librarySize > 0 && mappedReads / librarySize < 200)) {
    status = 'FAIL';
  } else if (issues.length > 0) {
    status = 'WARNING';
  } else {
    status = 'PASS';
  }

  return { status, issues, recommendations };
}
