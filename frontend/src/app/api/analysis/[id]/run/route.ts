import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { enqueueAnalysis, retryJob, isRedisAvailable, JobPriority } from '@/lib/queue/client';
import { markAnalysisQueued, transitionAnalysisStatus } from '@/lib/queue/db-state';
import { getApiUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** Allow up to 5 min for inline pipeline (Vercel Pro: 300s) */
export const maxDuration = 300;

const ENQUEUE_TIMEOUT_MS = 8000;

/**
 * Trigger analysis processing (e.g. Retry button).
 * Always enqueues to worker queue. Returns error if Redis/worker unavailable.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  const analysisId = params.id;

  try {
    // Check authentication
    const { user, error: userError } = await getApiUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: analysis, error } = await (supabaseAdmin as any)
      .from('analyses')
      .select('*')
      .eq('id', analysisId)
      .single();

    if (error || !analysis) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }

    // Check if user owns this analysis
    if (analysis.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Check if job already exists in queue (for retry)
    const existingJobId = analysis.job_id;
    if (existingJobId && analysis.status === 'failed') {
      // Try to retry the existing job
      try {
        await retryJob(existingJobId);
        // Reset status to queued
        await transitionAnalysisStatus(analysisId, 'failed', 'queued');
        return NextResponse.json({
          success: true,
          message: 'Analysis job retried',
          analysisId,
          jobId: existingJobId,
        });
      } catch (retryError) {
        console.warn('Failed to retry existing job, creating new one:', retryError);
        // Fall through to create new job
      }
    }

    // Reset analysis state
    await (supabaseAdmin as any)
      .from('analyses')
      .update({
        status: 'pending',
        progress: 0,
        error_message: null,
        error_traceback: null,
        retry_count: 0,
      })
      .eq('id', analysisId);

    const algorithms = Array.isArray(analysis.parameters?.algorithms)
      ? analysis.parameters.algorithms
      : [analysis.method || 'mageck'].filter(Boolean);

    const jobData = {
      analysisId: analysis.id,
      userId: analysis.user_id,
      fileNames: analysis.file_names || [],
      sampleLabels: analysis.sample_labels || [],
      library: analysis.library || 'brunello',
      algorithms,
      parameters: analysis.parameters || {},
    };

    // Try to enqueue when Redis is configured (with timeout), unless force inline
    let enqueued = false;
    let jobId: string | null = null;
    let enqueueError: unknown = null;

    // Always use worker queue when Redis is available
    if (isRedisAvailable()) {
      try {
        jobId = await Promise.race([
          enqueueAnalysis(jobData, { priority: JobPriority.NORMAL }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Queue timeout')), ENQUEUE_TIMEOUT_MS)
          ),
        ]);
        enqueued = true;
      } catch (queueErr) {
        enqueueError = queueErr;
        console.warn('Enqueue failed:', queueErr instanceof Error ? queueErr.message : queueErr);
      }
    }

    if (enqueued && jobId) {
      await markAnalysisQueued(analysisId, jobId);
      return NextResponse.json({
        success: true,
        message: 'Analysis queued for processing',
        analysisId,
        jobId,
        mode: 'worker',
      });
    }

    // If Redis is available but enqueue failed, return error (no inline fallback)
    if (isRedisAvailable()) {
      console.error('Redis execution failed. Worker queue is required.');
      return NextResponse.json({
        error: 'Analysis queuing failed. Please check worker status.',
        details: enqueueError instanceof Error ? enqueueError.message : String(enqueueError)
      }, { status: 503 });
    }

    // No Redis configured - return error with debug info
    console.error('Redis is not configured. Worker queue is required.');
    console.error('Debug Env:', {
      HAS_REDIS_URL: !!process.env.REDIS_URL,
      HAS_UPSTASH_REST: !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
      HAS_UPSTASH_TCP: !!(process.env.UPSTASH_REDIS_ENDPOINT && process.env.UPSTASH_REDIS_PASSWORD),
      RUN_INLINE: process.env.RUN_ANALYSIS_INLINE
    });

    return NextResponse.json({
      error: 'Worker queue is not configured. Please set REDIS_URL environment variable.',
    }, { status: 503 });
  } catch (error) {
    console.error('Run analysis error:', error);
    return NextResponse.json(
      { error: 'Failed to run analysis: ' + (error instanceof Error ? error.message : 'Unknown error') },
      { status: 500 }
    );
  }
}
