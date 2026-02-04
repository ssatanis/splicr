#!/usr/bin/env node
/**
 * Worker Startup Script
 * 
 * Entry point for running the analysis worker process.
 * Can be used with PM2, systemd, or Docker.
 * 
 * Usage:
 *   npm run worker              # Production mode
 *   npm run worker:dev          # Development mode with watch
 *   pm2 start scripts/start-worker.ts --interpreter tsx
 */

// Load environment variables
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.local if it exists
dotenv.config({ path: path.join(process.cwd(), '.env.local') });
dotenv.config(); // Also load .env

// Validate required environment variables
const requiredEnvVars = ['REDIS_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const missingVars = requiredEnvVars.filter((varName) => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('Missing required environment variables:', missingVars.join(', '));
  console.error('Please set these in your .env.local file');
  process.exit(1);
}

// Import and start worker
import '../src/workers/analysis-worker';
