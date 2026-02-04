"use client";

import { createContext, useContext, useState, useCallback, useMemo, useEffect } from "react";

type SidebarContextValue = {
  isMinimized: boolean;
  setMinimized: (minimized: boolean) => void;
  toggle: () => void;
  /** Use for main content left margin: ml-sidebar-min when minimized, ml-sidebar-max when expanded */
  mainMarginClass: string;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

const STORAGE_KEY = "splicr_sidebar_minimized";

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  // Always initialize with false to prevent hydration mismatch
  const [isMinimized, setMinimizedState] = useState<boolean>(false);

  // Read from localStorage after mounting
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "true") {
        setMinimizedState(true);
      }
    } catch {
      // Ignore errors
    }
  }, []);

  const setMinimized = useCallback((minimized: boolean) => {
    setMinimizedState(minimized);
    try {
      localStorage.setItem(STORAGE_KEY, minimized ? "true" : "false");
    } catch {}
  }, []);

  const toggle = useCallback(() => {
    setMinimizedState((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "true" : "false");
      } catch {}
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      isMinimized,
      setMinimized,
      toggle,
      mainMarginClass: isMinimized ? "ml-sidebar-min" : "ml-sidebar-max",
    }),
    [isMinimized, setMinimized, toggle]
  );

  return (
    <SidebarContext.Provider value={value}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    return {
      isMinimized: false,
      setMinimized: () => {},
      toggle: () => {},
      mainMarginClass: "ml-sidebar-max",
    };
  }
  return ctx;
}
