/**
 * Optional API key validation and rate limiting for /api/v1/*.
 * Uses in-memory state; for production use Redis or Supabase.
 */

const RATE_WINDOW_MS = 60 * 1000; // 1 minute
const DEFAULT_LIMIT = parseInt(process.env.API_RATE_LIMIT_STANDARD || '100', 10);

const globalStore = globalThis as any;
if (!globalStore.apiRequestCounts) globalStore.apiRequestCounts = new Map<string, { count: number; resetAt: number }>();

function getClientKey(request: Request): string {
  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7);
    return `key_${token.slice(0, 12)}`;
  }
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || 'anonymous';
  return `ip_${ip}`;
}

export function checkRateLimit(request: Request, limitPerMinute: number = DEFAULT_LIMIT): { ok: boolean; remaining: number } {
  const key = getClientKey(request);
  const now = Date.now();
  const store = globalStore.apiRequestCounts as Map<string, { count: number; resetAt: number }>;
  let entry = store.get(key);

  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_WINDOW_MS };
    store.set(key, entry);
  }

  entry.count += 1;
  const remaining = Math.max(0, limitPerMinute - entry.count);
  const ok = entry.count <= limitPerMinute;

  return { ok, remaining };
}

export function getApiKeyFromRequest(request: Request): string | null {
  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return null;
}
