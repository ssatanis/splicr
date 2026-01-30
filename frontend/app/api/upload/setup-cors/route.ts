import { NextResponse } from 'next/server';
import { S3Client, PutBucketCorsCommand } from '@aws-sdk/client-s3';

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
  });
}

const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'splicr-fastq-files';

export async function POST() {
  try {
    const client = getR2Client();

    // Configure CORS to allow browser uploads
    const corsConfig = {
      CORSRules: [
        {
          AllowedHeaders: ['*'],
          AllowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
          AllowedOrigins: ['*'], // In production, restrict to your domain
          ExposeHeaders: ['ETag', 'Content-Length', 'Content-Type', 'x-amz-meta-*'],
          MaxAgeSeconds: 3600,
        },
      ],
    };

    const command = new PutBucketCorsCommand({
      Bucket: BUCKET_NAME,
      CORSConfiguration: corsConfig,
    });

    await client.send(command);

    return NextResponse.json({
      success: true,
      message: 'CORS configured successfully for bucket: ' + BUCKET_NAME,
      corsRules: corsConfig.CORSRules,
    });
  } catch (error) {
    console.error('CORS setup error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to configure CORS: ${message}` },
      { status: 500 }
    );
  }
}

// GET endpoint to check current CORS config
export async function GET() {
  try {
    const { GetBucketCorsCommand } = await import('@aws-sdk/client-s3');
    const client = getR2Client();

    const command = new GetBucketCorsCommand({
      Bucket: BUCKET_NAME,
    });

    const response = await client.send(command);

    return NextResponse.json({
      bucket: BUCKET_NAME,
      corsRules: response.CORSRules || [],
    });
  } catch (error) {
    console.error('Get CORS error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';

    // NoSuchCORSConfiguration means CORS isn't set up yet
    if (message.includes('NoSuchCORSConfiguration') || message.includes('The CORS configuration does not exist')) {
      return NextResponse.json({
        bucket: BUCKET_NAME,
        corsRules: [],
        message: 'No CORS configuration found. POST to this endpoint to set it up.',
      });
    }

    return NextResponse.json(
      { error: `Failed to get CORS config: ${message}` },
      { status: 500 }
    );
  }
}
