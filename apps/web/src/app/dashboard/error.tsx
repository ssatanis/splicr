"use client";

/**
 * What a dashboard page shows when it throws while rendering.
 *
 * A reader never sees a stack trace or a database message: the digest is a short
 * id that the server log can be searched for, and nothing else about the failure
 * reaches the page. "Try again" re-renders the same route without a reload, which
 * is the right first move for a read that failed once.
 */
import Link from "next/link";
import { useEffect } from "react";

import { Card, PageHeader } from "@/components/dashboard/ui";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(`[dashboard] render failed${error.digest ? ` (${error.digest})` : ""}`);
  }, [error]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader dense title="This page could not be shown" />
      <Card title="Something went wrong on our side">
        <p className="text-sm text-body">
          The page failed while it was being prepared. Nothing you entered was lost or changed by this. Try again, and if it keeps
          happening, mention the reference below when you tell us.
        </p>
        {error.digest && (
          <p className="mt-2 text-xs text-muted">
            Reference <span className="font-mono">{error.digest}</span>
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={reset} className="btn btn-orange rounded-lg px-4 py-2 text-[13px]">
            Try again
          </button>
          <Link href="/dashboard" className="text-[13px] text-cyan-600 underline decoration-line-strong underline-offset-2">
            Back to the overview
          </Link>
        </div>
      </Card>
    </div>
  );
}
