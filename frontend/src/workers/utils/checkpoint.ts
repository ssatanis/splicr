/**
 * Checkpoint and Resume Utilities
 * 
 * Saves intermediate state during analysis processing
 * to enable resuming from last checkpoint on failure/retry.
 */

import { saveCheckpoint, getCheckpoint } from '@/lib/queue/db-state';

export interface CheckpointData {
  step: string;
  completedSteps: string[];
  intermediateFiles?: Record<string, string>;
  parameters?: Record<string, any>;
  progress: number;
  timestamp: string;
}

/**
 * Save checkpoint after completing a major step
 */
export async function saveAnalysisCheckpoint(
  analysisId: string,
  step: string,
  completedSteps: string[],
  progress: number,
  intermediateFiles?: Record<string, string>,
  parameters?: Record<string, any>
): Promise<void> {
  const checkpoint: CheckpointData = {
    step,
    completedSteps,
    intermediateFiles,
    parameters,
    progress,
    timestamp: new Date().toISOString(),
  };

  await saveCheckpoint(analysisId, checkpoint);
}

/**
 * Get last checkpoint to resume from
 */
export async function getAnalysisCheckpoint(
  analysisId: string
): Promise<CheckpointData | null> {
  const checkpoint = await getCheckpoint(analysisId);
  if (!checkpoint || !checkpoint.step) {
    return null;
  }

  return checkpoint as CheckpointData;
}

/**
 * Determine if analysis should resume from checkpoint
 */
export function shouldResumeFromCheckpoint(checkpoint: CheckpointData | null): boolean {
  return checkpoint !== null && checkpoint.completedSteps.length > 0;
}
