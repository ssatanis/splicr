/**
 * Analysis Processor
 * 
 * Executes the actual analysis pipeline for a job.
 * Handles checkpointing, progress updates, and error recovery.
 */

import { AnalysisJobData, AnalysisJobResult } from '@/lib/queue/job-types';
import { runAnalysisPipeline } from '@/lib/runAnalysisPipeline';
import {
  markAnalysisProcessing,
  markAnalysisFailed,
  getAnalysisForProcessing,
} from '@/lib/queue/db-state';
import {
  startHeartbeat,
  updateHeartbeatProgress,
  stopHeartbeat,
} from '../utils/heartbeat';
import { getAnalysisCheckpoint, shouldResumeFromCheckpoint } from '../utils/checkpoint';

/**
 * Process an analysis job
 */
export async function processAnalysisJob(
  jobData: AnalysisJobData,
  workerId: string,
  jobId: string
): Promise<AnalysisJobResult> {
  const { analysisId } = jobData;

  try {
    // Get analysis record
    const analysis = await getAnalysisForProcessing(analysisId);
    if (!analysis) {
      throw new Error(`Analysis ${analysisId} not found`);
    }

    // Check if we should resume from checkpoint
    const checkpoint = await getAnalysisCheckpoint(analysisId);
    const resume = shouldResumeFromCheckpoint(checkpoint);

    if (resume && checkpoint) {
      console.log(`Resuming analysis ${analysisId} from checkpoint: ${checkpoint.step}`);
      // TODO: Implement checkpoint resume logic
      // For now, we'll restart from beginning
      // In production, you'd restore intermediate files and skip completed steps
    }

    // Transition to processing status
    const transitioned = await markAnalysisProcessing(analysisId, workerId, jobId);
    if (!transitioned) {
      throw new Error(`Failed to transition analysis ${analysisId} to processing status`);
    }

    // Start heartbeat
    startHeartbeat(analysisId, workerId, analysis.progress || 0, analysis.current_step || 'Starting');

    // Progress callback: update heartbeat on every pipeline progress event so UI gets real-time updates
    const onProgress = (progress: number, step: string, _logEntry: unknown) => {
      updateHeartbeatProgress(analysisId, progress, step);
    };

    // Run the analysis pipeline (onProgress keeps heartbeat current for real-time UI)
    await runAnalysisPipeline(analysisId, analysis, { onProgress });

    // Get final results
    const finalAnalysis = await getAnalysisForProcessing(analysisId);
    if (!finalAnalysis || finalAnalysis.status !== 'complete') {
      throw new Error('Analysis did not complete successfully');
    }

    // Stop heartbeat
    stopHeartbeat(analysisId);

    return {
      success: true,
      analysisId,
      results: finalAnalysis.results,
    };
  } catch (error) {
    // Stop heartbeat on error
    stopHeartbeat(analysisId);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorTraceback = error instanceof Error ? error.stack : String(error);

    // Get current retry count
    const analysis = await getAnalysisForProcessing(analysisId);
    const retryCount = analysis?.retry_count || 0;

    // Mark as failed
    await markAnalysisFailed(analysisId, errorMessage, errorTraceback, retryCount);

    return {
      success: false,
      analysisId,
      error: errorMessage,
    };
  }
}
