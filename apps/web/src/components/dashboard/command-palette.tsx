"use client";

/**
 * The command palette, opened with Cmd+K, Ctrl+K or the search box.
 *
 * Three sources, in the order a user expects them:
 *   commands  navigation and actions, matched locally so they appear instantly
 *   screens   this workspace's own screens, from Postgres under the caller's RLS
 *   atlas     published screens by author, cell line, phenotype or PubMed id
 *   genes     the Atlas gene table, public reference data
 *
 * Static commands render on the first keystroke while the server query is still
 * in flight, so the palette never feels like it is waiting. Remote results fill
 * in underneath. A stale response can outrun a fresh one, so every query
 * carries a sequence number and late replies are dropped.
 *
 * Keyboard contract: Cmd/Ctrl+K toggles, arrows move, Home and End jump, Enter
 * opens, Escape closes and returns focus to whatever had it before. The list is
 * a combobox with an owned listbox, so a screen reader announces the active
 * option rather than silently moving a highlight.
 */

import {
  ArrowRight,
  Cable,
  CheckCircle2,
  Compass,
  CornerDownLeft,
  FlaskConical,
  LayoutDashboard,
  Loader2,
  Search,
  Settings,
  UploadCloud,
  Users,
  Waypoints,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { searchWorkspace, type SearchHit } from "@/lib/data/search";
import { cn } from "@/lib/utils";

type Icon = typeof LayoutDashboard;

interface Item {
  id: string;
  group: string;
  title: string;
  subtitle?: string;
  href: string;
  icon: Icon;
  /** Extra words that should match but are not displayed. */
  keywords?: string;
}

const COMMANDS: Item[] = [
  { id: "cmd:overview", group: "Go to", title: "Overview", href: "/dashboard", icon: LayoutDashboard, keywords: "home dashboard summary" },
  { id: "cmd:screens", group: "Go to", title: "Screens", href: "/dashboard/screens", icon: FlaskConical, keywords: "runs experiments list" },
  { id: "cmd:atlas", group: "Go to", title: "Atlas", href: "/dashboard/atlas", icon: Compass, keywords: "public screens evidence context" },
  { id: "cmd:validation", group: "Go to", title: "Truth Loop", href: "/dashboard/validation", icon: CheckCircle2, keywords: "outcomes validated results" },
  { id: "cmd:planner", group: "Go to", title: "Planner", href: "/dashboard/planner", icon: Waypoints, keywords: "design power plan" },
  { id: "cmd:connect", group: "Go to", title: "Connect", href: "/dashboard/connect", icon: Cable, keywords: "api keys rest endpoint token" },
  { id: "cmd:settings", group: "Go to", title: "Settings", href: "/dashboard/settings", icon: Settings, keywords: "workspace lab preferences defaults qc" },
  { id: "cmd:members", group: "Go to", title: "Lab members", href: "/dashboard/settings/members", icon: Users, keywords: "people roles invite team permissions" },
  { id: "act:upload", group: "Actions", title: "Start a new run", subtitle: "Upload FASTQ or a count table", href: "/dashboard/upload", icon: UploadCloud, keywords: "new analyse analyze fastq counts import" },
  { id: "act:key", group: "Actions", title: "Create an API key", subtitle: "Read this workspace over HTTP", href: "/dashboard/connect", icon: Cable, keywords: "token bearer secret" },
];

const EMPTY_ITEMS: Item[] = [];
const RECENT_KEY = "splicr.palette.recent";
const RECENT_MAX = 5;

/** Per-viewer convenience only. Storage can throw in a private window. */
function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function pushRecent(id: string) {
  try {
    const next = [id, ...readRecent().filter((v) => v !== id)].slice(0, RECENT_MAX);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

/**
 * Subsequence match with a score, the behaviour people expect from a palette:
 * "lm" finds "Lab members". Consecutive hits and hits at a word boundary score
 * higher, so a run of letters beats the same letters scattered about.
 */
function fuzzy(needle: string, haystack: string): number | null {
  if (!needle) return 0;
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();

  const direct = h.indexOf(n);
  if (direct === 0) return 1000;
  if (direct > 0) return 700 - direct;

  let score = 0;
  let hi = 0;
  let streak = 0;
  for (const ch of n) {
    const found = h.indexOf(ch, hi);
    if (found < 0) return null;
    streak = found === hi ? streak + 1 : 0;
    const boundary = found === 0 || /[\s\-_/.]/.test(h[found - 1] ?? "");
    score += 10 + streak * 6 + (boundary ? 8 : 0) - Math.min(found - hi, 6);
    hi = found + 1;
  }
  return score;
}

function scoreItem(query: string, item: Item): number | null {
  if (!query) return 0;
  const title = fuzzy(query, item.title);
  const keywords = item.keywords ? fuzzy(query, item.keywords) : null;
  const subtitle = item.subtitle ? fuzzy(query, item.subtitle) : null;
  const best = Math.max(title ?? -1, (keywords ?? -1) * 0.6, (subtitle ?? -1) * 0.5);
  return best < 0 ? null : best;
}

function toItem(hit: SearchHit): Item {
  return {
    id: `${hit.kind}:${hit.id}`,
    group: hit.kind === "screen" ? "Screens" : hit.kind === "atlas" ? "Atlas screens" : "Genes",
    title: hit.title,
    subtitle: hit.subtitle,
    href: hit.href,
    icon: hit.kind === "screen" ? FlaskConical : Compass,
  };
}

function PaletteBody({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const listId = useId();
  const labelId = useId();

  const [query, setQuery] = useState("");
  // Results carry the term they were fetched for, so "is this stale?" is a
  // comparison at render time rather than an effect that clears state.
  const [result, setResult] = useState<{ term: string; items: Item[]; degraded: string | null }>({
    term: "",
    items: [],
    degraded: null,
  });
  const [active, setActive] = useState(0);
  // This component only mounts on the client, when the palette opens, so the
  // initialiser can read storage without a hydration mismatch.
  const [recent] = useState(readRecent);

  const deferred = useDeferredValue(query);
  const term = deferred.trim();
  const listRef = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);

  // Memoised so the empty case is a stable reference; a fresh [] every render
  // would invalidate the items memo below on every keystroke.
  const remote = useMemo(
    () => (result.term === term ? result.items : EMPTY_ITEMS),
    [result, term],
  );
  const degraded = result.term === term ? result.degraded : null;
  const loading = term.length >= 2 && result.term !== term;

  // Debounced remote search. setResult runs in a callback, not in the effect
  // body, and every reply is checked against the sequence it was issued with so
  // a slow early query cannot overwrite a fast later one.
  useEffect(() => {
    if (term.length < 2) return;
    const mine = ++sequence.current;
    const timer = setTimeout(() => {
      searchWorkspace(term)
        .then((response) => {
          if (mine !== sequence.current) return;
          setResult({
            term,
            items: [...response.screens, ...response.genes, ...response.atlas].map(toItem),
            degraded: response.degraded,
          });
        })
        .catch(() => {
          if (mine !== sequence.current) return;
          setResult({ term, items: [], degraded: "Search is unavailable right now." });
        });
    }, 140);
    return () => clearTimeout(timer);
  }, [term]);

  const items = useMemo(() => {
    const term = query.trim();
    if (!term) {
      const byId = new Map(COMMANDS.map((c) => [c.id, c]));
      const recentItems = recent
        .map((id) => byId.get(id))
        .filter((c): c is Item => Boolean(c))
        .map((c) => ({ ...c, group: "Recent" }));
      const recentIds = new Set(recentItems.map((c) => c.id));
      return [...recentItems, ...COMMANDS.filter((c) => !recentIds.has(c.id))];
    }

    const local = COMMANDS.map((item) => ({ item, score: scoreItem(term, item) }))
      .filter((row): row is { item: Item; score: number } => row.score !== null)
      .sort((a, b) => b.score - a.score)
      .map((row) => row.item);

    return [...local, ...remote];
  }, [query, remote, recent]);

  // Derived, not corrected after the fact: when results shrink the highlight
  // must not point past the end, and an effect that fixed it up afterwards
  // would render one frame with an out-of-range index.
  const activeIndex = items.length === 0 ? 0 : Math.min(active, items.length - 1);

  const run = useCallback(
    (item: Item) => {
      pushRecent(item.id);
      onOpenChange(false);
      router.push(item.href);
    },
    [onOpenChange, router],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (items.length === 0) {
      if (event.key === "Escape") onOpenChange(false);
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActive((c) => (Math.min(c, items.length - 1) + 1) % items.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        setActive((c) => (Math.min(c, items.length - 1) - 1 + items.length) % items.length);
        break;
      case "Home":
        event.preventDefault();
        setActive(0);
        break;
      case "End":
        event.preventDefault();
        setActive(items.length - 1);
        break;
      case "Enter": {
        event.preventDefault();
        const item = items[activeIndex];
        if (item) run(item);
        break;
      }
      case "Escape":
        event.preventDefault();
        onOpenChange(false);
        break;
    }
  };

  // Keep the highlighted row in view when the keyboard moves it.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const grouped = useMemo(() => {
    const out: { group: string; rows: { item: Item; index: number }[] }[] = [];
    items.forEach((item, index) => {
      const last = out[out.length - 1];
      if (last && last.group === item.group) last.rows.push({ item, index });
      else out.push({ group: item.group, rows: [{ item, index }] });
    });
    return out;
  }, [items]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]"
    >
          <div
            className="absolute inset-0 bg-teal-950/40 backdrop-blur-sm"
            onClick={() => onOpenChange(false)}
            aria-hidden
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelId}
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="relative w-full max-w-xl rounded-2xl bg-white border border-line
                       shadow-2xl overflow-hidden"
          >
            <h2 id={labelId} className="sr-only">
              Search screens, genes and commands
            </h2>

            <div className="flex items-center gap-3 px-4 border-b border-line">
              <Search className="w-4 h-4 text-muted shrink-0" />
              <input
                autoFocus
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
                placeholder="Search screens, genes and commands"
                aria-label="Search screens, genes and commands"
                role="combobox"
                aria-expanded
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={items[activeIndex] ? `${listId}-${activeIndex}` : undefined}
                className="flex-1 bg-transparent outline-none py-3.5 text-sm text-ink
                           placeholder:text-muted"
              />
              {loading && <Loader2 className="w-4 h-4 text-muted animate-spin shrink-0" />}
            </div>

            <div
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label="Results"
              className="max-h-[52vh] overflow-y-auto thin-scroll py-2"
            >
              {items.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-muted">
                  Nothing matches {`"${query.trim()}"`}.
                </p>
              )}

              {grouped.map(({ group, rows }) => (
                <div key={group} className="px-2 pb-1">
                  <div className="px-2 py-1.5 text-[11px] uppercase tracking-wider text-muted">
                    {group}
                  </div>
                  {rows.map(({ item, index }) => {
                    const ItemIcon = item.icon;
                    const isActive = index === activeIndex;
                    return (
                      <div
                        key={item.id}
                        id={`${listId}-${index}`}
                        data-index={index}
                        role="option"
                        aria-selected={isActive}
                        onMouseMove={() => setActive(index)}
                        onClick={() => run(item)}
                        className={cn(
                          "flex items-center gap-3 px-2.5 py-2 rounded-lg cursor-pointer",
                          isActive ? "bg-mist-soft" : "hover:bg-mist-soft/60",
                        )}
                      >
                        <ItemIcon className="w-4 h-4 text-muted shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-ink truncate">{item.title}</span>
                          {item.subtitle && (
                            <span className="block text-xs text-muted truncate">
                              {item.subtitle}
                            </span>
                          )}
                        </span>
                        {isActive ? (
                          <CornerDownLeft className="w-3.5 h-3.5 text-muted shrink-0" />
                        ) : (
                          <ArrowRight className="w-3.5 h-3.5 text-transparent shrink-0" />
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}

              {degraded && (
                <p className="px-4 py-2 text-xs text-orange-700">{degraded}</p>
              )}
            </div>

            <div className="flex items-center gap-4 px-4 py-2.5 border-t border-line bg-mist-soft/50 text-[11px] text-muted">
              <span className="flex items-center gap-1.5">
                <kbd className="kbd">↑</kbd>
                <kbd className="kbd">↓</kbd> move
              </span>
              <span className="flex items-center gap-1.5">
                <kbd className="kbd">↵</kbd> open
              </span>
              <span className="flex items-center gap-1.5">
                <kbd className="kbd">esc</kbd> close
              </span>
            </div>
      </motion.div>
    </motion.div>
  );
}

/**
 * The palette shell.
 *
 * The body is mounted only while the palette is open, so opening it IS the
 * reset: query, results and highlight all start from their initialisers rather
 * than being cleared by an effect that watches `open`.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const restoreTo = useRef<HTMLElement | null>(null);

  // Refs, not state, so this synchronises focus with the DOM without a render.
  useEffect(() => {
    if (open) {
      restoreTo.current = document.activeElement as HTMLElement | null;
      return;
    }
    restoreTo.current?.focus?.();
    restoreTo.current = null;
  }, [open]);

  return (
    <AnimatePresence>
      {open && <PaletteBody key="palette" onOpenChange={onOpenChange} />}
    </AnimatePresence>
  );
}

/**
 * Cmd+K and Ctrl+K, bound once for the whole dashboard.
 *
 * Ignored while the user is typing in another field, so the shortcut cannot
 * swallow a keystroke meant for a form, and the browser default is prevented
 * only when we actually handle it.
 */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "k" && event.key !== "K") return;
      if (!event.metaKey && !event.ctrlKey) return;

      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      // Still allow the shortcut to close the palette from its own input.
      if (typing && !open) return;

      event.preventDefault();
      setOpen((current) => !current);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return { open, setOpen };
}
