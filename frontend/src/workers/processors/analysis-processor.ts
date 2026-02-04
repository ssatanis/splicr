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
  markAnalysisComplete,
  markAnalysisFailed,
  updateAnalysisProgress,
  getAnalysisForProcessing,
} from '@/lib/queue/db-state';
import {
  startHeartbeat,
  updateHeartbeatProgress,
  stopHeartbeat,
} from '../utils/heartbeat';
import {
  saveAnalysisCheckpoint,
  getAnalysisCheckpoint,
  shouldResumeFromCheckpoint,
} from '../utils/checkpoint';

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

    // Create progress callback
    let lastProgressUpdate = Date.now();
    const PROGRESS_UPDATE_INTERVAL_MS = parseInt(
      process.env.WORKER_PROGRESS_UPDATE_INTERVAL_MS || '5000',
      10
    ); // Default: 5 seconds

    const progressCallback = async (
      progress: number,
      step: string,
      logEntry: any
    ) => {
      // Update heartbeat with progress
      updateHeartbeatProgress(analysisId, progress, step);

      // Throttle database updates (every 5 seconds)
      const now = Date.now();
      if (now - lastProgressUpdate >= PROGRESS_UPDATE_INTERVAL_MS) {
        await updateAnalysisProgress(analysisId, progress, step, [logEntry]);
        lastProgressUpdate = now;
      }

      // Save checkpoint after major steps
      const majorSteps = [
        'Quality Control',
        'Normalization',
        'Hit Calling',
        'Visualization',
      ];
      if (majorSteps.includes(step)) {
        await saveAnalysisCheckpoint(analysisId, step, [step], progress);
      }
    };

    // Run the analysis pipeline
    await runAnalysisPipeline(analysisId, analysis);

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
