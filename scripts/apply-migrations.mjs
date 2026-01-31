#!/usr/bin/env node

/**
 * Simple migration runner for Supabase
 * Executes SQL migration files directly using Supabase REST API
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIGRATIONS_DIR = join(__dirname, '../supabase/migrations');

async function runMigrations() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error('❌ Missing environment variables:');
    console.error('   NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? '✓' : '✗');
    console.error('   SUPABASE_SERVICE_ROLE_KEY:', serviceKey ? '✓' : '✗');
    console.error('\n💡 Make sure your .env.local file is configured');
    process.exit(1);
  }

  console.log('🚀 Starting Supabase migrations...\n');

  // Get all migration files sorted by name
  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.error('❌ No migration files found in', MIGRATIONS_DIR);
    process.exit(1);
  }

  console.log(`📁 Found ${files.length} migration file(s):`);
  files.forEach(f => console.log(`   - ${f}`));
  console.log();

  for (const file of files) {
    const filePath = join(MIGRATIONS_DIR, file);
    console.log(`\n📄 Running: ${file}`);

    try {
      const sql = readFileSync(filePath, 'utf-8');

      // Execute the entire SQL file
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ query: sql })
      });

      if (!response.ok) {
        const errorText = await response.text();
        // Check if it's just "already exists" errors which are okay
        if (errorText.includes('already exists') || errorText.includes('duplicate')) {
          console.log(`   ⚠️  Some objects already exist (skipping)`);
          console.log(`   ✅ ${file} completed with warnings`);
        } else {
          console.error(`   ❌ Failed: ${errorText}`);
        }
      } else {
        console.log(`   ✅ ${file} completed successfully`);
      }
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}`);
    }
  }

  console.log('\n\n🔍 Verifying tables...\n');

  // Verify each table exists
  const tables = [
    'profiles',
    'analyses',
    'analysis_shares',
    'analysis_comments',
    'analysis_activity',
    'activity_logs',
    'comment_reactions'
  ];

  for (const table of tables) {
    try {
      const response = await fetch(
        `${supabaseUrl}/rest/v1/${table}?select=*&limit=0`,
        {
          headers: {
            'apikey': serviceKey,
            'Authorization': `Bearer ${serviceKey}`
          }
        }
      );

      if (response.ok) {
        console.log(`   ✅ ${table.padEnd(25)} OK`);
      } else {
        console.log(`   ❌ ${table.padEnd(25)} NOT FOUND`);
      }
    } catch (error) {
      console.log(`   ❌ ${table.padEnd(25)} ERROR: ${error.message}`);
    }
  }

  console.log('\n✨ Migration process complete!\n');
}

// Load .env.local if it exists
try {
  const envPath = join(__dirname, '../frontend/.env.local');
  const envContent = readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const [, key, value] = match;
      process.env[key.trim()] = value.trim().replace(/^["']|["']$/g, '');
    }
  });
} catch (err) {
  console.log('⚠️  Could not load .env.local, using existing environment variables\n');
}

runMigrations().catch(console.error);
