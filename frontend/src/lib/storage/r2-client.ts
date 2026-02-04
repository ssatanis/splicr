import { S3Client } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import https from 'https';

/**
 * Optimized R2 Client: connection pooling, keep-alive, singleton for serverless.
 * Reusing one client avoids connection churn and speeds up pipeline + count-matrix.
 */
const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  timeout: 60000,
});

let cachedClient: S3Client | null = null;

export function createServerR2Client(): S3Client {
  if (
    !process.env.R2_ENDPOINT ||
    !process.env.R2_ACCESS_KEY_ID ||
    !process.env.R2_SECRET_ACCESS_KEY
  ) {
    throw new Error(
      'R2 credentials not configured. Set R2_ENDPOINT, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY in .env.local'
    );
  }
  if (cachedClient) return cachedClient;
  cachedClient = new S3Client({
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
      requestTimeout: 300000,
    }),
  });
  return cachedClient;
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
