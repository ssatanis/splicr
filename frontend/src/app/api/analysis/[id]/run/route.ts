import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { enqueueAnalysis, retryJob, REDIS_AVAILABLE, JobPriority } from '@/lib/queue/client';
import { markAnalysisQueued, transitionAnalysisStatus } from '@/lib/queue/db-state';
import { getApiUser } from '@/lib/supabase/server';
import { runAnalysisPipeline } from '@/lib/runAnalysisPipeline';

export const dynamic = 'force-dynamic';

/** Allow up to 5 min for inline pipeline (Vercel Pro: 300s) */
export const maxDuration = 300;

const ENQUEUE_TIMEOUT_MS = 8000;

/**
 * Trigger analysis processing (e.g. Retry button).
 * Tries to enqueue; if Redis/worker unavailable or ?inline=true, runs pipeline inline (Vercel-friendly).
 * Use ?inline=true when worker is stuck (e.g. queued for 90+ sec) to run analysis directly in the API.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  const analysisId = params.id;
  const url = new URL(request.url);
  const forceInline = url.searchParams.get('inline') === 'true' || url.searchParams.get('inline') === '1';

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
    if (REDIS_AVAILABLE && !forceInline) {
      try {
        jobId = await Promise.race([
          enqueueAnalysis(jobData, { priority: JobPriority.NORMAL }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Queue timeout')), ENQUEUE_TIMEOUT_MS)
          ),
        ]);
        enqueued = true;
      } catch (queueErr) {
        console.warn('Enqueue failed, running pipeline inline:', queueErr instanceof Error ? queueErr.message : queueErr);
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

    // Fallback: run pipeline inline (Vercel / no Redis / no worker)
    await (supabaseAdmin as any)
      .from('analyses')
      .update({ status: 'running', current_step: 'Starting' })
      .eq('id', analysisId);

    await runAnalysisPipeline(analysisId, analysis);

    return NextResponse.json({
      success: true,
      message: 'Analysis completed inline',
      analysisId,
      mode: 'inline',
    });
  } catch (error) {
    console.error('Run analysis error:', error);
    return NextResponse.json(
      { error: 'Failed to run analysis: ' + (error instanceof Error ? error.message : 'Unknown error') },
      { status: 500 }
    );
  }
}
