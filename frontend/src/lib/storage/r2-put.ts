/**
 * Server-only: upload JSON to R2. Used to store large analysis artifacts (e.g. count matrix)
 * so they are not kept in the database and do not cause OOM when returning results.
 */
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { createServerR2Client, R2_BUCKET_NAME } from './r2-client';

export async function putR2Json(key: string, data: unknown): Promise<void> {
  const client = createServerR2Client();
  const body = JSON.stringify(data);
  await client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: 'application/json',
    })
  );
}
