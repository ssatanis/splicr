import { NextRequest, NextResponse } from 'next/server';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { createServerR2Client, R2_BUCKET_NAME } from '@/lib/storage/r2-client';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { hasAllowedExtension } from '@/lib/upload/constants';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max

/**
 * Server-side proxy upload for small-medium files (< 100MB).
 * Optional form field "hash" for dedup: after upload we register in sequencing_files.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;
    const hash = formData.get('hash') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!hasAllowedExtension(file.name)) {
      return NextResponse.json(
        { error: 'File type not allowed. Check allowed extensions.' },
        { status: 400 }
      );
    }

    const MAX_SIZE = 100 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: 'File too large for proxy upload. Use multipart upload.' },
        { status: 413 }
      );
    }

    const timestamp = Date.now();
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `${user.id}/${timestamp}-${sanitizedName}`;

    const buffer = Buffer.from(await file.arrayBuffer());
    const r2Client = createServerR2Client();

    await r2Client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: file.type || 'application/octet-stream',
        Metadata: {
          userId: user.id,
          originalName: file.name,
          uploadedAt: new Date().toISOString(),
          fileSize: file.size.toString(),
        },
      })
    );

    let canonicalKey = key;
    if (hash && hash.length >= 32) {
      try {
        const table = (supabaseAdmin as any).from('sequencing_files');
        await table.upsert(
          {
            file_hash: hash,
            r2_key: key,
            file_name: file.name,
            size_bytes: file.size,
            content_type: file.type || null,
            user_id: user.id,
          },
          { onConflict: 'file_hash', ignoreDuplicates: true }
        );
        const { data: existing } = await table
          .select('r2_key')
          .eq('file_hash', hash)
          .limit(1)
          .maybeSingle();
        if (existing?.r2_key) {
          canonicalKey = existing.r2_key as string;
        }
      } catch (dedupErr) {
        // Table may not exist yet (PGRST205); upload succeeded, skip dedup registration
      }
    }

    return NextResponse.json({
      success: true,
      key: canonicalKey,
      size: file.size,
    });
  } catch (error: unknown) {
    console.error('Proxy upload error:', error);
    const message = error instanceof Error ? error.message : 'Upload failed';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
