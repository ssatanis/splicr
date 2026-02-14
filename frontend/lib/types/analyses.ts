/**
 * TypeScript types for TEA and TxScore analyses
 */

// ============================================================================
// TEA Types
// ============================================================================

export type SequenceSource = 'manual' | 'fasta' | 'genbank' | 'vcf' | 'clinvar' | 'dbsnp';

export type AnalysisStatus = 'created' | 'running' | 'complete' | 'failed' | 'cancelled';

export interface TEAAnalysis {
  id: string;
  user_id: string;
  name: string;
  sequence: string;
  sequence_length: number;
  sequence_source: SequenceSource;
  variant_id?: string;
  status: AnalysisStatus;
  progress: number;
  current_step: string;
  parameters: Record<string, any>;
  results?: TEAResults;
  edit_score?: number;
  base_editor_feasible?: boolean;
  prime_editor_feasible?: boolean;
  error_message?: string;
  file_name?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export interface TEAResults {
  edit_score: number;
  efficiency: {
    efficiency_score: number;
    base_editable: boolean;
    prime_editable: boolean;
    recommended_editor: string;
  };
  window: {
    window_score: number;
    classification: string;
    disease_selectivity: number;
    normal_tissue_expression: number;
  };
  off_targets: {
    off_target_count: number;
    max_off_target_score: number;
    risk_level: 'low' | 'moderate' | 'high';
  };
  chromatin: {
    accessibility_score: number;
    tissue_scores: Array<{
      tissue: string;
      score: number;
    }>;
  };
  deliverability: {
    method: string;
    estimated_efficiency: number;
  };
}

// ============================================================================
// TxScore Types
// ============================================================================

export type GeneSource = 'manual' | 'csv' | 'tsv' | 'txt' | 'xlsx' | 'screen_import';

export interface TxScoreAnalysis {
  id: string;
  user_id: string;
  name: string;
  gene_list: string[];
  gene_count: number;
  gene_source: GeneSource;
  source_analysis_id?: string;
  status: AnalysisStatus;
  progress: number;
  current_step: string;
  parameters: Record<string, any>;
  filters: Record<string, any>;
  results?: TxScoreResults;
  top_target?: string;
  average_tvs?: number;
  error_message?: string;
  file_name?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export interface TxScoreResults {
  gene_rankings: Array<{
    gene_symbol: string;
    tvs: number; // Therapeutic Viability Score
    rank: number;
    essentiality_score: number;
    druggability_score: number;
    clinical_evidence_score: number;
    safety_score: number;
  }>;
  summary: {
    total_genes: number;
    high_priority_count: number; // TVS > 70
    medium_priority_count: number; // TVS 40-70
    low_priority_count: number; // TVS < 40
    average_tvs: number;
    top_target: string;
  };
  filters_applied: Record<string, any>;
}

// ============================================================================
// Upload Types
// ============================================================================

export interface SequenceUpload {
  source: SequenceSource;
  sequence?: string;
  file?: File;
  variant_id?: string;
  name?: string;
}

export interface GeneListUpload {
  source: GeneSource;
  genes?: string[];
  file?: File;
  source_analysis_id?: string;
  name?: string;
}

// ============================================================================
// Parser Results
// ============================================================================

export interface ParsedSequence {
  sequence: string;
  length: number;
  metadata?: {
    id?: string;
    description?: string;
    source?: string;
  };
}

export interface ParsedGeneList {
  genes: string[];
  invalid_genes?: string[];
  duplicates?: string[];
  metadata?: {
    source_file?: string;
    row_count?: number;
  };
}

// ============================================================================
// API Response Types
// ============================================================================

export interface CreateTEAAnalysisRequest {
  name: string;
  sequence: string;
  sequence_source: SequenceSource;
  variant_id?: string;
  file_name?: string;
  parameters?: Record<string, any>;
}

export interface CreateTEAAnalysisResponse {
  analysis: TEAAnalysis;
  url: string; // /tea/results/[id]
}

export interface CreateTxScoreAnalysisRequest {
  name: string;
  gene_list: string[];
  gene_source: GeneSource;
  source_analysis_id?: string;
  file_name?: string;
  parameters?: Record<string, any>;
  filters?: Record<string, any>;
}

export interface CreateTxScoreAnalysisResponse {
  analysis: TxScoreAnalysis;
  url: string; // /txscore/results/[id]
}
