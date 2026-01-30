'use client';

import type { UploadedFile, UploadProgress } from '@/types/upload';
import { hasAllowedExtension } from '@/lib/upload/constants';
import { computeFileHash } from '@/lib/storage/file-hash';

export type { UploadedFile, UploadProgress };

/**
 * Optimized R2 upload with:
 * - Dedup: check by content hash first; reuse existing key if found
 * - 100MB part size, 4× parallel multipart
 * - Server proxy for files < 100MB
 * - Retry with exponential backoff
 */

const SMALL_FILE_THRESHOLD = 100 * 1024 * 1024; // 100MB
const LARGE_PART_SIZE = 100 * 1024 * 1024; // 100MB
const PARALLEL_UPLOADS = 4;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const MAX_SIZE = 5 * 1024 * 1024 * 1024; // 5GB

/** Check if file already exists by hash; returns key if exists */
async function checkExistingFile(
  hash: string,
  fileName: string,
  size: number,
  contentType: string
): Promise<string | null> {
  const res = await fetch('/api/upload/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hash,
      fileName,
      size,
      contentType: contentType || 'application/octet-stream',
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.exists === true && data.key ? data.key : null;
}

async function uploadViaProxy(
  file: File,
  userId: string,
  fileHash: string,
  onProgress?: (progress: UploadProgress) => void
): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('userId', userId);
  formData.append('hash', fileHash);

  const xhr = new XMLHttpRequest();

  return new Promise((resolve, reject) => {
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress({
          loaded: e.loaded,
          total: e.total,
          percent: Math.round((e.loaded / e.total) * 100),
        });
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status === 200) {
        const response = JSON.parse(xhr.responseText);
        resolve(response.key);
      } else {
        reject(new Error(`Upload failed: ${xhr.statusText}`));
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error('Network error during upload'));
    });

    xhr.open('POST', '/api/upload/proxy');
    xhr.send(formData);
  });
}

async function uploadViaMultipart(
  file: File,
  userId: string,
  fileHash: string,
  onProgress?: (progress: UploadProgress) => void
): Promise<string> {
  const createRes = await fetch('/api/upload/multipart/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      fileSize: file.size,
      contentType: file.type || 'application/octet-stream',
    }),
  });

  if (!createRes.ok) {
    throw new Error('Failed to create multipart upload');
  }

  const { uploadId, key } = await createRes.json();

  try {
    const partSize = LARGE_PART_SIZE;
    const numParts = Math.ceil(file.size / partSize);
    const parts: { PartNumber: number; ETag: string }[] = [];
    let uploadedBytes = 0;

    for (let i = 0; i < numParts; i += PARALLEL_UPLOADS) {
      const batch: Promise<{ PartNumber: number; ETag: string; partSize: number }>[] = [];
      for (let j = 0; j < PARALLEL_UPLOADS && i + j < numParts; j++) {
        const partNumber = i + j + 1;
        batch.push(uploadPartWithRetry(file, key, uploadId, partNumber, partSize));
      }
      const batchResults = await Promise.all(batch);
      batchResults.forEach((result) => {
        parts.push({ PartNumber: result.PartNumber, ETag: result.ETag });
        uploadedBytes += result.partSize;
        if (onProgress) {
          onProgress({
            loaded: Math.min(uploadedBytes, file.size),
            total: file.size,
            percent: Math.round((Math.min(uploadedBytes, file.size) / file.size) * 100),
          });
        }
      });
    }

    const completeRes = await fetch('/api/upload/multipart/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key,
        uploadId,
        parts: parts.sort((a, b) => a.PartNumber - b.PartNumber),
        fileHash,
        fileName: file.name,
        size: file.size,
        contentType: file.type || 'application/octet-stream',
      }),
    });

    if (!completeRes.ok) {
      throw new Error('Failed to complete multipart upload');
    }

    const data = await completeRes.json();
    return data.key ?? key;
  } catch (error) {
    await fetch('/api/upload/multipart/abort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, uploadId }),
    });
    throw error;
  }
}

async function uploadPartWithRetry(
  file: File,
  key: string,
  uploadId: string,
  partNumber: number,
  partSize: number,
  retries = 0
): Promise<{ PartNumber: number; ETag: string; partSize: number }> {
  try {
    const presignRes = await fetch('/api/upload/multipart/presign-part', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, uploadId, partNumber }),
    });
    if (!presignRes.ok) throw new Error('Failed to get presigned URL');
    const { presignedUrl } = await presignRes.json();

    const start = (partNumber - 1) * partSize;
    const end = Math.min(start + partSize, file.size);
    const blob = file.slice(start, end);

    const uploadRes = await fetch(presignedUrl, {
      method: 'PUT',
      body: blob,
      headers: { 'Content-Length': blob.size.toString() },
    });
    if (!uploadRes.ok) {
      throw new Error(`Part ${partNumber} upload failed: ${uploadRes.statusText}`);
    }
    const etag = uploadRes.headers.get('ETag');
    if (!etag) throw new Error(`Part ${partNumber} missing ETag`);

    return {
      PartNumber: partNumber,
      ETag: etag.replace(/"/g, ''),
      partSize: blob.size,
    };
  } catch (error) {
    if (retries < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS * Math.pow(2, retries);
      await new Promise((r) => setTimeout(r, delay));
      return uploadPartWithRetry(file, key, uploadId, partNumber, partSize, retries + 1);
    }
    throw error;
  }
}

/**
 * Upload a single file: check dedup first, then proxy or multipart.
 * Returns { r2Key, reused } so UI can show "reused from cloud storage".
 */
export async function uploadFileToR2(
  file: File,
  userId: string,
  onProgress?: (progress: UploadProgress) => void
): Promise<{ r2Key: string; reused: boolean }> {
  if (!hasAllowedExtension(file.name)) {
    throw new Error(
      `Invalid file type. Allowed: .fastq, .fq, .fastq.gz, .fq.gz, .bam, .cram, .sam, .txt. Got: ${file.name}`
    );
  }
  if (file.size > MAX_SIZE) {
    throw new Error(
      `File too large. Max 5GB, file is ${(file.size / 1024 / 1024 / 1024).toFixed(2)}GB`
    );
  }

  const hash = await computeFileHash(file);
  const existingKey = await checkExistingFile(
    hash,
    file.name,
    file.size,
    file.type || 'application/octet-stream'
  );

  if (existingKey) {
    if (onProgress) {
      onProgress({
        loaded: file.size,
        total: file.size,
        percent: 100,
      });
    }
    return { r2Key: existingKey, reused: true };
  }

  const key =
    file.size < SMALL_FILE_THRESHOLD
      ? await uploadViaProxy(file, userId, hash, onProgress)
      : await uploadViaMultipart(file, userId, hash, onProgress);

  return { r2Key: key, reused: false };
}

/**
 * Upload multiple files in parallel; each file checks dedup then uploads if needed.
 */
export async function uploadMultipleFilesToR2(
  files: File[],
  userId: string,
  onFileProgress?: (fileName: string, progress: UploadProgress) => void,
  onFileComplete?: (file: UploadedFile) => void
): Promise<UploadedFile[]> {
  const results = await Promise.all(
    files.map((file) =>
      uploadFileToR2(file, userId, (progress) => {
        onFileProgress?.(file.name, progress);
      }).then(({ r2Key, reused }) => {
        const uploadedFile: UploadedFile = {
          name: file.name,
          size: file.size,
          r2Key,
          type: file.type,
          reused,
        };
        onFileComplete?.(uploadedFile);
        return uploadedFile;
      })
    )
  );
  return results;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function isAllowedSequencingFile(filename: string): boolean {
  return hasAllowedExtension(filename);
}

/** @deprecated Use isAllowedSequencingFile */
export function isFastqFile(filename: string): boolean {
  return hasAllowedExtension(filename);
}
