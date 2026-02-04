import { NextResponse } from 'next/server';
import { redisConnection } from '@/lib/queue/analysis-queue';
import { supabaseAdmin } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Overall health check endpoint
 * Checks all critical services
 */
export async function GET() {
  const checks: Record<string, { status: string; error?: string }> = {};

  // Check Redis
  try {
    const pingResult = await redisConnection.ping();
    checks.redis = pingResult === 'PONG' ? { status: 'healthy' } : { status: 'unhealthy', error: 'Ping failed' };
  } catch (error) {
    checks.redis = { status: 'unhealthy', error: error instanceof Error ? error.message : 'Unknown error' };
  }

  // Check Database
  try {
    const admin = supabaseAdmin as any;
    const { error } = await admin.from('analyses').select('id').limit(1);
    checks.database = error ? { status: 'unhealthy', error: error.message } : { status: 'healthy' };
  } catch (error) {
    checks.database = { status: 'unhealthy', error: error instanceof Error ? error.message : 'Unknown error' };
  }

  const allHealthy = Object.values(checks).every((check) => check.status === 'healthy');
  const statusCode = allHealthy ? 200 : 503;

  return NextResponse.json(
    {
      status: allHealthy ? 'healthy' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    },
    { status: statusCode }
  );
}
