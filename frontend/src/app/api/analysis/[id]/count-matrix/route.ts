import { NextRequest, NextResponse } from 'next/server';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { supabaseAdmin } from '@/lib/supabase/server';
import { createServerR2Client, R2_BUCKET_NAME, isR2Configured } from '@/lib/storage/r2-client';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const id = params.id;

    const { user, error: authError } = await (await import('@/lib/supabase/server')).getApiUser();
    if (authError || !user) {
      return NextResponse.json(
        { message: 'Please sign in to view analysis data.' },
        { status: 401 }
      );
    }

    const { data: row, error } = await (supabaseAdmin as any)
      .from('analyses')
      .select('id, user_id, count_matrix_r2_key')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error('Count matrix route: fetch error', error.message);
      return NextResponse.json(
        { message: 'Failed to load analysis.' },
        { status: 500 }
      );
    }

    if (!row || row.user_id !== user.id) {
      return NextResponse.json(
        { message: 'Analysis not found.' },
        { status: 404 }
      );
    }

    const r2Key = row.count_matrix_r2_key;
    if (!r2Key || typeof r2Key !== 'string') {
      return NextResponse.json(
        { message: 'Count matrix not available for this analysis.' },
        { status: 404 }
      );
    }

    if (!isR2Configured()) {
      return NextResponse.json(
        { message: 'Storage not configured.' },
        { status: 503 }
      );
    }

    const client = createServerR2Client();
    const command = new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: r2Key,
    });
    const response = await client.send(command);
    const body = response.Body;
    if (!body) {
      return NextResponse.json(
        { message: 'Count matrix file not found.' },
        { status: 404 }
      );
    }

    return new NextResponse(body.transformToWebStream(), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Count matrix route error:', msg, err);
    return NextResponse.json(
      { message: 'Failed to load count matrix. Please try again.' },
      { status: 500 }
    );
  }
}
