/**
 * The Atlas page's address is its state, and this is the one place that turns
 * an address into a query and a query back into an address.
 *
 * Parsing is forgiving about shape and strict about meaning: a repeated key
 * takes its first value, an unknown sort falls back to the default, a year that
 * is not a year is dropped, and nothing here can throw, so a mistyped link
 * opens the page rather than an error.
 */
import {
  FACET_KEYS,
  SCREEN_SORT_KEYS,
  type ScreenQuery,
  type ScreenSortKey,
} from "./types";

export type SearchParams = Record<string, string | string[] | undefined>;

export const DEFAULT_SORT: { sort: ScreenSortKey; dir: "asc" | "desc" } = { sort: "year", dir: "desc" };

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function text(value: string | string[] | undefined, max = 120): string | null {
  const trimmed = first(value).trim().slice(0, max);
  return trimmed === "" ? null : trimmed;
}

function year(value: string | string[] | undefined): number | null {
  const raw = first(value).trim();
  if (!/^\d{4}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1990 && n <= 2100 ? n : null;
}

function positiveInteger(value: string | string[] | undefined): number {
  const n = Number(first(value));
  return Number.isSafeInteger(n) && n >= 1 && n <= 100000 ? n : 1;
}

export function parseScreenQuery(params: SearchParams): ScreenQuery {
  const sortRaw = first(params.sort);
  const sort = (SCREEN_SORT_KEYS as readonly string[]).includes(sortRaw)
    ? (sortRaw as ScreenSortKey)
    : DEFAULT_SORT.sort;
  const dirRaw = first(params.dir);
  const dir = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : sortRaw && sort === sortRaw ? defaultDirection(sort) : DEFAULT_SORT.dir;

  const yearFrom = year(params.from);
  const yearTo = year(params.to);

  return {
    q: text(params.q, 160) ?? "",
    modality: text(params.modality),
    phenotype: text(params.phenotype),
    screenType: text(params.screenType),
    setup: text(params.setup),
    cellLine: text(params.cell),
    // A reversed range would match nothing and say nothing. Swap it.
    yearFrom: yearFrom !== null && yearTo !== null && yearFrom > yearTo ? yearTo : yearFrom,
    yearTo: yearFrom !== null && yearTo !== null && yearFrom > yearTo ? yearFrom : yearTo,
    withHits: first(params.hits) === "1",
    gene: text(params.gene, 40),
    sort,
    dir,
    page: positiveInteger(params.page),
  };
}

/** Names read A to Z and figures read biggest first, so the first click differs. */
export function defaultDirection(sort: ScreenSortKey): "asc" | "desc" {
  return sort === "year" || sort === "nHits" || sort === "nGenes" ? "desc" : "asc";
}

/** Keys a link may set. Anything else in the current address is preserved. */
export type Overrides = Partial<Record<string, string | number | null>>;

/**
 * The address for the same view with some parameters changed. Changing any
 * filter returns the reader to page one, because page nine of a different
 * result set is a page that may not exist.
 */
export function hrefWith(basePath: string, current: ScreenQuery, overrides: Overrides): string {
  const next = new URLSearchParams();
  const set = (key: string, value: string | number | null | undefined) => {
    if (value === null || value === undefined || value === "") return;
    next.set(key, String(value));
  };

  const merged: Record<string, string | number | null> = {
    q: current.q,
    gene: current.gene,
    modality: current.modality,
    phenotype: current.phenotype,
    screenType: current.screenType,
    setup: current.setup,
    cell: current.cellLine,
    from: current.yearFrom,
    to: current.yearTo,
    hits: current.withHits ? "1" : null,
    sort: current.sort === DEFAULT_SORT.sort && current.dir === DEFAULT_SORT.dir ? null : current.sort,
    dir: current.sort === DEFAULT_SORT.sort && current.dir === DEFAULT_SORT.dir ? null : current.dir,
    page: current.page > 1 ? current.page : null,
  };
  const touchesFilter = Object.keys(overrides).some((key) => key !== "page");
  if (touchesFilter && !("page" in overrides)) merged.page = null;
  Object.assign(merged, overrides);

  for (const key of ["q", "gene", ...FACET_KEYS, "cell", "from", "to", "hits", "sort", "dir", "page"]) {
    set(key, merged[key]);
  }
  const qs = next.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
