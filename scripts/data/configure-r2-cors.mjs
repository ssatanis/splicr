/**
 * Keep browser uploads enabled for the app's exact origins without replacing
 * unrelated bucket policies. Preview by default; --apply writes and verifies.
 * node scripts/data/configure-r2-cors.mjs --apply --origin=https://splicr.org
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { GetBucketCorsCommand, PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = file => existsSync(resolve(root, file)) ? parseEnv(readFileSync(resolve(root, file), 'utf8')) : {};
const env = { ...read('.env'), ...read('apps/web/.env.local'), ...process.env };
for (const name of ['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
  if (!env[name]?.trim()) throw new Error(`${name} is required.`);
}
const args = process.argv.slice(2);
const requested = [...new Set([
  env.NEXT_PUBLIC_SITE_URL,
  ...args.filter(arg => arg.startsWith('--origin=')).map(arg => arg.slice('--origin='.length)),
].filter(Boolean).map(value => {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP or HTTPS app origin.');
  return url.origin;
}))];
if (!requested.length) throw new Error('Set NEXT_PUBLIC_SITE_URL or provide --origin=https://your-app.example.');
const client = new S3Client({
  region: 'auto',
  endpoint: env.R2_ENDPOINT?.trim() || `https://${env.R2_ACCOUNT_ID.trim()}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID.trim(), secretAccessKey: env.R2_SECRET_ACCESS_KEY.trim() },
});
const bucket = env.R2_BUCKET.trim();
const readRules = async () => {
  try { return (await client.send(new GetBucketCorsCommand({ Bucket: bucket }))).CORSRules ?? []; }
  catch (error) { if (error.name === 'NoSuchCORSConfiguration') return []; throw error; }
};
const ready = (rule, origin) => rule.AllowedOrigins?.includes(origin)
  && rule.AllowedMethods?.includes('PUT')
  && rule.AllowedHeaders?.some(header => header === '*' || header.toLowerCase() === 'content-type')
  && rule.ExposeHeaders?.some(header => header.toLowerCase() === 'etag');
const before = await readRules();
const missing = requested.filter(origin => !before.some(rule => ready(rule, origin)));
if (!missing.length) { console.log('Upload CORS is configured for every requested origin.'); }
else {
  const rules = [...before, { AllowedOrigins: missing, AllowedMethods: ['GET', 'HEAD', 'PUT'], AllowedHeaders: ['*'], ExposeHeaders: ['ETag', 'Content-Length'], MaxAgeSeconds: 3600 }];
  console.log(JSON.stringify({ addedOrigins: missing, preservedRules: before.length, apply: args.includes('--apply') }, null, 2));
  if (args.includes('--apply')) {
    await client.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: rules } }));
    const after = await readRules();
    if (requested.some(origin => !after.some(rule => ready(rule, origin)))) throw new Error('The saved CORS rules did not confirm every requested origin.');
    console.log('Upload CORS saved and verified.');
  }
}
