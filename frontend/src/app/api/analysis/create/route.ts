import { NextResponse } from 'next/server';
import { createClient, supabaseAdmin } from '@/lib/supabase/server';
import { normalizeAnalysisMethod } from '@/lib/analysis-method';

export const dynamic = 'force-dynamic';

/**
 * Create analysis record with R2 FASTQ paths.
 * Expects JSON body: { name, library, method?, algorithms?, r2Keys, parameters?, sampleLabels? }
 */
export async function POST(request: Request) {
  try {
    const { getApiUser } = await import('@/lib/supabase/server');

    const { user, error: userError } = await getApiUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized. Please log in.' },
        { status: 401 }
      );
    }

    const admin = supabaseAdmin as any;

    const body = await request.json();
    const { name, library, method, r2Keys, parameters } = body;
    const sampleLabels = body.sampleLabels ?? body.parameters?.sampleLabels ?? [];
    const algorithms = parameters?.algorithms || (Array.isArray(method) ? method : [method]);

    if (!name || !library || (!method && (!algorithms || algorithms.length === 0))) {
      return NextResponse.json(
        { error: 'Missing required fields: name, library, method/algorithms' },
        { status: 400 }
      );
    }

    if (!r2Keys || !Array.isArray(r2Keys) || r2Keys.length === 0) {
      return NextResponse.json(
        { error: 'At least one FASTQ file is required (r2Keys)' },
        { status: 400 }
      );
    }

    const invalidKeys = r2Keys.filter(
      (key: string) => typeof key !== 'string' || !key.startsWith(`${user.id}/`)
    );
    if (invalidKeys.length > 0) {
      return NextResponse.json(
        { error: 'Invalid file paths. Files must belong to current user.' },
        { status: 403 }
      );
    }

    const params = parameters || {
      fdr_threshold: 0.05,
      normalization: 'median',
      min_reads: 30,
    };
    const payload: Record<string, unknown> = {
      user_id: user.id,
      name: String(name).trim(),
      library: String(library),
      method: normalizeAnalysisMethod(String(algorithms[0] || method)),
      parameters: { ...params, r2Keys, sampleLabels, algorithms },
      status: 'pending',
      progress: 0,
    };

    let { data: analysis, error: insertError } = await admin
      .from('analyses')
      .insert({
        ...payload,
        file_names: r2Keys,
        sample_labels: sampleLabels || [],
      })
      .select()
      .single();

    if (insertError?.code === 'PGRST204') {
      const fallback = await admin.from('analyses').insert(payload).select().single();
      insertError = fallback.error;
      analysis = fallback.data;
    }

    if (insertError) {
      console.error('Database insert error:', insertError);
      return NextResponse.json(
        {
          success: false,
          error: `Failed to create analysis: ${insertError.message}`,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        analysis,
        message: 'Analysis created. Open the results page to start the run.',
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Internal server error';
    console.error('Analysis creation error:', error);
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
