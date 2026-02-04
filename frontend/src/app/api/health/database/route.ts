import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Health check endpoint for database connection
 */
export async function GET() {
  try {
    const admin = supabaseAdmin as any;

    // Simple query to test connection
    const { error } = await admin
      .from('analyses')
      .select('id')
      .limit(1);

    if (error) {
      throw error;
    }

    return NextResponse.json({
      status: 'healthy',
      service: 'database',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Database health check error:', error);
    return NextResponse.json(
      {
        status: 'unhealthy',
        service: 'database',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 503 }
    );
  }
}
