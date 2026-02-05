import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { getApiUser } from '@/lib/supabase/server';
import { removeJob } from '@/lib/queue/analysis-queue';

export const dynamic = 'force-dynamic';

const CANCELLABLE_STATUSES = ['pending', 'queued', 'processing', 'running'] as const;

/**
 * Cancel an analysis (remove from queue and mark as cancelled).
 * Only allowed for pending, queued, processing, or running jobs.
 */
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  const analysisId = params.id;

  try {
    const { user, error: userError } = await getApiUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: analysis, error } = await (supabaseAdmin as any)
      .from('analyses')
      .select('id, user_id, status, job_id')
      .eq('id', analysisId)
      .single();

    if (error || !analysis) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }

    if (analysis.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!CANCELLABLE_STATUSES.includes(analysis.status)) {
      return NextResponse.json(
        { error: `Analysis cannot be cancelled (current status: ${analysis.status})` },
        { status: 400 }
      );
    }

    // Remove from Redis queue so the worker won't pick it (or stop retrying)
    if (analysis.job_id) {
      try {
        await removeJob(analysis.job_id);
      } catch {
        // Continue to mark as cancelled even if Redis remove fails
      }
    }

    const { error: updateError } = await (supabaseAdmin as any)
      .from('analyses')
      .update({
        status: 'cancelled',
        updated_at: new Date().toISOString(),
        worker_id: null,
        last_heartbeat: null,
      })
      .eq('id', analysisId)
      .eq('user_id', user.id);

    if (updateError) {
      console.error('Cancel analysis update error:', updateError);
      return NextResponse.json(
        { error: 'Failed to cancel analysis' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, message: 'Analysis cancelled' });
  } catch (err) {
    console.error('Cancel analysis error:', err);
    return NextResponse.json(
      { error: 'Failed to cancel analysis' },
      { status: 500 }
    );
  }
}
