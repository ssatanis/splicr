"use client";

/**
 * The shortlist: the genes a reader has marked to take to the bench.
 *
 * The overview exists so that somebody can choose about ten genes out of a few
 * hundred, under a PI who has approved one validation round. So the table
 * carries a checkbox, and two things about where the picks live matter more than
 * the checkbox does.
 *
 * THEY LIVE IN THE QUERY STRING. The one thing worth sending is the ten genes,
 * and a pick held only in this browser cannot be sent. Before this the URL after
 * ticking three genes was still `?cview=clean`, so the page's own design law,
 * that the view has to be sendable to a PI, was broken by the only control on
 * the page that produces something worth sending. Now it reads
 * `?cpick=scr_demo:DUSP6,scr_demo:MCM2`.
 *
 * `localStorage` stays, but only as a seed: on the first render of a link that
 * carries no picks at all, the last session's picks are written into the URL, so
 * a reader who closes the tab mid-round comes back to it. Clearing empties both,
 * so nothing a reader deliberately dropped can come back. Every storage access
 * is guarded, because a private window and blocked site data both throw here,
 * and a pick that cannot be stored still works for this session.
 *
 * THEY ARE KEYED BY SCREEN AND GENE, NOT BY GENE. `KRAS` is a row on every
 * screen in a workspace that ran more than one. Keyed on the symbol alone,
 * ticking it on one screen silently ticked it on all of them, and a reader
 * building a ten-gene round out of two screens would have been handed a list
 * they did not choose.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";

const KEY = "splicr.shortlist.v1";
const EMPTY: readonly string[] = [];

/** The shortlist key for a row: one screen's gene, not the symbol on its own. */
export function pickKey(screenId: string, gene: string): string {
  return `${screenId}:${gene}`;
}

/** The gene half of a key, for a label that does not need to name the screen. */
export function pickGene(key: string): string {
  const cut = key.indexOf(":");
  return cut === -1 ? key : key.slice(cut + 1);
}

function parse(raw: string): readonly string[] {
  if (raw === "") return EMPTY;
  // Deduplicated, because a hand-edited or twice-appended link is a link a
  // reader pasted and the round size is the figure they are reading off it.
  return [...new Set(raw.split(",").filter((value) => value !== ""))];
}

function readStore(): readonly string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : EMPTY;
  } catch {
    return EMPTY;
  }
}

function writeStore(next: readonly string[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // A shortlist that cannot be stored is still in the URL, which is the copy
    // that matters, so the pick stands and only the restore is lost.
  }
}

/**
 * Read and write the shortlist through one panel's slice of the query string.
 *
 * Takes the panel's own `get` and `set` rather than reaching for the router, so
 * a pick and a filter change go through the same single write and neither can
 * drop the other.
 */
export function useShortlist(
  get: (key: string, fallback?: string) => string,
  set: (patch: Record<string, string | null>) => void,
) {
  const raw = get("pick");
  const picked = useMemo(() => parse(raw), [raw]);

  // Once per mount, and only for a link that carried no picks. A link that
  // carries `cpick` is somebody's considered view and this must not touch it.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    if (raw !== "") return;
    const stored = readStore();
    if (stored.length > 0) set({ pick: stored.join(",") });
  }, [raw, set]);

  const toggle = useCallback(
    (key: string) => {
      const next = picked.includes(key)
        ? picked.filter((value) => value !== key)
        : [...picked, key];
      writeStore(next);
      set({ pick: next.length === 0 ? null : next.join(",") });
    },
    [picked, set],
  );

  const clear = useCallback(() => {
    writeStore(EMPTY);
    set({ pick: null });
  }, [set]);

  return { picked, toggle, clear };
}
