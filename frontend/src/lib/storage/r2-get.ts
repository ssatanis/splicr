/**
 * Server-only: fetch a file from R2 by key and return as a File for pipeline use.
 * Retries with exponential backoff so freshly uploaded files are immediately fetchable
 * (handles R2/Cloudflare eventual consistency and transient errors).
 */
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { createServerR2Client, R2_BUCKET_NAME } from './r2-client';
import fs from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

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

export async function getR2FileAsFile(r2Key: string, fileName?: string, options?: { maxSizeBytes?: number }): Promise<File> {
  const client = createServerR2Client();
  const bucketName = R2_BUCKET_NAME;

  // Log fetch attempt (without secrets) to help debug R2_ENDPOINT/BUCKET issues
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[R2 Fetch] Key: ${r2Key}, Bucket: ${bucketName}`);
  }

  const command = new GetObjectCommand({
    Bucket: bucketName,
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

      if (options?.maxSizeBytes && response.ContentLength && response.ContentLength > options.maxSizeBytes) {
        throw new Error(`File size (${(response.ContentLength / 1024 / 1024).toFixed(2)} MB) exceeds maximum allowed size (${(options.maxSizeBytes / 1024 / 1024).toFixed(2)} MB)`);
      }

      if (!body) {
        throw new Error(`R2 object empty or not found (Body missing): ${r2Key}`);
      }
      const buffer = await body.transformToByteArray();
      const name = fileName ?? r2Key.split('/').pop() ?? r2Key;
      return new File([buffer as BlobPart], name);
    } catch (err) {
      lastError = err;
      const retryable = isRetryableFetchError(err);
      const isLast = attempt === MAX_FETCH_RETRIES - 1;
      // Don't retry if it's a file size error
      const isSizeError = err instanceof Error && err.message.includes('exceeds maximum allowed size');

      if (!retryable || isLast || isSizeError) {
        const msg = err instanceof Error ? err.message : String(err);
        const code = (err as any)?.code || (err as any)?.name || 'UnknownError';
        throw new Error(`R2 object not found or failed to fetch: ${r2Key} [Code: ${code}]. ${msg}`);
      }
    }
  }


  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  const code = (lastError as any)?.code || (lastError as any)?.name || 'UnknownError';
  throw new Error(`R2 object not found or failed to fetch after ${MAX_FETCH_RETRIES} attempts: ${r2Key} [Code: ${code}]. ${msg}`);
}

export async function downloadR2FileToDisk(r2Key: string, destPath: string): Promise<void> {
  const client = createServerR2Client();
  const bucketName = R2_BUCKET_NAME;

  const command = new GetObjectCommand({
    Bucket: bucketName,
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

      if (!response.Body) {
        throw new Error(`R2 object empty or not found (Body missing): ${r2Key}`);
      }

      // Stream to disk
      await pipeline(response.Body as Readable, fs.createWriteStream(destPath));
      return;

    } catch (err) {
      lastError = err;
      // Reuse retry logic helper if exported, else simplified check
      // Using simpler check for now or duplicated logic
      const retryable = isRetryableFetchError(err);
      const isLast = attempt === MAX_FETCH_RETRIES - 1;

      if (!retryable || isLast) {
        const msg = err instanceof Error ? err.message : String(err);
        const code = (err as any)?.code || (err as any)?.name || 'UnknownError';
        throw new Error(`R2 download to disk failed: ${r2Key} [Code: ${code}]. ${msg}`);
      }
    }
  }
}
