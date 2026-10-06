"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { retryScreenAnalysis } from "@/lib/intake/actions";

export function RetryAnalysis({ screenId, completed = false }: { screenId: string; completed?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return <div className="mt-3"><button disabled={busy} className="h-8 rounded-md border border-stone-200 px-3 text-[12px] text-ink disabled:opacity-50" onClick={async () => {
    setBusy(true); setError(null);
    const result = await retryScreenAnalysis(screenId);
    setBusy(false);
    if (!result.ok) setError(result.error);
    else router.refresh();
  }}>{busy ? "Queueing..." : completed ? "Run saved analysis again" : "Retry saved analysis"}</button>{error && <p role="alert" className="mt-2 text-[12px] text-orange-700">{error}</p>}</div>;
}
