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

// Normalize env for worker: SUPABASE_URL from NEXT_PUBLIC, REDIS_URL from Upstash if needed
if (process.env.NEXT_PUBLIC_SUPABASE_URL && !process.env.SUPABASE_URL) {
  process.env.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
}
if (!process.env.REDIS_URL?.trim()) {
  const endpoint = process.env.UPSTASH_REDIS_ENDPOINT?.trim();
  const password = process.env.UPSTASH_REDIS_PASSWORD?.trim();
  if (endpoint && password) {
    const host = endpoint.replace(/^https?:\/\//, '').replace(/\/$/, '');
    process.env.REDIS_URL = `rediss://default:${encodeURIComponent(password)}@${host}:6379`;
  } else if (process.env.UPSTASH_REDIS_REST_URL?.trim() && process.env.UPSTASH_REDIS_REST_TOKEN?.trim()) {
    try {
      const host = new URL(process.env.UPSTASH_REDIS_REST_URL).hostname;
      process.env.REDIS_URL = `rediss://default:${encodeURIComponent(process.env.UPSTASH_REDIS_REST_TOKEN)}@${host}:6379`;
    } catch {
      // ignore
    }
  }
}

const hasRedis = !!process.env.REDIS_URL?.trim();
const hasSupabase = !!process.env.SUPABASE_URL?.trim();
const hasServiceKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!hasRedis || !hasSupabase || !hasServiceKey) {
  const missing = [];
  if (!hasRedis) missing.push('REDIS_URL or UPSTASH_REDIS_REST_*');
  if (!hasSupabase) missing.push('SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL');
  if (!hasServiceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  console.error('Missing required environment variables:', missing.join(', '));
  console.error('Please set these in your .env.local or Railway Variables');
  process.exit(1);
}

// Import and start worker
// Import and start worker (dynamic import to ensure env vars are loaded first)
import('../src/workers/analysis-worker').catch((err) => {
  console.error('Failed to load worker module:', err);
  process.exit(1);
});
