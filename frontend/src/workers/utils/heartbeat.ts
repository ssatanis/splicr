/**
 * Worker Heartbeat Management
 * 
 * Sends periodic heartbeats to database to prove worker is alive.
 * Used to detect stuck/crashed workers.
 */

import { updateAnalysisHeartbeat } from '@/lib/queue/db-state';

const HEARTBEAT_INTERVAL_MS = parseInt(
  process.env.WORKER_HEARTBEAT_INTERVAL_MS || '30000',
  10
); // Default: 30 seconds

interface HeartbeatState {
  analysisId: string;
  workerId: string;
  intervalId?: NodeJS.Timeout;
  lastProgress?: number;
  lastStep?: string;
}

const activeHeartbeats = new Map<string, HeartbeatState>();

/**
 * Start sending heartbeats for an analysis
 */
export function startHeartbeat(
  analysisId: string,
  workerId: string,
  initialProgress?: number,
  initialStep?: string
): void {
  // Stop existing heartbeat if any
  stopHeartbeat(analysisId);

  const state: HeartbeatState = {
    analysisId,
    workerId,
    lastProgress: initialProgress,
    lastStep: initialStep,
  };

  // Send initial heartbeat immediately
  updateAnalysisHeartbeat(analysisId, workerId, initialProgress, initialStep).catch(
    (err) => console.error(`Heartbeat error for ${analysisId}:`, err)
  );

  // Set up periodic heartbeats
  state.intervalId = setInterval(async () => {
    try {
      await updateAnalysisHeartbeat(
        analysisId,
        workerId,
        state.lastProgress,
        state.lastStep
      );
    } catch (err) {
      console.error(`Heartbeat error for ${analysisId}:`, err);
    }
  }, HEARTBEAT_INTERVAL_MS);

  activeHeartbeats.set(analysisId, state);
}

/**
 * Update heartbeat with current progress/step
 */
export function updateHeartbeatProgress(
  analysisId: string,
  progress: number,
  step: string
): void {
  const state = activeHeartbeats.get(analysisId);
  if (state) {
    state.lastProgress = progress;
    state.lastStep = step;
    // Trigger immediate heartbeat update
    updateAnalysisHeartbeat(analysisId, state.workerId, progress, step).catch(
      (err) => console.error(`Heartbeat update error for ${analysisId}:`, err)
    );
  }
}

/**
 * Stop sending heartbeats for an analysis
 */
export function stopHeartbeat(analysisId: string): void {
  const state = activeHeartbeats.get(analysisId);
  if (state?.intervalId) {
    clearInterval(state.intervalId);
    activeHeartbeats.delete(analysisId);
  }
}

/**
 * Stop all active heartbeats (for graceful shutdown)
 */
export function stopAllHeartbeats(): void {
  for (const [analysisId] of activeHeartbeats) {
    stopHeartbeat(analysisId);
  }
}
