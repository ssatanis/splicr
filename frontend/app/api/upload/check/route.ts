import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { hasAllowedExtension } from '@/lib/upload/constants';

export const dynamic = 'force-dynamic';

/**
 * Check if a file already exists in R2 by content hash (global dedup).
 */
export async function POST(request: NextRequest) {
  try {
    const { getApiUser } = await import('@/lib/supabase/server');
    const { user } = await getApiUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { hash, fileName, size, contentType } = body as {
      hash?: string;
      fileName?: string;
      size?: number;
      contentType?: string;
    };

    if (!hash || typeof hash !== 'string' || hash.length < 32) {
      return NextResponse.json(
        { error: 'hash (SHA-256 hex) is required' },
        { status: 400 }
      );
    }
    if (!fileName || typeof fileName !== 'string') {
      return NextResponse.json({ error: 'fileName is required' }, { status: 400 });
    }

    if (!hasAllowedExtension(fileName)) {
      return NextResponse.json(
        { error: 'File type not allowed. Check allowed extensions.' },
        { status: 400 }
      );
    }

    const { data: row, error: dbError } = await (supabaseAdmin as any)
      .from('sequencing_files')
      .select('r2_key')
      .eq('file_hash', hash)
      .limit(1)
      .maybeSingle();

    if (dbError) {
      if (dbError.code === 'PGRST205') {
        return NextResponse.json({ exists: false });
      }
      console.error('Dedup check error:', dbError);
      return NextResponse.json(
        { error: 'Failed to check existing file' },
        { status: 500 }
      );
    }

    if (row?.r2_key) {
      return NextResponse.json({
        exists: true,
        key: row.r2_key as string,
      });
    }

    return NextResponse.json({ exists: false });
  } catch (e) {
    console.error('Upload check error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Upload check failed' },
      { status: 500 }
    );
  }
}
