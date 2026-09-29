"use client";

/**
 * The Atlas page's controls.
 *
 * Every control writes to the address and nothing else. The page itself is a
 * Server Component that reads the address, so there is one source of truth,
 * a filtered view can be sent to a colleague as a link, and Back returns to the
 * view the reader had rather than to a blank one. `router.replace` inside a
 * transition keeps the old rows on screen, dimmed, until the new ones arrive:
 * the table never flashes empty between two filters.
 */

import { Loader2, Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";

import { suggestAtlasGenes } from "@/lib/atlas/actions";
import { modalityLabel } from "@/lib/atlas/links";
import { hrefWith, parseScreenQuery, type Overrides } from "@/lib/atlas/params";
import {
  FACET_KEYS,
  FACET_LABEL,
  type FacetKey,
  type FacetOption,
  type GeneSuggestion,
} from "@/lib/atlas/types";
import { cn, formatNumber } from "@/lib/utils";

const FIELD =
  "h-7 rounded-md border border-line bg-white px-2 text-[12px] text-ink outline-none transition-colors duration-[var(--dur-1)] focus:border-cyan-500 motion-reduce:transition-none";

/** The current address as a query, and a function that moves to a changed one. */
function useAtlasNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const query = useMemo(() => parseScreenQuery(Object.fromEntries(params.entries())), [params]);

  const go = useCallback(
    (overrides: Overrides, mode: "replace" | "push" = "replace") => {
      const href = hrefWith(pathname, query, overrides);
      startTransition(() => {
        if (mode === "push") router.push(href, { scroll: false });
        else router.replace(href, { scroll: false });
      });
    },
    [pathname, query, router],
  );

  return { query, go, pending, pathname };
}

const FACET_ANY: Record<FacetKey, string> = {
  modality: "All modalities",
  phenotype: "All phenotypes",
  screenType: "All selections",
  setup: "All setups",
};

const FILTER_KEYS = ["q", "modality", "phenotype", "screenType", "setup", "cell", "from", "to", "hits"] as const;

export function AtlasFilters({
  facets,
  yearRange,
  total,
  corpus,
}: {
  facets: Record<FacetKey, FacetOption[]>;
  yearRange: [number, number] | null;
  total: number;
  corpus: number;
}) {
  const { query, go, pending } = useAtlasNavigation();
  const searchId = useId();

  // The search box holds what the reader is typing. The address holds what was
  // last applied. They differ only inside the debounce, and an update that
  // arrives from the address (Clear, Back, a link) must not be undone by a stale
  // keystroke. So the box takes the address's value only when the address moved
  // to something this box did not itself write. Held in state and reconciled
  // during render, which React re-runs immediately, rather than in an effect
  // that would paint the old value first.
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
      go({ q: text.trim() === "" ? null : text });
    }, 260);
    return () => window.clearTimeout(timer);
  }, [text, written, go]);

  const active = FILTER_KEYS.filter((key) => {
    if (key === "q") return query.q !== "";
    if (key === "cell") return query.cellLine !== null;
    if (key === "from") return query.yearFrom !== null;
    if (key === "to") return query.yearTo !== null;
    if (key === "hits") return query.withHits;
    return query[key] !== null;
  });

  const years = useMemo(() => {
    if (!yearRange) return [];
    const list: number[] = [];
    for (let y = yearRange[1]; y >= yearRange[0]; y--) list.push(y);
    return list;
  }, [yearRange]);

  const clearAll = () => {
    setWritten("");
    setText("");
    go(Object.fromEntries(FILTER_KEYS.map((key) => [key, null])));
  };

  return (
    <div
      className="flex shrink-0 flex-col gap-1.5 border-b border-line px-[var(--panel-gutter)] py-2"
      role="search"
      aria-label="Filter Atlas screens"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="relative min-w-[200px] max-w-[420px] flex-1">
          <label htmlFor={searchId} className="sr-only">
            Search screens
          </label>
          <Search
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <input
            id={searchId}
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Search author, cell line, phenotype, condition, PMID"
            className={cn(FIELD, "w-full pl-7 pr-7")}
            autoComplete="off"
            spellCheck={false}
          />
          {text !== "" && (
            <button
              type="button"
              onClick={() => setText("")}
              className="absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-muted hover:text-ink"
            >
              <X className="h-3 w-3" aria-hidden="true" />
              <span className="sr-only">Clear search</span>
            </button>
          )}
        </div>

        {query.cellLine !== null && (
          <button
            type="button"
            onClick={() => go({ cell: null })}
            className="flex h-7 items-center gap-1 rounded-md bg-cyan-50 px-2 text-[11px] text-cyan-700 hover:bg-cyan-100"
          >
            Cell line: {query.cellLine}
            <X className="h-3 w-3" aria-hidden="true" />
            <span className="sr-only">Remove cell line filter</span>
          </button>
        )}

        <div className="ml-auto flex items-center gap-3 text-[11px] text-muted">
          <span aria-live="polite" className="num flex items-center gap-1.5">
            {pending && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
            {pending
              ? "Updating"
              : total === corpus
                ? `${formatNumber(total)} screens`
                : `${formatNumber(total)} of ${formatNumber(corpus)} screens`}
          </span>
          {active.length > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="rounded-sm text-cyan-600 underline decoration-line-strong underline-offset-2 hover:decoration-cyan-600"
            >
              Clear {active.length === 1 ? "filter" : `${active.length} filters`}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {FACET_KEYS.map((key) => {
          const options = facets[key];
          const selected = query[key];
          return (
            <select
              key={key}
              aria-label={FACET_LABEL[key]}
              value={selected ?? ""}
              onChange={(event) => go({ [key]: event.target.value === "" ? null : event.target.value })}
              className={cn(FIELD, "w-[152px] min-w-0 pr-6", selected !== null && "border-cyan-500")}
            >
              <option value="">{FACET_ANY[key]}</option>
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {key === "modality" ? modalityLabel(option.value) : option.value} ({formatNumber(option.count)})
                </option>
              ))}
            </select>
          );
        })}

        <div className="flex items-center gap-1" role="group" aria-label="Publication year">
          <select
            aria-label="From year"
            value={query.yearFrom ?? ""}
            onChange={(event) => go({ from: event.target.value === "" ? null : event.target.value })}
            className={cn(FIELD, "w-[84px] pr-5", query.yearFrom !== null && "border-cyan-500")}
          >
            <option value="">From</option>
            {years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-muted" aria-hidden="true">
            to
          </span>
          <select
            aria-label="To year"
            value={query.yearTo ?? ""}
            onChange={(event) => go({ to: event.target.value === "" ? null : event.target.value })}
            className={cn(FIELD, "w-[84px] pr-5", query.yearTo !== null && "border-cyan-500")}
          >
            <option value="">To</option>
            {years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>

        <label className="flex h-7 cursor-pointer items-center gap-1.5 text-[12px] text-body">
          <input
            type="checkbox"
            checked={query.withHits}
            onChange={(event) => go({ hits: event.target.checked ? "1" : null })}
            className="h-3.5 w-3.5 accent-cyan-600"
          />
          Called genes only
        </label>
      </div>
    </div>
  );
}

/**
 * A gene box that suggests as you type.
 *
 * It is an ARIA combobox with a listbox popup: the input keeps focus, arrow
 * keys move a highlight that screen readers follow through
 * `aria-activedescendant`, Enter takes the highlight or, with none, whatever
 * was typed, and Escape closes the list before it clears anything. An alias
 * such as p53 is a valid entry: the page resolves it and says what it became.
 */
export function GeneFinder({ active }: { active: string | null }) {
  const { go, pending } = useAtlasNavigation();
  const inputId = useId();
  const listId = useId();
  const [text, setText] = useState("");
  const [options, setOptions] = useState<GeneSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const request = useRef(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const value = text.trim();
    const id = ++request.current;
    if (value === "") return;
    const timer = window.setTimeout(() => {
      suggestAtlasGenes(value).then((found) => {
        // A slower earlier answer must not replace a newer one.
        if (id !== request.current) return;
        setOptions(found);
        setHighlight(-1);
      });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, []);

  const choose = (symbol: string) => {
    const value = symbol.trim();
    if (value === "") return;
    setOpen(false);
    setText("");
    setOptions([]);
    go({ gene: value }, "push");
  };

  // Suggestions for text that has since been cleared are not shown, so the
  // list is derived from the box rather than reset by an effect.
  const shown = text.trim() === "" ? [] : options;
  const showList = open && shown.length > 0;

  return (
    <div ref={box} className="relative w-full min-w-0 sm:max-w-[300px]">
      <label htmlFor={inputId} className="sr-only">
        Find a gene by symbol
      </label>
      <Search
        className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
        aria-hidden="true"
      />
      <input
        id={inputId}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && highlight >= 0 ? `${listId}-${highlight}` : undefined}
        value={text}
        placeholder={active ? `Look up another gene (now ${active})` : "Look up a gene: TP53, KRAS, RPL5"}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setHighlight((h) => (shown.length === 0 ? -1 : (h + 1) % shown.length));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlight((h) => (shown.length === 0 ? -1 : h <= 0 ? shown.length - 1 : h - 1));
          } else if (event.key === "Enter") {
            event.preventDefault();
            choose(showList && highlight >= 0 && highlight < shown.length ? shown[highlight].symbol : text);
          } else if (event.key === "Escape") {
            if (showList) {
              event.preventDefault();
              setOpen(false);
            } else if (text !== "") {
              setText("");
            }
          }
        }}
        className={cn(FIELD, "w-full pl-7 pr-7")}
      />
      {pending ? (
        <Loader2
          className="absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted"
          aria-hidden="true"
        />
      ) : (
        text !== "" && (
          <button
            type="button"
            onClick={() => {
              setText("");
              setOptions([]);
            }}
            className="absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-muted hover:text-ink"
          >
            <X className="h-3 w-3" aria-hidden="true" />
            <span className="sr-only">Clear gene box</span>
          </button>
        )
      )}
      <ul
        id={listId}
        role="listbox"
        aria-label="Matching genes"
        hidden={!showList}
        className="absolute right-0 top-full z-30 mt-1 max-h-72 w-[340px] max-w-[calc(100vw-2rem)] overflow-auto rounded-lg border border-line bg-white py-1 shadow-float"
      >
        {shown.map((option, index) => (
          <li
            key={option.symbol}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === highlight}
            onPointerDown={(event) => {
              // Before the input loses focus, or the list would close under the click.
              event.preventDefault();
              choose(option.symbol);
            }}
            onPointerEnter={() => setHighlight(index)}
            className={cn(
              "flex cursor-pointer items-baseline justify-between gap-3 px-3 py-1.5 text-[12px]",
              index === highlight ? "bg-cyan-50 text-ink" : "text-body",
            )}
          >
            <span className="min-w-0 truncate font-medium text-ink">
              {option.symbol}
              {option.viaAlias && <span className="ml-1.5 font-normal text-muted">alias {option.viaAlias}</span>}
            </span>
            <span className="num shrink-0 whitespace-nowrap text-[11px] text-muted">
              called in {formatNumber(option.called)} of {formatNumber(option.tested)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
