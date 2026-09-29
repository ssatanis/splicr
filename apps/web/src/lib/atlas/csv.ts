/**
 * Atlas exports, as CSV a reader can cite.
 *
 * Same conventions as the hit-report export: RFC 4180, CRLF, every text field
 * quoted, a UTF-8 BOM for Excel's encoding detection, and a `#` preamble that
 * says where the rows came from, which is what makes a supplementary table
 * reproducible. Readers in this field already handle it:
 *
 *   readr::read_csv("file.csv", comment = "#")
 *   pandas.read_csv("file.csv", comment = "#")
 *
 * Nothing is derived. A screen row is the ORCS record; a gene list is exactly
 * the genes that screen's own authors called. The BioGRID ORCS licence (MIT,
 * Copyright 2021 Mike Tyers) is named in the preamble because the notice has to
 * travel with a substantial copy.
 */
import { orcsScreenUrl } from "./links";
import type { AtlasManifest, AtlasScreen, ScreenFilters } from "./types";

const CRLF = "\r\n";

/**
 * A field beginning with one of these is read as a formula by Excel and
 * LibreOffice, so a hostile or merely unlucky record could run one. A leading
 * apostrophe defuses it. Gene symbols never start this way; free-text notes can.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

function text(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function num(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "" : String(value);
}

function bool(value: boolean): string {
  return value ? "true" : "false";
}

/** Symbols Excel rewrites as dates when a CSV is opened by double-click. */
const DATE_LIKE_SYMBOL = /^(JAN|FEB|MAR|MARCH|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)-?\d{1,2}$/i;

function excelNote(symbols: string[]): string {
  const risky = symbols.filter((symbol) => DATE_LIKE_SYMBOL.test(symbol));
  return risky.length > 0
    ? `# excel_warning: ${risky.length} gene symbol(s) here are rewritten as dates when a CSV is opened by double-click in Excel: ${risky.slice(0, 20).join(", ")}${risky.length > 20 ? ", ..." : ""}. Import with Data then From Text/CSV and set the symbol column to Text.`
    : "# excel_note: no gene symbol in this file is date-ambiguous. If you add rows, import with Data then From Text/CSV and set gene columns to Text.";
}

function header(manifest: AtlasManifest, title: string, generatedAt: Date, extra: string[]): string[] {
  return [
    `# ${title}`,
    `# generated: ${generatedAt.toISOString()}`,
    `# source: ${manifest.source}, release ${manifest.release} (${manifest.organism})`,
    `# licence: ${manifest.licence}`,
    "# hit_definition: each screen keeps the analysis method, significance indicator and threshold its own authors used. Hit counts are not comparable across screens.",
    ...extra,
    '# read in R with readr::read_csv(path, comment = "#")',
  ];
}

const SCREEN_COLUMNS = [
  "atlas_release",
  "screen_id",
  "publication",
  "year",
  "pmid",
  "source_id",
  "cell_line",
  "cell_type",
  "phenotype",
  "condition",
  "dosage",
  "screen_type",
  "experimental_setup",
  "duration",
  "moi",
  "modality",
  "enzyme",
  "library",
  "analysis",
  "significance_indicator",
  "significance_criteria",
  "genes_reported",
  "hits_reported",
  "hit_list_only",
  "orcs_url",
] as const;

function describeFilters(filters: Partial<ScreenFilters>): string {
  const parts: string[] = [];
  if (filters.q) parts.push(`search "${filters.q}"`);
  if (filters.gene) parts.push(`called ${filters.gene}`);
  for (const key of ["modality", "phenotype", "screenType", "setup", "cellLine"] as const) {
    if (filters[key]) parts.push(`${key} = ${filters[key]}`);
  }
  if (filters.yearFrom) parts.push(`year >= ${filters.yearFrom}`);
  if (filters.yearTo) parts.push(`year <= ${filters.yearTo}`);
  if (filters.withHits) parts.push("only screens with called genes");
  return parts.length > 0 ? parts.join("; ") : "none";
}

export function screensCsv(
  rows: readonly AtlasScreen[],
  manifest: AtlasManifest,
  filters: Partial<ScreenFilters>,
  generatedAt: Date,
): string {
  const lines = header(manifest, "SplicR Atlas: published screens", generatedAt, [
    `# filters: ${describeFilters(filters)}`,
    `# rows: ${rows.length} screens, one row each`,
    "# genes_reported: genes with a score in the record; for a hit-list-only screen, the genes listed",
    "# hits_reported: the number of genes the original authors called a hit, as ORCS records it",
  ]);
  const body = rows.map((screen) =>
    [
      text(manifest.release),
      num(screen.id),
      text(screen.author),
      num(screen.year),
      text(screen.pmid),
      text(screen.sourceId),
      text(screen.cellLine),
      text(screen.cellType),
      text(screen.phenotype),
      text(screen.condition),
      text(screen.dosage),
      text(screen.screenType),
      text(screen.setup),
      text(screen.duration),
      text(screen.moi),
      text(screen.modality),
      text(screen.enzyme),
      text(screen.library),
      text(screen.analysis),
      text(screen.significanceIndicator),
      text(screen.significanceCriteria),
      num(screen.nGenes),
      num(screen.nHits),
      bool(screen.hitListOnly),
      text(orcsScreenUrl(screen.id)),
    ].join(","),
  );
  return `﻿${[...lines, SCREEN_COLUMNS.join(","), ...body].join(CRLF)}${CRLF}`;
}

export function hitsCsv(
  screen: AtlasScreen,
  symbols: readonly string[],
  manifest: AtlasManifest,
  generatedAt: Date,
): string {
  const lines = header(manifest, `SplicR Atlas: genes called in screen ${screen.id}`, generatedAt, [
    `# screen: ${screen.id}, ${screen.author ?? "Unattributed"}, ${screen.cellLine ?? "cell line not recorded"}, ${screen.phenotype ?? "phenotype not recorded"}`,
    `# authors_hit_rule: ${[screen.significanceIndicator, screen.significanceCriteria].filter(Boolean).join(": ") || "not recorded"}`,
    `# rows: ${symbols.length} distinct gene symbols; ORCS reports ${screen.nHits ?? "an unknown number of"} hits for this screen. Repeated identifiers that resolve to one symbol are listed once.`,
    excelNote([...symbols]),
  ]);
  const body = symbols.map((symbol) => [text(manifest.release), num(screen.id), text(symbol)].join(","));
  return `﻿${[...lines, ["atlas_release", "screen_id", "gene_symbol"].join(","), ...body].join(CRLF)}${CRLF}`;
}
