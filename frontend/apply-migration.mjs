#!/usr/bin/env node

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

// Load .env.local
const envPath = new URL('.env.local', import.meta.url);
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

async function applyMigration() {
  console.log('\n🚀 Applying database migration...\n');

  const migrationPath = new URL('../supabase/migrations/20260131000000_add_collaboration_tables.sql', import.meta.url);
  const sql = readFileSync(migrationPath, 'utf-8');

  // Split into individual statements
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  let success = 0;
  let errors = 0;

  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i];
    if (!statement) continue;

    try {
      const { error } = await supabase.rpc('exec_sql', { query: statement + ';' });

      if (error) {
        if (error.message.includes('already exists') || error.message.includes('does not exist')) {
          success++;
        } else {
          console.error(`   ❌ Statement ${i + 1}: ${error.message}`);
          errors++;
        }
      } else {
        success++;
      }
    } catch (err) {
      // Try using direct query if RPC doesn't work
      try {
        const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
          },
          body: JSON.stringify({ query: statement + ';' })
        });

        if (response.ok || await response.text().then(t => t.includes('already exists'))) {
          success++;
        } else {
          errors++;
        }
      } catch (fallbackErr) {
        console.error(`   ❌ Error: ${err.message}`);
        errors++;
      }
    }
  }

  console.log(`\n✅ Migration complete: ${success} statements executed, ${errors} errors\n`);

  // Verify tables
  console.log('🔍 Verifying tables...\n');
  const tables = ['analysis_comments', 'analysis_activity', 'activity_logs', 'comment_reactions'];

  for (const table of tables) {
    const { error } = await supabase.from(table).select('*').limit(1);
    console.log(`   ${error ? '❌' : '✅'} ${table.padEnd(25)} ${error ? 'NOT FOUND' : 'CREATED'}`);
  }
  console.log();
}

applyMigration().catch(console.error);
