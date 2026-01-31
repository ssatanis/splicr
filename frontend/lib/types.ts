/**
 * Type definitions for SplicR
 */

export type AnalysisStatus = "created" | "pending" | "queued" | "running" | "complete" | "failed" | "cancelled";

export type Algorithm = "mageck" | "bagel2" | "drugz";

export type LibraryType = "brunello" | "gecko-v2" | "tko-v3" | "brie" | "custom";

export interface SampleLabel {
  fileName: string;
  fileId: string;
  sampleName: string;
  condition: "treatment" | "control";
  replicate: number;
}

export interface AnalysisParameters {
  fdrThreshold: number;
  lfcThreshold: number;
  normalizationMethod: "median" | "total" | "control" | "none";
  removeRibosomal: boolean;
  minimumReads: number;
  essentialGenes: string;
  nonEssentialGenes: string;
  runCNVCorrection: boolean;
  generatePlots: boolean;
  calculateCorrelations: boolean;
  exportIntermediateFiles: boolean;
  bagelPermutations: number;
}

export interface Analysis {
  id: string;
  name: string;
  status: AnalysisStatus;
  algorithm: Algorithm[];
  libraryType: LibraryType;
  fileKeys: string[];
  sampleLabels: SampleLabel[];
  parameters: AnalysisParameters;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  progress: number;
  currentStep?: string;
  errorMessage?: string;
  logs?: { timestamp: string; step: string; message: string; progress: number; level: string }[];
  resultsPath?: string;
  thumbnailPath?: string;
  userId?: string;
}

export interface VolcanoDataPoint {
  gene: string;
  log2FC: number;
  negLog10P: number;
  fdr: number;
  isSignificant: boolean;
}

export interface QCMetrics {
  totalReads: number;
  mappingRate: number;
  zeroCounts: number;
  libraryCoverage: number;
  giniCoefficient?: number;
  correlations?: number[][];
  sampleStats?: Array<{
    name: string;
    totalReads: number;
    uniqueSgRNAs?: number;
    mappingRate?: number | string;
    avgQuality?: string;
    gcContent?: string;
  }>;
}

export interface GeneResult {
  gene: string;
  sgrnaCount: number;
  logFoldChange: number;
  pValue: number;
  fdr: number;
  rank: number;
}

export interface AnalysisResults {
  id: string;
  summary: {
    totalGenes: number;
    significantHits: number;
    enriched: number;
    depleted: number;
  };
  qcMetrics: QCMetrics;
  topHits: {
    depleted: GeneResult[];
    enriched: GeneResult[];
  };
  allGenes: GeneResult[];
  volcanoData?: VolcanoDataPoint[];
  rawData?: {
    countMatrix: Record<string, Record<string, number>>;
    normalizedCounts?: Record<string, Record<string, number>>;
  };
  logs?: { timestamp: string; step: string; message: string; progress: number; level: string }[];
  plots: {
    volcano?: string;
    waterfall?: string;
    topHits?: string;
    qc?: string;
  };
  rawFiles: {
    counts: string;
    geneSummary: string;
    sgrnaSummary: string;
  };
}

export interface UserData {
  userId: string;
  email?: string;
  analyses: Analysis[];
  favorites: string[]; // gene IDs
  notes: Record<string, string>; // analysisId -> notes
}
