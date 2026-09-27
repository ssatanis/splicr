"use client";

/**
 * The shortlist: the genes a reader has marked to take to the bench.
 *
 * The overview exists so that somebody can choose about ten genes out of a few
 * hundred, under a PI who has approved one validation round, and before this
 * there was no way to mark even one of them. So the table carries a checkbox and
 * the picks survive a reload.
 *
 * They live in this browser rather than in the workspace because there is no
 * endpoint to write them to yet. That is a real limitation and the footer says
 * so; when the endpoint exists, this module is the only thing that changes.
 *
 * Read through `useSyncExternalStore` with an empty server snapshot, so the
 * server render and the first client render agree and no row flickers into a
 * picked state after hydration. Every storage access is guarded, because a
 * private window and blocked site data both throw here.
 */
import { useCallback, useSyncExternalStore } from "react";

const KEY = "splicr.shortlist.v1";
const EMPTY: readonly string[] = [];

let cache: readonly string[] | null = null;
const listeners = new Set<() => void>();

function read(): readonly string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : EMPTY;
  } catch {
    return EMPTY;
  }
}

/** Referentially stable between writes, which is what the store contract needs. */
function snapshot(): readonly string[] {
  if (cache === null) cache = read();
  return cache;
}

function serverSnapshot(): readonly string[] {
  return EMPTY;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function write(next: readonly string[]): void {
  cache = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // A shortlist that cannot be stored is still usable for this session, so the
    // pick stands and only its persistence is lost.
  }
  for (const onChange of listeners) onChange();
}

export function useShortlist() {
  const picked = useSyncExternalStore(subscribe, snapshot, serverSnapshot);

  const toggle = useCallback((gene: string) => {
    const current = snapshot();
    write(current.includes(gene) ? current.filter((g) => g !== gene) : [...current, gene]);
  }, []);

  const clear = useCallback(() => write(EMPTY), []);

  return { picked, toggle, clear };
}
