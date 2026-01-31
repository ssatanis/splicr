import { Analysis, AnalysisResults } from './types';

/**
 * Real API client (replaces mock-api.ts)
 */

const API_BASE = '/api';

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
      const error = await response.json();
      throw new Error(error.message || 'Failed to create analysis');
    }

    return response.json();
  },

  async getAnalyses(): Promise<Analysis[]> {
    const response = await fetch(`${API_BASE}/analysis/list`);
    if (!response.ok) throw new Error('Failed to fetch analyses');
    return response.json();
  },

  async getAnalysis(id: string): Promise<Analysis> {
    const response = await fetch(`${API_BASE}/analysis/${id}`);
    if (!response.ok) throw new Error('Failed to fetch analysis');
    return response.json();
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
    return response.json();
  },

  /** Returns results, or { results: null, analysis } when analysis exists but results aren't ready yet. */
  async getResults(id: string): Promise<AnalysisResults | { results: null; analysis: Analysis }> {
    const response = await fetch(`${API_BASE}/analysis/${id}/results`);
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data?.message === 'string' ? data.message : 'Failed to fetch results');
    if (data && typeof data === 'object' && data.results === null && data.analysis) {
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
    const data = await response.json();
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
