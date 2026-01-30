import { NextRequest, NextResponse } from 'next/server';
import { S3Client, AbortMultipartUploadCommand } from '@aws-sdk/client-s3';
import { createClient } from '@/lib/supabase/server';

function getR2Client() {
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 credentials not configured');
  }

  return new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
}

const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'splicr-fastq-files';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { key, uploadId } = await request.json();

    if (!key || !uploadId) {
      return NextResponse.json(
        { error: 'key and uploadId are required' },
        { status: 400 }
      );
    }

    // Verify the key belongs to this user
    if (!key.startsWith(user.id + '/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const client = getR2Client();
    const command = new AbortMultipartUploadCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      UploadId: uploadId,
    });

    await client.send(command);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Abort multipart error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to abort upload: ${message}` },
      { status: 500 }
    );
  }
}
