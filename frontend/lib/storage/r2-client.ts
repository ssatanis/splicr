import { S3Client } from '@aws-sdk/client-s3';

/**
 * R2 Client Configuration (S3-compatible)
 * Works in both browser (client-side upload) and server (analysis worker download)
 */

// Browser-side client (uses public credentials for upload only)
export function createBrowserR2Client() {
  if (
    !process.env.NEXT_PUBLIC_R2_ENDPOINT ||
    !process.env.NEXT_PUBLIC_R2_ACCESS_KEY_ID ||
    !process.env.NEXT_PUBLIC_R2_SECRET_ACCESS_KEY
  ) {
    throw new Error('R2 credentials not configured for browser');
  }

  return new S3Client({
    region: 'auto',
    endpoint: process.env.NEXT_PUBLIC_R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.NEXT_PUBLIC_R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.NEXT_PUBLIC_R2_SECRET_ACCESS_KEY,
    },
  });
}

// Server-side client (uses private credentials for full access)
export function createServerR2Client() {
  if (
    !process.env.R2_ENDPOINT ||
    !process.env.R2_ACCESS_KEY_ID ||
    !process.env.R2_SECRET_ACCESS_KEY
  ) {
    throw new Error('R2 credentials not configured for server');
  }

  return new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

// Bucket name (browser uses NEXT_PUBLIC_ var)
export const R2_BUCKET_NAME =
  typeof process.env.NEXT_PUBLIC_R2_BUCKET_NAME !== 'undefined'
    ? process.env.NEXT_PUBLIC_R2_BUCKET_NAME
    : process.env.R2_BUCKET_NAME ?? 'splicr-fastq-files';
