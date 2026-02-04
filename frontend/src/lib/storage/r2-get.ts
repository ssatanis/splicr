/**
 * Server-only: fetch a file from R2 by key and return as a File for pipeline use.
 */
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { createServerR2Client, R2_BUCKET_NAME } from './r2-client';

export async function getR2FileAsFile(r2Key: string, fileName?: string): Promise<File> {
  const client = createServerR2Client();
  const command = new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: r2Key,
  });
  const response = await client.send(command);
  const body = response.Body;
  if (!body) {
    throw new Error(`R2 object empty or not found: ${r2Key}`);
  }
  const buffer = await body.transformToByteArray();
  const name = fileName ?? r2Key.split('/').pop() ?? r2Key;
  return new File([buffer], name);
}
