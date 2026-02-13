import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Register file metadata in the database after successful direct upload.
 */
export async function POST(request: NextRequest) {
    try {
        const { getApiUser } = await import('@/lib/supabase/server');
        const { user, error: authError } = await getApiUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
        }

        const { key, hash, fileName, size, contentType } = await request.json();

        if (!key || !hash) {
            return NextResponse.json({ error: 'key and hash are required' }, { status: 400 });
        }

        // Save metadata to database for deduplication
        try {
            const table = (supabaseAdmin as any).from('sequencing_files');
            await table.upsert(
                {
                    file_hash: hash,
                    r2_key: key,
                    file_name: fileName,
                    size_bytes: size,
                    content_type: contentType || 'application/octet-stream',
                    user_id: user.id,
                },
                { onConflict: 'file_hash', ignoreDuplicates: true }
            );
        } catch (dbError) {
            console.warn('Failed to save file metadata for deduplication:', dbError);
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Complete single upload error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
