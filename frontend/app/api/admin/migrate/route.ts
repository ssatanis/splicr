import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

    // Create analyses table if it doesn't exist
    // Using individual statements since Supabase REST API doesn't support multi-statement
    const migrations = [
      // Create the table
      `CREATE TABLE IF NOT EXISTS analyses (
        id TEXT PRIMARY KEY,
        user_id UUID NOT NULL,
        name TEXT NOT NULL,
        library_type TEXT NOT NULL,
        method TEXT NOT NULL DEFAULT 'mageck',
        file_names TEXT[] NOT NULL DEFAULT '{}',
        parameters JSONB DEFAULT '{}',
        sample_labels JSONB,
        status TEXT NOT NULL DEFAULT 'pending',
        progress INTEGER NOT NULL DEFAULT 0,
        current_step TEXT,
        results JSONB,
        logs JSONB,
        error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ
      )`,
      // Add indexes
      `CREATE INDEX IF NOT EXISTS idx_analyses_user_id ON analyses(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_analyses_status ON analyses(status)`,
      `CREATE INDEX IF NOT EXISTS idx_analyses_created_at ON analyses(created_at DESC)`,
    ];

    const results: { sql: string; success: boolean; error?: string }[] = [];

    for (const sql of migrations) {
      const { error } = await supabase.rpc('exec_sql', { query: sql }).maybeSingle();
      if (error && !error.message.includes('already exists')) {
        results.push({ sql: sql.substring(0, 50) + '...', success: false, error: error.message });
      } else {
        results.push({ sql: sql.substring(0, 50) + '...', success: true });
      }
    }

    // Try direct insert to test
    const testResult = await supabase
      .from('analyses')
      .select('id')
      .limit(1);

    return NextResponse.json({
      success: true,
      message: 'Migration attempted',
      results,
      tableExists: !testResult.error,
      tableError: testResult.error?.message,
    });
  } catch (error) {
    console.error('Migration error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Migration failed' },
      { status: 500 }
    );
  }
}
