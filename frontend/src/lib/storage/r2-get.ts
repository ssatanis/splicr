/**
 * Server-only: fetch a file from R2 by key and return as a File for pipeline use.
 * Retries with exponential backoff so freshly uploaded files are immediately fetchable
 * (handles R2/Cloudflare eventual consistency and transient errors).
 */
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { createServerR2Client, R2_BUCKET_NAME } from './r2-client';

const MAX_FETCH_RETRIES = 4;
const RETRY_DELAYS_MS = [0, 500, 1500, 4000]; // immediate, then backoff so just-uploaded files become visible

function isRetryableFetchError(err: unknown): boolean {
  if (err == null) return false;
  const e = err as { name?: string; code?: string; statusCode?: number };
  // NoSuchKey: object not yet visible after upload (eventual consistency)
  if (e.name === 'NoSuchKey') return true;
  // 404 from R2/S3-compatible
  if (e.statusCode === 404 || e.code === 'NotFound') return true;
  // Transient server/network
  if (e.statusCode === 503 || e.statusCode === 502 || e.statusCode === 504) return true;
  if (e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT' || e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') return true;
  return false;
}

export async function getR2FileAsFile(r2Key: string, fileName?: string): Promise<File> {
  const client = createServerR2Client();
  const command = new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: r2Key,
  });

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_FETCH_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const delay = RETRY_DELAYS_MS[attempt] ?? 4000;
        await new Promise((r) => setTimeout(r, delay));
      }
      const response = await client.send(command);
      const body = response.Body;
      if (!body) {
        throw new Error(`R2 object empty or not found: ${r2Key}`);
      }
      const buffer = await body.transformToByteArray();
      const name = fileName ?? r2Key.split('/').pop() ?? r2Key;
      return new File([buffer as BlobPart], name);
    } catch (err) {
      lastError = err;
      const retryable = isRetryableFetchError(err);
      const isLast = attempt === MAX_FETCH_RETRIES - 1;
      if (!retryable || isLast) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`R2 object not found or failed to fetch: ${r2Key}. ${msg}`);
      }
    }
  }

  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`R2 object not found or failed to fetch after ${MAX_FETCH_RETRIES} attempts: ${r2Key}. ${msg}`);
}
