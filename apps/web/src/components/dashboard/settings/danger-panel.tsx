"use client";

import { Loader2, Trash2, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { deleteWorkspace } from "@/app/dashboard/settings/actions";
import type { Organization, WorkspaceStats } from "@/lib/data/types";
import { formatNumber } from "@/lib/utils";

export interface DangerPanelProps {
  org: Organization | null;
  stats: WorkspaceStats;
  /** True only for an owner with a real session. */
  canDelete: boolean;
  lockedReason?: string;
}

type DeleteState = { status: "idle" } | { status: "error"; error: string } | { status: "done" };

/**
 * Deleting the workspace.
 *
 * Every foreign key pointing at `organizations` cascades, so this one statement
 * takes the screens, runs, hits, QC, outcomes, reports, invites, memberships,
 * API keys and any custom library with it. The counts shown are the workspace's
 * real ones, read on the server, because "3 screens and 47,000 hits" is the
 * sentence that stops the wrong click.
 *
 * The typed confirmation is checked here and again inside the action, and the
 * "owners delete their organization" policy checks the role a third time inside
 * Postgres.
 */
export function DangerPanel({ org, stats, canDelete, lockedReason }: DangerPanelProps) {
  const router = useRouter();
  const inputId = useId();
  const [typed, setTyped] = useState("");
  const [state, setState] = useState<DeleteState>({ status: "idle" });
  const [pending, startTransition] = useTransition();

  const slug = org?.slug ?? "";
  const matches = typed.trim() === slug && slug.length > 0;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canDelete || !matches || pending) return;

    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await deleteWorkspace(formData);
      if (!result.ok) {
        setState({ status: "error", error: result.error });
        return;
      }
      setState({ status: "done" });
      router.replace("/dashboard");
      router.refresh();
    });
  }

  const lines: { label: string; value: number }[] = [
    { label: "screens", value: stats.screens },
    { label: "runs", value: stats.runs },
    { label: "hits", value: stats.hits },
    { label: "logged outcomes", value: stats.outcomes },
    { label: "members", value: stats.members },
  ];

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-3xl border border-red-200 bg-white p-5 md:p-6"
    >
      <header className="mb-5 flex items-start gap-3">
        <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-600" strokeWidth={1.8} />
        <div>
          <h2 className="text-lg font-medium tracking-tight text-ink">Danger zone</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Deleting a workspace removes it for everybody in it, not only for you, and it cannot be
            undone.
          </p>
        </div>
      </header>

      <div className="rounded-2xl bg-red-50 px-4 py-3.5">
        <p className="text-xs font-medium text-red-700">
          Deleting {org?.name ?? "this workspace"} also deletes
        </p>
        <ul className="mt-2 grid gap-x-6 gap-y-1 text-xs text-red-700 sm:grid-cols-2">
          {lines.map((line) => (
            <li key={line.label} className="flex items-baseline gap-1.5">
              <span className="tabular-nums font-medium">{formatNumber(line.value)}</span>
              <span>{line.label}</span>
            </li>
          ))}
          <li className="sm:col-span-2">
            Every API key, pending invite, report and custom guide library as well.
          </li>
        </ul>
      </div>

      {!canDelete && lockedReason && (
        <p className="mt-5 rounded-2xl bg-mist-soft px-3.5 py-2.5 text-xs text-body">
          {lockedReason}
        </p>
      )}

      <fieldset disabled={!canDelete || state.status === "done"} className="m-0 border-0 p-0">
        <div className="mt-5 max-w-sm">
          <label htmlFor={inputId} className="label-sm block">
            Type <span className="font-medium text-ink">{slug || "the workspace slug"}</span> to
            confirm
          </label>
          <input
            id={inputId}
            name="confirm"
            type="text"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder={slug}
            className="underline-input disabled:cursor-not-allowed disabled:text-muted"
          />
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-4">
          <button
            type="submit"
            disabled={!canDelete || !matches || pending || state.status === "done"}
            className="btn btn-sm bg-red-600 text-white hover:bg-red-700 disabled:pointer-events-none disabled:opacity-45"
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
            )}
            {pending ? "Deleting" : "Delete this workspace"}
          </button>

          <p
            className="min-h-5 max-w-md text-xs"
            aria-live="polite"
            role={state.status === "error" ? "alert" : undefined}
          >
            {state.status === "error" ? (
              <span className="text-red-700">{state.error}</span>
            ) : state.status === "done" ? (
              <span className="text-body">Workspace deleted. Taking you back to the dashboard.</span>
            ) : canDelete && !matches ? (
              <span className="text-muted">
                The button unlocks once the slug matches exactly.
              </span>
            ) : null}
          </p>
        </div>
      </fieldset>
    </form>
  );
}
