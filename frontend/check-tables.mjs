#!/usr/bin/env node

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

// Load .env.local
const envPath = new URL('../frontend/.env.local', import.meta.url);
const envContent = readFileSync(envPath, 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) {
    const [, key, value] = match;
    env[key.trim()] = value.trim().replace(/^["']|["']$/g, '');
  }
});

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

async function checkTables() {
  console.log('\n🔍 Checking database tables...\n');
  const tables = ['profiles', 'analyses', 'analysis_shares', 'analysis_comments', 'analysis_activity', 'activity_logs', 'comment_reactions'];

  for (const table of tables) {
    const { error } = await supabase.from(table).select('*').limit(1);
    console.log(`   ${error ? '❌' : '✅'} ${table.padEnd(25)} ${error ? 'NOT FOUND' : 'EXISTS'}`);
  }
  console.log();
}

checkTables().catch(console.error);
