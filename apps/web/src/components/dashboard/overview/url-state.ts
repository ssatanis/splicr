"use client";

/**
 * Sort and filter state for the overview's panels, held in the query string.
 *
 * WHY THE URL
 *
 * The screening workflow is a sequence of filters, and the thing a postdoc does
 * at the end of one is send their PI the exact view they are looking at. State in
 * `useState` cannot be sent. `history.replaceState` rather than `router.push`,
 * because it syncs with `useSearchParams` without a server round trip and without
 * filling the back button with a dozen intermediate filter states.
 *
 * WHY EVERY KEY IS PREFIXED
 *
 * The overview carries two sortable tables at once. A bare `sort` key, which is
 * what the all-screens page uses because it is the only table on its page, would
 * make the candidates and the runs fight over one parameter: sorting one would
 * silently re-sort the other on a column it does not have. The prefix is also
 * what makes a pasted link restore both panels rather than one.
 */
import { useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

export type Dir = "asc" | "desc";
export type Cell = string | number | null;

/**
 * Read and write one panel's slice of the query string.
 *
 * `set` takes every key it is changing at once. Two separate writes would both
 * start from the same snapshot of the parameters, so the second would drop the
 * first, which is exactly what happens when a new sort column also sets a
 * direction.
 */
export function usePanelUrl(prefix: string) {
  const params = useSearchParams();

  const get = useCallback(
    (key: string, fallback = "") => params.get(`${prefix}${key}`) ?? fallback,
    [params, prefix],
  );

  const set = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(patch)) {
        // A parameter at its default is removed rather than written, so the
        // common view has a clean URL and a link carries only what was changed.
        if (value === null || value === "") next.delete(`${prefix}${key}`);
        else next.set(`${prefix}${key}`, value);
      }
      const qs = next.toString();
      window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
    },
    [params, prefix],
  );

  return { get, set };
}

/** Nulls sink to the bottom in both directions: an unknown is not a small number. */
function compare(a: Cell, b: Cell, dir: Dir): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const delta =
    typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
  return dir === "asc" ? delta : -delta;
}

/**
 * Sorted rows, plus the state the header needs to draw itself. The comparator
 * stays with the table that owns the rows, so one column sorts the same way
 * wherever a researcher meets it.
 */
export function usePanelSort<T>(
  rows: T[],
  prefix: string,
  fallback: { key: string; dir: Dir },
  cell: (row: T, key: string) => Cell,
) {
  const { get, set } = usePanelUrl(prefix);
  const key = get("sort", fallback.key);
  const dir: Dir = get("dir", fallback.dir) === "asc" ? "asc" : "desc";

  const sorted = useMemo(
    () => [...rows].sort((a, b) => compare(cell(a, key), cell(b, key), dir)),
    [rows, key, dir, cell],
  );

  // First click on a new column uses the direction that column is normally read
  // in: biggest effect first for numbers, A to Z for names.
  const toggle = useCallback(
    (next: string, preferred: Dir) => {
      const nextDir = next === key ? (dir === "asc" ? "desc" : "asc") : preferred;
      set({
        sort: next === fallback.key ? null : next,
        dir: nextDir === fallback.dir && next === fallback.key ? null : nextDir,
      });
    },
    [key, dir, set, fallback.key, fallback.dir],
  );

  return { sorted, key, dir, toggle };
}
