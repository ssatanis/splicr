"use client";

/**
 * Freezing and revealing a round.
 *
 * Both are one-way, so both confirm first. Setting a round up is reversible and
 * lives inline in `round-setup.tsx`; a drawer was the wrong shape for it,
 * because it covered the list of rounds it was adding to.
 */
import { useState, useTransition } from "react";

import { freezeRound, revealRound } from "@/lib/data/round-actions";

export function FreezeButton({ roundId, nSlots }: { roundId: string; nSlots: number }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (error) {
    return (
      <span className="text-[11px] text-red-700" title={error}>
        {error.slice(0, 48)}
      </span>
    );
  }
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-[11.5px] text-cyan-600 underline decoration-line-strong underline-offset-2 hover:decoration-cyan-600"
      >
        Freeze
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[11px] text-muted">Commit {nSlots}?</span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await freezeRound(roundId);
            if (!result.ok) setError(result.error);
          })
        }
        className="rounded-md bg-ink px-2 py-0.5 text-[11px] text-white disabled:opacity-60"
      >
        {pending ? "Writing" : "Yes"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="text-[11px] text-muted underline"
      >
        No
      </button>
    </span>
  );
}

export function RevealButton({ roundId }: { roundId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (error) {
    return (
      <span className="text-[11px] text-red-700" title={error}>
        {error.slice(0, 48)}
      </span>
    );
  }
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-[11.5px] text-cyan-600 underline decoration-line-strong underline-offset-2 hover:decoration-cyan-600"
      >
        Reveal
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[11px] text-muted">End the blind?</span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await revealRound(roundId);
            if (!result.ok) setError(result.error);
          })
        }
        className="rounded-md bg-ink px-2 py-0.5 text-[11px] text-white disabled:opacity-60"
      >
        {pending ? "Saving" : "Yes"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="text-[11px] text-muted underline"
      >
        No
      </button>
    </span>
  );
}
