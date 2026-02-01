import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const id = params.id;

    const supabase = await createClient();

    // Get analysis from database
    const { data: analysis, error } = await (supabase.from('analyses') as any)
      .select('id, status, progress, logs, error_message, results, started_at, completed_at')
      .eq('id', id)
      .single();

    if (error || !analysis) {
      return NextResponse.json(
        { status: 'not_found', progress: 0 },
        { status: 404 }
      );
    }

    // Get current step from logs
    const logs = analysis.logs || [];
    const lastLog = logs[logs.length - 1];
    const currentStep = lastLog?.step || null;

    const response = {
      status: analysis.status || 'pending',
      progress: analysis.progress || 0,
      currentStep,
      logs: logs.slice(-20), // Return last 20 log entries
      error: analysis.error_message,
      hasResults: !!analysis.results,
      startedAt: analysis.started_at,
      completedAt: analysis.completed_at,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Status fetch error:', error);
    return NextResponse.json(
      { status: 'error', progress: 0, error: 'Failed to fetch status' },
      { status: 500 }
    );
  }
}
