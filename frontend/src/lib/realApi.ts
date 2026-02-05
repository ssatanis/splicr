import { Analysis, AnalysisResults } from './types';

/**
 * Real API client (replaces mock-api.ts)
 * In Electron desktop build, calls production API (splicr.org).
 */

// Production-grade cache: longer TTL for stable data, shorter for lists
const apiCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 10000; // 10s default
const CACHE_TTL_RESULTS = 300000; // 5 min for completed results (stable)
const CACHE_TTL_LIST = 20000; // 20s for analysis list (balance freshness vs speed)

function getCachedData<T>(key: string, ttlMs: number = CACHE_TTL): T | null {
  const cached = apiCache.get(key);
  if (!cached) return null;
  const age = Date.now() - cached.timestamp;
  if (age > ttlMs) {
    apiCache.delete(key);
    return null;
  }
  return cached.data as T;
}

function setCachedData(key: string, data: any): void {
  apiCache.set(key, { data, timestamp: Date.now() });
}

async function safeJson<T = unknown>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    const text = await response.text();
    const fallback = response.status === 404 ? 'Not found' : 'Invalid response from server.';
    throw new Error(fallback);
  }
  const text = await response.text();
  if (!text?.trim()) throw new Error('Empty response from server.');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error('Invalid response from server.');
  }
}

const API_BASE =
  typeof process !== 'undefined' &&
  process.env.NEXT_PUBLIC_IS_ELECTRON === 'true' &&
  process.env.NEXT_PUBLIC_APP_URL
    ? `${String(process.env.NEXT_PUBLIC_APP_URL).replace(/\/$/, '')}/api`
    : '/api';

export const realApi = {
  // Analysis CRUD
  async createAnalysis(data: {
    name: string;
    libraryType: string;
    algorithm: string[];
    files: File[];
    sampleLabels: any[];
    parameters: any;
  }): Promise<Analysis> {
    const formData = new FormData();

    formData.append('name', data.name);
    formData.append('libraryType', data.libraryType);
    formData.append('algorithms', JSON.stringify(data.algorithm));
    formData.append('sampleLabels', JSON.stringify(data.sampleLabels));
    formData.append('parameters', JSON.stringify(data.parameters));

    data.files.forEach((file, index) => {
      formData.append(`file_${index}`, file);
      const label = data.sampleLabels[index];
      formData.append(`metadata_${index}`, JSON.stringify({
        fileName: file.name,
        condition: label.condition,
        replicate: label.replicate,
        sampleName: label.sampleName
      }));
    });

    const response = await fetch(`${API_BASE}/analysis/create`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await safeJson<{ message?: string }>(response).catch(() => ({} as { message?: string }));
      throw new Error(error.message || 'Failed to create analysis');
    }
    apiCache.delete('analyses:list');
    return safeJson<Analysis>(response);
  },

  async getAnalyses(): Promise<Analysis[]> {
    const cacheKey = 'analyses:list';
    const cached = getCachedData<Analysis[]>(cacheKey, CACHE_TTL_LIST);
    if (cached) return cached;
    const response = await fetch(`${API_BASE}/analysis/list`, { credentials: 'include' });
    if (!response.ok) throw new Error('Failed to fetch analyses');
    const data = await safeJson<Analysis[]>(response);
    setCachedData(cacheKey, data);
    return data;
  },

  async getAnalysis(id: string): Promise<Analysis> {
    const response = await fetch(`${API_BASE}/analysis/${id}`, { credentials: 'include' });
    if (!response.ok) throw new Error('Failed to fetch analysis');
    return safeJson<Analysis>(response);
  },

  async updateAnalysis(id: string, updates: Partial<Analysis>): Promise<Analysis> {
    if (updates.name != null && String(updates.name).trim()) {
      const res = await fetch(`${API_BASE}/analysis/${id}/update`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: String(updates.name).trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || data?.details || res.statusText || 'Failed to update analysis');
      }
      apiCache.delete('analyses:list');
    }
    return this.getAnalysis(id);
  },

  async deleteAnalysis(id: string): Promise<void> {
    const response = await fetch(`${API_BASE}/analysis/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete analysis');
    apiCache.delete('analyses:list');
    apiCache.delete(`results:${id}`);
  },

  async getAnalysisStatus(id: string): Promise<{
    status: string;
    progress: number;
    currentStep?: string;
    error?: string;
  }> {
    const response = await fetch(`${API_BASE}/analysis/${id}/status`);
    if (!response.ok) throw new Error('Failed to fetch status');
    return safeJson(response);
  },

  /** Re-run a failed or existing analysis. Resets status to running and starts the pipeline.
   * Pass { inline: true } to force inline execution (skip queue) when worker is stuck. */
  async runAnalysis(id: string, options?: { inline?: boolean }): Promise<{ success: boolean; analysisId: string }> {
    const url = `${API_BASE}/analysis/${id}/run` + (options?.inline ? '?inline=1' : '');
    const response = await fetch(url, { method: 'POST' });
    if (!response.ok) {
      const data = await safeJson<{ error?: string }>(response).catch(() => ({ error: undefined }));
      throw new Error(data.error || 'Failed to start analysis');
    }
    apiCache.delete(`results:${id}`);
    apiCache.delete('analyses:list');
    return safeJson<{ success: boolean; analysisId: string }>(response);
  },

  /** Returns results, or { results: null, analysis } when analysis exists but results aren't ready yet. */
  async getResults(id: string): Promise<AnalysisResults | { results: null; analysis: Analysis }> {
    const cacheKey = `results:${id}`;
    const cached = getCachedData<AnalysisResults | { results: null; analysis: Analysis }>(
      cacheKey,
      CACHE_TTL_RESULTS
    );
    if (cached) return cached;

    const response = await fetch(`${API_BASE}/analysis/${id}/results`, { credentials: 'include' });
    if (!response.ok) {
      let message: string;
      try {
        const data = await safeJson<{ message?: string }>(response);
        message = typeof data.message === 'string' && data.message ? data.message : `Failed to fetch results (${response.status})`;
      } catch {
        message = response.status === 401
          ? 'Please sign in to view results.'
          : response.status === 404
            ? 'Results not found.'
            : `Failed to fetch results (${response.status}). Please try again.`;
      }
      throw new Error(message);
    }
    const data = await safeJson<AnalysisResults | { results: null; analysis: Analysis }>(response);
    
    if (data && typeof data === 'object') {
      if ('results' in data && data.results === null && 'analysis' in data && data.analysis) {
        return { results: null, analysis: data.analysis };
      }
      setCachedData(cacheKey, data);
      return data as AnalysisResults;
    }
    
    return data as AnalysisResults;
  },

  /** Fetch count matrix on demand (used when results.rawData.countMatrixR2Key is set and countMatrix is omitted to avoid OOM). */
  async getCountMatrix(analysisId: string): Promise<Record<string, Record<string, number>> | null> {
    const response = await fetch(`${API_BASE}/analysis/${analysisId}/count-matrix`, { credentials: 'include' });
    if (!response.ok) return null;
    const data = await response.json().catch(() => null);
    if (data && typeof data === 'object' && !Array.isArray(data)) return data as Record<string, Record<string, number>>;
    return null;
  },

  // Notes
  async saveNote(analysisId: string, note: string): Promise<void> {
    const response = await fetch(`${API_BASE}/notes/${analysisId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    });
    if (!response.ok) throw new Error('Failed to save note');
    
    // Invalidate note cache after save
    apiCache.delete(`note:${analysisId}`);
  },

  async getNote(analysisId: string): Promise<string> {
    // Check cache first
    const cacheKey = `note:${analysisId}`;
    const cached = getCachedData<string>(cacheKey);
    if (cached !== null) {
      return cached;
    }
    
    const response = await fetch(`${API_BASE}/notes/${analysisId}`);
    if (!response.ok) return '';
    const data = await safeJson<{ note?: string }>(response).catch(() => ({} as { note?: string }));
    const note = data.note || '';
    
    // Cache the note
    setCachedData(cacheKey, note);
    return note;
  },

  // Favorites
  async getFavorites(): Promise<string[]> {
    const stored = typeof window !== 'undefined'
      ? localStorage.getItem('splicr_favorites')
      : null;
    return stored ? JSON.parse(stored) : [];
  },

  async toggleFavorite(geneId: string): Promise<void> {
    if (typeof window === 'undefined') return;

    const favorites = await this.getFavorites();
    const index = favorites.indexOf(geneId);

    if (index > -1) {
      favorites.splice(index, 1);
    } else {
      favorites.push(geneId);
    }

    localStorage.setItem('splicr_favorites', JSON.stringify(favorites));
  },
};
