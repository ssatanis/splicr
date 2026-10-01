/**
 * Atlas queries, as pure functions over the snapshot.
 *
 * Nothing here reads a file or a network, so the same code runs in a page, a
 * route handler and a test. The loader that feeds it lives in `store.ts`.
 *
 * Two rules the rest of the console leans on.
 *
 * A rate always names its denominator. A gene's hit rate is over the background
 * screens that measured it, never over the size of the Atlas, and a gene no
 * background screen measured has an unknown rate, not a zero one.
 *
 * A hit is whatever the screen's own authors called a hit. Nothing here counts
 * hits across screens as though they shared a definition; it counts how many
 * screens called a gene, which is a different and honest statement.
 */
import {
  FACET_KEYS,
  type AtlasScreen,
  type FacetKey,
  type FacetOption,
  type GeneIndex,
  type GeneLookup,
  type GeneSuggestion,
  type GeneSummary,
  type GeneTable,
  type PhenotypeCall,
  type ScreenFilters,
  type ScreenHitPage,
  type ScreenPage,
  type ScreenQuery,
  type ScreenSortKey,
  type SimilarScreen,
  type WilsonInterval,
} from "./types";

export const SCREEN_PAGE_SIZE = 50;
export const HIT_PAGE_SIZE = 100;

/**
 * SplicR's own frequent-hitter rule, from `engine/splicr/config.py` and
 * `engine/splicr/atlas.py`: a rate above 25% across at least ten background
 * screens. The engine applies it to screens unrelated to the run at hand; the
 * Atlas has no run, so here it is applied to every background screen and the
 * page says so.
 */
export const FREQUENT_HITTER_RATE = 0.25;
export const MIN_SCREENS_FOR_FREQUENT_HITTER = 10;

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/**
 * Lowercase, accents folded, everything but letters and digits removed, so
 * `K-562`, `K 562` and `k562` are one cell line and `HAP1` finds `HAP-1`.
 */
export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Words of a query are separated by whitespace only. Splitting on punctuation
 * turned `K-562` into `k` and `562`, and the number then matched screen 562.
 */
function tokens(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

const HAYSTACK_FIELDS: (keyof AtlasScreen)[] = [
  "author",
  "cellLine",
  "cellType",
  "phenotype",
  "condition",
  "library",
  "libraryType",
  "modality",
  "enzyme",
  "screenType",
  "setup",
  "analysis",
  "rationale",
  "notes",
];

const haystacks = new WeakMap<AtlasScreen, string>();

function haystack(screen: AtlasScreen): string {
  let value = haystacks.get(screen);
  if (value === undefined) {
    // One normalized blob per field joined by a space that a token can never
    // contain, so a query cannot match across the seam between two fields.
    value = HAYSTACK_FIELDS.map((field) => {
      const raw = screen[field];
      return typeof raw === "string" ? normalize(raw) : "";
    }).join(" ");
    haystacks.set(screen, value);
  }
  return value;
}

/**
 * Whether one token of the reader's query matches a screen.
 *
 * A short number is a screen id or a year and nothing else, because "12" is a
 * substring of half the PubMed ids and a reader who typed a year wants that
 * year. A long number is a PubMed id. Everything else is a substring of the
 * normalized text, so a partial word matches.
 */
function matchesToken(screen: AtlasScreen, token: string): boolean {
  const folded = normalize(token);
  if (folded === "") return true;
  if (/^\d+$/.test(folded)) {
    if (folded.length <= 4) {
      const n = Number(folded);
      return screen.id === n || screen.year === n;
    }
    return (screen.pmid ?? "").includes(folded) || (screen.sourceId ?? "").includes(folded);
  }
  return haystack(screen).includes(folded);
}

export function matchesText(screen: AtlasScreen, query: string): boolean {
  const parts = tokens(query);
  return parts.every((token) => matchesToken(screen, token));
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

type FacetSelection = Pick<ScreenFilters, FacetKey>;

function facetValue(screen: AtlasScreen, key: FacetKey): string | null {
  return screen[key];
}

function passes(
  screen: AtlasScreen,
  filters: ScreenFilters,
  calledIds: ReadonlySet<number> | null,
  skip: FacetKey | null,
): boolean {
  if (filters.withHits && !((screen.nHits ?? 0) > 0)) return false;
  if (filters.yearFrom !== null && !(screen.year !== null && screen.year >= filters.yearFrom)) return false;
  if (filters.yearTo !== null && !(screen.year !== null && screen.year <= filters.yearTo)) return false;
  if (filters.cellLine !== null && normalize(screen.cellLine ?? "") !== normalize(filters.cellLine)) return false;
  if (calledIds !== null && !calledIds.has(screen.id)) return false;
  for (const key of FACET_KEYS) {
    if (key === skip) continue;
    const wanted = (filters as FacetSelection)[key];
    if (wanted !== null && facetValue(screen, key) !== wanted) return false;
  }
  return filters.q.trim() === "" || matchesText(screen, filters.q);
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

function sortValue(screen: AtlasScreen, key: ScreenSortKey): string | number | null {
  switch (key) {
    case "year":
      return screen.year;
    case "author":
      return screen.author;
    case "cellLine":
      return screen.cellLine;
    case "phenotype":
      return screen.phenotype;
    case "modality":
      return screen.modality;
    case "library":
      return screen.library;
    case "nHits":
      return screen.nHits;
    case "nGenes":
      return screen.nGenes;
    case "id":
      return screen.id;
  }
}

/**
 * Nulls sink in both directions and ties fall back to the screen id, so a page
 * of results is the same page every time and an unknown is never read as zero.
 */
export function sortScreens(rows: AtlasScreen[], key: ScreenSortKey, dir: "asc" | "desc"): AtlasScreen[] {
  return [...rows].sort((a, b) => {
    const x = sortValue(a, key);
    const y = sortValue(b, key);
    if (x === null && y === null) return a.id - b.id;
    if (x === null) return 1;
    if (y === null) return -1;
    const delta = typeof x === "number" && typeof y === "number" ? x - y : collator.compare(String(x), String(y));
    if (delta === 0) return a.id - b.id;
    return dir === "asc" ? delta : -delta;
  });
}

function facetOptions(rows: AtlasScreen[], key: FacetKey, selected: string | null): FacetOption[] {
  const counts = new Map<string, number>();
  for (const screen of rows) {
    const value = facetValue(screen, key);
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  // The chosen value stays in the list at zero, so a filter that empties the
  // corpus still names itself instead of vanishing from its own control.
  if (selected && !counts.has(selected)) counts.set(selected, 0);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || collator.compare(a.value, b.value));
}

/** Screen ids a gene was called in, or null when no gene filter is set. */
export function calledSet(index: GeneIndex | null, symbol: string | null): Set<number> | null {
  if (symbol === null || symbol.trim() === "") return null;
  if (index === null) return new Set();
  const gene = resolveGene(index, symbol);
  if (gene === null) return new Set();
  return new Set(index.calledIn[gene.index]);
}

export function queryScreens(
  corpus: readonly AtlasScreen[],
  index: GeneIndex | null,
  query: ScreenQuery,
  pageSize = SCREEN_PAGE_SIZE,
): ScreenPage {
  const called = calledSet(index, query.gene);
  const matching = corpus.filter((screen) => passes(screen, query, called, null));

  // Facet counts are taken with every filter applied except the facet's own,
  // the standard behaviour: choosing "Knockout" must still show what CRISPRi
  // would have returned, or the reader cannot tell what they are excluding.
  const facets = Object.fromEntries(
    FACET_KEYS.map((key) => [
      key,
      facetOptions(
        corpus.filter((screen) => passes(screen, query, called, key)),
        key,
        (query as FacetSelection)[key],
      ),
    ]),
  ) as Record<FacetKey, FacetOption[]>;

  const sorted = sortScreens(matching, query.sort, query.dir);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const page = Math.min(Math.max(1, query.page), pages);

  let low = Infinity;
  let high = -Infinity;
  for (const screen of corpus) {
    if (screen.year !== null) {
      low = Math.min(low, screen.year);
      high = Math.max(high, screen.year);
    }
  }

  return {
    rows: sorted.slice((page - 1) * pageSize, page * pageSize),
    total: sorted.length,
    corpus: corpus.length,
    page,
    pages,
    pageSize,
    facets,
    yearRange: Number.isFinite(low) ? [low, high] : null,
  };
}

/** One line a reader can scan: how the screen selected, in what, and for what. */
export function describeScreen(screen: AtlasScreen): string {
  return [screen.screenType, screen.cellLine, screen.phenotype, screen.condition]
    .filter((part): part is string => Boolean(part))
    .join(", ");
}

/** The authors' own hit definition, as recorded. Never paraphrased. */
export function hitDefinition(screen: AtlasScreen): string | null {
  const parts = [screen.significanceIndicator, screen.significanceCriteria].filter(Boolean);
  return parts.length > 0 ? parts.join(": ") : null;
}

// ---------------------------------------------------------------------------
// Genes
// ---------------------------------------------------------------------------

/** Wilson score interval, z = 1.96. The same interval the engine reports. */
export function wilsonInterval(hits: number, n: number): WilsonInterval | null {
  if (n <= 0) return null;
  const z = 1.959963984540054;
  const p = hits / n;
  const denominator = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return {
    lower: hits === 0 ? 0 : Math.max(0, (centre - spread) / denominator),
    upper: hits === n ? 1 : Math.min(1, (centre + spread) / denominator),
  };
}

export function buildGeneIndex(table: GeneTable): GeneIndex {
  const bySymbol = new Map<string, number>();
  table.symbols.forEach((symbol, i) => bySymbol.set(symbol.toUpperCase(), i));

  const byAlias = new Map<string, string>();
  for (const [alias, symbol] of Object.entries(table.aliases)) {
    const key = alias.toUpperCase();
    // A symbol beats an alias that happens to spell it, and the first alias
    // wins among alias collisions, so a lookup is deterministic.
    if (!bySymbol.has(key) && !byAlias.has(key)) byAlias.set(key, symbol);
  }

  const calledIn: Int32Array[] = new Array(table.symbols.length);
  const hitsOfScreen = new Map<number, number[]>();
  for (let i = 0; i < table.symbols.length; i++) {
    const deltas = table.hitScreens[i];
    const ids = new Int32Array(deltas.length);
    let id = 0;
    for (let j = 0; j < deltas.length; j++) {
      id += deltas[j];
      ids[j] = id;
      let list = hitsOfScreen.get(id);
      if (!list) hitsOfScreen.set(id, (list = []));
      list.push(i);
    }
    calledIn[i] = ids;
  }
  return { table, bySymbol, byAlias, calledIn, hitsOfScreen };
}

export function resolveGene(
  index: GeneIndex,
  input: string,
): { index: number; resolvedFrom: string | null } | null {
  const typed = input.trim();
  if (typed === "") return null;
  const direct = index.bySymbol.get(typed.toUpperCase());
  if (direct !== undefined) return { index: direct, resolvedFrom: null };
  const symbol = index.byAlias.get(typed.toUpperCase());
  if (symbol !== undefined) {
    const resolved = index.bySymbol.get(symbol.toUpperCase());
    if (resolved !== undefined) return { index: resolved, resolvedFrom: typed };
  }
  return null;
}

export function summarizeGene(index: GeneIndex, geneIndex: number, resolvedFrom: string | null): GeneSummary {
  const t = index.table;
  const testedBackground = t.testedBackground[geneIndex];
  const hitsBackground = t.hitsBackground[geneIndex];
  const hitRate = testedBackground > 0 ? hitsBackground / testedBackground : null;
  const enough = testedBackground >= MIN_SCREENS_FOR_FREQUENT_HITTER && hitRate !== null;
  return {
    symbol: t.symbols[geneIndex],
    resolvedFrom,
    entrez: t.entrez[geneIndex],
    tested: t.tested[geneIndex],
    called: index.calledIn[geneIndex].length,
    testedBackground,
    hitsBackground,
    hitRate,
    hitRateInterval: wilsonInterval(hitsBackground, testedBackground),
    phenotypes: t.phenotypes[geneIndex],
    cellLines: t.cellLines[geneIndex],
    conditions: t.conditions[geneIndex],
    frequentHitter: !enough
      ? "not_enough_screens"
      : hitRate > FREQUENT_HITTER_RATE
        ? "above_threshold"
        : "below_threshold",
  };
}

function tally(values: (string | null)[]): PhenotypeCall[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = value ?? "Not recorded";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([phenotype, called]) => ({ phenotype, called }))
    .sort((a, b) => b.called - a.called || collator.compare(a.phenotype, b.phenotype));
}

export function suggestGenes(index: GeneIndex, prefix: string, limit = 8): GeneSuggestion[] {
  const wanted = prefix.trim().toUpperCase();
  if (wanted === "") return [];
  const found: GeneSuggestion[] = [];
  const seen = new Set<number>();
  const add = (i: number, viaAlias?: string) => {
    if (seen.has(i) || found.length >= limit) return;
    seen.add(i);
    found.push({
      symbol: index.table.symbols[i],
      called: index.calledIn[i].length,
      tested: index.table.tested[i],
      ...(viaAlias ? { viaAlias } : {}),
    });
  };
  // Prefix matches first, in symbol order: someone typing "TP5" wants TP53.
  // A symbol with an underscore is a construct label, such as KRAS_G12V_noCDNA,
  // not a gene, so it is offered only when nothing better matches.
  const symbols = index.table.symbols;
  const constructs: number[] = [];
  for (let i = 0; i < symbols.length && found.length < limit; i++) {
    if (!symbols[i].toUpperCase().startsWith(wanted)) continue;
    if (symbols[i].includes("_")) constructs.push(i);
    else add(i);
  }
  // Then aliases, so "P53" leads to TP53 instead of to nothing.
  if (found.length < limit) {
    for (const [alias, symbol] of index.byAlias) {
      if (alias.startsWith(wanted)) {
        const i = index.bySymbol.get(symbol.toUpperCase());
        if (i !== undefined) add(i, alias);
      }
      if (found.length >= limit) break;
    }
  }
  for (const i of constructs) add(i);
  return found;
}

/**
 * What the Atlas can say about one gene of a hit table, in the terms the Hit
 * Report prints: how many of the background screens that measured it called it,
 * and whether that clears the frequent-hitter rule. `found: false` is its own
 * answer ("the Atlas has no such gene") and never reads as a hit rate of zero.
 */
export type GeneEvidence =
  | { found: false }
  | {
      found: true;
      symbol: string;
      called: number;
      tested: number;
      testedBackground: number;
      hitsBackground: number;
      rate: number | null;
      frequentHitter: GeneSummary["frequentHitter"];
    };

export function geneEvidence(index: GeneIndex, symbol: string): GeneEvidence {
  const resolved = resolveGene(index, symbol);
  if (resolved === null) return { found: false };
  const summary = summarizeGene(index, resolved.index, resolved.resolvedFrom);
  return {
    found: true,
    symbol: summary.symbol,
    called: summary.called,
    tested: summary.tested,
    testedBackground: summary.testedBackground,
    hitsBackground: summary.hitsBackground,
    rate: summary.hitRate,
    frequentHitter: summary.frequentHitter,
  };
}

export function lookupGene(
  index: GeneIndex,
  screens: ReadonlyMap<number, AtlasScreen>,
  input: string,
): GeneLookup {
  const resolved = resolveGene(index, input);
  if (resolved === null) {
    return { status: "not_found", query: input.trim(), suggestions: suggestGenes(index, input, 6) };
  }
  const gene = summarizeGene(index, resolved.index, resolved.resolvedFrom);
  const called = [...index.calledIn[resolved.index]]
    .map((id) => screens.get(id))
    .filter((screen): screen is AtlasScreen => screen !== undefined);
  called.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.id - b.id);
  return {
    status: "found",
    gene,
    screens: called,
    byPhenotype: tally(called.map((screen) => screen.phenotype)),
    byModality: tally(called.map((screen) => screen.modality)),
  };
}

// ---------------------------------------------------------------------------
// A single screen
// ---------------------------------------------------------------------------

export function screenHits(
  index: GeneIndex,
  screenId: number,
  text: string,
  page: number,
  pageSize = HIT_PAGE_SIZE,
): ScreenHitPage {
  const all = index.hitsOfScreen.get(screenId) ?? [];
  const wanted = text.trim().toUpperCase();
  const symbols = index.table.symbols;
  const filtered = wanted === "" ? all : all.filter((i) => symbols[i].toUpperCase().includes(wanted));
  const ordered = [...filtered].sort((a, b) => collator.compare(symbols[a], symbols[b]));
  const pages = Math.max(1, Math.ceil(ordered.length / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  return {
    rows: ordered.slice((current - 1) * pageSize, current * pageSize).map((i) => ({
      symbol: symbols[i],
      calledElsewhere: index.calledIn[i].length,
      tested: index.table.tested[i],
    })),
    total: all.length,
    matching: ordered.length,
    page: current,
    pages,
    pageSize,
  };
}

/** Every hit symbol of a screen, in symbol order, for the export. */
export function allScreenHits(index: GeneIndex, screenId: number): string[] {
  const symbols = index.table.symbols;
  return (index.hitsOfScreen.get(screenId) ?? []).map((i) => symbols[i]).sort((a, b) => collator.compare(a, b));
}

/**
 * Screens whose hit calls overlap this one's most, by Jaccard index over the
 * authors' own hit lists. Reported as an overlap of calls and nothing more:
 * two proliferation screens overlap heavily because both call the core
 * essential genes, which says the screens measured fitness, not that they are
 * replicates. Both hit lists need at least ten genes, and at least three genes
 * must be shared, so a coincidence of two genes cannot rank.
 */
export function similarScreens(
  index: GeneIndex,
  screens: ReadonlyMap<number, AtlasScreen>,
  screenId: number,
  limit = 8,
): SimilarScreen[] {
  const own = index.hitsOfScreen.get(screenId);
  if (!own || own.length < 10) return [];
  const shared = new Map<number, number>();
  for (const g of own) {
    for (const other of index.calledIn[g]) {
      if (other !== screenId) shared.set(other, (shared.get(other) ?? 0) + 1);
    }
  }
  const out: SimilarScreen[] = [];
  for (const [id, n] of shared) {
    const theirs = index.hitsOfScreen.get(id);
    const screen = screens.get(id);
    if (!theirs || !screen || theirs.length < 10 || n < 3) continue;
    out.push({ screen, shared: n, jaccard: n / (own.length + theirs.length - n) });
  }
  out.sort((a, b) => b.jaccard - a.jaccard || a.screen.id - b.screen.id);
  return out.slice(0, limit);
}

/** Screens run in the same cell line for the same phenotype, whatever their hits. */
export function sameContext(
  corpus: readonly AtlasScreen[],
  screen: AtlasScreen,
  limit = 8,
): AtlasScreen[] {
  if (!screen.cellLine || !screen.phenotype) return [];
  const cell = normalize(screen.cellLine);
  return corpus
    .filter((other) => other.id !== screen.id && normalize(other.cellLine ?? "") === cell && other.phenotype === screen.phenotype)
    .sort((a, b) => Math.abs((a.year ?? 0) - (screen.year ?? 0)) - Math.abs((b.year ?? 0) - (screen.year ?? 0)) || a.id - b.id)
    .slice(0, limit);
}

export function corpusFigures(corpus: readonly AtlasScreen[]) {
  const papers = new Set<string>();
  const cells = new Set<string>();
  let withHits = 0;
  let hitListOnly = 0;
  for (const screen of corpus) {
    papers.add(screen.pmid ?? screen.sourceId ?? `screen-${screen.id}`);
    if (screen.cellLine) cells.add(normalize(screen.cellLine));
    if ((screen.nHits ?? 0) > 0) withHits++;
    if (screen.hitListOnly) hitListOnly++;
  }
  return {
    screens: corpus.length,
    publications: papers.size,
    cellLines: cells.size,
    withHits,
    hitListOnly,
  };
}
