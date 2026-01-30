import { S3Client } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import https from 'https';

/**
 * Optimized R2 Client Configuration
 * Uses connection pooling and keep-alive for better performance
 */

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  timeout: 60000,
});

export function createServerR2Client() {
  if (
    !process.env.R2_ENDPOINT ||
    !process.env.R2_ACCESS_KEY_ID ||
    !process.env.R2_SECRET_ACCESS_KEY
  ) {
    throw new Error(
      'R2 credentials not configured. Set R2_ENDPOINT, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY in .env.local'
    );
  }

  return new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
    requestHandler: new NodeHttpHandler({
      httpsAgent,
      connectionTimeout: 10000,
      requestTimeout: 300000, // 5 minutes per request
    }),
  });
}

export const R2_BUCKET_NAME =
  process.env.R2_BUCKET_NAME || 'splicr-fastq-files';

export function isR2Configured(): boolean {
  return Boolean(
    process.env.R2_ENDPOINT &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY
  );
}
