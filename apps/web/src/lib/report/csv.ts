/**
 * CSV export: the hit table as a supplementary table.
 *
 * Shape. RFC 4180, CRLF line endings, every text field quoted, one row per gene,
 * twenty-one columns. A `#` preamble above the header carries the provenance, because
 * a supplementary table that cannot say which library and which tool versions
 * produced it is not reproducible. `#` is the comment convention every reader in
 * this field already handles:
 *
 *   readr::read_csv("file.csv", comment = "#")
 *   read.csv("file.csv", comment.char = "#")
 *   pandas.read_csv("file.csv", comment = "#")
 *
 * The file opens in Excel too; the preamble lands in column A above the header.
 *
 * THE EXCEL GENE SYMBOL PROBLEM, and what is actually done about it.
 * Excel rewrites gene symbols that look like dates when a .csv is opened by
 * double-click: MARCH1 becomes 1-Mar, SEPT9 becomes 9-Sep. Ziemann et al.
 * (Genome Biology 2016) found this in a fifth of published supplementary files.
 * None of the usual folk remedies work. Quoting the field does not stop the
 * coercion. A UTF-8 BOM fixes the encoding, not the dates. `="MARCH1"` does stop
 * Excel, but it puts a formula in the cell that R and pandas then read literally,
 * which trades a silent Excel bug for a silent R bug. There is no single byte
 * sequence that is a plain symbol in R and immune in Excel.
 *
 * So this exporter does three things instead of pretending to fix it:
 *   1. It writes the file clean, for the readers that get it right: quoted text,
 *      CRLF, BOM, no formulas, nothing to strip before parsing.
 *   2. It detects the symbols in this export that Excel would rewrite and names
 *      them in the preamble, so the risk is specific rather than generic.
 *   3. It states the one Excel path that is safe, Data then From Text/CSV with
 *      gene_symbol typed as Text, next to the download button in the UI and in
 *      the preamble of the file itself.
 * The JSON export is the lossless path and carries no such caveat.
 *
 * Sample data is marked twice on purpose: once in the preamble and once as a
 * real column on every row, so a block of rows pasted into a manuscript table
 * still says what it is.
 */
import { excelAmbiguousSymbols, type ReportDocument } from "./document";

const CRLF = "\r\n";

/** RFC 4180: quote everything textual, double any embedded quote. */
function field(value: string | number | null): string {
  if (value === null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return `"${value.replace(/"/g, '""')}"`;
}

/** Full precision without float noise. Small values stay readable as exponents. */
function sci(value: number, digits = 6): string {
  if (!Number.isFinite(value)) return "";
  return value !== 0 && Math.abs(value) < 1e-4 ? value.toExponential(digits) : value.toFixed(digits);
}

const COLUMNS = [
  "report_id",
  "sample_data",
  "screen_id",
  "rank",
  "gene_symbol",
  "verdict",
  "chance_real",
  "novelty",
  "direction",
  "log2_fold_change",
  "p_value",
  "fdr",
  "bayes_factor",
  "n_guides",
  "n_guides_agreeing",
  "guide_concordance",
  "atlas_hit_count",
  "atlas_screens_testing_gene",
  "atlas_hit_rate",
  "flags",
  "evidence",
] as const;

function preamble(doc: ReportDocument, generatedAt: Date): string[] {
  const lines: string[] = [];
  const say = (label: string, value: string) => lines.push(`# ${label}: ${value}`);

  lines.push("# SplicR hit report");
  if (doc.notice) {
    lines.push(`# ${doc.notice.toUpperCase()}`);
  }
  say("score_interpretation", "chance_real is an uncalibrated model score; no validated uncertainty interval is available");
  say("report_id", doc.reportId);
  say("generated", generatedAt.toISOString());
  say("data_source", doc.source === "sample" ? "SplicR sample dataset" : "SplicR workspace");
  say("screen", `${doc.screen.id}, ${doc.screen.name}`);
  say("model", `${doc.screen.cellLine}, ${doc.screen.organism}, ${doc.screen.modality}`);
  say("phenotype", doc.screen.phenotype);
  say(
    "library",
    doc.library.guides !== null
      ? `${doc.library.label} (${doc.library.guides} guides over ${doc.library.genes} genes, ${doc.library.guidesPerGene} per gene, ${doc.library.cas})`
      : `${doc.library.label} (guide and gene counts are not registered for this library version)`,
  );
  say("pipeline", `${doc.run.pipeline} ${doc.run.pipelineVersion} (${doc.run.analysisSchema})`);
  say("run_id", doc.run.id);
  if (doc.run.startedAt) say("run_started", doc.run.startedAt);
  if (doc.run.completedAt) say("run_completed", doc.run.completedAt);
  say("tools", doc.tools.map((t) => (t.version ? `${t.name} ${t.version}` : t.name)).join("; "));
  say("reference_data", doc.references.map((r) => `${r.name} ${r.release}`).join("; "));
  say("parameters", doc.parameters.map((p) => `${p.label} = ${p.value}`).join("; "));
  say("rows", `${doc.hits.length} genes, one row each, ranked by gene-level p-value`);
  // Without the denominator a q-value cannot be recomputed, and without the
  // direction note a reader has no way to tell the two arms apart from the sign.
  say(
    "fdr_method",
    `Benjamini-Hochberg step-up over ${doc.nTests} gene-level tests; every row in this file is inside the FDR < 0.10 cut declared above, and the fdr column is monotone in p_value`,
  );
  say(
    "direction",
    "depleted or enriched. log2_fold_change carries the sign; the enriched rows are the positive-selection arm and are not a subset of the depleted ones",
  );
  say(
    "atlas_denominators",
    `atlas_screens_testing_gene is the subset of the ${doc.atlasScreensTotal} Atlas screens that assayed that gene, which is what atlas_hit_rate is computed against. It is not the size of the corpus`,
  );

  const risky = excelAmbiguousSymbols(doc.hits);
  lines.push(
    risky.length > 0
      ? `# excel_warning: ${risky.length} gene symbol(s) in this file are rewritten as dates when a CSV is opened by double-click in Excel: ${risky.join(", ")}. Import with Data then From Text/CSV and set gene_symbol to Text.`
      : "# excel_note: no gene symbol in this file is date-ambiguous. If you add rows, import with Data then From Text/CSV and set gene_symbol to Text.",
  );
  lines.push("# read in R with readr::read_csv(path, comment = \"#\")");
  return lines;
}

export function toCsv(doc: ReportDocument, generatedAt: Date): string {
  const sampleFlag = doc.source === "sample" ? "SAMPLE DATA" : "workspace";
  const rows = doc.hits.map((h) =>
    [
      field(doc.reportId),
      field(sampleFlag),
      field(doc.screen.id),
      field(h.rank),
      field(h.gene),
      field(h.verdict),
      h.chance.toFixed(4),
      h.novelty.toFixed(4),
      field(h.direction),
      h.lfc.toFixed(4),
      sci(h.pValue),
      sci(h.fdr),
      h.bayesFactor.toFixed(2),
      field(h.guides),
      field(h.guidesAgree),
      h.guideConcordance.toFixed(3),
      field(h.atlasHits),
      field(h.atlasScreens),
      h.atlasHitRate.toFixed(6),
      field(h.flags.join("; ")),
      field(h.evidence),
    ].join(","),
  );

  // The BOM is for Excel's encoding detection only. It has nothing to do with
  // the date coercion above, and R strips it when the encoding is UTF-8.
  return `﻿${[...preamble(doc, generatedAt), COLUMNS.join(","), ...rows].join(CRLF)}${CRLF}`;
}
