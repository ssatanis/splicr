"use client";

import { useEffect } from "react";
import { getStoredAppearance, applyAppearance } from "@/lib/appearance";

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const stored = getStoredAppearance();
    applyAppearance(stored);
  }, []);
  return <>{children}</>;
}
