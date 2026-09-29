/**
 * Outcomes as a file that opens in R, Excel or Prism.
 *
 * Same conventions as every other export in the console: RFC 4180, CRLF, a UTF-8
 * BOM, every text field quoted, formulas defused, and a `#` preamble that says
 * what the rows are and what they are not. A recorded model score is labelled as
 * exactly that in the file, so a column pasted into a manuscript table cannot be
 * read as a validation probability.
 */
import type { OutcomeFilters, OutcomeRow } from "./model";

const CRLF = "\r\n";
const FORMULA_START = /^[=+\-@\t\r]/;

function text(value: string | null): string {
  if (value === null) return "";
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function num(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "" : String(value);
}

export const OUTCOME_CSV_COLUMNS = [
  "outcome_id",
  "screen_id",
  "screen",
  "gene_symbol",
  "result",
  "assay",
  "guides_used",
  "effect_size",
  "recorded_model_score",
  "model_version",
  "linked_to_recorded_hit",
  "notes",
  "evidence_url",
  "logged_at",
  "logged_by",
] as const;

export function outcomesCsv(
  rows: readonly OutcomeRow[],
  options: { filters: OutcomeFilters; generatedAt: Date; sample: boolean; screenLabel?: string | null },
): string {
  const { filters, generatedAt, sample } = options;
  const scope = [
    filters.result ? `result = ${filters.result}` : null,
    filters.screen ? `screen = ${options.screenLabel ?? filters.screen}` : null,
    filters.q ? `gene contains "${filters.q}"` : null,
  ].filter(Boolean);
  const preamble = [
    "# SplicR Truth Loop: bench outcomes",
    ...(sample ? ["# SAMPLE DATA. These rows are invented to show the layout and are not any lab's work."] : []),
    `# generated: ${generatedAt.toISOString()}`,
    `# filters: ${scope.length > 0 ? scope.join("; ") : "none"}`,
    `# rows: ${rows.length} outcomes, one row each, newest first`,
    "# result: validated, failed, inconclusive or pending, exactly as recorded. A pending outcome is not a failure and an inconclusive one is not a \"no\".",
    "# recorded_model_score: the uncalibrated model output stored when the gene was called. It is not a validation probability.",
    "# recording an outcome does not change any score or retrain any model.",
    '# read in R with readr::read_csv(path, comment = "#")',
  ];
  const body = rows.map((row) =>
    [
      text(row.id),
      text(row.screenId),
      text(row.screenName),
      text(row.gene),
      text(row.result),
      text(row.assay),
      num(row.nGuides),
      num(row.effectSize),
      num(row.predicted),
      text(row.modelVersion),
      row.hitLinked ? "true" : "false",
      text(row.notes),
      text(row.evidenceUrl),
      text(row.loggedAt),
      text(row.loggedBy),
    ].join(","),
  );
  return `﻿${[...preamble, OUTCOME_CSV_COLUMNS.join(","), ...body].join(CRLF)}${CRLF}`;
}
