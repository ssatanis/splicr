"use client";

/**
 * The state behind a console table, and the one control `ui.tsx` does not carry.
 *
 * WHY THE URL
 *
 * The screening workflow is a sequence of filters, and the thing a postdoc does
 * at the end of it is send their PI the exact view they are looking at. Sort and
 * filter state in `useState` cannot be sent, so every control here writes to the
 * query string instead. `window.history.replaceState` rather than `router.push`,
 * because it syncs with `useSearchParams` without a server round trip and without
 * filling the back button with twelve intermediate filter states.
 *
 * The sortable header, the segmented control, the select, the panel action and
 * the link out all live in `ui.tsx` and are used from there. This file used to
 * hold a second copy of each, which is how a console ends up sorting one way on
 * one page and another way on the next.
 */

import { Search, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useId } from "react";

import { cn } from "@/lib/utils";

import type { SortDir } from "./ui";

/** What a column reads out of a row. `null` is unknown, never zero. */
export type Cell = string | number | null;

// ---------------------------------------------------------------------------
// URL state
// ---------------------------------------------------------------------------

export function useUrlState() {
  const params = useSearchParams();

  const set = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      const qs = next.toString();
      window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
    },
    [params],
  );

  const get = useCallback((key: string, fallback = "") => params.get(key) ?? fallback, [params]);

  return { get, set };
}

/**
 * Sort state, read from and written to the URL, with the comparator beside it.
 *
 * `sortProps` hands a column exactly what `SortTh` from ui.tsx needs, so a table
 * declares its columns once and cannot end up with a header that shows one sort
 * and a body that is ordered by another.
 */
export function useUrlSort<T>(
  rows: T[],
  fallback: { key: string; dir: SortDir },
  cell: (row: T, key: string) => Cell,
) {
  const { get, set } = useUrlState();
  const key = get("sort", fallback.key);
  const dir = (get("dir", fallback.dir) === "asc" ? "asc" : "desc") as SortDir;

  // Nulls sink to the bottom in both directions: an unknown is not a small
  // number, and a screen that has not called hits has not called zero of them.
  const sorted = [...rows].sort((a, b) => {
    const x = cell(a, key);
    const y = cell(b, key);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    const delta =
      typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return dir === "asc" ? delta : -delta;
  });

  const toggle = useCallback(
    (nextKey: string, preferred: SortDir) => {
      if (nextKey === key) set({ sort: nextKey, dir: dir === "asc" ? "desc" : "asc" });
      else set({ sort: nextKey, dir: preferred });
    },
    [key, dir, set],
  );

  /** Numbers read biggest first and names read A to Z, so the first click differs. */
  const sortProps = useCallback(
    (columnKey: string, preferred: SortDir = "asc") => ({
      active: key === columnKey,
      dir,
      onToggle: () => toggle(columnKey, preferred),
    }),
    [key, dir, toggle],
  );

  return { sorted, key, dir, sortProps };
}

// ---------------------------------------------------------------------------
// The one control ui.tsx does not carry
// ---------------------------------------------------------------------------

/**
 * A table's text filter. It sits in a thin bar inside the panel body rather than
 * in the header, because the header control slot holds one control and the rail
 * owns the search that crosses pages.
 *
 * Controlled straight from the query string rather than mirrored in local state.
 * One source of truth means a link somebody was sent opens with the field
 * already filled in, and there is no second copy to fall out of step.
 */
export function FilterField({
  label,
  value,
  onChange,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}) {
  const id = useId();

  return (
    <div className={cn("relative min-w-0", className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search
        className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
        aria-hidden="true"
      />
      <input
        id={id}
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-7 w-full rounded-md border border-line bg-white pl-7 pr-7 text-[12px] text-ink outline-none transition-colors duration-[var(--dur-1)] focus:border-cyan-500 motion-reduce:transition-none"
      />
      {value !== "" && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-muted hover:text-ink"
        >
          <X className="h-3 w-3" aria-hidden="true" />
          <span className="sr-only">Clear {label.toLowerCase()}</span>
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The export
// ---------------------------------------------------------------------------

/** RFC 4180: a field containing a comma, a quote or a newline is quoted. */
function csvField(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * The export, for a panel whose rows are computed in the browser rather than
 * served by an endpoint.
 *
 * The design law is that every number is one click from a file that opens in R,
 * Excel or Prism. Where `/api/report/[id]` already serves that file, link to it
 * with `FootLink`. Where the rows exist only on the page, this writes exactly the
 * rows on screen, in the order they are on screen, and nothing else: an export
 * that does not match the table it sits under is worse than no export.
 *
 * A button rather than an anchor, because there is no URL until it is clicked.
 */
export function CsvFootLink({
  filename,
  columns,
  rows,
  children,
}: {
  filename: string;
  columns: readonly string[];
  rows: readonly (readonly (string | number)[])[];
  children: React.ReactNode;
}) {
  const download = () => {
    const csv = [columns, ...rows].map((row) => row.map(csvField).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button
      type="button"
      onClick={download}
      className="shrink-0 rounded-sm text-[11px] text-cyan-600 underline decoration-line-strong underline-offset-2 transition-colors duration-[var(--dur-1)] hover:decoration-cyan-600 motion-reduce:transition-none"
    >
      {children}
    </button>
  );
}

/**
 * The export for a panel whose file is built by a function rather than from
 * rows: same look as `CsvFootLink`, for a page that owns its own file format
 * (a preamble, a header, a defused formula) and only needs a download button.
 */
export function TextFootLink({
  filename,
  build,
  type = "text/csv;charset=utf-8",
  children,
}: {
  filename: string;
  build: () => string;
  type?: string;
  children: React.ReactNode;
}) {
  const download = () => {
    const url = URL.createObjectURL(new Blob([build()], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button
      type="button"
      onClick={download}
      className="shrink-0 rounded-sm text-[11px] text-cyan-600 underline decoration-line-strong underline-offset-2 transition-colors duration-[var(--dur-1)] hover:decoration-cyan-600 motion-reduce:transition-none"
    >
      {children}
    </button>
  );
}

/**
 * The bar that holds a filter field, at the top of a flush panel body. Fixed
 * height, so the rows below it start on the same line on every page.
 */
export function FilterBar({
  className,
  children,
}: {
  /** For a bar of several facets, which has to wrap rather than squeeze on a phone. */
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex h-9 shrink-0 items-center gap-2 border-b border-line px-[var(--panel-gutter)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
