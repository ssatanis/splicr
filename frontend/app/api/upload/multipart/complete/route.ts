import { NextRequest, NextResponse } from 'next/server';
import { CompleteMultipartUploadCommand, CompletedPart } from '@aws-sdk/client-s3';
import { createServerR2Client, R2_BUCKET_NAME } from '@/lib/storage/r2-client';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const { key, uploadId, parts, fileHash, fileName, size, contentType } = body as {
      key: string;
      uploadId: string;
      parts: unknown[];
      fileHash?: string;
      fileName?: string;
      size?: number;
      contentType?: string;
    };

    if (!key || !uploadId || !parts || !Array.isArray(parts)) {
      return NextResponse.json(
        { error: 'key, uploadId, and parts array are required' },
        { status: 400 }
      );
    }

    if (!key.startsWith(user.id + '/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    type PartInput = { PartNumber?: number; partNumber?: number; ETag?: string; etag?: string };
    const partsList = parts as PartInput[];
    const sortedParts: CompletedPart[] = partsList
      .sort((a, b) => (a.PartNumber ?? a.partNumber ?? 0) - (b.PartNumber ?? b.partNumber ?? 0))
      .map((part) => ({
        PartNumber: part.PartNumber ?? part.partNumber!,
        ETag: part.ETag ?? part.etag!,
      }));

    const client = createServerR2Client();
    const command = new CompleteMultipartUploadCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: sortedParts },
    });

    await client.send(command);

    let canonicalKey = key;
    if (fileHash && fileName && size != null) {
      const table = (supabaseAdmin as any).from('sequencing_files');
      await table.upsert(
        {
          file_hash: fileHash,
          r2_key: key,
          file_name: fileName,
          size_bytes: size,
          content_type: contentType || null,
          user_id: user.id,
        },
        { onConflict: 'file_hash', ignoreDuplicates: true }
      );
      const { data: existing } = await table
        .select('r2_key')
        .eq('file_hash', fileHash)
        .limit(1)
        .maybeSingle();
      if (existing?.r2_key) {
        canonicalKey = existing.r2_key as string;
      }
    }

    return NextResponse.json({
      key: canonicalKey,
    });
  } catch (error) {
    console.error('Complete multipart error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to complete upload: ${message}` },
      { status: 500 }
    );
  }
}
