import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// Admin endpoint to run migrations - should be protected in production
export async function POST() {
  try {
    // Use service role for admin operations
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: 'Supabase credentials not configured' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const results: { file: string; success: boolean; error?: string; statements?: number }[] = [];

    // Get all migration files from supabase/migrations directory
    const migrationsDir = join(process.cwd(), '../supabase/migrations');
    let migrationFiles: string[] = [];

    try {
      migrationFiles = readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort();
    } catch (err) {
      console.log('No migrations directory found, using inline migrations');
    }

    // Run file-based migrations if found
    for (const file of migrationFiles) {
      const filePath = join(migrationsDir, file);
      try {
        const sql = readFileSync(filePath, 'utf-8');
        const statements = sql
          .split(';')
          .map(s => s.trim())
          .filter(s => s.length > 0 && !s.startsWith('--') && !s.match(/^COMMENT ON/));

        let successCount = 0;
        let errorMsg = '';

        for (const statement of statements) {
          if (!statement) continue;

          try {
            const { error } = await (supabase as any).rpc('exec_sql', {
              query: statement + ';'
            });

            if (error) {
              if (
                error.message.includes('already exists') ||
                error.message.includes('duplicate') ||
                error.message.includes('does not exist')
              ) {
                successCount++;
              } else {
                errorMsg = error.message;
              }
            } else {
              successCount++;
            }
          } catch (e: any) {
            if (!e.message?.includes('already exists')) {
              errorMsg = e.message;
            }
          }
        }

        results.push({
          file,
          success: true,
          statements: successCount,
          error: errorMsg || undefined
        });
      } catch (error: any) {
        results.push({ file, success: false, error: error.message });
      }
    }

    // Verify critical tables exist
    const tables = ['profiles', 'analyses', 'analysis_comments', 'analysis_activity', 'activity_logs'];
    const tableStatus: Record<string, boolean> = {};

    for (const table of tables) {
      const { error } = await supabase.from(table).select('*').limit(1);
      tableStatus[table] = !error;
    }

    return NextResponse.json({
      success: true,
      message: 'Migrations completed',
      results,
      tableStatus,
    });
  } catch (error) {
    console.error('Migration error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Migration failed' },
      { status: 500 }
    );
  }
}
