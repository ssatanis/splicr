/**
 * Analysis Version Management
 *
 * Handles version snapshotting, comparison, and rollback functionality
 * for scientific reproducibility.
 */

import { createClient } from '@/lib/supabase/server';
import {
  AnalysisVersion,
  VersionComparison,
  VersionDifferences,
  ParameterDiff,
  ResultsDiff,
  PerformanceDiff,
  InputDiff,
  AnalysisParameters,
  VersionSnapshotData,
  InputFileSnapshot,
  LibraryInfo,
  SoftwareEnvironment,
} from '@/lib/types';
import * as crypto from 'crypto';

// =============================================================================
// VERSION CREATION
// =============================================================================

/**
 * Create a new version snapshot for an analysis
 * This should be called:
 * - When analysis is created (done by database trigger)
 * - When parameters are updated
 * - When analysis completes (done by database trigger)
 * - When user manually creates a checkpoint
 */
export async function createVersionSnapshot(params: {
  analysis_id: string;
  created_by: string;
  change_description: string;
  snapshot_data: VersionSnapshotData;
  input_files: InputFileSnapshot[];
  sample_metadata: Record<string, any>;
  library_info: LibraryInfo;
  software_environment: SoftwareEnvironment;
  results_snapshot?: Record<string, any>;
  results_checksum?: string;
  execution_time_seconds?: number;
  memory_usage_mb?: number;
  compute_node?: string;
  tags?: string[];
  is_current?: boolean;
}): Promise<AnalysisVersion> {
  const supabase = await createClient();

  // Calculate git-style hash of the complete state
  const git_hash = calculateVersionHash({
    analysis_id: params.analysis_id,
    parameters: params.snapshot_data.parameters,
    input_files: params.input_files,
    library: params.library_info.library,
    results: params.results_snapshot,
  });

  // Get next version number
  const { data: versionNumberData } = await supabase
    .rpc('get_next_version_number', { p_analysis_id: params.analysis_id });

  const version_number = versionNumberData || 1;

  const version = {
    analysis_id: params.analysis_id,
    version_number,
    created_by: params.created_by,
    change_description: params.change_description,
    git_style_hash: git_hash,
    snapshot_data: params.snapshot_data,
    input_files: params.input_files,
    sample_metadata: params.sample_metadata,
    library_info: params.library_info,
    software_environment: params.software_environment,
    results_snapshot: params.results_snapshot || null,
    results_checksum: params.results_checksum || null,
    execution_time_seconds: params.execution_time_seconds || null,
    memory_usage_mb: params.memory_usage_mb || null,
    compute_node: params.compute_node || null,
    is_current: params.is_current !== undefined ? params.is_current : true,
    is_published: false,
    tags: params.tags || null,
  };

  const { data, error } = await supabase
    .from('analysis_versions')
    .insert(version)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create version snapshot: ${error.message}`);
  }

  return data as AnalysisVersion;
}

/**
 * Calculate a git-style hash for a version
 * This creates a deterministic hash of the analysis state
 */
export function calculateVersionHash(params: {
  analysis_id: string;
  parameters: AnalysisParameters;
  input_files: InputFileSnapshot[];
  library: string;
  results?: Record<string, any>;
}): string {
  const content = [
    params.analysis_id,
    JSON.stringify(params.parameters, Object.keys(params.parameters).sort()),
    params.input_files
      .map((f) => `${f.name}:${f.checksum}`)
      .sort()
      .join(','),
    params.library,
    params.results ? JSON.stringify(params.results) : '',
  ].join('|');

  return crypto.createHash('sha256').update(content).digest('hex');
}

// =============================================================================
// VERSION RETRIEVAL
// =============================================================================

/**
 * Get all versions for an analysis
 */
export async function getAnalysisVersions(
  analysis_id: string
): Promise<AnalysisVersion[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('analysis_versions')
    .select('*')
    .eq('analysis_id', analysis_id)
    .order('version_number', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch analysis versions: ${error.message}`);
  }

  return data as AnalysisVersion[];
}

/**
 * Get specific version by ID or version number
 */
export async function getAnalysisVersion(
  analysis_id: string,
  version_identifier: string | number
): Promise<AnalysisVersion> {
  const supabase = await createClient();

  let query = supabase.from('analysis_versions').select('*');

  if (typeof version_identifier === 'number') {
    query = query.eq('analysis_id', analysis_id).eq('version_number', version_identifier);
  } else {
    query = query.eq('id', version_identifier);
  }

  const { data, error } = await query.single();

  if (error) {
    throw new Error(`Failed to fetch analysis version: ${error.message}`);
  }

  return data as AnalysisVersion;
}

/**
 * Get current (active) version for an analysis
 */
export async function getCurrentVersion(analysis_id: string): Promise<AnalysisVersion> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('analysis_versions')
    .select('*')
    .eq('analysis_id', analysis_id)
    .eq('is_current', true)
    .single();

  if (error) {
    throw new Error(`Failed to fetch current version: ${error.message}`);
  }

  return data as AnalysisVersion;
}

// =============================================================================
// VERSION COMPARISON
// =============================================================================

/**
 * Compare two versions of an analysis
 * Returns detailed differences between parameters, results, and performance
 */
export async function compareVersions(
  version1_id: string,
  version2_id: string
): Promise<VersionComparison> {
  const supabase = await createClient();

  // Fetch both versions
  const [version1, version2] = await Promise.all([
    supabase.from('analysis_versions').select('*').eq('id', version1_id).single(),
    supabase.from('analysis_versions').select('*').eq('id', version2_id).single(),
  ]);

  if (version1.error || version2.error) {
    throw new Error('Failed to fetch versions for comparison');
  }

  const v1 = version1.data as AnalysisVersion;
  const v2 = version2.data as AnalysisVersion;

  // Calculate differences
  const differences: VersionDifferences = {
    parameters: compareParameters(
      v1.snapshot_data.parameters,
      v2.snapshot_data.parameters
    ),
    results: compareResults(v1.results_snapshot, v2.results_snapshot),
    performance: comparePerformance(v1, v2),
    inputs: compareInputs(v1.input_files, v2.input_files),
  };

  return {
    version1: v1,
    version2: v2,
    differences,
  };
}

/**
 * Compare parameters between two versions
 */
function compareParameters(
  params1: AnalysisParameters,
  params2: AnalysisParameters
): ParameterDiff[] {
  const diffs: ParameterDiff[] = [];
  const allKeys = new Set([...Object.keys(params1), ...Object.keys(params2)]);

  allKeys.forEach((key) => {
    const val1 = (params1 as any)[key];
    const val2 = (params2 as any)[key];

    diffs.push({
      parameter: key,
      old_value: val1,
      new_value: val2,
      changed: JSON.stringify(val1) !== JSON.stringify(val2),
    });
  });

  return diffs.filter((d) => d.changed);
}

/**
 * Compare results between two versions
 */
function compareResults(
  results1: Record<string, any> | null,
  results2: Record<string, any> | null
): ResultsDiff {
  if (!results1 || !results2) {
    return {
      genes_gained_significance: [],
      genes_lost_significance: [],
      qc_metrics_changed: {},
      summary_changed: true,
    };
  }

  // Compare significant genes
  const sig1 = new Set(
    results1.allGenes
      ?.filter((g: any) => g.fdr < 0.05)
      .map((g: any) => g.gene) || []
  );

  const sig2 = new Set(
    results2.allGenes
      ?.filter((g: any) => g.fdr < 0.05)
      .map((g: any) => g.gene) || []
  );

  const gained = Array.from(sig2).filter((g) => !sig1.has(g));
  const lost = Array.from(sig1).filter((g) => !sig2.has(g));

  // Compare QC metrics
  const qc_changes: Record<string, { old: number; new: number }> = {};
  if (results1.qcMetrics && results2.qcMetrics) {
    Object.keys(results1.qcMetrics).forEach((key) => {
      const old_val = results1.qcMetrics[key];
      const new_val = results2.qcMetrics[key];

      if (typeof old_val === 'number' && typeof new_val === 'number') {
        if (Math.abs(old_val - new_val) > 0.001) {
          qc_changes[key] = { old: old_val, new: new_val };
        }
      }
    });
  }

  return {
    genes_gained_significance: gained,
    genes_lost_significance: lost,
    qc_metrics_changed: qc_changes,
    summary_changed:
      results1.summary?.significantHits !== results2.summary?.significantHits,
  };
}

/**
 * Compare performance metrics between two versions
 */
function comparePerformance(v1: AnalysisVersion, v2: AnalysisVersion): PerformanceDiff {
  const time1 = v1.execution_time_seconds || 0;
  const time2 = v2.execution_time_seconds || 0;
  const mem1 = v1.memory_usage_mb || 0;
  const mem2 = v2.memory_usage_mb || 0;

  return {
    execution_time_change_seconds: time2 - time1,
    memory_usage_change_mb: mem2 - mem1,
    faster: time2 < time1,
  };
}

/**
 * Compare input files between two versions
 */
function compareInputs(
  inputs1: InputFileSnapshot[],
  inputs2: InputFileSnapshot[]
): InputDiff[] {
  const diffs: InputDiff[] = [];

  const files1Map = new Map(inputs1.map((f) => [f.name, f]));
  const files2Map = new Map(inputs2.map((f) => [f.name, f]));

  const allFileNames = new Set([...files1Map.keys(), ...files2Map.keys()]);

  allFileNames.forEach((fileName) => {
    const file1 = files1Map.get(fileName);
    const file2 = files2Map.get(fileName);

    if (!file1 && file2) {
      diffs.push({
        file_name: fileName,
        status: 'added',
        checksum_new: file2.checksum,
      });
    } else if (file1 && !file2) {
      diffs.push({
        file_name: fileName,
        status: 'removed',
        checksum_old: file1.checksum,
      });
    } else if (file1 && file2) {
      if (file1.checksum !== file2.checksum) {
        diffs.push({
          file_name: fileName,
          status: 'modified',
          checksum_old: file1.checksum,
          checksum_new: file2.checksum,
        });
      } else {
        diffs.push({
          file_name: fileName,
          status: 'unchanged',
          checksum_old: file1.checksum,
          checksum_new: file2.checksum,
        });
      }
    }
  });

  return diffs;
}

// =============================================================================
// VERSION OPERATIONS
// =============================================================================

/**
 * Set a version as current (active)
 */
export async function setCurrentVersion(version_id: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from('analysis_versions')
    .update({ is_current: true })
    .eq('id', version_id);

  if (error) {
    throw new Error(`Failed to set current version: ${error.message}`);
  }
}

/**
 * Clone a version to create a new analysis with the same parameters
 * This enables "restore" functionality
 */
export async function cloneVersionToNewAnalysis(
  version_id: string,
  user_id: string,
  new_name?: string
): Promise<string> {
  const version = await getAnalysisVersion('', version_id);

  const supabase = await createClient();

  // Create new analysis with parameters from this version
  const { data: newAnalysis, error } = await supabase
    .from('analyses')
    .insert({
      user_id,
      name: new_name || `${version.snapshot_data.name} (restored from v${version.version_number})`,
      library: version.library_info.library,
      method: version.snapshot_data.method,
      parameters: version.snapshot_data.parameters,
      sample_labels: version.sample_metadata,
      file_names: version.input_files.map((f) => f.storage_key || f.name),
      status: 'created',
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to clone version: ${error.message}`);
  }

  return newAnalysis.id;
}

/**
 * Publish a version (mark as published, preventing modifications)
 */
export async function publishVersion(version_id: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from('analysis_versions')
    .update({ is_published: true })
    .eq('id', version_id);

  if (error) {
    throw new Error(`Failed to publish version: ${error.message}`);
  }
}

/**
 * Add tags to a version
 */
export async function addVersionTags(version_id: string, tags: string[]): Promise<void> {
  const supabase = await createClient();

  // Get current tags
  const { data: version } = await supabase
    .from('analysis_versions')
    .select('tags')
    .eq('id', version_id)
    .single();

  const currentTags = (version?.tags as string[]) || [];
  const updatedTags = Array.from(new Set([...currentTags, ...tags]));

  const { error } = await supabase
    .from('analysis_versions')
    .update({ tags: updatedTags })
    .eq('id', version_id);

  if (error) {
    throw new Error(`Failed to add version tags: ${error.message}`);
  }
}

/**
 * Find duplicate versions (same hash)
 * Useful for detecting redundant runs
 */
export async function findDuplicateVersions(
  analysis_id: string
): Promise<Map<string, AnalysisVersion[]>> {
  const versions = await getAnalysisVersions(analysis_id);

  const hashMap = new Map<string, AnalysisVersion[]>();

  versions.forEach((version) => {
    const existing = hashMap.get(version.git_style_hash) || [];
    existing.push(version);
    hashMap.set(version.git_style_hash, existing);
  });

  // Filter to only duplicates
  const duplicates = new Map<string, AnalysisVersion[]>();
  hashMap.forEach((versions, hash) => {
    if (versions.length > 1) {
      duplicates.set(hash, versions);
    }
  });

  return duplicates;
}

// =============================================================================
// VERSION HISTORY TIMELINE
// =============================================================================

/**
 * Get version history as timeline for visualization
 */
export async function getVersionTimeline(analysis_id: string): Promise<any[]> {
  const versions = await getAnalysisVersions(analysis_id);

  return versions.map((version) => ({
    version,
    event_type: determineEventType(version),
    icon: getEventIcon(version),
    color: getEventColor(version),
    description: version.change_description || 'Version created',
  }));
}

function determineEventType(version: AnalysisVersion): string {
  if (version.is_published) return 'published';
  if (version.results_snapshot) return 'completed';
  if (version.version_number === 1) return 'created';
  return 'updated';
}

function getEventIcon(version: AnalysisVersion): string {
  if (version.is_published) return '🚀';
  if (version.results_snapshot) return '✅';
  if (version.version_number === 1) return '🎬';
  return '📝';
}

function getEventColor(version: AnalysisVersion): string {
  if (version.is_published) return '#10b981'; // green
  if (version.results_snapshot) return '#3b82f6'; // blue
  if (version.version_number === 1) return '#8b5cf6'; // purple
  return '#6b7280'; // gray
}
