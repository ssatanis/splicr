/**
 * Outcomes as a file that opens in R, Excel or Prism.
 *
 * Same conventions as every other export in the console: RFC 4180, CRLF, a UTF-8
 * BOM, every text field quoted, formulas defused, and a `#` preamble that says
 * what the rows are and what they are not. A recorded model score is labelled as
 * exactly that in the file, so a column pasted into a manuscript table cannot be
 * read as a validation probability.
 */
import { TYPE_QUESTION } from "@/lib/validation/model";

import type { OutcomeFilters, OutcomeRow } from "./model";

const CRLF = "\r\n";
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * A quoted, formula-defused cell.
 *
 * `undefined` is treated exactly like `null`: an empty cell. A row produced by
 * an older deployment than the one exporting it is missing the newer keys
 * rather than holding nulls for them, and that is the normal case during a
 * rollout. Crashing on it would lose the whole export over a field nobody
 * asked for.
 */
function text(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function num(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? ""
    : String(value);
}

/**
 * A recorded boolean, or an empty cell.
 *
 * Empty means "not recorded" and must not become FALSE. A spreadsheet column of
 * FALSE where the answer was never written down is a column of measurements
 * nobody made, and it is the exact error `insufficient_record` exists to keep
 * out of the engine.
 */
function bool(value: unknown): string {
  return value === true ? "true" : value === false ? "false" : "";
}

function number(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

export const OUTCOME_CSV_COLUMNS = [
  "outcome_id",
  "screen_id",
  "screen",
  "gene_symbol",
  "result",
  // Which experiment, and which of the four questions it bears on. Without
  // these two a downstream analysis cannot separate a genetic reproduction from
  // a pharmacologic test, and averaging them is the mistake this export exists
  // to make impossible.
  "validation_type",
  "question",
  "endpoint",
  "endpoint_decision",
  "endpoint_decision_reason",
  "laboratory",
  "arm",
  "round_id",
  "independent_perturbation",
  "distinct_from_screen_constructs",
  "n_perturbations",
  "n_replicates",
  "compound",
  "concentration_um",
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
    "# validation_type: what was done at the bench. question: which of the four questions it bears on. The four never share a number: a hit can validate genetically and fail pharmacologically.",
    "# question is empty for validation_type 'other' and for rows recorded before the experiment was a required field. Those rows bear on no question and enter no model.",
    "# endpoint_decision: whether the measurement meets the prespecified endpoint. 'insufficient_record' means a required criterion was not recorded; it is NOT a failure and belongs in neither a rate's numerator nor its denominator.",
    "# where endpoint_decision and result disagree, both are kept. The laboratory's own label is never overwritten.",
    "# an empty independent_perturbation or distinct_from_screen_constructs means not recorded, which is not the same as false.",
    "# laboratory is the unit of clustered uncertainty: two screens from one lab are not two independent observations.",
    "# arm: which selection strategy proposed the candidate. 'unassigned' means the outcome was not part of a blinded round.",
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
      text(row.validationType),
      text(row.validationType ? (TYPE_QUESTION[row.validationType] ?? null) : null),
      text(row.endpoint),
      text(row.endpointDecision),
      text(row.decisionBecause),
      text(row.labId),
      text(row.arm),
      text(row.roundId),
      bool(row.measurement?.independent_perturbation),
      bool(row.measurement?.distinct_from_screen_constructs),
      num(number(row.measurement?.n_perturbations)),
      num(number(row.measurement?.n_replicates)),
      text(string(row.measurement?.compound)),
      num(number(row.measurement?.concentration_um)),
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
