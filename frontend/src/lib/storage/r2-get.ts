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

/**
 * Returns a generic Node.js Readable stream for the R2 object.
 * Used for direct streaming analysis without disk buffer.
 */
export async function getR2FileStream(r2Key: string): Promise<Readable> {
  const client = createServerR2Client();
  const command = new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: r2Key,
  });

  const response = await client.send(command);
  if (!response.Body) {
    throw new Error(`R2 object found but body is empty: ${r2Key}`);
  }
  return response.Body as Readable;
}

/**
 * Fetches the first N bytes of a file as a string (utf-8).
 * Used for header inspection and offset detection.
 */
export async function getR2FileChunk(r2Key: string, endByte: number = 10 * 1024 * 1024): Promise<string> {
  const client = createServerR2Client();
  const command = new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: r2Key,
    Range: `bytes=0-${endByte}` // partial content request
  });

  try {
    const response = await client.send(command);
    if (!response.Body) {
      throw new Error('Empty body in Range request');
    }
    const str = await response.Body.transformToString('utf-8');
    return str;
  } catch (err) {
    // If range is invalid (file too small), try plain fetch?
    // AWS S3 usually ignores range if invalid, or returns 416. 
    // For small files, just fetch whole thing.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('InvalidRange') || (err as any).statusCode === 416) {
      console.warn(`[R2] Range request failed for ${r2Key}, fetching full file for header check.`);
      return (await getR2FileAsFile(r2Key)).text();
    }
    throw err;
  }
}
