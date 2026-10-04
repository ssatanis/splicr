import "server-only";

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
  type CompletedPart,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const REGION = "auto";
export const R2_MULTIPART_PART_SIZE = 64 * 1024 * 1024;

export type R2Object = { bucket: string; key: string };

export function r2Configured(): boolean {
  return Boolean(process.env.R2_ACCOUNT_ID && process.env.R2_BUCKET && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);
}

function config() {
  const account = process.env.R2_ACCOUNT_ID?.trim();
  const bucket = process.env.R2_BUCKET?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  if (!account || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 is not configured for private uploads.");
  }
  return {
    bucket,
    endpoint: process.env.R2_ENDPOINT?.trim() || `https://${account}.r2.cloudflarestorage.com`,
    accessKeyId,
    secretAccessKey,
  };
}

export function r2Client(): S3Client {
  const cfg = config();
  return new S3Client({
    region: REGION,
    endpoint: cfg.endpoint,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
}

export function bucketName(): string {
  return config().bucket;
}

export function r2Uri(key: string): string {
  return `r2://${bucketName()}/${key}`;
}

export function parseR2Uri(uri: string): R2Object | null {
  const match = uri.match(/^r2:\/\/([^/]+)\/(.+)$/);
  if (!match) return null;
  return { bucket: match[1], key: match[2] };
}

export async function signedPutUrl(key: string, contentType: string, expiresIn = 3600): Promise<string> {
  const client = r2Client();
  return getSignedUrl(client, new PutObjectCommand({
    Bucket: bucketName(),
    Key: key,
    ContentType: contentType || "application/octet-stream",
  }), { expiresIn });
}

export async function createMultipart(key: string, contentType: string): Promise<string> {
  const client = r2Client();
  const out = await client.send(new CreateMultipartUploadCommand({
    Bucket: bucketName(),
    Key: key,
    ContentType: contentType || "application/octet-stream",
  }));
  if (!out.UploadId) throw new Error("R2 did not return an upload id.");
  return out.UploadId;
}

export async function signedPartUrl(key: string, uploadId: string, partNumber: number, expiresIn = 86400): Promise<string> {
  const client = r2Client();
  return getSignedUrl(client, new UploadPartCommand({
    Bucket: bucketName(),
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber,
  }), { expiresIn });
}

export async function listMultipartParts(key: string, uploadId: string): Promise<CompletedPart[]> {
  const client = r2Client();
  const parts: CompletedPart[] = [];
  let marker: string | undefined;
  for (;;) {
    const page = await client.send(new ListPartsCommand({
      Bucket: bucketName(),
      Key: key,
      UploadId: uploadId,
      PartNumberMarker: marker,
    }));
    for (const part of page.Parts ?? []) {
      if (part.PartNumber && part.ETag) parts.push({ PartNumber: part.PartNumber, ETag: part.ETag });
    }
    if (!page.IsTruncated) return parts;
    marker = page.NextPartNumberMarker;
  }
}

export async function completeMultipart(key: string, uploadId: string, parts: CompletedPart[]): Promise<void> {
  const client = r2Client();
  await client.send(new CompleteMultipartUploadCommand({
    Bucket: bucketName(),
    Key: key,
    UploadId: uploadId,
    MultipartUpload: { Parts: parts.sort((a, b) => (a.PartNumber ?? 0) - (b.PartNumber ?? 0)) },
  }));
}

export async function abortMultipart(key: string, uploadId: string): Promise<void> {
  const client = r2Client();
  await client.send(new AbortMultipartUploadCommand({ Bucket: bucketName(), Key: key, UploadId: uploadId }));
}

export async function headR2(uri: string): Promise<number | null> {
  const obj = parseR2Uri(uri);
  if (!obj) return null;
  try {
    const out = await r2Client().send(new HeadObjectCommand({ Bucket: obj.bucket, Key: obj.key }));
    return typeof out.ContentLength === "number" ? out.ContentLength : 0;
  } catch {
    return null;
  }
}

export async function readR2Head(uri: string, bytes: number): Promise<Uint8Array | null> {
  const obj = parseR2Uri(uri);
  if (!obj) return null;
  try {
    const out = await r2Client().send(new GetObjectCommand({
      Bucket: obj.bucket,
      Key: obj.key,
      Range: `bytes=0-${bytes - 1}`,
    }));
    const body = out.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
    return body?.transformToByteArray ? await body.transformToByteArray() : null;
  } catch {
    return null;
  }
}

export async function deleteR2(uri: string): Promise<void> {
  const obj = parseR2Uri(uri);
  if (!obj) return;
  await r2Client().send(new DeleteObjectCommand({ Bucket: obj.bucket, Key: obj.key }));
}
