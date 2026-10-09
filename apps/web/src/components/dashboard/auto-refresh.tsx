"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function AutoRefresh({ intervalMs = 5000, active = false }: { intervalMs?: number; active?: boolean }) {
  const router = useRouter();
  const [supabase] = useState(createClient);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") router.refresh(); };
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const changed = () => {
      clearTimeout(debounce); debounce = setTimeout(refresh, 250);
    };
    const channel = supabase.channel("workspace-screen-progress")
      .on("postgres_changes", { event: "*", schema: "public", table: "screens" }, changed)
      .on("postgres_changes", { event: "*", schema: "public", table: "run_stages" }, changed)
      .on("postgres_changes", { event: "*", schema: "public", table: "runs" }, changed)
      .subscribe();
    // Covers returning through the router cache, even if this page was idle.
    refresh();
    const timer = active ? setInterval(refresh, intervalMs) : undefined;
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    window.addEventListener("online", refresh);
    return () => {
      clearInterval(timer);
      clearTimeout(debounce);
      void supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [active, intervalMs, router, supabase]);
  return null;
}
