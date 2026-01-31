import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { runAnalysisPipeline } from '@/lib/runAnalysisPipeline';

/**
 * Trigger analysis processing (e.g. Retry button).
 * Runs the CRISPR screen analysis pipeline (MAGeCK/BAGEL2/DrugZ).
 */
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  const analysisId = params.id;

  try {
    const { data: analysis, error } = await (supabaseAdmin as any)
      .from('analyses')
      .select('*')
      .eq('id', analysisId)
      .single();

    if (error || !analysis) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }

    // Reset status so UI shows "Running" immediately (e.g. after retry)
    await (supabaseAdmin as any)
      .from('analyses')
      .update({
        status: 'running',
        progress: 0,
        error_message: null,
      })
      .eq('id', analysisId);

    // Run pipeline in background (same logic as create; no HTTP self-call)
    runAnalysisPipeline(analysisId, analysis).catch(console.error);

    return NextResponse.json({
      success: true,
      message: 'Analysis pipeline started',
      analysisId,
    });
  } catch (error) {
    console.error('Run analysis error:', error);
    return NextResponse.json(
      { error: 'Failed to start analysis' },
      { status: 500 }
    );
  }
}
