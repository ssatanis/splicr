/**
 * Queue Client
 *
 * Provides a unified interface for the analysis job queue.
 * Uses REDIS_URL (TCP) for BullMQ — supports Upstash (rediss://) and local Redis.
 * When Redis is unavailable, APIs fall back to inline pipeline execution.
 */

import {
  analysisQueue,
  enqueueAnalysis,
  retryJob,
  getJobStatus,
  removeJob,
  getQueueMetrics,
  closeQueue,
  redisConnection,
} from './analysis-queue';
import type { AnalysisJobData, JobOptions } from './job-types';

export { JobPriority } from './job-types';
export type { AnalysisJobData, JobOptions };

/**
 * When true, never enqueue - always run pipeline inline (no worker/Redis needed).
 * Set RUN_ANALYSIS_INLINE=true to skip the queue and run analyses directly in the API.
 */
export const RUN_ANALYSIS_INLINE =
  process.env.RUN_ANALYSIS_INLINE === 'true' || process.env.RUN_ANALYSIS_INLINE === '1';

/**
 * Redis is considered available when REDIS_URL or Upstash REST vars are set,
 * AND we're not forcing inline mode.
 * When false, Run API skips enqueue and runs pipeline inline.
 */
/**
 * Redis is considered available when REDIS_URL or Upstash REST vars are set,
 * AND we're not forcing inline mode.
 * When false, Run API skips enqueue and runs pipeline inline.
 */
export function isRedisAvailable(): boolean {
  if (RUN_ANALYSIS_INLINE) return false;

  // Check standard Redis URL
  if (process.env.REDIS_URL?.trim()) return true;

  // Check Upstash Redis REST vars (for serverless/Edge)
  if (process.env.UPSTASH_REDIS_REST_URL?.trim() && process.env.UPSTASH_REDIS_REST_TOKEN?.trim()) return true;

  // Check Upstash Redis TCP vars
  if (process.env.UPSTASH_REDIS_ENDPOINT?.trim() && process.env.UPSTASH_REDIS_PASSWORD?.trim()) return true;

  return false;
}

export const REDIS_AVAILABLE = isRedisAvailable();

export {
  analysisQueue,
  enqueueAnalysis,
  retryJob,
  getJobStatus,
  removeJob,
  getQueueMetrics,
  closeQueue,
  redisConnection,
};
