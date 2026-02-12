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

// Must run first so Docker/Railway can use UPSTASH_* and NEXT_PUBLIC_SUPABASE_URL
import './env';

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

// Connect and verify Redis at startup (generates activity in Upstash Monitor)
async function connectRedis() {
  if (redisConnection.status !== 'ready') {
    console.log(`[${WORKER_ID}] Waiting for Redis connection...`);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Redis connection timed out waiting for ready state'));
      }, 10000);

      const onReady = () => {
        clearTimeout(timeout);
        redisConnection.removeListener('error', onError);
        resolve(true);
      };

      const onError = (err: Error) => {
        clearTimeout(timeout);
        redisConnection.removeListener('ready', onReady);
        reject(err);
      };

      redisConnection.once('ready', onReady);
      redisConnection.once('error', onError);
    });
  }

  try {
    const pong = await redisConnection.ping();
    console.log(`[${WORKER_ID}] Redis connected: ${pong}`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${WORKER_ID}] Redis connection failed:`, msg);
    throw err;
  }
}

// Periodic heartbeat so Upstash Monitor shows activity even when idle
const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function startRedisHeartbeat() {
  heartbeatTimer = setInterval(async () => {
    try {
      await redisConnection.ping();
    } catch {
      // Ignore; connection errors are logged elsewhere
    }
  }, HEARTBEAT_INTERVAL_MS);
}

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

// Global worker reference
let worker: Worker<AnalysisJobData, AnalysisJobResult> | undefined;

async function startWorker() {
  // Initialize Redis
  await connectRedis();
  startRedisHeartbeat();

  // Create worker instance
  worker = new Worker<AnalysisJobData, AnalysisJobResult>(
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

  console.log(`[${WORKER_ID}] Worker started and ready to process jobs`);
}

// Start the worker
startWorker().catch((error) => {
  console.error(`[${WORKER_ID}] Fatal error starting worker:`, error);
  process.exit(1);
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
  if (worker) {
    await worker.close();
  }

  // Stop all heartbeats
  stopAllHeartbeats();
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

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

// Health check endpoint for Railway
import express from 'express';
const app = express();

app.get('/health', (req, res) => {
  const healthStatus = {
    status: 'healthy',
    worker: {
      id: WORKER_ID,
      status: worker && !shuttingDown ? 'running' : 'stopped',
      concurrency: CONCURRENCY,
      uptime: process.uptime(),
    },
    redis: {
      status: redisConnection.status,
    },
    system: {
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        limit: Math.round(process.memoryUsage().rss / 1024 / 1024),
      },
      platform: process.platform,
      nodeVersion: process.version,
    },
    timestamp: new Date().toISOString(),
  };

  res.json(healthStatus);
});

app.get('/', (req, res) => {
  res.json({
    service: 'SplicR Analysis Worker',
    version: '1.0.0',
    algorithms: ['MAGeCK', 'BAGEL2', 'DrugZ'],
    status: 'operational',
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`[${WORKER_ID}] Health check server listening on port ${PORT}`);
});


