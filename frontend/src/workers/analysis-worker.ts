/**
 * Analysis Worker Process
 * 
 * Standalone worker process that processes analysis jobs from the Redis queue.
 * Can run independently of the Next.js app server.
 * 
 * Usage:
 *   node -r ts-node/register src/workers/analysis-worker.ts
 *   or
 *   npm run worker
 */

import { Worker, WorkerOptions } from 'bullmq';
import { redisConnection } from '@/lib/queue/analysis-queue';
import { AnalysisJobData, AnalysisJobResult } from '@/lib/queue/job-types';
import { processAnalysisJob } from './processors/analysis-processor';
import { stopAllHeartbeats } from './utils/heartbeat';

// Worker configuration
const WORKER_ID = process.env.WORKER_ID || `worker-${process.pid}-${Date.now()}`;
const CONCURRENCY = parseInt(process.env.QUEUE_CONCURRENCY || '4', 10);

console.log(`Starting analysis worker: ${WORKER_ID}`);
console.log(`Concurrency: ${CONCURRENCY}`);

// Worker options
const workerOptions: WorkerOptions = {
  connection: redisConnection,
  concurrency: CONCURRENCY,
  limiter: {
    max: CONCURRENCY,
    duration: 1000,
  },
  removeOnComplete: {
    age: 7 * 24 * 60 * 60, // 7 days
    count: 1000,
  },
  removeOnFail: {
    age: 30 * 24 * 60 * 60, // 30 days
    count: 500,
  },
};

// Create worker instance
const worker = new Worker<AnalysisJobData, AnalysisJobResult>(
  'analysis-jobs',
  async (job) => {
    const { data } = job;
    const jobId = job.id!;

    console.log(`[${WORKER_ID}] Processing job ${jobId} for analysis ${data.analysisId}`);

    try {
      // Process the analysis
      const result = await processAnalysisJob(data, WORKER_ID, jobId);

      if (!result.success) {
        throw new Error(result.error || 'Analysis processing failed');
      }

      console.log(`[${WORKER_ID}] Job ${jobId} completed successfully`);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[${WORKER_ID}] Job ${jobId} failed:`, errorMessage);
      throw error; // Re-throw to trigger BullMQ retry logic
    }
  },
  workerOptions
);

// Worker event handlers
worker.on('completed', (job) => {
  console.log(`[${WORKER_ID}] Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`[${WORKER_ID}] Job ${job?.id} failed:`, err.message);
});

worker.on('error', (err) => {
  console.error(`[${WORKER_ID}] Worker error:`, err);
});

worker.on('stalled', (jobId) => {
  console.warn(`[${WORKER_ID}] Job ${jobId} stalled`);
});

// Graceful shutdown handler
let shuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  console.log(`[${WORKER_ID}] Received ${signal}, shutting down gracefully...`);

  // Stop accepting new jobs
  await worker.close();

  // Stop all heartbeats
  stopAllHeartbeats();

  // Close Redis connection
  await redisConnection.quit();

  console.log(`[${WORKER_ID}] Shutdown complete`);
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error(`[${WORKER_ID}] Uncaught exception:`, error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`[${WORKER_ID}] Unhandled rejection at:`, promise, 'reason:', reason);
});

console.log(`[${WORKER_ID}] Worker started and ready to process jobs`);
