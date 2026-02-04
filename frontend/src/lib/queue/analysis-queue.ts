/**
 * BullMQ Queue Configuration for Analysis Jobs
 *
 * This queue manages all CRISPR screening analysis jobs.
 * Jobs persist in Redis and survive server restarts.
 * When Redis is unavailable, enqueue fails fast so the API can still create the analysis
 * and the user can start it manually from the results page.
 */

import { Queue, QueueOptions } from 'bullmq';
import IORedis from 'ioredis';
import { AnalysisJobData, JobOptions, JobPriority } from './job-types';

export { JobPriority };

const REDIS_CONNECT_TIMEOUT_MS = 4000;
const REDIS_MAX_RETRIES = 2;

let connection: IORedis | null = null;
let queue: Queue<AnalysisJobData> | null = null;
let lastRedisErrorLog = 0;
const REDIS_ERROR_LOG_INTERVAL_MS = 60000;

function createRedisConnection(): IORedis {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const redisPassword = process.env.REDIS_PASSWORD;
  const redisDb = parseInt(process.env.REDIS_DB || '0', 10);

  let host = 'localhost';
  let port = 6379;
  let password = redisPassword;
  let useTls = false;

  if (redisUrl.startsWith('redis://') || redisUrl.startsWith('rediss://')) {
    useTls = redisUrl.startsWith('rediss://');
    try {
      const url = new URL(redisUrl);
      host = url.hostname;
      port = parseInt(url.port || '6379', 10);
      password = password || url.password || undefined;
    } catch (e) {
      console.warn('Failed to parse REDIS_URL, using defaults');
    }
  }

  const conn = new IORedis({
    host,
    port,
    password,
    db: redisDb,
    maxRetriesPerRequest: REDIS_MAX_RETRIES,
    retryStrategy: (times) => {
      if (times > REDIS_MAX_RETRIES) return null;
      return Math.min(times * 200, 1500);
    },
    enableReadyCheck: true,
    enableOfflineQueue: false,
    lazyConnect: true,
    connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
    ...(useTls && { tls: {} }),
  });

  conn.on('error', (err) => {
    const now = Date.now();
    if (now - lastRedisErrorLog > REDIS_ERROR_LOG_INTERVAL_MS) {
      lastRedisErrorLog = now;
      console.warn('Redis connection error (suppressing repeat logs):', err?.message || err);
    }
  });

  conn.on('connect', () => {
    console.log('Redis connected successfully');
  });

  return conn;
}

function getConnection(): IORedis {
  if (!connection) {
    connection = createRedisConnection();
  }
  return connection;
}

function getQueue(): Queue<AnalysisJobData> {
  if (!queue) {
    const conn = getConnection();
    const queueOptions: QueueOptions = {
      connection: conn,
      defaultJobOptions: {
        removeOnComplete: {
          age: 7 * 24 * 60 * 60,
          count: 1000,
        },
        removeOnFail: {
          age: 30 * 24 * 60 * 60,
          count: 500,
        },
        timeout: parseInt(process.env.QUEUE_JOB_TIMEOUT_MS || '14400000', 10),
        attempts: parseInt(process.env.QUEUE_MAX_RETRIES || '3', 10),
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      } as any,
    };
    queue = new Queue<AnalysisJobData>('analysis-jobs', queueOptions);
  }
  return queue;
}

export const analysisQueue = new Proxy({} as Queue<AnalysisJobData>, {
  get(_, prop) {
    return (getQueue() as any)[prop];
  },
});

/**
 * Add an analysis job to the queue.
 * Fails fast if Redis is unavailable (connection timeout 4s, few retries).
 */
export async function enqueueAnalysis(
  data: AnalysisJobData,
  options: JobOptions = {}
): Promise<string> {
  const {
    priority = JobPriority.NORMAL,
    attempts = parseInt(process.env.QUEUE_MAX_RETRIES || '3', 10),
    backoff = {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete = {
      age: 7 * 24 * 60 * 60,
      count: 1000,
    },
    removeOnFail = {
      age: 30 * 24 * 60 * 60,
      count: 500,
    },
    timeout = parseInt(process.env.QUEUE_JOB_TIMEOUT_MS || '14400000', 10),
  } = options;

  const q = getQueue();
  const job = await q.add(
    `analysis-${data.analysisId}`,
    data,
    {
      priority,
      attempts,
      backoff,
      removeOnComplete,
      removeOnFail,
      timeout,
      jobId: `analysis-${data.analysisId}`,
    } as any
  );

  return job.id!;
}

/**
 * Get job status from queue
 */
export async function getJobStatus(jobId: string) {
  try {
    const q = getQueue();
    const job = await q.getJob(jobId);
    if (!job) return null;

    const state = await job.getState();
    const progress = job.progress || 0;
    const returnvalue = job.returnvalue;
    const failedReason = job.failedReason;

    return {
      id: job.id,
      state,
      progress,
      returnvalue,
      failedReason,
      attemptsMade: job.attemptsMade,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
    };
  } catch {
    return null;
  }
}

/**
 * Remove a job from the queue
 */
export async function removeJob(jobId: string) {
  try {
    const q = getQueue();
    const job = await q.getJob(jobId);
    if (job) await job.remove();
  } catch {
    // ignore when Redis unavailable
  }
}

/**
 * Retry a failed job
 */
export async function retryJob(jobId: string) {
  try {
    const q = getQueue();
    const job = await q.getJob(jobId);
    if (job) await job.retry();
  } catch {
    // ignore when Redis unavailable
  }
}

/**
 * Get queue metrics
 */
export async function getQueueMetrics() {
  try {
    const q = getQueue();
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      q.getWaitingCount(),
      q.getActiveCount(),
      q.getCompletedCount(),
      q.getFailedCount(),
      q.getDelayedCount(),
    ]);
    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
      total: waiting + active + completed + failed + delayed,
    };
  } catch {
    return {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      total: 0,
    };
  }
}

/**
 * Clean up old jobs (called periodically)
 */
export async function cleanupOldJobs() {
  try {
    const q = getQueue();
    const completed = await q.getCompleted();
    const failed = await q.getFailed();
    console.log(`Queue cleanup: ${completed.length} completed, ${failed.length} failed jobs`);
  } catch {
    // ignore when Redis unavailable
  }
}

/**
 * Close queue connection (for graceful shutdown)
 */
export async function closeQueue() {
  if (queue) {
    await queue.close();
    queue = null;
  }
  if (connection) {
    await connection.quit();
    connection = null;
  }
}

/** For worker and health checks; lazily creates connection on first use */
export const redisConnection = new Proxy({} as IORedis, {
  get(_, prop) {
    return (getConnection() as any)[prop];
  },
});
