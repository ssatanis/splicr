'use client';

import { Upload } from '@aws-sdk/lib-storage';
import { createBrowserR2Client, R2_BUCKET_NAME } from './r2-client';

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

export interface UploadedFile {
  name: string;
  size: number;
  r2Key: string; // R2 storage path
  type: string;
}

/**
 * Upload a file to Cloudflare R2 from the browser
 * @param file - File object from input
 * @param userId - Current user ID (for folder structure)
 * @param onProgress - Callback for progress updates
 * @returns R2 key (path) of uploaded file
 */
export async function uploadFileToR2(
  file: File,
  userId: string,
  onProgress?: (progress: UploadProgress) => void
): Promise<string> {
  // Validate file type
  const validExtensions = ['.fastq', '.fastq.gz', '.fq', '.fq.gz'];
  const hasValidExtension = validExtensions.some((ext) =>
    file.name.toLowerCase().endsWith(ext)
  );

  if (!hasValidExtension) {
    throw new Error(
      `Invalid file type. Expected FASTQ file (.fastq, .fastq.gz, .fq, .fq.gz), got: ${file.name}`
    );
  }

  // Validate file size (5GB max for safety)
  const MAX_SIZE = 5 * 1024 * 1024 * 1024; // 5GB
  if (file.size > MAX_SIZE) {
    throw new Error(
      `File too large. Maximum size is 5GB, file is ${(file.size / 1024 / 1024 / 1024).toFixed(2)}GB`
    );
  }

  // Generate unique key with timestamp
  const timestamp = Date.now();
  const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `${userId}/${timestamp}-${sanitizedName}`;

  // Create R2 client
  const client = createBrowserR2Client();

  // Create multipart upload with progress tracking
  const uploadTask = new Upload({
    client,
    params: {
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: file,
      ContentType: file.type || 'application/octet-stream',
      Metadata: {
        userId,
        originalName: file.name,
        uploadedAt: new Date().toISOString(),
        fileSize: file.size.toString(),
      },
    },
    // Multipart upload settings for large files
    queueSize: 4, // Number of concurrent parts
    partSize: 10 * 1024 * 1024, // 10MB parts (R2 minimum is 5MB)
    leavePartsOnError: false, // Clean up on failure
  });

  // Track upload progress
  uploadTask.on('httpUploadProgress', (progress) => {
    if (progress.loaded != null && progress.total != null && onProgress) {
      onProgress({
        loaded: progress.loaded,
        total: progress.total,
        percent: Math.round((progress.loaded / progress.total) * 100),
      });
    }
  });

  try {
    await uploadTask.done();
    return key;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('R2 upload failed:', error);
    throw new Error(`Upload failed: ${message}. Please try again.`);
  }
}

/**
 * Upload multiple files in sequence (not parallel to avoid browser memory issues)
 */
export async function uploadMultipleFilesToR2(
  files: File[],
  userId: string,
  onFileProgress?: (fileName: string, progress: UploadProgress) => void,
  onFileComplete?: (file: UploadedFile) => void
): Promise<UploadedFile[]> {
  const uploaded: UploadedFile[] = [];

  for (const file of files) {
    const r2Key = await uploadFileToR2(file, userId, (progress) => {
      onFileProgress?.(file.name, progress);
    });

    const uploadedFile: UploadedFile = {
      name: file.name,
      size: file.size,
      r2Key,
      type: file.type,
    };

    uploaded.push(uploadedFile);
    onFileComplete?.(uploadedFile);
  }

  return uploaded;
}

/**
 * Validate FASTQ file format (basic check)
 */
export function isFastqFile(filename: string): boolean {
  const validExtensions = ['.fastq', '.fastq.gz', '.fq', '.fq.gz'];
  return validExtensions.some((ext) => filename.toLowerCase().endsWith(ext));
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
