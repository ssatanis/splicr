import { NextRequest, NextResponse } from 'next/server';
import { CreateMultipartUploadCommand } from '@aws-sdk/client-s3';
import { createServerR2Client, R2_BUCKET_NAME } from '@/lib/storage/r2-client';
import { createClient } from '@/lib/supabase/server';
import { hasAllowedExtension } from '@/lib/upload/constants';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { user, error: authError } = await (await import('@/lib/supabase/server')).getApiUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { filename, contentType, fileSize } = await request.json();

    if (!filename) {
      return NextResponse.json({ error: 'Filename is required' }, { status: 400 });
    }

    if (!hasAllowedExtension(filename)) {
      return NextResponse.json(
        { error: 'File type not allowed. Check allowed extensions.' },
        { status: 400 }
      );
    }

    const timestamp = Date.now();
    const sanitizedName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `${user.id}/${timestamp}-${sanitizedName}`;

    const client = createServerR2Client();
    const command = new CreateMultipartUploadCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Metadata: {
        userId: user.id,
        originalName: filename,
        uploadedAt: new Date().toISOString(),
        fileSize: fileSize?.toString() || '0',
      },
    });

    const response = await client.send(command);

    return NextResponse.json({
      uploadId: response.UploadId,
      key,
      bucket: R2_BUCKET_NAME,
    });
  } catch (error) {
    console.error('Create multipart error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to create multipart upload: ${message}` },
      { status: 500 }
    );
  }
}
