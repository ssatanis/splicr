#!/usr/bin/env node

/**
 * Adds is_link_share and related columns to analysis_shares if missing.
 * Run from repo root with DATABASE_URL from frontend/.env.local:
 *
 *   cd frontend && node --env-file=.env.local ../scripts/ensure-analysis-share-columns.mjs
 *
 * Or with explicit env:
 *   DATABASE_URL="postgresql://..." node scripts/ensure-analysis-share-columns.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(scriptDir, '..');
const envPath = join(rootDir, 'frontend', '.env.local');

if (existsSync(envPath)) {
  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eq = trimmed.indexOf('=');
      if (eq > 0) {
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
    }
  }
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL is not set.');
  console.error('   Set it in frontend/.env.local or run:');
  console.error('   cd frontend && node --env-file=.env.local ../scripts/ensure-analysis-share-columns.mjs');
  process.exit(1);
}

const sql = `
DO $$ BEGIN
  CREATE TYPE share_visibility AS ENUM ('private', 'institution', 'public');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.analysis_shares ADD COLUMN IF NOT EXISTS is_link_share BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.analysis_shares ADD COLUMN IF NOT EXISTS visibility share_visibility NOT NULL DEFAULT 'private';
ALTER TABLE public.analysis_shares ADD COLUMN IF NOT EXISTS share_token VARCHAR(64) UNIQUE;
ALTER TABLE public.analysis_shares ADD COLUMN IF NOT EXISTS link_permission TEXT NOT NULL DEFAULT 'view';
ALTER TABLE public.analysis_shares ADD COLUMN IF NOT EXISTS link_expires_at TIMESTAMPTZ;
ALTER TABLE public.analysis_shares ADD COLUMN IF NOT EXISTS institution_domain VARCHAR(255);
ALTER TABLE public.analysis_shares ADD COLUMN IF NOT EXISTS institution_permission TEXT NOT NULL DEFAULT 'view';
ALTER TABLE public.analysis_shares ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Allow multiple email invites per analysis (drop composite unique, add partial unique for link share only)
ALTER TABLE public.analysis_shares DROP CONSTRAINT IF EXISTS analysis_shares_one_link_per_analysis;
CREATE UNIQUE INDEX IF NOT EXISTS idx_analysis_shares_one_link_per_analysis
  ON public.analysis_shares(analysis_id) WHERE is_link_share = true;
`;

async function main() {
  let pg;
  try {
    pg = await import('pg');
  } catch {
    console.error('❌ Optional dependency "pg" is required to run this script.');
    console.error('   From repo root run: npm install pg');
    console.error('   Or run the SQL manually in Supabase Dashboard → SQL Editor:');
    console.error('   See supabase/migrations/20260201120000_ensure_analysis_shares_is_link_share.sql');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: DATABASE_URL });
  try {
    await client.connect();
    await client.query(sql);
    console.log('✅ analysis_shares columns and unique constraint fix are in place. Sharing should work.');
  } catch (err) {
    const code = err.code || '';
    const msg = err.message || '';
    if (code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || msg.includes('getaddrinfo')) {
      console.error('❌ Could not connect to the database:', msg);
      console.error('');
      console.error('   Run the SQL manually in Supabase Dashboard → SQL Editor:');
      console.error('   1. supabase/migrations/20260201120000_ensure_analysis_shares_is_link_share.sql');
      console.error('   2. supabase/migrations/20260201130000_fix_analysis_shares_unique_constraint.sql');
      console.error('');
      console.error('   Or check DATABASE_URL in frontend/.env.local and your network.');
    } else {
      console.error('❌ Migration failed:', msg);
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
