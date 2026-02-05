/**
 * Worker env normalization — run before any queue/Supabase code.
 * Ensures REDIS_URL and SUPABASE_URL are set from Upstash/NEXT_PUBLIC when
 * the worker is started directly (e.g. Docker CMD) instead of via scripts/start-worker.ts.
 */
if (!process.env.SUPABASE_URL?.trim() && process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()) {
  process.env.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
}
if (!process.env.REDIS_URL?.trim() && process.env.UPSTASH_REDIS_REST_URL?.trim() && process.env.UPSTASH_REDIS_REST_TOKEN?.trim()) {
  try {
    const host = new URL(process.env.UPSTASH_REDIS_REST_URL).hostname;
    process.env.REDIS_URL = `rediss://default:${encodeURIComponent(process.env.UPSTASH_REDIS_REST_TOKEN)}@${host}:6379`;
  } catch {
    // ignore
  }
}
