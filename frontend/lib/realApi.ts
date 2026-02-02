import { Analysis, AnalysisResults } from './types';

/**
 * Real API client (replaces mock-api.ts)
 * In Electron desktop build, calls production API (splicr.org).
 */

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

    return safeJson<Analysis>(response);
  },

  async getAnalyses(): Promise<Analysis[]> {
    const response = await fetch(`${API_BASE}/analysis/list`);
    if (!response.ok) throw new Error('Failed to fetch analyses');
    return safeJson<Analysis[]>(response);
  },

  async getAnalysis(id: string): Promise<Analysis> {
    const response = await fetch(`${API_BASE}/analysis/${id}`);
    if (!response.ok) throw new Error('Failed to fetch analysis');
    return safeJson<Analysis>(response);
  },

  async updateAnalysis(id: string, updates: Partial<Analysis>): Promise<Analysis> {
    const analysis = await this.getAnalysis(id);
    return { ...analysis, ...updates };
  },

  async deleteAnalysis(id: string): Promise<void> {
    const response = await fetch(`${API_BASE}/analysis/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete analysis');
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

  /** Re-run a failed or existing analysis. Resets status to running and starts the pipeline. */
  async runAnalysis(id: string): Promise<{ success: boolean; analysisId: string }> {
    const response = await fetch(`${API_BASE}/analysis/${id}/run`, { method: 'POST' });
    if (!response.ok) {
      const data = await safeJson<{ error?: string }>(response).catch(() => ({ error: undefined }));
      throw new Error(data.error || 'Failed to start analysis');
    }
    return safeJson<{ success: boolean; analysisId: string }>(response);
  },

  /** Returns results, or { results: null, analysis } when analysis exists but results aren't ready yet. */
  async getResults(id: string): Promise<AnalysisResults | { results: null; analysis: Analysis }> {
    const response = await fetch(`${API_BASE}/analysis/${id}/results`);
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
    if (data && typeof data === 'object' && 'results' in data && data.results === null && 'analysis' in data && data.analysis) {
      return { results: null, analysis: data.analysis };
    }
    return data as AnalysisResults;
  },

  // Notes
  async saveNote(analysisId: string, note: string): Promise<void> {
    const response = await fetch(`${API_BASE}/notes/${analysisId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    });
    if (!response.ok) throw new Error('Failed to save note');
  },

  async getNote(analysisId: string): Promise<string> {
    const response = await fetch(`${API_BASE}/notes/${analysisId}`);
    if (!response.ok) return '';
    const data = await safeJson<{ note?: string }>(response).catch(() => ({} as { note?: string }));
    return data.note || '';
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
