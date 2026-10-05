/**
 * The workspace Hit Report, as a CSV or JSON file.
 *
 * Built from the recorded run and nothing else. Every number is written as the
 * database returned it, with no rounding, so a p-value of 1.2e-24 is still
 * 1.2e-24 in the file. A missing value is blank in the CSV and null in the JSON,
 * never zero, because a measured zero and an unmeasured one are different
 * results. The stored model output is named for what it is in the file itself,
 * in a column name and in the preamble, so a column pasted into a manuscript
 * table cannot be read as a validation probability.
 *
 * Same file conventions as every other export in the console: RFC 4180, CRLF, a
 * UTF-8 BOM, every text field quoted, formulas defused, and a `#` preamble that
 * says where the rows came from.
 */
import type { ReportData, ReportHitRow } from "@/lib/data/screen-report";

const CRLF = "\r\n";
const FORMULA_START = /^[=+\-@\t\r]/;

function text(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** The number as received. Nonfinite values are invalid and are written as missing. */
function num(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

/** Symbols Excel rewrites as dates when a CSV is opened by double-click. */
const DATE_LIKE_SYMBOL = /^(JAN|FEB|MAR|MARCH|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)-?\d{1,2}$/i;

export function guideConcordance(hit: Pick<ReportHitRow, "n_guides" | "n_good_guides">): number | null {
  if (hit.n_guides === null || hit.n_good_guides === null || hit.n_guides <= 0) return null;
  return hit.n_good_guides / hit.n_guides;
}

const COLUMNS = [
  "screen_id",
  "comparison",
  "gene_symbol",
  "direction",
  "log2_fold_change",
  "p_value",
  "fdr",
  "bayes_factor",
  "mageck_depletion_fdr",
  "mageck_enrichment_fdr",
  "drugz_norm_z",
  "drugz_directional_fdr",
  "mle_beta",
  "mle_fdr",
  "n_guides",
  "n_good_guides",
  "guide_concordance",
  "cn_corrected",
  "artifact_flags",
  "recorded_model_score",
  "model_version",
  "verdict",
  "reason",
  "atlas_hit_count_at_analysis",
  "atlas_screen_count_at_analysis",
  "atlas_hit_rate_at_analysis",
] as const;

function comparisonNames(data: ReportData): Map<string, string> {
  return new Map(data.comparisons.map((comparison) => [comparison.id, comparison.name]));
}

export function workspaceCsv(data: ReportData, generatedAt: Date): string {
  const names = comparisonNames(data);
  const risky = data.hits.map((hit) => hit.gene_symbol).filter((symbol) => DATE_LIKE_SYMBOL.test(symbol));
  const lines = [
    "# SplicR hit report",
    "# data_source: SplicR workspace, the recorded results of this screen's current run",
    `# generated: ${generatedAt.toISOString()}`,
    `# screen: ${data.screen.id}, ${data.screen.name}`,
    `# model_system: ${[data.screen.cell_line, data.screen.modality].filter(Boolean).join(", ") || "not recorded"}`,
    `# phenotype: ${data.screen.phenotype ?? "not recorded"}`,
    `# screen_status: ${data.screen.status}; qc: ${data.screen.qc}`,
    data.run
      ? `# run: ${data.run.id} (${data.run.status}); engine ${data.run.engine_version ?? "not recorded"}; container ${data.run.image_digest ?? "not recorded"}`
      : "# run: none recorded, so this file has no hit rows. That does not establish that the experiment had no hits.",
    `# analysis_settings: ${JSON.stringify(data.run?.settings ?? {})}`,
    `# comparisons: ${data.comparisons.map((c) => c.name).join("; ") || "none recorded"}`,
    `# rows: ${data.hits.length} gene and comparison records${data.truncated ? ", STOPPED AT THE ROW LIMIT: the run has more" : ""}, ordered by recorded FDR, most significant first, then gene`,
    "# statistics: every value is as recorded. Blank means not recorded, which is not zero.",
    "# recorded_model_score: a stored, uncalibrated model output. It is not a validation probability and carries no confidence interval.",
    "# atlas_*_at_analysis: the Atlas counts stored when the run was made, with their own denominator; they are not recomputed here.",
    risky.length > 0
      ? `# excel_warning: ${risky.length} gene symbol(s) here are rewritten as dates when a CSV is opened by double-click in Excel: ${[...new Set(risky)].slice(0, 20).join(", ")}. Import with Data then From Text/CSV and set gene_symbol to Text.`
      : "# excel_note: no gene symbol in this file is date-ambiguous. If you add rows, import with Data then From Text/CSV and set gene_symbol to Text.",
    '# read in R with readr::read_csv(path, comment = "#")',
  ];
  const rows = data.hits.map((hit) => {
    const flags = (hit.hit_flags ?? []).map((flag) => `${flag.flag}:${flag.severity}`).join("; ");
    return [
      text(data.screen.id),
      text(names.get(hit.comparison_id) ?? null),
      text(hit.gene_symbol),
      text(hit.direction),
      num(hit.lfc),
      num(hit.p_value),
      num(hit.fdr),
      num(hit.bayes_factor),
      num(hit.depleted_fdr), num(hit.enriched_fdr), num(hit.norm_z), num(hit.drugz_fdr), num(hit.mle_beta), num(hit.mle_fdr),
      num(hit.n_guides),
      num(hit.n_good_guides),
      num(guideConcordance(hit)),
      hit.cn_corrected === null ? "" : hit.cn_corrected ? "true" : "false",
      text(flags === "" ? null : flags),
      num(hit.chance_real),
      text(hit.model_version),
      text(hit.verdict),
      text(hit.reason),
      num(hit.atlas_hit_count),
      num(hit.atlas_screen_count),
      num(hit.atlas_hit_rate),
    ].join(",");
  });
  return `﻿${[...lines, COLUMNS.join(","), ...rows].join(CRLF)}${CRLF}`;
}

export function workspaceJson(data: ReportData, generatedAt: Date): string {
  const names = comparisonNames(data);
  const finite = (value: number | null) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  const document = {
    schema: "splicr.workspace-hit-report/1",
    generated: generatedAt.toISOString(),
    data_source: "workspace",
    sample_data: false,
    // Stated in the file so a pipeline that only reads the JSON still has it.
    score_interpretation: "stored_uncalibrated_model_output",
    validation_probability: null,
    score_uncertainty_interval: null,
    screen: {
      id: data.screen.id,
      name: data.screen.name,
      cell_line: data.screen.cell_line,
      modality: data.screen.modality,
      phenotype: data.screen.phenotype,
      status: data.screen.status,
      qc: data.screen.qc,
      taxid: data.screen.taxid,
    },
    run: data.run
      ? {
          id: data.run.id,
          status: data.run.status,
          engine_version: data.run.engine_version,
          container_digest: data.run.image_digest,
          created_at: data.run.created_at,
          settings: data.run.settings ?? {},
        }
      : null,
    comparisons: data.comparisons.map((comparison) => ({ id: comparison.id, name: comparison.name, kind: comparison.kind, primary: comparison.is_primary })),
    rows: { count: data.hits.length, truncated: data.truncated, order: "recorded FDR ascending, then gene" },
    hits: data.hits.map((hit) => ({
      id: hit.id,
      gene: hit.gene_symbol,
      comparison: names.get(hit.comparison_id) ?? null,
      direction: hit.direction,
      lfc: finite(hit.lfc),
      p_value: finite(hit.p_value),
      fdr: finite(hit.fdr),
        mageck_depletion_fdr: hit.depleted_fdr ?? null, mageck_enrichment_fdr: hit.enriched_fdr ?? null, drugz_norm_z: hit.norm_z ?? null, drugz_directional_fdr: hit.drugz_fdr ?? null, mle_beta: hit.mle_beta ?? null, mle_fdr: hit.mle_fdr ?? null,
      bayes_factor: finite(hit.bayes_factor),
      n_guides: hit.n_guides,
      n_good_guides: hit.n_good_guides,
      guide_concordance: guideConcordance(hit),
      cn_corrected: hit.cn_corrected,
      flags: hit.hit_flags ?? [],
      recorded_model_score: finite(hit.chance_real),
      model_version: hit.model_version,
      verdict: hit.verdict,
      reason: hit.reason,
      atlas_at_analysis: {
        hit_count: hit.atlas_hit_count,
        screen_count: hit.atlas_screen_count,
        hit_rate: finite(hit.atlas_hit_rate),
      },
    })),
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function workspaceFilename(data: ReportData, extension: "csv" | "json", now: Date): string {
  return `splicr-hit-report_${data.screen.id}_${now.toISOString().slice(0, 10)}.${extension}`;
}
