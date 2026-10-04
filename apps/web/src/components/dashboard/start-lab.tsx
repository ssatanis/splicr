"use client";

/**
 * Start a lab, for somebody signed in who is not in one.
 *
 * Until this existed that person had nowhere to go: the overview said the
 * workspace was unavailable, the members page said they were not in a workspace,
 * and settings said the panels could not be saved. All three were accurate and
 * none of them was a way out, because the only workspace anyone ever got was the
 * personal one the signup trigger makes, and leaving it was final.
 *
 * The caller becomes the owner, so inviting the rest of the lab is available
 * immediately afterwards and the page says so rather than making them find it.
 */

import { Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createOrganization } from "@/lib/data/actions";
import { ORG_KINDS, ORG_KIND_LABEL } from "@/lib/data/types";

import { Card } from "./ui";

export function StartLab({
  /** Demo visitors see the form, disabled, like every other control there. */
  demo = false,
  className,
}: {
  demo?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<string>("academic");
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const busy = isPending;
  const disabled = demo || busy || trimmed.length === 0;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    setError(null);

    const payload = new FormData();
    payload.set("name", trimmed);
    payload.set("kind", kind);

    startTransition(async () => {
      const result = await createOrganization(payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // The server revalidated the dashboard layout; refresh so this route
      // re-renders with the new workspace in context instead of this form.
      router.refresh();
    });
  }

  return (
    <Card
      className={className}
      title="Start a lab"
      subtitle="A lab holds the screens, runs and validation outcomes your group shares."
    >
      <form className="space-y-4" onSubmit={submit}>
        <div>
          <label htmlFor="lab-name" className="block text-sm text-ink">
            Lab name
          </label>
          <input
            id="lab-name"
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Franklin Lab"
            maxLength={120}
            autoComplete="organization"
            disabled={demo || busy}
            className="mt-1.5 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-teal-700"
          />
          <p className="mt-1.5 text-xs text-muted">
            Shown in the sidebar, on the screens list and wherever the workspace is named. You can
            rename it later in settings.
          </p>
        </div>

        <div>
          <label htmlFor="lab-kind" className="block text-sm text-ink">
            Kind
          </label>
          <select
            id="lab-kind"
            name="kind"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            disabled={demo || busy}
            className="mt-1.5 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-teal-700"
          >
            {ORG_KINDS.map((option) => (
              <option key={option} value={option}>
                {ORG_KIND_LABEL[option]}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-muted">
            Used for the Atlas comparisons a new screen is offered, and for nothing else.
          </p>
        </div>

        {error && (
          <p role="alert" className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-700">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button type="submit" className="btn btn-teal btn-sm" disabled={disabled}>
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Plus className="h-4 w-4" aria-hidden />
            )}
            {busy ? "Creating" : "Create lab"}
          </button>
          <span className="text-xs text-muted">
            {demo
              ? "The demo has no account behind it, so there is no lab to create."
              : "You will be its owner, and can invite the rest of the lab straight after."}
          </span>
        </div>
      </form>
    </Card>
  );
}
