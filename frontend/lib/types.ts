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
  // Sharing fields
  isOwner?: boolean;
  isShared?: boolean;
  permission?: 'view' | 'edit' | 'admin';
  ownerEmail?: string;
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

/** When results are from the demo/mock pipeline vs real sequencing pipeline. */
export type ResultsSource = 'demo' | 'pipeline';

export interface AnalysisResults {
  id: string;
  /** 'demo' = generated for demo; 'pipeline' = from real analysis (MAGeCK/DrugZ/BAGEL2). Omitted = legacy, treat as demo. */
  resultsSource?: ResultsSource;
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

/**
 * Sharing System Types
 */

// Visibility levels for link-based sharing
export type ShareVisibility = 'private' | 'institution' | 'public';

// Permission levels
export type SharePermission = 'view' | 'edit';

// Access methods for audit trail
export type AccessMethod = 'owner' | 'collaborator' | 'institution' | 'public_link';

// Access types for logging
export type AccessType = 'view' | 'edit' | 'download' | 'share' | 'delete';

// Analysis share record (email-based invitation)
export interface AnalysisShare {
  id: string;
  analysis_id: string;
  email: string;
  permission: SharePermission | 'admin';
  status: 'pending' | 'accepted' | 'declined';
  user_id: string | null;
  shared_by: string;
  created_at: string;
  accepted_at: string | null;
  // Link-based sharing fields
  visibility: ShareVisibility;
  share_token: string | null;
  link_permission: SharePermission;
  link_expires_at: string | null;
  institution_domain: string | null;
  institution_permission: SharePermission;
  updated_at: string;
  is_link_share: boolean;
}

// Link share configuration
export interface LinkShareConfig {
  id: string;
  analysis_id: string;
  visibility: ShareVisibility;
  share_token: string | null;
  link_permission: SharePermission;
  link_expires_at: string | null;
  institution_domain: string | null;
  institution_permission: SharePermission;
  shared_by: string;
  created_at: string;
  updated_at: string;
}

// Access check result
export interface AccessCheckResult {
  hasAccess: boolean;
  permission: SharePermission | null;
  method: AccessMethod | null;
  isOwner: boolean;
  isExpired?: boolean;
  requiresAuth?: boolean;
}

// Access log entry
export interface AccessLogEntry {
  id: string;
  analysis_id: string;
  user_id: string | null;
  access_type: AccessType;
  access_method: AccessMethod | null;
  ip_address: string | null;
  user_agent: string | null;
  accessed_at: string;
}

// Share modal state
export interface ShareModalState {
  isOpen: boolean;
  loading: boolean;
  error: string | null;
  success: string | null;
}

// Collaborator display (for UI)
export interface Collaborator {
  id: string;
  email: string;
  permission: SharePermission | 'admin';
  status: 'pending' | 'accepted';
  user_id: string | null;
  created_at: string;
  accepted_at: string | null;
}
