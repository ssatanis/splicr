import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Create analysis record with R2 FASTQ paths.
 * FASTQ files are uploaded directly from browser to Cloudflare R2;
 * this route only stores metadata and R2 keys in the database.
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

    const body = await request.json();
    const { name, library, method, r2Keys, parameters } = body;

    if (!name || !library || !method) {
      return NextResponse.json(
        { error: 'Missing required fields: name, library, method' },
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

    const analysisId = `analysis_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const now = new Date().toISOString();

    const { data: analysis, error: insertError } = await (supabase.from('analyses') as any)
      .insert({
        id: analysisId,
        user_id: user.id,
        name: String(name).trim(),
        library_type: String(library),
        method: String(method),
        file_names: r2Keys,
        parameters: parameters || {},
        status: 'pending',
        progress: 0,
        current_step: null,
        results: null,
        logs: null,
        error_message: null,
        sample_labels: null,
        created_at: now,
        updated_at: now,
        started_at: null,
        completed_at: null,
      })
      .select()
      .single();

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
        message: 'Analysis created successfully',
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
