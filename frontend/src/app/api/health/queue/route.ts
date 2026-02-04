import { NextResponse } from 'next/server';
import { getQueueMetrics, redisConnection } from '@/lib/queue/analysis-queue';

export const dynamic = 'force-dynamic';

/**
 * Health check endpoint for queue system
 */
export async function GET() {
  try {
    // Check Redis connection
    const pingResult = await redisConnection.ping();
    if (pingResult !== 'PONG') {
      return NextResponse.json(
        {
          status: 'unhealthy',
          service: 'queue',
          error: 'Redis connection failed',
        },
        { status: 503 }
      );
    }

    // Get queue metrics
    const metrics = await getQueueMetrics();

    return NextResponse.json({
      status: 'healthy',
      service: 'queue',
      redis: 'connected',
      metrics,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Queue health check error:', error);
    return NextResponse.json(
      {
        status: 'unhealthy',
        service: 'queue',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 503 }
    );
  }
}
