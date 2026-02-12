/**
 * Database State Management for Analysis Jobs
 * 
 * Provides atomic status transitions and heartbeat updates
 * to prevent race conditions and ensure data consistency.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';

const admin = supabaseAdmin as any;

/**
 * Atomically transition analysis status
 * Uses database function to prevent race conditions
 */
export async function transitionAnalysisStatus(
  analysisId: string,
  fromStatus: string,
  toStatus: string,
  workerId?: string,
  jobId?: string
): Promise<boolean> {
  const { data, error } = await admin.rpc('transition_analysis_status', {
    p_analysis_id: analysisId,
    p_from_status: fromStatus,
    p_to_status: toStatus,
    p_worker_id: workerId || null,
    p_job_id: jobId || null,
  });

  if (error) {
    console.error('Status transition error:', error);
    return false;
  }

  return data === true;
}

/**
 * Update analysis heartbeat (proves worker is alive)
 */
export async function updateAnalysisHeartbeat(
  analysisId: string,
  workerId: string,
  progress?: number,
  currentStep?: string
): Promise<boolean> {
  const { data, error } = await admin.rpc('update_analysis_heartbeat', {
    p_analysis_id: analysisId,
    p_worker_id: workerId,
    p_progress: progress || null,
    p_current_step: currentStep || null,
  });

  if (error) {
    console.error('Heartbeat update error:', error);
    return false;
  }

  return data === true;
}

/**
 * Mark analysis as queued (when job is added to queue)
 */
export async function markAnalysisQueued(
  analysisId: string,
  jobId: string
): Promise<boolean> {
  return transitionAnalysisStatus(analysisId, 'pending', 'queued', undefined, jobId);
}

/**
 * Mark analysis as processing (when worker starts)
 */
export async function markAnalysisProcessing(
  analysisId: string,
  workerId: string,
  jobId: string
): Promise<boolean> {
  // Try specific transition from queued first (safest)
  const success = await transitionAnalysisStatus(analysisId, 'queued', 'processing', workerId, jobId);
  if (success) return true;

  // If that failed, it might be a retry of a stalled job (status stuck in processing)
  // or a retry from failed state that didn't reset to queued.
  // Force update the status and worker info.
  console.log(`[${workerId}] marking analysis ${analysisId} as processing (force transition)`);

  const { error } = await admin
    .from('analyses')
    .update({
      status: 'processing',
      worker_id: workerId,
      job_id: jobId,
      error_message: null,
      error_traceback: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', analysisId)
    .in('status', ['processing', 'failed', 'pending']);

  if (error) {
    console.error(`[${workerId}] Failed to force mark analysis processing:`, error);
    return false;
  }

  return true;
}

/**
 * Mark analysis as complete
 */
export async function markAnalysisComplete(
  analysisId: string,
  results: any,
  logs?: any[]
): Promise<boolean> {
  const { error } = await admin
    .from('analyses')
    .update({
      status: 'complete',
      progress: 100,
      current_step: 'Complete',
      completed_at: new Date().toISOString(),
      results,
      logs: logs || null,
      error_message: null,
      error_traceback: null,
      worker_id: null,
      last_heartbeat: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', analysisId)
    .eq('status', 'processing'); // Only update if still processing (atomic check)

  if (error) {
    console.error('Failed to mark analysis complete:', error);
    return false;
  }

  return true;
}

/**
 * Mark analysis as failed
 */
export async function markAnalysisFailed(
  analysisId: string,
  errorMessage: string,
  errorTraceback?: string,
  retryCount?: number
): Promise<boolean> {
  const updateData: any = {
    status: 'failed',
    error_message: errorMessage,
    error_traceback: errorTraceback || null,
    completed_at: new Date().toISOString(),
    worker_id: null,
    last_heartbeat: null,
    updated_at: new Date().toISOString(),
  };

  if (retryCount !== undefined) {
    updateData.retry_count = retryCount;
  }

  const { error } = await admin
    .from('analyses')
    .update(updateData)
    .eq('id', analysisId);

  if (error) {
    console.error('Failed to mark analysis failed:', error);
    return false;
  }

  return true;
}

/**
 * Update analysis progress
 */
export async function updateAnalysisProgress(
  analysisId: string,
  progress: number,
  currentStep: string,
  logs?: any[]
): Promise<boolean> {
  const { error } = await admin
    .from('analyses')
    .update({
      progress,
      current_step: currentStep,
      logs: logs || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', analysisId)
    .eq('status', 'processing'); // Only update if processing

  if (error) {
    console.error('Failed to update progress:', error);
    return false;
  }

  return true;
}

/**
 * Get analysis with lock (for worker to check status)
 */
export async function getAnalysisForProcessing(
  analysisId: string
): Promise<any | null> {
  const { data, error } = await admin
    .from('analyses')
    .select('*')
    .eq('id', analysisId)
    .single();

  if (error || !data) {
    return null;
  }

  return data;
}

/**
 * Reset stuck jobs (called by monitoring cron)
 */
export async function resetStuckJobs(): Promise<any[]> {
  const { data, error } = await admin.rpc('reset_stuck_jobs');

  if (error) {
    console.error('Failed to reset stuck jobs:', error);
    return [];
  }

  return data || [];
}

/**
 * Save checkpoint data for resume
 */
export async function saveCheckpoint(
  analysisId: string,
  checkpointData: Record<string, any>
): Promise<boolean> {
  const { error } = await admin
    .from('analyses')
    .update({
      checkpoint_data: checkpointData,
      updated_at: new Date().toISOString(),
    })
    .eq('id', analysisId);

  if (error) {
    console.error('Failed to save checkpoint:', error);
    return false;
  }

  return true;
}

/**
 * Get checkpoint data for resume
 */
export async function getCheckpoint(analysisId: string): Promise<Record<string, any> | null> {
  const { data, error } = await admin
    .from('analyses')
    .select('checkpoint_data')
    .eq('id', analysisId)
    .single();

  if (error || !data) {
    return null;
  }

  return data.checkpoint_data || null;
}
