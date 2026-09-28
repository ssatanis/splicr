"use client";

/**
 * The candidate table's export, as the rows that are actually on screen.
 *
 * WHY THIS IS NOT A LINK TO /api/report. The footer used to link to
 * `/api/report/<screen>?format=csv` under the label "Export rows (CSV)". That
 * file is the whole screen: verified with curl, 212 gene rows, indifferent to the
 * filter, the sort order and the shortlist. A reader who filtered to forty-three
 * clean candidates, sorted by novelty, ticked ten, and then pressed the only
 * export on the panel got a file with none of those three decisions in it, and
 * nothing in the file said so. That is the exact failure the design law is
 * against: the export has to be the rows the number came from.
 *
 * So the file is built here from the rendered rows, and the preamble states the
 * filter, the sort and the shortlist, because a supplementary table that cannot
 * say which subset it is cannot be reproduced. `#` is the comment convention
 * every reader in this field already handles: `read_csv(comment = "#")` in readr
 * and pandas, `comment.char = "#"` in base R.
 *
 * The screen's full report, with the provenance record and the twenty-one column
 * table, is still one click away on the screen's own Report tab. This export is
 * the working subset, not a replacement for it.
 */
import type { CandidateRow } from "./types";

const CRLF = "\r\n";

/** RFC 4180: quote everything textual, double any embedded quote. */
function field(value: string | number | null): string {
  if (value === null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return `"${value.replace(/"/g, '""')}"`;
}

const COLUMNS = [
  "screen_id",
  "screen_name",
  "gene_symbol",
  "verdict",
  "chance_real",
  "chance_lower",
  "chance_upper",
  "novelty",
  "log2_fold_change",
  "fdr",
  "n_guides",
  "n_guides_agreeing",
  "artifact_flags",
  "bench_assay",
  "shortlisted",
  "sample_data",
] as const;

export interface ExportContext {
  /** What the reader filtered to, spelled out rather than as a parameter value. */
  filter: string;
  /** Which column the rows are ordered by, and which way. */
  sort: string;
  /** Tool version, threshold and library, the same line the footer prints. */
  provenance: string;
  /** The reason to distrust every row, when there is one. */
  caveat: string | null;
  /** True only in the sample workspace, and then said twice in the file. */
  sample: boolean;
  /** The shortlist keys, so the file can mark which rows were picked. */
  picked: readonly string[];
  /** The key for a row, matching the shortlist's own scheme. */
  keyOf: (row: CandidateRow) => string;
}

export function candidatesCsv(rows: CandidateRow[], ctx: ExportContext): string {
  const preamble = [
    "# SplicR candidate table, as shown in the console",
    ...(ctx.sample
      ? [
          "# SAMPLE DATA. EVERY NUMBER IN THIS FILE COMES FROM THE SPLICR DEMO DATASET.",
          "# IT IS NOT A MEASUREMENT OF ANY REAL SCREEN AND MUST NOT BE CITED.",
        ]
      : []),
    `# exported: ${new Date().toISOString()}`,
    `# rows: ${rows.length}`,
    `# filter: ${ctx.filter}`,
    `# sorted_by: ${ctx.sort}`,
    `# provenance: ${ctx.provenance}`,
    "# chance_real is a legacy field name for an uncalibrated model score, not a validation probability",
    "# chance_lower and chance_upper are empty: no validated uncertainty interval is available",
    ...(ctx.caveat === null ? [] : [`# qc_caveat: ${ctx.caveat}`]),
    "# guide sequences are not in this file: there is no guide table behind these rows, so none is invented here",
  ];

  const body = rows.map((row) => {
    return [
      field(row.screenId),
      field(row.screenName),
      field(row.gene),
      field(row.verdict),
      field(row.chance),
      field(null),
      field(null),
      field(row.novelty),
      field(row.lfc),
      field(row.fdr),
      field(row.guides),
      field(row.guidesAgree),
      field(row.flags.join("; ")),
      field(row.benchAssay),
      field(ctx.picked.includes(ctx.keyOf(row)) ? "yes" : "no"),
      field(ctx.sample ? "yes" : "no"),
    ].join(",");
  });

  // A BOM, so Excel reads the file as UTF-8. It does not stop Excel rewriting
  // gene symbols that look like dates; nothing in a byte sequence does. The one
  // safe path is Data then From Text/CSV with gene_symbol typed as Text.
  return `﻿${[...preamble, COLUMNS.join(","), ...body].join(CRLF)}${CRLF}`;
}

/**
 * Hand the file to the browser.
 *
 * A Blob and an object URL rather than a `data:` href: a forty-thousand character
 * data URL is refused outright by some browsers, and the object URL is revoked on
 * the next frame so the rows do not sit in memory for the life of the page.
 */
export function downloadCsv(name: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}
