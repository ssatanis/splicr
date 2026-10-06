"use client";

import { useEffect, useState } from "react";

/** Uses saved timestamps, so returning or reloading never resets the clock. */
export function ElapsedTime({ createdAt, startedAt, finishedAt, status }: {
  createdAt: string; startedAt?: string | null; finishedAt?: string | null; status: string;
}) {
  const [now, setNow] = useState<number | null>(null);
  const active = status === "queued" || status === "running";
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    if (!active) return;
    const timer = setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, [active]);
  const start = Date.parse(startedAt ?? createdAt);
  const end = active ? now : finishedAt ? Date.parse(finishedAt) : null;
  const seconds = end === null || !Number.isFinite(start) || !Number.isFinite(end) ? null : Math.max(0, Math.floor((end - start) / 1000));
  const duration = seconds === null ? "—" : [
    Math.floor(seconds / 3600) ? `${Math.floor(seconds / 3600)}h` : "",
    Math.floor(seconds / 60) % 60 ? `${Math.floor(seconds / 60) % 60}m` : "",
    `${seconds % 60}s`,
  ].filter(Boolean).join(" ");
  return <span className="tabular-nums" suppressHydrationWarning>{status === "queued" ? "Queued for" : "Elapsed"}: {duration}</span>;
}
