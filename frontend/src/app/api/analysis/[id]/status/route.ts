import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const id = params.id;

    const supabase = await createClient();

    // Do not select results (huge JSONB) — infer hasResults from status
    const { data: analysis, error } = await (supabase.from('analyses') as any)
      .select('id, status, progress, logs, error_message, started_at, completed_at, current_step, retry_count, max_retries, job_id, worker_id')
      .eq('id', id)
      .single();

    if (error || !analysis) {
      return NextResponse.json(
        { status: 'not_found', progress: 0 },
        { status: 404 }
      );
    }

    const logs = analysis.logs || [];
    const lastLog = logs[logs.length - 1];
    const currentStep = lastLog?.step || null;

    return NextResponse.json({
      status: analysis.status || 'pending',
      progress: analysis.progress || 0,
      currentStep: analysis.current_step || currentStep,
      logs: logs.slice(-20),
      error: analysis.error_message,
      hasResults: analysis.status === 'complete',
      startedAt: analysis.started_at,
      completedAt: analysis.completed_at,
      retryCount: analysis.retry_count || 0,
      maxRetries: analysis.max_retries || 3,
      jobId: analysis.job_id || null,
      workerId: analysis.worker_id || null,
    });
  } catch (error) {
    console.error('Status fetch error:', error);
    return NextResponse.json(
      { status: 'error', progress: 0, error: 'Failed to fetch status' },
      { status: 500 }
    );
  }
}
