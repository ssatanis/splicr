import { NextResponse } from 'next/server';
import { createClient, supabaseAdmin } from '@/lib/supabase/server';
import { normalizeAnalysisMethod } from '@/lib/analysis-method';

export const dynamic = 'force-dynamic';

/**
 * Create analysis record with R2 FASTQ paths.
 * FASTQ files are uploaded directly from browser to Cloudflare R2;
 * this route only stores metadata and R2 keys in the database.
 * Uses supabaseAdmin for inserts/updates to avoid RLS recursion (e.g. team_members policies).
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

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
    // Support both single method and algorithms array
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

    // Insert analysis. If table is missing file_names/sample_labels, store in parameters.
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

    // Add columns that may not exist on older schemas (run migrations to add them)
    // Use admin client to bypass RLS and avoid infinite recursion in team_members policies
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
      // Column not found: table may lack file_names/sample_labels; store only in parameters
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

    // Start analysis processing asynchronously (admin for updates to bypass RLS)
    startAnalysisProcessing(analysis.id, admin).catch(console.error);

    return NextResponse.json(
      {
        success: true,
        analysis,
        message: 'Analysis created and processing started',
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

/**
 * Start analysis processing in background.
 * Uses admin client so RLS recursion on team_members does not block updates.
 */
async function startAnalysisProcessing(analysisId: string, admin: any) {
  try {
    // Update status to running
    await admin
      .from('analyses')
      .update({
        status: 'running',
        progress: 5,
        started_at: new Date().toISOString(),
      })
      .eq('id', analysisId);

    // Trigger the actual analysis (this would call your backend service)
    const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/analysis/${analysisId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      throw new Error('Failed to start analysis processing');
    }
  } catch (error) {
    console.error('Failed to start analysis processing:', error);
    // Update status to failed
    await admin
      .from('analyses')
      .update({
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Processing failed to start',
      })
      .eq('id', analysisId);
  }
}
