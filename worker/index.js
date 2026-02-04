#!/usr/bin/env node
/**
 * Docker Worker Entrypoint
 *
 * Validates environment, loads env files, and runs the SplicR TypeScript worker
 * (frontend/scripts/start-worker.ts). All analysis logic lives in the frontend
 * codebase (queue, pipeline, Supabase, R2).
 */

const path = require('path');
const { spawn } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const frontendDir = path.join(projectRoot, 'frontend');

// Env is provided by Docker (-e, --env-file) or by the child (start-worker.ts loads frontend/.env.local)

function validateEnv() {
  const redisUrl = process.env.REDIS_URL;
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const missing = [];
  if (!redisUrl || redisUrl.trim() === '') missing.push('REDIS_URL');
  if (!supabaseUrl || supabaseUrl.trim() === '')
    missing.push('NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL');
  if (!serviceRoleKey || serviceRoleKey.trim() === '')
    missing.push('SUPABASE_SERVICE_ROLE_KEY');

  if (missing.length > 0) {
    console.error(
      'Missing required environment variables:',
      missing.join(', ')
    );
    console.error(
      'Set them in the container (e.g. -e REDIS_URL=... -e SUPABASE_SERVICE_ROLE_KEY=...) or mount .env.local'
    );
    process.exit(1);
  }

  // Ensure frontend worker script exists
  const startWorkerPath = path.join(frontendDir, 'scripts', 'start-worker.ts');
  const fs = require('fs');
  if (!fs.existsSync(startWorkerPath)) {
    console.error('Worker script not found:', startWorkerPath);
    process.exit(1);
  }
}

// Forward SUPABASE_URL for server code if only NEXT_PUBLIC is set
function normalizeEnv() {
  if (
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !process.env.SUPABASE_URL
  ) {
    process.env.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  }
}

normalizeEnv();
validateEnv();

console.log('Worker entrypoint: starting TypeScript worker in frontend...');

const child = spawn(
  'npx',
  ['tsx', 'scripts/start-worker.ts'],
  {
    cwd: frontendDir,
    stdio: 'inherit',
    env: process.env,
    shell: false,
  }
);

child.on('error', (err) => {
  console.error('Failed to start worker:', err);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error('Worker killed by signal:', signal);
    process.exit(128 + (signal === 'SIGKILL' ? 9 : 15));
  }
  process.exit(code ?? 0);
});
