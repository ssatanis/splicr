/**
 * Mock API for local development
 * Replace with real API calls when backend is connected
 */

import { Analysis, AnalysisResults, UserData } from "./types";

const STORAGE_KEY = "splicr_user_data";

// Simulate network delay
const delay = (ms: number = 500) => new Promise((resolve) => setTimeout(resolve, ms));

// Get user data from localStorage
function getUserData(): UserData {
  if (typeof window === "undefined") return getDefaultUserData();
  
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    const defaultData = getDefaultUserData();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultData));
    return defaultData;
  }
  
  return JSON.parse(stored);
}

// Save user data to localStorage
function saveUserData(data: UserData): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// Get default user data
function getDefaultUserData(): UserData {
  return {
    userId: "user-" + Math.random().toString(36).substring(7),
    analyses: [],
    favorites: [],
    notes: {},
  };
}

// Mock API functions
export const mockApi = {
  // List all analyses
  async getAnalyses(): Promise<Analysis[]> {
    await delay();
    const data = getUserData();
    return data.analyses.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  },

  // Get single analysis
  async getAnalysis(id: string): Promise<Analysis | null> {
    await delay();
    const data = getUserData();
    return data.analyses.find((a) => a.id === id) || null;
  },

  // Create new analysis
  async createAnalysis(analysis: Omit<Analysis, "id" | "createdAt" | "progress">): Promise<Analysis> {
    await delay();
    const data = getUserData();
    
    const newAnalysis: Analysis = {
      ...analysis,
      id: "analysis-" + Math.random().toString(36).substring(7),
      createdAt: new Date().toISOString(),
      progress: 0,
      userId: data.userId,
    };
    
    data.analyses.push(newAnalysis);
    saveUserData(data);
    
    return newAnalysis;
  },

  // Update analysis
  async updateAnalysis(id: string, updates: Partial<Analysis>): Promise<Analysis> {
    await delay();
    const data = getUserData();
    const index = data.analyses.findIndex((a) => a.id === id);
    
    if (index === -1) {
      throw new Error("Analysis not found");
    }
    
    data.analyses[index] = { ...data.analyses[index], ...updates };
    saveUserData(data);
    
    return data.analyses[index];
  },

  // Delete analysis
  async deleteAnalysis(id: string): Promise<void> {
    await delay();
    const data = getUserData();
    data.analyses = data.analyses.filter((a) => a.id !== id);
    saveUserData(data);
  },

  // Get analysis results (mock)
  async getResults(id: string): Promise<AnalysisResults | null> {
    await delay(1000); // Longer delay for "fetching" results
    
    // Generate mock results
    const mockResults: AnalysisResults = {
      id,
      summary: {
        totalGenes: 18000,
        significantHits: 234,
        enriched: 89,
        depleted: 145,
      },
      qcMetrics: {
        totalReads: 10500000,
        mappingRate: 95.2,
        zeroCounts: 2.3,
        libraryCoverage: 98.7,
        giniCoefficient: 0.42,
      },
      topHits: {
        depleted: generateMockGenes(20, "depleted"),
        enriched: generateMockGenes(20, "enriched"),
      },
      allGenes: generateMockGenes(100, "mixed"),
      plots: {
        volcano: "/mock-volcano.png",
        waterfall: "/mock-waterfall.png",
        topHits: "/mock-top-hits.png",
        qc: "/mock-qc.png",
      },
      rawFiles: {
        counts: "/mock-counts.txt",
        geneSummary: "/mock-gene-summary.txt",
        sgrnaSummary: "/mock-sgrna-summary.txt",
      },
    };
    
    return mockResults;
  },

  // Save notes
  async saveNote(analysisId: string, note: string): Promise<void> {
    await delay(200);
    const data = getUserData();
    data.notes[analysisId] = note;
    saveUserData(data);
  },

  // Get note
  async getNote(analysisId: string): Promise<string> {
    const data = getUserData();
    return data.notes[analysisId] || "";
  },

  // Toggle favorite gene
  async toggleFavorite(geneId: string): Promise<void> {
    await delay(200);
    const data = getUserData();
    const index = data.favorites.indexOf(geneId);
    
    if (index === -1) {
      data.favorites.push(geneId);
    } else {
      data.favorites.splice(index, 1);
    }
    
    saveUserData(data);
  },

  // Get favorites
  async getFavorites(): Promise<string[]> {
    const data = getUserData();
    return data.favorites;
  },
};

// Helper: Generate mock gene data
function generateMockGenes(count: number, type: "depleted" | "enriched" | "mixed") {
  const genes = [];
  const geneNames = [
    "TP53", "KRAS", "EGFR", "MYC", "BRCA1", "BRCA2", "APC", "PTEN",
    "RB1", "VHL", "CDKN2A", "SMAD4", "STK11", "ATM", "NF1", "NOTCH1",
    "BRAF", "PIK3CA", "CTNNB1", "ERBB2", "RET", "ALK", "MET", "FGFR2"
  ];
  
  for (let i = 0; i < count; i++) {
    const lfc = type === "depleted" 
      ? -(Math.random() * 3 + 0.5)
      : type === "enriched"
      ? Math.random() * 2 + 0.5
      : (Math.random() - 0.5) * 4;
    
    genes.push({
      gene: geneNames[i % geneNames.length] + (i > geneNames.length ? i : ""),
      sgrnaCount: Math.floor(Math.random() * 4) + 4,
      logFoldChange: lfc,
      pValue: Math.random() * 0.05,
      fdr: Math.random() * 0.1,
      rank: i + 1,
    });
  }
  
  return genes;
}
