/**
 * The Atlas, as the console sees it.
 *
 * Every field here is one the BioGRID ORCS record itself carries, read from the
 * snapshot `scripts/data/build-atlas-snapshot.py` writes. Nothing is scored,
 * re-called or harmonised: a screen keeps the analysis method, the significance
 * indicator and the threshold its own authors used, because those are what
 * "hit" means for that screen and they differ between studies.
 */

export interface AtlasScreen {
  id: number;
  sourceId: string | null;
  sourceType: string | null;
  pmid: string | null;
  author: string | null;
  year: number | null;
  /** Genes with a reported score. For a hit-list-only screen this is the hit count. */
  nGenes: number | null;
  nHits: number | null;
  analysis: string | null;
  significanceIndicator: string | null;
  significanceCriteria: string | null;
  throughput: string | null;
  screenType: string | null;
  screenFormat: string | null;
  setup: string | null;
  duration: string | null;
  condition: string | null;
  dosage: string | null;
  moi: string | null;
  library: string | null;
  libraryType: string | null;
  libraryMethodology: string | null;
  modality: string | null;
  enzyme: string | null;
  cellLine: string | null;
  cellType: string | null;
  phenotype: string | null;
  rationale: string | null;
  notes: string | null;
  /** The record lists only the genes the authors called; unlisted genes were not necessarily measured. */
  hitListOnly: boolean;
  /** Reports enough measured genes to serve as a denominator for a gene's hit rate. */
  background: boolean;
  targetsTss: boolean;
  scoreTypes: string[];
}

export interface AtlasManifest {
  schemaVersion: number;
  release: string;
  sourceGeneratedUtc: string;
  source: string;
  licence: string;
  organism: string;
  screens: number;
  backgroundScreens: number;
  hitListOnlyScreens: number;
  geneRowsInSource: number;
  hitRowsInSource: number;
  genes: number;
  genesDroppedUnresolved: number;
  aliases: number;
  hitRows: number;
  sha256: Record<string, string>;
}

/** Columnar gene index, exactly as the snapshot stores it. */
export interface GeneTable {
  symbols: string[];
  entrez: (number | null)[];
  /** Screens whose rows include the gene, hit-list-only screens included. */
  tested: number[];
  testedBackground: number[];
  hitsBackground: number[];
  phenotypes: number[];
  cellLines: number[];
  conditions: number[];
  /** Screen ids that called the gene, ascending and delta encoded. */
  hitScreens: number[][];
  aliases: Record<string, string>;
}

/** The gene table with the screen lists decoded and the lookup maps built. */
export interface GeneIndex {
  table: GeneTable;
  bySymbol: Map<string, number>;
  byAlias: Map<string, string>;
  /** Absolute screen ids per gene, ascending. */
  calledIn: Int32Array[];
  /** Gene indexes per screen id, ascending by gene index. */
  hitsOfScreen: Map<number, number[]>;
}

export const SCREEN_SORT_KEYS = [
  "year",
  "author",
  "cellLine",
  "phenotype",
  "modality",
  "library",
  "nHits",
  "nGenes",
  "id",
] as const;
export type ScreenSortKey = (typeof SCREEN_SORT_KEYS)[number];

export type SortDirection = "asc" | "desc";

/** The four facets a reader narrows the corpus by. */
export const FACET_KEYS = ["modality", "phenotype", "screenType", "setup"] as const;
export type FacetKey = (typeof FACET_KEYS)[number];

export const FACET_LABEL: Record<FacetKey, string> = {
  modality: "Modality",
  phenotype: "Phenotype",
  screenType: "Selection",
  setup: "Setup",
};

export interface ScreenFilters {
  q: string;
  modality: string | null;
  phenotype: string | null;
  screenType: string | null;
  setup: string | null;
  cellLine: string | null;
  yearFrom: number | null;
  yearTo: number | null;
  /** Only screens whose authors called at least one gene. */
  withHits: boolean;
  /** Only screens that called this gene, by symbol. */
  gene: string | null;
}

export interface ScreenQuery extends ScreenFilters {
  sort: ScreenSortKey;
  dir: SortDirection;
  page: number;
}

export interface FacetOption {
  value: string;
  count: number;
}

export interface ScreenPage {
  rows: AtlasScreen[];
  total: number;
  /** Rows in the corpus before any filter. */
  corpus: number;
  page: number;
  pages: number;
  pageSize: number;
  facets: Record<FacetKey, FacetOption[]>;
  yearRange: [number, number] | null;
}

export interface WilsonInterval {
  lower: number;
  upper: number;
}

export interface GeneSummary {
  symbol: string;
  /** The alias the reader typed, when it resolved to a different symbol. */
  resolvedFrom: string | null;
  entrez: number | null;
  /** Screens whose rows include the gene. */
  tested: number;
  called: number;
  /** Background screens that measured the gene, the denominator of its rate. */
  testedBackground: number;
  hitsBackground: number;
  hitRate: number | null;
  hitRateInterval: WilsonInterval | null;
  phenotypes: number;
  cellLines: number;
  conditions: number;
  /** What the flag rule can say. Never `false` when the Atlas cannot judge. */
  frequentHitter: "above_threshold" | "below_threshold" | "not_enough_screens";
}

export interface PhenotypeCall {
  phenotype: string;
  called: number;
}

export type GeneLookup =
  | {
      status: "found";
      gene: GeneSummary;
      screens: AtlasScreen[];
      byPhenotype: PhenotypeCall[];
      byModality: PhenotypeCall[];
    }
  | { status: "not_found"; query: string; suggestions: GeneSuggestion[] };

export interface GeneSuggestion {
  symbol: string;
  called: number;
  tested: number;
  /** The alias that matched, when the reader's prefix is an alias rather than the symbol. */
  viaAlias?: string;
}

export interface SimilarScreen {
  screen: AtlasScreen;
  shared: number;
  jaccard: number;
}

export interface ScreenHitRow {
  symbol: string;
  /** Screens that called this gene, over the whole Atlas. */
  calledElsewhere: number;
  tested: number;
}

export interface ScreenHitPage {
  rows: ScreenHitRow[];
  total: number;
  /** Hits after the text filter, before paging. */
  matching: number;
  page: number;
  pages: number;
  pageSize: number;
}
