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
 * Redis is considered available when REDIS_URL or Upstash REST vars are set.
 * When false (e.g. Vercel without env), Run API skips enqueue and runs pipeline inline.
 */
export const REDIS_AVAILABLE = !!(
  process.env.REDIS_URL?.trim() ||
  (process.env.UPSTASH_REDIS_REST_URL?.trim() && process.env.UPSTASH_REDIS_REST_TOKEN?.trim())
);

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
