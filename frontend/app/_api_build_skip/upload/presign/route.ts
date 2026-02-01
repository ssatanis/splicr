import { NextRequest, NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createClient } from '@/lib/supabase/server';

// Server-side R2 client configured for Cloudflare R2
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
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    // R2 requires path-style addressing
    forcePathStyle: true,
  });
}

const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'splicr-fastq-files';
const VALID_EXTENSIONS = ['.fastq', '.fastq.gz', '.fq', '.fq.gz'];
const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024; // 10GB

export async function POST(request: NextRequest) {
  try {
    // Authenticate user
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { filename, fileSize, contentType } = body;

    if (!filename) {
      return NextResponse.json(
        { error: 'Filename is required' },
        { status: 400 }
      );
    }

    // Validate file extension
    const hasValidExtension = VALID_EXTENSIONS.some((ext) =>
      filename.toLowerCase().endsWith(ext)
    );

    if (!hasValidExtension) {
      return NextResponse.json(
        {
          error: `Invalid file type. Allowed: ${VALID_EXTENSIONS.join(', ')}`,
        },
        { status: 400 }
      );
    }

    // Validate file size if provided
    if (fileSize && fileSize > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          error: `File too large. Maximum size is 10GB.`,
        },
        { status: 400 }
      );
    }

    // Generate unique key
    const timestamp = Date.now();
    const sanitizedName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `${user.id}/${timestamp}-${sanitizedName}`;

    // Create presigned URL
    // Note: We don't include ContentType in the command to avoid signature mismatches
    // R2 will auto-detect the content type from the file extension
    const client = getR2Client();
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Metadata: {
        userId: user.id,
        originalName: filename,
        uploadedAt: new Date().toISOString(),
      },
    });

    // URL valid for 1 hour
    // signableHeaders is left empty so no headers need to match during upload
    const presignedUrl = await getSignedUrl(client, command, {
      expiresIn: 3600,
    });

    return NextResponse.json({
      presignedUrl,
      key,
      bucket: BUCKET_NAME,
      expiresIn: 3600,
    });
  } catch (error) {
    console.error('Presign error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';

    // Provide better error messages
    if (message.includes('R2 credentials not configured')) {
      return NextResponse.json(
        { error: 'Storage is not configured. Check R2_ENDPOINT, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY in .env.local' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: `Failed to generate upload URL: ${message}` },
      { status: 500 }
    );
  }
}
