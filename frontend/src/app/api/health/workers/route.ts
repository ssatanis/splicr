import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Health check endpoint for worker monitoring
 * Returns active worker count and their last heartbeats
 */
export async function GET() {
  try {
    const admin = supabaseAdmin as any;

    // Get all processing analyses with worker info
    const { data: activeJobs, error } = await admin
      .from('analyses')
      .select('id, worker_id, last_heartbeat, status, current_step, progress')
      .eq('status', 'processing');

    if (error) {
      throw error;
    }

    // Group by worker
    const workers = new Map<string, any[]>();
    activeJobs?.forEach((job: any) => {
      if (job.worker_id) {
        if (!workers.has(job.worker_id)) {
          workers.set(job.worker_id, []);
        }
        workers.get(job.worker_id)!.push(job);
      }
    });

    // Calculate worker stats
    const workerStats = Array.from(workers.entries()).map(([workerId, jobs]) => {
      const lastHeartbeat = jobs.reduce((latest, job) => {
        if (!job.last_heartbeat) return latest;
        const hb = new Date(job.last_heartbeat).getTime();
        return hb > latest ? hb : latest;
      }, 0);

      return {
        workerId,
        activeJobs: jobs.length,
        lastHeartbeat: lastHeartbeat > 0 ? new Date(lastHeartbeat).toISOString() : null,
        jobs: jobs.map((j: any) => ({
          analysisId: j.id,
          progress: j.progress,
          step: j.current_step,
          lastHeartbeat: j.last_heartbeat,
        })),
      };
    });

    return NextResponse.json({
      status: 'healthy',
      service: 'workers',
      activeWorkers: workers.size,
      totalActiveJobs: activeJobs?.length || 0,
      workers: workerStats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Workers health check error:', error);
    return NextResponse.json(
      {
        status: 'unhealthy',
        service: 'workers',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 503 }
    );
  }
}
