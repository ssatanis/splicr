"use client";

/**
 * The hit table's controls. Each one writes to the address and nothing else, so
 * the server re-reads the run for that address and a filtered view is a link.
 * See the Atlas and Truth Loop filters for the same pattern and the reasoning
 * behind the debounced, address-reconciled search box.
 */
import { Loader2, Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";

import { hitHref, isFiltered, parseHitQuery } from "@/lib/report/hit-query";
import { cn, formatNumber } from "@/lib/utils";

const FDR_CHOICES = [0.25, 0.1, 0.05, 0.01];

const FIELD = "h-7 rounded-md border bg-white px-2 text-[12px] text-ink outline-none focus:border-cyan-500";

export function HitFilters({
  comparisons,
  matching,
  recorded,
}: {
  comparisons: { id: string; name: string }[];
  matching: number;
  recorded: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const query = useMemo(() => parseHitQuery(Object.fromEntries(params.entries())), [params]);

  /**
   * A control the reader operated once is a step they can go back from, so it
   * pushes. The search box does not: it fires on a debounce while somebody is
   * typing, and twelve keystrokes should not be twelve entries to walk back
   * through. `replaceText` is that case and only that case.
   */
  const go = useCallback(
    (patch: Parameters<typeof hitHref>[2], replaceText = false) => {
      const href = hitHref(pathname, query, patch);
      startTransition(() =>
        replaceText
          ? router.replace(href, { scroll: false })
          : router.push(href, { scroll: false }),
      );
    },
    [pathname, query, router],
  );

  const [text, setText] = useState(query.q);
  const [written, setWritten] = useState(query.q);
  const [seen, setSeen] = useState(query.q);
  if (query.q !== seen) {
    setSeen(query.q);
    if (query.q !== written) {
      setWritten(query.q);
      setText(query.q);
    }
  }
  useEffect(() => {
    if (text === written) return;
    const timer = window.setTimeout(() => {
      setWritten(text);
      go({ q: text.trim() === "" ? null : text.trim() }, true);
    }, 260);
    return () => window.clearTimeout(timer);
  }, [text, written, go]);

  const custom = query.maxFdr !== null && !FDR_CHOICES.includes(query.maxFdr);

  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-line px-[var(--panel-gutter)] py-2"
      role="search"
      aria-label="Filter the hit table"
    >
      <div className="relative min-w-[150px] max-w-[220px] flex-1">
        <label htmlFor="hit-gene-filter" className="sr-only">Filter by gene symbol</label>
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input
          id="hit-gene-filter"
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Gene symbol"
          autoComplete="off"
          spellCheck={false}
          className={cn(FIELD, "w-full border-line pl-7")}
        />
      </div>
      <select
        aria-label="Direction"
        value={query.direction ?? ""}
        onChange={(event) => go({ direction: event.target.value === "" ? null : event.target.value })}
        className={cn(FIELD, "w-[130px] pr-6", query.direction ? "border-cyan-500" : "border-line")}
      >
        <option value="">Both directions</option>
        <option value="depleted">Depleted</option>
        <option value="enriched">Enriched</option>
      </select>
      <select
        aria-label="Recorded FDR at most"
        value={query.maxFdr === null ? "" : String(query.maxFdr)}
        onChange={(event) => go({ maxFdr: event.target.value === "" ? null : Number(event.target.value) })}
        className={cn(FIELD, "w-[150px] pr-6", query.maxFdr !== null ? "border-cyan-500" : "border-line")}
      >
        <option value="">Any recorded FDR</option>
        {FDR_CHOICES.map((value) => (
          <option key={value} value={value}>FDR at most {value}</option>
        ))}
        {custom && <option value={String(query.maxFdr)}>FDR at most {query.maxFdr}</option>}
      </select>
      {comparisons.length > 1 && (
        <select
          aria-label="Comparison"
          value={query.comparison ?? ""}
          onChange={(event) => go({ comparison: event.target.value === "" ? null : event.target.value })}
          className={cn(FIELD, "w-[180px] max-w-full pr-6", query.comparison ? "border-cyan-500" : "border-line")}
        >
          <option value="">All comparisons</option>
          {comparisons.map((comparison) => (
            <option key={comparison.id} value={comparison.id}>{comparison.name}</option>
          ))}
        </select>
      )}
      <label className="flex h-7 cursor-pointer items-center gap-1.5 text-[12px] text-body">
        <input
          type="checkbox"
          checked={query.flagged}
          onChange={(event) => go({ flagged: event.target.checked })}
          className="h-3.5 w-3.5 accent-cyan-600"
        />
        With artifact flags
      </label>
      <span className="ml-auto flex items-center gap-3 text-[11px] text-muted">
        <span className="num flex items-center gap-1.5" aria-live="polite">
          {pending && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
          {pending ? "Updating" : isFiltered(query) ? `${formatNumber(matching)} of ${formatNumber(recorded)}` : `${formatNumber(recorded)} records`}
        </span>
        {isFiltered(query) && (
          <button
            type="button"
            onClick={() => {
              setWritten("");
              setText("");
              go({ direction: null, maxFdr: null, flagged: false, q: null, comparison: null });
            }}
            className="inline-flex items-center gap-1 rounded-sm text-cyan-600 underline decoration-line-strong underline-offset-2"
          >
            <X className="h-3 w-3" aria-hidden="true" /> Clear filters
          </button>
        )}
      </span>
    </div>
  );
}
