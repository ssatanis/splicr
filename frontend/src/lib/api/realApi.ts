/**
 * Backend API client for services that run on the Python/FastAPI backend
 * (e.g. reference gene sets).
 * Set NEXT_PUBLIC_BACKEND_URL (e.g. http://localhost:8000) for reference sets.
 * When unset, requests go to same-origin /api/v1 (use Next.js rewrite to proxy to backend if needed).
 */

const BACKEND_BASE =
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_BACKEND_URL
    ? `${String(process.env.NEXT_PUBLIC_BACKEND_URL).replace(/\/$/, '')}/api/v1`
    : '/api/v1';

interface RequestConfig {
  params?: Record<string, string | number | boolean | undefined>;
}

function buildUrl(path: string, config?: RequestConfig): string {
  const fullPath = path.startsWith('http') ? path : `${BACKEND_BASE}${path}`;
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  const u = new URL(fullPath, origin);
  if (config?.params) {
    Object.entries(config.params).forEach(([k, v]) => {
      if (v !== undefined) u.searchParams.set(k, String(v));
    });
  }
  return u.toString();
}

async function request<T>(path: string, config?: RequestConfig): Promise<{ data: T }> {
  const url = buildUrl(path, config);
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    next: { revalidate: 60 },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  const data = (await res.json()) as T;
  return { data };
}

export const apiClient = {
  get<T>(path: string, config?: RequestConfig): Promise<{ data: T }> {
    return request<T>(path, config);
  },
  post<T>(path: string, body?: unknown): Promise<{ data: T }> {
    const url = buildUrl(path);
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then(async (res) => {
      if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
      return { data: (await res.json()) as T };
    });
  },
};
