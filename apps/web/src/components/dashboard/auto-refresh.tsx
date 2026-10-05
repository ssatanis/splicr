"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function AutoRefresh({ intervalMs = 5000, active = false }: { intervalMs?: number; active?: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => {
      router.refresh();
    }, intervalMs);
    return () => clearInterval(interval);
  }, [active, intervalMs, router]);

  return null;
}
