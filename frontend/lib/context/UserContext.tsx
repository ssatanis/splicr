"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { Analysis, UserData } from "../types";
import { realApi } from "../realApi";

interface UserContextType {
  userData: UserData | null;
  analyses: Analysis[];
  isLoading: boolean;
  refreshAnalyses: () => Promise<void>;
  createAnalysis: (analysis: Omit<Analysis, "id" | "createdAt" | "progress">) => Promise<Analysis>;
  updateAnalysis: (id: string, updates: Partial<Analysis>) => Promise<Analysis>;
  deleteAnalysis: (id: string) => Promise<void>;
  saveNote: (analysisId: string, note: string) => Promise<void>;
  getNote: (analysisId: string) => Promise<string>;
  toggleFavorite: (geneId: string) => Promise<void>;
  favorites: string[];
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: ReactNode }) {
  const [userData, setUserData] = useState<UserData | null>(null);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load user data on mount
  useEffect(() => {
    loadUserData();
  }, []);

  const loadUserData = async () => {
    setIsLoading(true);
    try {
      const analyses = await realApi.getAnalyses();
      const favorites = await realApi.getFavorites();
      
      setAnalyses(analyses);
      setFavorites(favorites);
      
      // Load user data from storage
      if (typeof window !== "undefined") {
        const stored = localStorage.getItem("splicr_user_data");
        if (stored) {
          setUserData(JSON.parse(stored));
        }
      }
    } catch (error) {
      console.error("Error loading user data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const refreshAnalyses = async () => {
    const analyses = await realApi.getAnalyses();
    setAnalyses(analyses);
  };

  const createAnalysis = async (analysis: Omit<Analysis, "id" | "createdAt" | "progress">) => {
    // Note: This function is no longer used directly - analyses are created via /api/analysis/create
    // Keeping for backwards compatibility
    await refreshAnalyses();
    return analysis as Analysis;
  };

  const updateAnalysis = async (id: string, updates: Partial<Analysis>) => {
    const updated = await realApi.updateAnalysis(id, updates);
    await refreshAnalyses();
    return updated;
  };

  const deleteAnalysis = async (id: string) => {
    await realApi.deleteAnalysis(id);
    await refreshAnalyses();
  };

  const saveNote = async (analysisId: string, note: string) => {
    await realApi.saveNote(analysisId, note);
  };

  const getNote = async (analysisId: string) => {
    return await realApi.getNote(analysisId);
  };

  const toggleFavorite = async (geneId: string) => {
    await realApi.toggleFavorite(geneId);
    const newFavorites = await realApi.getFavorites();
    setFavorites(newFavorites);
  };

  return (
    <UserContext.Provider
      value={{
        userData,
        analyses,
        isLoading,
        refreshAnalyses,
        createAnalysis,
        updateAnalysis,
        deleteAnalysis,
        saveNote,
        getNote,
        toggleFavorite,
        favorites,
      }}
    >
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error("useUser must be used within a UserProvider");
  }
  return context;
}
