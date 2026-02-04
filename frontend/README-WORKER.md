# Resilient Background Job Processing System

This document describes the resilient background job processing system for SplicR's CRISPR screening analyses.

## Architecture Overview

The system uses **BullMQ** + **Redis** for job queuing and **PostgreSQL** as the single source of truth. Jobs persist independently of client connections and continue running even when users close their browser.

```
┌─────────────┐
│   Browser   │ (can close anytime)
└──────┬──────┘
       │ POST /api/analyses
       ▼
┌─────────────────┐
│  Next.js API    │ (validates, creates DB record, enqueues)
└──────┬──────────┘
       │ Enqueue job
       ▼
┌─────────────────┐
│  Redis Queue    │ (BullMQ - persistent job storage)
│  (Job: #12345)  │
└──────┬──────────┘
       │ Worker pulls job
       ▼
┌─────────────────┐
│  Worker Process │ (separate Node.js process, runs pipeline)
│  Updates DB     │ (progress, status, results every 5 seconds)
└──────┬──────────┘
       │ Results
       ▼
┌─────────────────┐
│  PostgreSQL DB  │ (single source of truth for job state)
└─────────────────┘
```

## Key Features

- ✅ **Resilient**: Jobs continue running even if browser closes
- ✅ **Fault-tolerant**: Automatic retries with exponential backoff
- ✅ **Recoverable**: Checkpoint/resume support for long-running jobs
- ✅ **Monitorable**: Real-time status updates and health checks
- ✅ **Scalable**: Horizontal scaling with multiple workers
- ✅ **Observable**: Comprehensive logging and metrics

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env.local` and configure.

#### Upstash Redis (recommended for production)

1. Create a Redis database at [Upstash Console](https://console.upstash.com/)
2. Copy your endpoint and token from the Redis details page
3. Use `rediss://` (double s) for TLS (required by Upstash):

```bash
REDIS_URL=rediss://default:YOUR_UPSTASH_TOKEN@striking-wallaby-46693.upstash.io:6379
```

#### Local Redis

```bash
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=
REDIS_DB=0
```

#### Queue Settings

```bash
QUEUE_CONCURRENCY=4
QUEUE_MAX_RETRIES=3
QUEUE_JOB_TIMEOUT_MS=14400000  # 4 hours
```

### 3. Run Database Migration

Apply the migration to add resilient job processing fields:

```bash
# Using Supabase CLI or your migration tool
supabase migration up
```

### 4. Start Redis (skip if using Upstash)

```bash
# Using Docker (local development)
docker run -d -p 6379:6379 redis:7-alpine

# Upstash: No local Redis needed — just set REDIS_URL in .env.local
```

### 5. Start Worker Process

```bash
# Development mode (with watch)
npm run worker:dev

# Production mode
npm run worker

# Using PM2
pm2 start scripts/start-worker.ts --interpreter tsx --name splicr-worker
```

## Usage

### Creating an Analysis

When you create an analysis via `POST /api/analysis/create`, it automatically:
1. Creates the analysis record in the database with status `pending`
2. Enqueues the job in Redis
3. Marks the analysis as `queued`
4. Returns immediately (non-blocking)

### Starting an Analysis

Use `POST /api/analysis/[id]/run` to start or retry an analysis. This:
1. Enqueues the job in Redis
2. Marks the analysis as `queued`
3. Worker picks it up and processes it

### Monitoring Status

Poll `GET /api/analysis/[id]/status` to get real-time updates:
- `status`: pending | queued | processing | complete | failed
- `progress`: 0-100
- `currentStep`: Human-readable step name
- `logs`: Recent log entries

### Retrying Failed Jobs

Use `POST /api/analysis/[id]/retry` to manually retry a failed job.

## Worker Management

### Starting Workers

Workers can run on the same server or separate instances. All workers connect to the same Redis instance and automatically distribute jobs.

```bash
# Start multiple workers
WORKER_ID=worker-1 npm run worker &
WORKER_ID=worker-2 npm run worker &
WORKER_ID=worker-3 npm run worker &
```

### Graceful Shutdown

Workers handle `SIGTERM` and `SIGINT` gracefully:
1. Stop accepting new jobs
2. Finish current jobs
3. Close Redis connections
4. Exit cleanly

### Monitoring Workers

Check worker health:
```bash
curl http://localhost:3000/api/health/workers
```

## Stuck Job Detection

A cron job detects and resets stuck jobs (status='processing' but no heartbeat in 5+ minutes):

```bash
# Run every 5 minutes
*/5 * * * * cd /path/to/project && npm run monitor:stuck-jobs
```

Or use the API endpoint (if you have a cron service):
```bash
curl http://localhost:3000/api/health/workers
```

## Health Checks

- `GET /api/health` - Overall system health
- `GET /api/health/queue` - Queue and Redis health
- `GET /api/health/workers` - Active workers and their jobs
- `GET /api/health/database` - Database connection health

## Database Schema

The `analyses` table includes these fields for resilient processing:

- `status`: ENUM (pending, queued, processing, complete, failed, cancelled)
- `job_id`: Redis job ID reference
- `worker_id`: ID of worker processing this job
- `retry_count`: Number of retries attempted
- `max_retries`: Maximum retries allowed (default: 3)
- `checkpoint_data`: JSONB checkpoint for resume
- `last_heartbeat`: Timestamp of last worker heartbeat
- `error_traceback`: Full error traceback for debugging

## Job Priorities

- **HIGH (1)**: Paid users, re-runs
- **NORMAL (5)**: Default priority
- **LOW (10)**: Batch jobs, scheduled analyses

## Retry Strategy

- **Retry 1**: Wait 5 seconds
- **Retry 2**: Wait 30 seconds  
- **Retry 3**: Wait 2 minutes
- **After 3 retries**: Mark as failed, move to dead letter queue

## Checkpointing

After each major step (Quality Control, Normalization, Hit Calling, Visualization), the system saves checkpoint data. If a job fails and is retried, it can resume from the last checkpoint.

## Production Deployment

### Using PM2

```bash
# Start worker
pm2 start scripts/start-worker.ts --interpreter tsx --name splicr-worker

# Monitor
pm2 logs splicr-worker

# Restart
pm2 restart splicr-worker
```

### Using Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
CMD ["npm", "run", "worker"]
```

### Using Kubernetes

Deploy workers as a Deployment with:
- Horizontal Pod Autoscaler for scaling
- Liveness/Readiness probes using `/api/health/workers`
- Resource limits to prevent OOM

## Troubleshooting

### Jobs Not Processing

1. Check Redis connection: `curl http://localhost:3000/api/health/queue`
2. Check workers are running: `curl http://localhost:3000/api/health/workers`
3. Check queue metrics: Look at `waiting` count in queue health endpoint

### Stuck Jobs

Run the stuck job monitor:
```bash
npm run monitor:stuck-jobs
```

### Worker Crashes

Check logs for errors. Workers automatically retry failed jobs. If a worker crashes mid-job, the stuck job detector will reset it after 5 minutes.

### High Memory Usage

Reduce `QUEUE_CONCURRENCY` to process fewer jobs simultaneously.

## Performance Tuning

- **Concurrency**: Adjust `QUEUE_CONCURRENCY` based on CPU cores (default: 4)
- **Heartbeat Interval**: Reduce `WORKER_HEARTBEAT_INTERVAL_MS` for faster stuck detection (default: 30s)
- **Progress Updates**: Adjust `WORKER_PROGRESS_UPDATE_INTERVAL_MS` for update frequency (default: 5s)

## Monitoring & Observability

- Queue metrics available at `/api/health/queue`
- Worker status at `/api/health/workers`
- Database queries logged for debugging
- All errors include full tracebacks in `error_traceback` field

## Security Considerations

- Workers use service role key for database access (never expose to clients)
- Redis should be password-protected in production
- Use TLS for Redis connections in production
- Workers run with minimal permissions
