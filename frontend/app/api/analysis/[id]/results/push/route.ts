import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';

/**
 * Push results from the analysis pipeline into the database.
 * Called by the real pipeline (MAGeCK/BAGEL2/DRUGZ) when a run completes.
 * Protected by ANALYSIS_WRITE_SECRET so only your backend can call this.
 * Ensures results are saved to the user's analysis and appear in Dashboard, My analyses, and Reports.
 */
const WRITE_SECRET = process.env.ANALYSIS_WRITE_SECRET;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const id = params.id;

    const authHeader = request.headers.get('authorization');
    const secret = authHeader?.replace(/^Bearer\s+/i, '') || request.nextUrl.searchParams.get('secret');
    if (!WRITE_SECRET || secret !== WRITE_SECRET) {
      return NextResponse.json(
        { message: 'Unauthorized. Set ANALYSIS_WRITE_SECRET and pass it as Bearer token or ?secret=.' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { results, status = 'complete', progress = 100, error_message = null, logs = null } = body;

    if (results == null) {
      return NextResponse.json(
        { message: 'Missing required field: results' },
        { status: 400 }
      );
    }

    const updatePayload: Record<string, unknown> = {
      results,
      status,
      progress: typeof progress === 'number' ? progress : 100,
      completed_at: status === 'complete' ? new Date().toISOString() : null,
    };
    if (error_message != null) updatePayload.error_message = error_message;
    if (Array.isArray(logs)) updatePayload.logs = logs;

    const { data, error } = await (supabaseAdmin as any)
      .from('analyses')
      .update(updatePayload)
      .eq('id', id)
      .select('id, status')
      .maybeSingle();

    if (error) {
      console.error('Results push error:', error);
      return NextResponse.json(
        { message: 'Failed to save results', error: error.message },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { message: 'Analysis not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      analysisId: id,
      status: data.status,
      message: 'Results saved. They will appear in Dashboard, My analyses, and Reports.',
    });
  } catch (error) {
    console.error('Results push route error:', error);
    return NextResponse.json(
      { message: 'Failed to save results' },
      { status: 500 }
    );
  }
}
