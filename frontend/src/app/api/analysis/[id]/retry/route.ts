import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { retryJob } from '@/lib/queue/analysis-queue';
import { transitionAnalysisStatus } from '@/lib/queue/db-state';
import { getApiUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Manually retry a failed analysis job
 */
export async function POST(
  _request: NextRequest,
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

    // Check if analysis is in a retryable state
    if (analysis.status !== 'failed') {
      return NextResponse.json(
        { error: `Analysis is in '${analysis.status}' status and cannot be retried` },
        { status: 400 }
      );
    }

    // Check retry limit
    if (analysis.retry_count >= analysis.max_retries) {
      return NextResponse.json(
        { error: `Maximum retries (${analysis.max_retries}) exceeded` },
        { status: 400 }
      );
    }

    // Retry the job if it exists
    if (analysis.job_id) {
      try {
        await retryJob(analysis.job_id);
      } catch (retryError) {
        console.warn('Failed to retry existing job:', retryError);
        // Continue to create new job
      }
    }

    // Reset status to queued
    const transitioned = await transitionAnalysisStatus(analysisId, 'failed', 'queued');
    if (!transitioned) {
      return NextResponse.json(
        { error: 'Failed to transition analysis status' },
        { status: 500 }
      );
    }

    // Reset error fields
    await (supabaseAdmin as any)
      .from('analyses')
      .update({
        error_message: null,
        error_traceback: null,
        progress: 0,
      })
      .eq('id', analysisId);

    return NextResponse.json({
      success: true,
      message: 'Analysis queued for retry',
      analysisId,
      retryCount: analysis.retry_count + 1,
    });
  } catch (error) {
    console.error('Retry analysis error:', error);
    return NextResponse.json(
      { error: 'Failed to retry analysis' },
      { status: 500 }
    );
  }
}
