"use client";

/**
 * The accession box, and this workspace's requests under it.
 *
 * It validates the accession shape in the browser so an obvious typo is caught
 * before a round trip, and again on the server, where the decision is actually
 * made. Everything the list says about a request is what the ingest engine
 * recorded; a queued request is called queued, not "processing", because
 * nothing has looked at it yet.
 */
import { Loader2, Plus, X } from "lucide-react";
import { useActionState, useState } from "react";

import { requestScreenAnalysis, withdrawScreenRequest } from "@/lib/data/request-actions";
import {
  REQUEST_COPY,
  isSupportedAccession,
  normaliseAccession,
  type ScreenRequest,
} from "@/lib/data/request-shape";
import { cn } from "@/lib/utils";

import { StatusChip, type ChipTone } from "./ui";

const TONE: Record<ScreenRequest["status"], ChipTone> = {
  queued: "wait",
  planning: "run",
  running: "run",
  accepted: "run",
  needs_review: "wait",
  published: "ok",
  rejected: "idle",
  failed: "bad",
};

const EXAMPLES = ["GSE145743", "PRJNA607255", "SRP250108"];

/** Withdrawing one queued request, with whatever went wrong said out loud. */
function Withdraw({ id }: { id: string }) {
  const [state, action, pending] = useActionState(
    async (_previous: { error: string } | null, formData: FormData) => {
      const result = await withdrawScreenRequest(formData);
      return result.ok ? null : { error: result.error };
    },
    null,
  );
  return (
    <form action={action} className="ml-auto flex items-baseline gap-2">
      <input type="hidden" name="id" value={id} />
      {state?.error && <span role="alert" className="text-[11px] text-orange-700">{state.error}</span>}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-sm text-[11px] text-cyan-600 underline decoration-line-strong underline-offset-2 disabled:text-muted disabled:no-underline"
      >
        <X className="h-3 w-3" aria-hidden="true" /> {pending ? "Withdrawing" : "Withdraw"}
      </button>
    </form>
  );
}

export function RequestForm({ requests }: { requests: ScreenRequest[] }) {
  const [state, action, pending] = useActionState(
    async (_previous: { error: string } | null, formData: FormData) => {
      const result = await requestScreenAnalysis(formData);
      return result.ok ? null : { error: result.error };
    },
    null,
  );
  const [text, setText] = useState("");

  const typed = normaliseAccession(text);
  const malformed = typed.length > 3 && !isSupportedAccession(typed);

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-2">
        <label htmlFor="accession" className="block text-[12px] text-ink">
          Accession
        </label>
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-[220px] flex-1">
            <input
              id="accession"
              name="accession"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={EXAMPLES[0]}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={malformed || Boolean(state?.error) ? true : undefined}
              aria-describedby="accession-help"
              className={cn(
                "num h-8 w-full rounded-md border bg-white px-2.5 text-[13px] uppercase text-ink outline-none transition-colors duration-[var(--dur-1)] focus:border-cyan-500 motion-reduce:transition-none",
                malformed ? "border-orange-500" : "border-line",
              )}
            />
          </div>
          <button
            type="submit"
            disabled={pending || typed === "" || malformed}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-ink px-3 text-[12px] font-medium text-white hover:bg-ink/90 disabled:bg-mist disabled:text-muted"
          >
            {pending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
            Queue the analysis
          </button>
        </div>
        <p id="accession-help" className="text-[11px] leading-snug text-muted">
          {malformed
            ? `${typed} is not a shape SplicR can resolve. Try a GEO series, a BioProject or an SRA, ENA or DDBJ study.`
            : <>For example {EXAMPLES.map((example, index) => (
                <span key={example}>
                  {index > 0 && ", "}
                  <button
                    type="button"
                    onClick={() => setText(example)}
                    className="num text-cyan-600 underline decoration-line-strong underline-offset-2"
                  >
                    {example}
                  </button>
                </span>
              ))}.</>}
        </p>
        {state?.error && (
          <p role="alert" className="rounded-md bg-orange-50 px-2.5 py-1.5 text-[12px] leading-snug text-orange-700">
            {state.error}
          </p>
        )}
      </form>

      <div>
        <div className="mb-1 flex items-baseline justify-between gap-2 border-b border-line pb-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
            This workspace&rsquo;s requests
          </span>
          <span className="num text-[11px] text-muted">{requests.length}</span>
        </div>
        {requests.length === 0 ? (
          <p className="py-2 text-[12px] leading-snug text-muted">
            None yet. A request you queue here is listed with whatever the engine last reported
            about it.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {requests.map((request) => (
              <li key={request.id} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 py-2">
                <span className="num text-[12.5px] font-medium text-ink">{request.accession}</span>
                {request.resolved_accession && request.resolved_accession !== request.accession && (
                  <span className="num text-[11px] text-muted">resolved to {request.resolved_accession}</span>
                )}
                <StatusChip tone={TONE[request.status]}>{REQUEST_COPY[request.status].label}</StatusChip>
                {request.status === "queued" && <Withdraw id={request.id} />}
                <p className="basis-full text-[11.5px] leading-snug text-muted">
                  {request.detail?.trim() || REQUEST_COPY[request.status].body}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
