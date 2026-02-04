# Queue System Documentation

This directory contains the resilient background job processing system for SplicR.

## Files

- `client.ts`: Queue client with REDIS_AVAILABLE flag; use for Run API and other routes
- `analysis-queue.ts`: BullMQ queue configuration and job management
- `job-types.ts`: TypeScript types for jobs and options
- `db-state.ts`: Database state management with atomic operations

## Usage

### Enqueueing a Job (with Redis availability check)

```typescript
import { enqueueAnalysis, REDIS_AVAILABLE, JobPriority } from '@/lib/queue/client';
```

Or directly from analysis-queue:

```typescript
import { enqueueAnalysis, JobPriority } from '@/lib/queue/analysis-queue';
import { markAnalysisQueued } from '@/lib/queue/db-state';

const jobId = await enqueueAnalysis({
  analysisId: '...',
  userId: '...',
  fileNames: [...],
  sampleLabels: [...],
  library: 'brunello',
  algorithms: ['mageck'],
  parameters: {...},
}, {
  priority: JobPriority.NORMAL,
});

await markAnalysisQueued(analysisId, jobId);
```

### Updating Job Status

```typescript
import {
  markAnalysisProcessing,
  markAnalysisComplete,
  markAnalysisFailed,
  updateAnalysisProgress,
} from '@/lib/queue/db-state';

// Start processing
await markAnalysisProcessing(analysisId, workerId, jobId);

// Update progress
await updateAnalysisProgress(analysisId, 50, 'Normalization', logs);

// Complete
await markAnalysisComplete(analysisId, results, logs);

// Fail
await markAnalysisFailed(analysisId, errorMessage, errorTraceback);
```

### Heartbeat Updates

Workers should call `updateAnalysisHeartbeat` every 30 seconds to prove they're alive.

## Database Functions

The migration creates these PostgreSQL functions:

- `transition_analysis_status`: Atomically transition status (prevents race conditions)
- `update_analysis_heartbeat`: Update heartbeat timestamp
- `reset_stuck_jobs`: Reset jobs with stale heartbeats

## Error Handling

All database operations use transactions and row-level locking to prevent race conditions. Failed operations return `false` and log errors.
