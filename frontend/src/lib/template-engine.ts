/**
 * Template engine: replace placeholders in TipTap content with analysis data
 */

import type { TipTapDoc, TipTapNode, AnalysisContextForReport } from '@/types/report';

const PLACEHOLDER_KEYS: Record<string, keyof AnalysisContextForReport> = {
  library_name: 'libraryName',
  analysis_method: 'method',
  gene_count: 'totalGenes',
  sgrna_count: 'totalGenes',
  sgrnas_per_gene: 'totalGenes',
  fdr_threshold: 'fdrThreshold',
  lfc_threshold: 'lfcThreshold',
  analysis_name: 'analysisName',
  significant_hits: 'significantHits',
  enriched: 'enriched',
  depleted: 'depleted',
  created_date: 'createdDate',
  completed_date: 'completedDate',
  sample_count: 'sampleCount',
  sample_names: 'sampleNames',
  control_samples: 'controlSamples',
  treatment_samples: 'treatmentSamples',
  total_reads: 'totalReads',
  mapping_rate: 'mappingRate',
  library_coverage: 'libraryCoverage',
  zero_counts: 'zeroCounts',
  gini_coefficient: 'giniCoefficient',
  normalization_method: 'normalizationMethod',
  minimum_reads: 'minimumReads',
  results_source: 'resultsSource',
};

export function fillPlaceholders(
  doc: TipTapDoc,
  data: Partial<AnalysisContextForReport>
): TipTapDoc {
  if (!doc.content) return doc;

  const replace = (node: TipTapNode): TipTapNode => {
    if (node.type === 'text' && 'text' in node && node.text) {
      let text = (node as { type: 'text'; text: string }).text;
      for (const [placeholder, key] of Object.entries(PLACEHOLDER_KEYS)) {
        const value = data[key as keyof AnalysisContextForReport];
        if (value !== undefined) {
          const regex = new RegExp(`\\{\\{${placeholder}\\}\\}`, 'gi');
          text = text.replace(regex, String(value));
        }
      }
      // Generic {{key}} from data
      for (const [k, v] of Object.entries(data)) {
        const regex = new RegExp(`\\{\\{${k}\\}\\}`, 'gi');
        if (typeof v === 'string' || typeof v === 'number') {
          text = text.replace(regex, String(v));
        }
      }
      return { ...node, text };
    }
    if ('content' in node && Array.isArray(node.content)) {
      return {
        ...node,
        content: node.content.map(replace),
      };
    }
    return node;
  };

  return {
    ...doc,
    content: doc.content.map(replace),
  };
}

export function getDefaultAnalysisContext(): AnalysisContextForReport {
  return {
    analysisName: 'Screen Analysis',
    libraryName: 'Brunello',
    method: 'MAGeCK',
    totalGenes: 0,
    significantHits: 0,
    enriched: 0,
    depleted: 0,
    fdrThreshold: 0.05,
    lfcThreshold: 1.0,
    topDepleted: [],
    topEnriched: [],
    createdDate: new Date().toLocaleDateString(),
    completedDate: new Date().toLocaleDateString(),
    sampleCount: 0,
    sampleNames: 'N/A',
    controlSamples: 'N/A',
    treatmentSamples: 'N/A',
    totalReads: 'N/A',
    mappingRate: 'N/A',
    libraryCoverage: 'N/A',
    zeroCounts: 'N/A',
    giniCoefficient: 'N/A',
    normalizationMethod: 'median',
    minimumReads: 30,
    resultsSource: 'pipeline',
  };
}
