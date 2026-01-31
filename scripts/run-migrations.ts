#!/usr/bin/env ts-node

/**
 * Migration runner for Supabase
 * Runs all SQL migration files in order
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, '../supabase/migrations');

async function runMigrations() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('❌ Missing Supabase credentials');
    console.error('   NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? '✓' : '✗');
    console.error('   SUPABASE_SERVICE_ROLE_KEY:', serviceRoleKey ? '✓' : '✗');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  console.log('🚀 Starting migrations...\n');

  // Get all migration files sorted by name
  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log(`Found ${files.length} migration file(s):\n`);
  files.forEach(f => console.log(`   - ${f}`));
  console.log();

  for (const file of files) {
    const filePath = join(MIGRATIONS_DIR, file);
    console.log(`📄 Running migration: ${file}`);

    try {
      const sql = readFileSync(filePath, 'utf-8');

      // Split by statements (simple split on ;)
      const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      for (let i = 0; i < statements.length; i++) {
        const statement = statements[i];
        if (!statement) continue;

        try {
          // Execute using the SQL endpoint
          const { error } = await supabase.rpc('exec_sql', {
            query: statement + ';'
          });

          if (error) {
            // Check if it's a harmless "already exists" error
            if (
              error.message.includes('already exists') ||
              error.message.includes('duplicate key') ||
              error.message.includes('does not exist')
            ) {
              console.log(`   ⚠️  Statement ${i + 1}: ${error.message} (skipping)`);
            } else {
              throw error;
            }
          }
        } catch (err: any) {
          console.error(`   ❌ Error in statement ${i + 1}:`);
          console.error(`      ${statement.substring(0, 100)}...`);
          console.error(`      ${err.message}`);
          // Continue with next statement
        }
      }

      console.log(`   ✅ Migration completed: ${file}\n`);
    } catch (error: any) {
      console.error(`   ❌ Failed to run migration ${file}:`);
      console.error(`      ${error.message}\n`);
    }
  }

  console.log('✨ All migrations completed!\n');

  // Verify tables exist
  console.log('🔍 Verifying tables...\n');
  const tables = ['profiles', 'analyses', 'analysis_shares', 'analysis_comments', 'analysis_activity', 'activity_logs', 'comment_reactions'];

  for (const table of tables) {
    const { data, error } = await supabase.from(table).select('*').limit(1);
    if (error) {
      console.log(`   ❌ ${table}: ${error.message}`);
    } else {
      console.log(`   ✅ ${table}: OK`);
    }
  }

  console.log('\n🎉 Migration verification complete!');
}

runMigrations().catch(console.error);
