/**
 * Type definitions for SplicR
 */

import type { QCMetrics as ComprehensiveQCMetrics } from './analysis/qcMetrics';
export type AnalysisStatus = "created" | "pending" | "queued" | "processing" | "running" | "complete" | "failed" | "cancelled";

export type Algorithm = "mageck" | "bagel2" | "drugz";

export type LibraryType = "brunello" | "brie" | "gecko-v2" | "tko-v3" | "calabrese" | "dolcetto" | "dolomiti" | "custom";

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
  librarySize?: number;
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
  comprehensiveQC?: ComprehensiveQCMetrics;
}

/** Real QC assessment from pipeline (PASS / WARNING / FAIL). */
export interface QCAssessment {
  status: 'PASS' | 'WARNING' | 'FAIL';
  issues: string[];
  recommendations: string[];
}

export interface GeneResult {
  gene: string;
  sgrnaCount: number;
  logFoldChange: number;
  pValue: number;
  fdr: number;
  rank: number;
}

// Specific Algorithm Results
export interface MAGeCKGeneResult {
  gene: string;
  fdrNeg: number;
  fdrPos: number;
  log2FC: number;
  pValNeg: number;
  pValPos: number;
}

export interface BAGEL2GeneResult {
  gene: string;
  bayesFactor: number;
  essentialProbability?: number;
}

export interface DrugZGeneResult {
  gene: string;
  fdr: number;
  normZ: number;
  syntheticScore?: number;
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
  qcAssessment?: QCAssessment;
  topHits: {
    depleted: GeneResult[];
    enriched: GeneResult[];
  };
  allGenes: GeneResult[];
  volcanoData?: VolcanoDataPoint[];
  rawData?: {
    countMatrix?: Record<string, Record<string, number>>;
    /** R2 key for count matrix; when set, client fetches via /api/analysis/[id]/count-matrix to avoid huge payloads. */
    countMatrixR2Key?: string;
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
  algorithms?: {
    mageck?: MAGeCKGeneResult[];
    bagel2?: BAGEL2GeneResult[];
    drugz?: DrugZGeneResult[];
  };
  batchCorrection?: {
    metrics: {
      silhouetteBefore: number;
      silhouetteAfter: number;
      pcaR2Before: number;
      pcaR2After: number;
    };
    pcaCoordinates?: { x: number; y: number; batch: string; stage: string }[];
    library?: {
      name: string;
      confidence: number;
      matchStats: Record<string, number>;
    };
    r2Key?: string;
    timestamp?: string;
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
export type AccessMethod = 'owner' | 'collaborator' | 'lab_member' | 'institution' | 'public_link';

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
  shared_by: string; // Database column is 'shared_by', not 'shared_by_user_id'
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
  shared_by: string; // Database column is 'shared_by', not 'shared_by_user_id'
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

/**
 * Lab Collaboration System Types
 */

// Lab member roles
export type LabRole = 'pi' | 'admin' | 'member' | 'guest';

// Lab record from database
export interface Lab {
  id: string;
  name: string;
  pi_user_id: string;
  department: string | null;
  institution: string | null;
  lab_website: string | null;
  logo_url: string | null;
  invite_code: string;
  created_at: string;
  updated_at: string;
}

// Lab member record from database
export interface LabMember {
  id: string;
  lab_id: string;
  user_id: string;
  role: LabRole;
  title: string | null; // e.g., "Postdoc", "PhD Student"
  joined_at: string;
  guest_expires_at: string | null;
  last_active_at: string | null;
  // Joined profile data (when fetching members with profiles)
  email?: string;
  full_name?: string;
  display_name?: string;
  avatar_url?: string;
}

// User's lab membership info (used in settings UI)
export interface LabMembershipInfo {
  inLab: boolean;
  lab: Lab | null;
  membership: LabMember | null;
  role: LabRole | null;
}

// Create lab request payload
export interface CreateLabRequest {
  name: string;
  department?: string;
  institution?: string;
  lab_website?: string;
}

// Join lab request payload
export interface JoinLabRequest {
  invite_code: string;
  title?: string; // Optional job title
}

// Update lab member request payload
export interface UpdateLabMemberRequest {
  role?: LabRole;
  title?: string;
}

// Lab invite code validation result
export interface InviteCodeValidation {
  valid: boolean;
  lab?: {
    name: string;
    institution: string | null;
  };
  error?: string;
}

/**
 * =============================================================================
 * REPRODUCIBILITY SYSTEM TYPES
 * =============================================================================
 * Types for scientific reproducibility tracking including:
 * - Analysis versioning and snapshots
 * - W3C PROV provenance model
 * - Methods text generation
 * - Reproducibility packages and scoring
 * =============================================================================
 */

// -----------------------------------------------------------------------------
// ANALYSIS VERSIONS
// -----------------------------------------------------------------------------

export interface AnalysisVersion {
  id: string;
  analysis_id: string;
  version_number: number;
  created_at: string;
  created_by: string | null;

  // Version metadata
  change_description: string | null;
  git_style_hash: string; // SHA256 of all parameters
  parent_version_id: string | null;

  // Complete snapshot of analysis state
  snapshot_data: VersionSnapshotData;

  // Input data snapshot
  input_files: InputFileSnapshot[];
  sample_metadata: Record<string, any>;
  library_info: LibraryInfo;

  // Software environment snapshot
  software_environment: SoftwareEnvironment;

  // Results snapshot (if analysis has completed)
  results_snapshot: Record<string, any> | null;
  results_checksum: string | null;

  // Performance metrics
  execution_time_seconds: number | null;
  memory_usage_mb: number | null;
  compute_node: string | null;

  // Status and flags
  is_current: boolean;
  is_published: boolean;
  tags: string[] | null;
}

export interface VersionSnapshotData {
  name: string;
  method: string;
  parameters: AnalysisParameters;
  status: AnalysisStatus;
  progress?: number;
  [key: string]: any; // Allow additional metadata
}

export interface InputFileSnapshot {
  name: string;
  size: number;
  checksum: string; // MD5 or SHA256
  uploaded_at: string;
  storage_key?: string;
}

export interface LibraryInfo {
  library: LibraryType | string;
  version?: string;
  source?: string;
  organism?: string;
  guide_count?: number;
  gene_count?: number;
}

export interface SoftwareEnvironment {
  splicr_version: string;
  mageck_version?: string;
  bagel2_version?: string;
  drugz_version?: string;
  python_version?: string;
  r_version?: string;
  node_version?: string;
  os?: string;
  cpu_architecture?: string;
  dependencies?: Record<string, string>; // package name -> version
  created_at?: string;
  completed_at?: string;
}

// Version comparison result
export interface VersionComparison {
  version1: AnalysisVersion;
  version2: AnalysisVersion;
  differences: VersionDifferences;
}

export interface VersionDifferences {
  parameters: ParameterDiff[];
  results: ResultsDiff;
  performance: PerformanceDiff;
  inputs: InputDiff[];
}

export interface ParameterDiff {
  parameter: string;
  old_value: any;
  new_value: any;
  changed: boolean;
}

export interface ResultsDiff {
  genes_gained_significance: string[];
  genes_lost_significance: string[];
  qc_metrics_changed: Record<string, { old: number; new: number }>;
  summary_changed: boolean;
}

export interface PerformanceDiff {
  execution_time_change_seconds: number;
  memory_usage_change_mb: number;
  faster: boolean;
}

export interface InputDiff {
  file_name: string;
  status: 'added' | 'removed' | 'modified' | 'unchanged';
  checksum_old?: string;
  checksum_new?: string;
}

// -----------------------------------------------------------------------------
// W3C PROV PROVENANCE MODEL
// -----------------------------------------------------------------------------

export type ProvEntityType =
  | 'fastq_file'
  | 'count_matrix'
  | 'normalized_counts'
  | 'results_table'
  | 'plot'
  | 'report'
  | 'gene_summary'
  | 'sgrna_summary'
  | 'qc_metrics';

export interface ProvEntity {
  id: string;
  analysis_id: string;
  version_id: string | null;

  // Entity identification
  type: ProvEntityType;
  label: string;

  // Entity location and attributes
  location: string | null; // Storage path or URL
  checksum: string | null; // SHA256 hash
  size_bytes: number | null;
  format: string | null; // MIME type

  // Timing
  created_at: string;

  // Flexible metadata
  attributes: Record<string, any> | null;

  // Relationships
  is_input: boolean;
  is_output: boolean;
  is_intermediate: boolean;
}

export type ProvActivityType =
  | 'quality_control'
  | 'normalization'
  | 'statistical_test'
  | 'visualization'
  | 'hit_calling'
  | 'pathway_analysis'
  | 'data_upload'
  | 'file_parsing';

export interface ProvActivity {
  id: string;
  analysis_id: string;
  version_id: string | null;

  // Activity identification
  type: ProvActivityType;
  label: string;

  // Algorithm details
  algorithm: string; // e.g., "MAGeCK-RRA", "BAGEL2"
  algorithm_version: string | null;

  // Parameters used
  parameters: Record<string, any>;

  // Timing
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;

  // Status
  status: 'running' | 'success' | 'failed';
  error_message: string | null;

  // Compute resources
  compute_resources: ComputeResources | null;

  // Output summary
  output_summary: Record<string, any> | null;
}

export interface ComputeResources {
  cpu_seconds?: number;
  memory_mb?: number;
  node?: string;
  gpu_used?: boolean;
}

export type ProvAgentType = 'user' | 'software' | 'algorithm' | 'organization';

export interface ProvAgent {
  id: string;

  // Agent identification
  type: ProvAgentType;
  label: string;

  // Agent details
  version: string | null; // For software agents
  user_id: string | null; // For human agents
  organization: string | null;

  // Contact and attribution
  email: string | null;
  orcid: string | null; // ORCID identifier for researchers
  url: string | null;

  // Metadata
  attributes: Record<string, any> | null;

  created_at: string;
}

export type ProvRelationType =
  | 'wasGeneratedBy' // Entity was generated by Activity
  | 'used' // Activity used Entity
  | 'wasAttributedTo' // Entity was attributed to Agent
  | 'wasAssociatedWith' // Activity was associated with Agent
  | 'wasDerivedFrom' // Entity was derived from Entity
  | 'wasInformedBy' // Activity was informed by Activity
  | 'wasStartedBy' // Activity was started by Entity/Agent
  | 'wasEndedBy' // Activity was ended by Entity/Agent
  | 'actedOnBehalfOf' // Agent acted on behalf of Agent
  | 'wasInfluencedBy'; // Generic influence

export interface ProvRelation {
  id: string;
  analysis_id: string;
  version_id: string | null;

  // Relation type
  relation_type: ProvRelationType;

  // Source (one of these must be set)
  source_entity_id: string | null;
  source_activity_id: string | null;
  source_agent_id: string | null;

  // Target (one of these must be set)
  target_entity_id: string | null;
  target_activity_id: string | null;
  target_agent_id: string | null;

  // Timing and metadata
  created_at: string;
  attributes: Record<string, any> | null;
}

// Provenance graph structure for visualization
export interface ProvenanceGraph {
  entities: ProvEntity[];
  activities: ProvActivity[];
  agents: ProvAgent[];
  relations: ProvRelation[];
}

// Provenance trace result (lineage of a specific entity)
export interface ProvenanceTrace {
  entity: ProvEntity;
  upstream: ProvenanceTraceNode[];
  downstream: ProvenanceTraceNode[];
}

export interface ProvenanceTraceNode {
  entity?: ProvEntity;
  activity?: ProvActivity;
  agent?: ProvAgent;
  relation: ProvRelation;
  depth: number;
}

// -----------------------------------------------------------------------------
// METHODS TEXT GENERATION
// -----------------------------------------------------------------------------

export interface AnalysisMethod {
  id: string;
  analysis_id: string;
  version_id: string | null;

  // Methods content
  generated_text: string;
  edited_text: string | null;
  is_edited: boolean;

  // Template and style
  template_name: string;
  citation_style: CitationStyle;

  // Sections
  sections: MethodsSections;

  // Citations
  citations: Citation[];

  // Metadata
  generated_at: string;
  edited_at: string | null;
  edited_by: string | null;

  // Version tracking
  version: number;
  parent_methods_id: string | null;

  // Export formats
  export_formats: ExportFormats;
}

export type CitationStyle = 'apa' | 'nature' | 'science' | 'cell' | 'mla' | 'chicago';

export interface MethodsSections {
  study_design?: string;
  data_processing?: string;
  statistical_analysis?: string;
  data_availability?: string;
  [key: string]: string | undefined; // Allow custom sections
}

export interface Citation {
  type: 'software' | 'algorithm' | 'database' | 'publication';
  title: string;
  authors?: string[];
  year?: number;
  doi?: string;
  url?: string;
  version?: string;
  accessed_date?: string;
}

export interface ExportFormats {
  plain: boolean;
  word: boolean;
  latex: boolean;
}

export interface MethodsTemplate {
  id: string;
  name: string;
  display_name: string;
  description: string | null;

  // Template content
  template_content: TemplateContent;

  // Applicability
  analysis_types: string[];
  journal_styles: string[];

  // Metadata
  created_at: string;
  updated_at: string;
  created_by: string | null;

  // Versioning
  version: string;
  is_active: boolean;
  is_default: boolean;
}

export interface TemplateContent {
  sections: {
    [sectionName: string]: TemplateSection;
  };
}

export interface TemplateSection {
  template: string; // Text with {{variable}} placeholders
  variables: string[]; // List of required variables
  optional_variables?: string[];
}

// Methods generation request
export interface GenerateMethodsRequest {
  analysis_id: string;
  version_id?: string;
  template_name?: string;
  citation_style?: CitationStyle;
  custom_variables?: Record<string, string>;
}

// Methods generation response
export interface GenerateMethodsResponse {
  methods: AnalysisMethod;
  missing_variables?: string[];
  warnings?: string[];
}

// -----------------------------------------------------------------------------
// REPRODUCIBILITY PACKAGES
// -----------------------------------------------------------------------------

export interface ReproducibilityPackage {
  id: string;
  analysis_id: string;
  version_id: string;

  // Package identification
  package_name: string;
  description: string | null;

  // Package contents
  contents: PackageContents;

  // Storage
  storage_location: string | null;
  package_size_bytes: number | null;
  package_checksum: string | null;

  // Export formats
  export_format: ExportFormat;
  export_url: string | null;

  // Publishing
  doi: string | null;
  published_at: string | null;
  is_public: boolean;

  // Metadata
  created_at: string;
  created_by: string | null;
  downloaded_count: number;

  // Verification
  verification_status: VerificationStatus;
  verified_at: string | null;
  verified_by: string | null;
  verification_notes: string | null;
}

export interface PackageContents {
  manifest: PackageManifest;
  parameters: AnalysisParameters;
  data_files: FileReference[];
  results: FileReference[];
  provenance: FileReference;
  methods: FileReference;
  readme: FileReference;
  software_environment: FileReference;
  citations?: FileReference;
}

export interface PackageManifest {
  analysis_id: string;
  title: string;
  version: string;
  created_at: string;
  created_by: string;
  splicr_version: string;
  description?: string;
  keywords?: string[];
  files: ManifestFile[];
}

export interface ManifestFile {
  path: string;
  checksum: string;
  size_bytes: number;
  description?: string;
}

export interface FileReference {
  path: string;
  checksum: string;
  size_bytes: number;
}

export type ExportFormat = 'zip' | 'docker' | 'binder' | 'zenodo' | 'tar.gz';

export type VerificationStatus = 'unverified' | 'verified' | 'failed';

// Package generation request
export interface GeneratePackageRequest {
  analysis_id: string;
  version_id?: string;
  export_format: ExportFormat;
  include_data_files: boolean;
  include_results: boolean;
  include_provenance: boolean;
  include_methods: boolean;
  package_name?: string;
  description?: string;
}

// Package generation response
export interface GeneratePackageResponse {
  package: ReproducibilityPackage;
  download_url: string;
  estimated_size_mb: number;
}

// -----------------------------------------------------------------------------
// REPRODUCIBILITY SCORES
// -----------------------------------------------------------------------------

export interface ReproducibilityScore {
  id: string;
  analysis_id: string;
  version_id: string | null;

  // Overall score (0-100)
  total_score: number;

  // Component scores
  parameters_documented: number; // Max 20 points
  software_versions_captured: number; // Max 20 points
  provenance_tracked: number; // Max 20 points
  data_checksums_recorded: number; // Max 15 points
  methods_generated: number; // Max 10 points
  package_exported: number; // Max 10 points
  published_with_doi: number; // Max 5 points

  // Checklist items
  checklist: ReproducibilityChecklist;

  // Badge earned
  badge: ReproducibilityBadge | null;

  // Metadata
  calculated_at: string;
  updated_at: string;
}

export interface ReproducibilityChecklist {
  input_files_checksummed: boolean;
  parameters_saved: boolean;
  analysis_completed: boolean;
  methods_reviewed: boolean;
  package_exported: boolean;
  shared_or_published: boolean;
}

export type ReproducibilityBadge = 'platinum' | 'gold' | 'silver' | 'bronze';

// Badge criteria and display info
export interface BadgeInfo {
  badge: ReproducibilityBadge;
  name: string;
  description: string;
  icon: string;
  color: string;
  min_score: number;
  requirements: string[];
}

// Score improvement suggestions
export interface ScoreImprovement {
  component: string;
  current_score: number;
  max_score: number;
  suggestions: string[];
  priority: 'high' | 'medium' | 'low';
}

// -----------------------------------------------------------------------------
// REPRODUCIBILITY VERIFICATION
// -----------------------------------------------------------------------------

export interface ReproducibilityVerification {
  id: string;
  original_analysis_id: string;
  original_version_id: string;
  reproduced_analysis_id: string | null;

  // Verifier information
  verified_by: string | null;
  verifier_institution: string | null;
  verifier_notes: string | null;

  // Verification results
  status: VerificationAttemptStatus;
  results_match: boolean | null;
  differences: VerificationDifferences | null;

  // Timing
  started_at: string;
  completed_at: string | null;

  // Metadata
  environment_differences: Record<string, any> | null;
  verification_report: string | null;
}

export type VerificationAttemptStatus =
  | 'in_progress'
  | 'identical'
  | 'minor_differences'
  | 'major_differences'
  | 'failed';

export interface VerificationDifferences {
  qc_metrics?: Record<string, { original: number; reproduced: number; diff_percent: number }>;
  significant_hits?: {
    original_count: number;
    reproduced_count: number;
    genes_only_in_original: string[];
    genes_only_in_reproduced: string[];
    shared_genes: number;
  };
  plots_similar?: boolean;
  error?: string;
}

// Verification request
export interface VerifyReproducibilityRequest {
  original_analysis_id: string;
  original_version_id?: string;
  verifier_notes?: string;
}

// Verification response
export interface VerifyReproducibilityResponse {
  verification: ReproducibilityVerification;
  certificate_url?: string;
  detailed_report: string;
}

// Verification certificate (for display)
export interface VerificationCertificate {
  verification_id: string;
  original_analysis_id: string;
  verified_by: string;
  verified_at: string;
  status: VerificationAttemptStatus;
  results_match: boolean;
  certificate_text: string;
  signature?: string; // Optional cryptographic signature
}

// -----------------------------------------------------------------------------
// REPRODUCIBILITY DASHBOARD
// -----------------------------------------------------------------------------

export interface ReproducibilityDashboard {
  analysis: Analysis;
  current_version: AnalysisVersion;
  all_versions: AnalysisVersion[];
  score: ReproducibilityScore;
  provenance_summary: ProvenanceSummary;
  methods: AnalysisMethod | null;
  packages: ReproducibilityPackage[];
  verifications: ReproducibilityVerification[];
  improvements: ScoreImprovement[];
}

export interface ProvenanceSummary {
  entity_count: number;
  activity_count: number;
  agent_count: number;
  complete: boolean;
  has_visualization: boolean;
}

// Timeline item for version history visualization
export interface VersionTimelineItem {
  version: AnalysisVersion;
  event_type: 'created' | 'completed' | 'updated' | 'published';
  icon: string;
  color: string;
  description: string;
}
