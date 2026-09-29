/**
 * How a Hit Report is narrowed and ordered, as an address.
 *
 * The same rules the Atlas and the Truth Loop follow: the address is the state,
 * parsing never throws, and an unknown value is dropped rather than obeyed. A
 * reader who filters a screen to enriched hits at FDR 0.05 can send that exact
 * view to a colleague, and a hand-edited link cannot break the page.
 *
 * Sorting here is by recorded statistics only. There is deliberately no sort by
 * the stored model output: the report orders by what was measured, and says so.
 */

export const HIT_SORTS = ["fdr", "lfc", "p_value", "gene"] as const;
export type HitSort = (typeof HIT_SORTS)[number];

export interface HitQuery {
  direction: "depleted" | "enriched" | null;
  /** Keep hits whose recorded FDR is at or below this. Null keeps everything, including no FDR. */
  maxFdr: number | null;
  /** Only hits that carry at least one artifact flag. */
  flagged: boolean;
  q: string;
  comparison: string | null;
  sort: HitSort;
  dir: "asc" | "desc";
  page: number;
}

export const DEFAULT_HIT_QUERY: HitQuery = {
  direction: null,
  maxFdr: null,
  flagged: false,
  q: "",
  comparison: null,
  sort: "fdr",
  dir: "asc",
  page: 1,
};

type Raw = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string =>
  ((Array.isArray(value) ? value[0] : value) ?? "").trim();

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Names read A to Z and statistics read most significant first, so the first click differs. */
export function defaultHitDirection(sort: HitSort): "asc" | "desc" {
  return sort === "lfc" ? "desc" : "asc";
}

export function parseHitQuery(params: Raw): HitQuery {
  const sortRaw = first(params.sort);
  const sort = (HIT_SORTS as readonly string[]).includes(sortRaw) ? (sortRaw as HitSort) : DEFAULT_HIT_QUERY.sort;
  const dirRaw = first(params.dir);
  const dir = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : defaultHitDirection(sort);

  const direction = first(params.direction);
  const fdrRaw = first(params.fdr);
  const fdr = fdrRaw === "" ? Number.NaN : Number(fdrRaw);
  const page = Number(first(params.page));
  const comparison = first(params.comparison);

  return {
    direction: direction === "depleted" || direction === "enriched" ? direction : null,
    // A tiny threshold is legitimate (1e-10), so anything from 0 up to 1 is kept
    // exactly as typed and anything else is dropped rather than clamped.
    maxFdr: Number.isFinite(fdr) && fdr >= 0 && fdr <= 1 ? fdr : null,
    flagged: first(params.flagged) === "1",
    q: first(params.q).replace(/[^A-Za-z0-9._@-]/g, "").slice(0, 40),
    comparison: ID.test(comparison) ? comparison : null,
    sort,
    dir,
    page: Number.isSafeInteger(page) && page >= 1 && page <= 10000 ? page : 1,
  };
}

/** The address for a view. Changing any filter or the sort returns to page one. */
export function hitHref(
  base: string,
  current: HitQuery,
  patch: Partial<Record<keyof HitQuery, string | number | boolean | null>>,
): string {
  const merged: Record<string, string | number | boolean | null> = {
    direction: current.direction,
    fdr: current.maxFdr,
    flagged: current.flagged ? "1" : null,
    q: current.q || null,
    comparison: current.comparison,
    sort: current.sort === DEFAULT_HIT_QUERY.sort && current.dir === DEFAULT_HIT_QUERY.dir ? null : current.sort,
    dir: current.sort === DEFAULT_HIT_QUERY.sort && current.dir === DEFAULT_HIT_QUERY.dir ? null : current.dir,
    page: current.page > 1 ? current.page : null,
  };
  const renamed: Record<string, string> = { maxFdr: "fdr" };
  const touchesFilter = Object.keys(patch).some((key) => key !== "page");
  if (touchesFilter && !("page" in patch)) merged.page = null;
  for (const [key, value] of Object.entries(patch)) {
    merged[renamed[key] ?? key] = key === "flagged" ? (value ? "1" : null) : (value as string | number | boolean | null);
  }
  const params = new URLSearchParams();
  for (const key of ["direction", "fdr", "flagged", "q", "comparison", "sort", "dir", "page"]) {
    const value = merged[key];
    if (value !== null && value !== undefined && value !== "" && value !== false) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export function isFiltered(query: HitQuery): boolean {
  return query.direction !== null || query.maxFdr !== null || query.flagged || query.q !== "" || query.comparison !== null;
}
