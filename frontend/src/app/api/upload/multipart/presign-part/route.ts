import { NextRequest, NextResponse } from 'next/server';
import { UploadPartCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createServerR2Client, R2_BUCKET_NAME } from '@/lib/storage/r2-client';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { user, error: authError } = await (await import("@/lib/supabase/server")).getApiUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { key, uploadId, partNumber } = await request.json();

    if (!key || !uploadId || !partNumber) {
      return NextResponse.json(
        { error: 'key, uploadId, and partNumber are required' },
        { status: 400 }
      );
    }

    if (!key.startsWith(user.id + '/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const client = createServerR2Client();
    const command = new UploadPartCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    });

    const presignedUrl = await getSignedUrl(client, command, {
      expiresIn: 3600,
    });

    return NextResponse.json({ presignedUrl, url: presignedUrl, partNumber });
  } catch (error) {
    console.error('Presign part error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to generate part URL: ${message}` },
      { status: 500 }
    );
  }
}
