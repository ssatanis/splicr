#!/usr/bin/env node
/**
 * Stuck Job Monitor
 * 
 * Cron job that runs periodically to detect and reset stuck jobs.
 * Jobs are considered stuck if status='processing' but last_heartbeat > 5 minutes ago.
 * 
 * Run this as a cron job or scheduled task (every 5 minutes).
 * Example cron: 0,5,10,15... minutes — use your scheduler's "every 5 min" or equivalent.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env.local') });
dotenv.config();

import { resetStuckJobs } from '../src/lib/queue/db-state';

async function main() {
  console.log(`[${new Date().toISOString()}] Checking for stuck jobs...`);

  try {
    const resetJobs = await resetStuckJobs();

    if (resetJobs.length === 0) {
      console.log('No stuck jobs found');
      return;
    }

    console.log(`Found ${resetJobs.length} stuck job(s):`);
    resetJobs.forEach((job: any) => {
      console.log(
        `  - Analysis ${job.analysis_id}: ${job.old_status} -> ${job.old_status === 'processing' ? (job.retry_count < job.max_retries ? 'queued' : 'failed') : 'unknown'} (retry ${job.retry_count + 1}/${job.max_retries})`
      );
    });
  } catch (error) {
    console.error('Error monitoring stuck jobs:', error);
    process.exit(1);
  }
}

main()
  .then(() => {
    console.log('Stuck job monitor completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
