/**
 * CSV Export Utilities
 *
 * Functions to export analysis results to CSV format
 */

export interface SgRNAResult {
  sequence: string;
  gene: string;
  geneId?: string;
  count: number;
  rpm: number;
}

export interface GeneResult {
  gene: string;
  geneId?: string;
  totalReads: number;
  sgRNACount: number;
  avgReadsPerSgRNA: number;
  rpm: number;
}

export interface UnmatchedResult {
  sequence: string;
  count: number;
  rpm: number;
}

/**
 * Convert array of objects to CSV string
 */
function arrayToCSV(data: Record<string, any>[], headers: string[]): string {
  const csvRows: string[] = [];

  // Add header row
  csvRows.push(headers.join(','));

  // Add data rows
  for (const row of data) {
    const values = headers.map(header => {
      const value = row[header];
      // Escape quotes and wrap in quotes if contains comma
      if (value === undefined || value === null) return '';
      const stringValue = String(value);
      if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
    });
    csvRows.push(values.join(','));
  }

  return csvRows.join('\n');
}

/**
 * Download CSV file
 */
function downloadCSV(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');

  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}

/**
 * Export sgRNA results to CSV
 */
export function exportSgRNAResults(results: SgRNAResult[], libraryName: string): void {
  const data = results.map(r => ({
    Sequence: r.sequence,
    Gene: r.gene,
    GeneID: r.geneId || '',
    ReadCount: r.count,
    RPM: r.rpm.toFixed(2),
  }));

  const csv = arrayToCSV(data, ['Sequence', 'Gene', 'GeneID', 'ReadCount', 'RPM']);
  const filename = `sgrna_results_${libraryName}_${new Date().toISOString().split('T')[0]}.csv`;

  downloadCSV(csv, filename);
}

/**
 * Export gene results to CSV
 */
export function exportGeneResults(results: GeneResult[], libraryName: string): void {
  const data = results.map(r => ({
    Gene: r.gene,
    GeneID: r.geneId || '',
    TotalReads: r.totalReads,
    SgRNACount: r.sgRNACount,
    AvgReadsPerSgRNA: r.avgReadsPerSgRNA.toFixed(2),
    RPM: r.rpm.toFixed(2),
  }));

  const csv = arrayToCSV(data, ['Gene', 'GeneID', 'TotalReads', 'SgRNACount', 'AvgReadsPerSgRNA', 'RPM']);
  const filename = `gene_results_${libraryName}_${new Date().toISOString().split('T')[0]}.csv`;

  downloadCSV(csv, filename);
}

/**
 * Export unmatched sequences to CSV
 */
export function exportUnmatchedSequences(results: UnmatchedResult[], libraryName: string): void {
  const data = results.map(r => ({
    Sequence: r.sequence,
    ReadCount: r.count,
    RPM: r.rpm.toFixed(2),
  }));

  const csv = arrayToCSV(data, ['Sequence', 'ReadCount', 'RPM']);
  const filename = `unmatched_sequences_${libraryName}_${new Date().toISOString().split('T')[0]}.csv`;

  downloadCSV(csv, filename);
}

/**
 * Export complete analysis summary to CSV
 */
export function exportAnalysisSummary(
  summary: {
    totalReads: number;
    matchedReads: number;
    unmatchedReads: number;
    matchRate: number;
    uniqueSgRNAs: number;
    genesDetected: number;
    libraryCoverage: number;
  },
  qc: {
    matchRate: number;
    matchRateQuality: string;
    libraryCoverage: number;
    libraryQuality: string;
    zeroCountSgRNAs: number;
    zeroCountPercentage: number;
    giniCoefficient: number;
    overallQuality: string;
    recommendation: string;
  },
  library: {
    name: string;
    organism: string;
    type: string;
  },
  fileName: string
): void {
  const data = [
    { Metric: 'Library', Value: library.name },
    { Metric: 'Organism', Value: library.organism },
    { Metric: 'Library Type', Value: library.type },
    { Metric: '', Value: '' },
    { Metric: 'Total Reads', Value: summary.totalReads },
    { Metric: 'Matched Reads', Value: summary.matchedReads },
    { Metric: 'Unmatched Reads', Value: summary.unmatchedReads },
    { Metric: 'Match Rate (%)', Value: summary.matchRate.toFixed(2) },
    { Metric: 'Unique sgRNAs', Value: summary.uniqueSgRNAs },
    { Metric: 'Genes Detected', Value: summary.genesDetected },
    { Metric: 'Library Coverage (%)', Value: summary.libraryCoverage.toFixed(2) },
    { Metric: '', Value: '' },
    { Metric: 'QC - Match Rate Quality', Value: qc.matchRateQuality },
    { Metric: 'QC - Library Coverage Quality', Value: qc.libraryQuality },
    { Metric: 'QC - Zero-Count sgRNAs', Value: qc.zeroCountSgRNAs },
    { Metric: 'QC - Zero-Count %', Value: qc.zeroCountPercentage.toFixed(2) },
    { Metric: 'QC - Gini Coefficient', Value: qc.giniCoefficient.toFixed(3) },
    { Metric: 'QC - Overall Quality', Value: qc.overallQuality },
    { Metric: 'QC - Recommendation', Value: qc.recommendation },
  ];

  const csv = arrayToCSV(data, ['Metric', 'Value']);
  const filename = `analysis_summary_${fileName}_${new Date().toISOString().split('T')[0]}.csv`;

  downloadCSV(csv, filename);
}
