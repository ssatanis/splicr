import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';

/**
 * Trigger analysis processing.
 * Results are ONLY written when produced by the real analysis backend (MAGeCK/BAGEL2/DRUGZ).
 * No mock or simulated results are ever written — publication-grade real data only.
 */
export async function POST(
  request: NextRequest,
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

    // Never generate or write mock/simulated results. Only real pipeline results are stored.
    const errorMessage =
      'Real analysis pipeline not connected. Configure the analysis backend (MAGeCK/BAGEL2/DRUGZ) to run on your FASTQ files and write results to this app. No mock or simulated data is used.';
    await (supabaseAdmin as any)
      .from('analyses')
      .update({
        status: 'failed',
        progress: 0,
        error_message: errorMessage,
        logs: [{
          timestamp: new Date().toISOString(),
          step: 'Configuration',
          message: errorMessage,
          progress: 0,
          level: 'error',
        }],
      })
      .eq('id', analysisId);

    return NextResponse.json(
      { success: false, error: errorMessage, analysisId }
    );
  } catch (error) {
    console.error('Run analysis error:', error);
    return NextResponse.json(
      { error: 'Failed to start analysis' },
      { status: 500 }
    );
  }
}
