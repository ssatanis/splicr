import ExcelJS from "exceljs";
import { strToU8, zipSync } from "fflate";
import type { EvidenceRow, ExportScreen } from "@/lib/data/screens-export";
import { EXPORT_FIELDS, type ExportField, type ExportRequest } from "./export-options";

type Cell = string | number | boolean | null;
type Row = Record<string, Cell>;
interface Table { name: string; columns: string[]; rows: Row[]; }
const keyFor = (row: { comparison_id?: unknown; gene_symbol?: unknown }) => JSON.stringify([row.comparison_id, row.gene_symbol]);
function scalar(value: unknown): Cell {
  if (value == null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("A recorded value is not finite. No file was created.");
    return value;
  }
  if (typeof value === "string" || typeof value === "boolean") return value;
  return JSON.stringify(value);
}
function flatten(value: unknown, path = "", out: Row = {}): Row {
  if (value !== null && typeof value === "object" && Object.keys(value).length) {
    for (const [key, child] of Object.entries(value)) flatten(child, path ? `${path}.${key}` : key, out);
  } else out[path] = scalar(value);
  return out;
}
function columnsFor(rows: Row[], fallback: string[]): string[] {
  return [...new Set([...fallback, ...rows.flatMap(row => Object.keys(row))])];
}
function hitValue(screen: ExportScreen, hit: ExportScreen["hits"][number], field: ExportField): Cell {
  if (field === "comparison") return screen.comparisons.find(c => c.id === hit.comparison_id)?.name ?? hit.comparison_id;
  if (field === "flags") return (hit.hit_flags ?? []).map(f => `${f.flag} [${f.severity}]`).join("; ");
  if (field === "flag_messages") return (hit.hit_flags ?? []).map(f => `${f.flag}: ${f.message}`).join("\n");
  return scalar(hit[field]);
}
export function prepareExport(screens: ExportScreen[], request: ExportRequest, exportedAt = new Date().toISOString()) {
  const results = screens.map(screen => {
    const hits = request.rowScope === "all" ? screen.hits : screen.hits.filter(hit => {
      const value = hit[request.fdrMetric];
      return typeof value === "number" && Number.isFinite(value) && value <= request.fdrThreshold;
    });
    const keys = new Set(hits.map(keyFor));
    const evidence = (rows: EvidenceRow[]) => request.rowScope === "all" ? rows : rows.filter(row => keys.has(keyFor(row)));
    return {
      screen: screen.screen,
      run_id: screen.run!.id,
      comparisons: screen.comparisons,
      recorded_gene_rows: screen.hits.length,
      exported_gene_rows: hits.length,
      genes: hits.map(hit => Object.fromEntries(request.fields.map(field => [field, hitValue(screen, hit, field)]))),
      ...(request.sections.includes("qc") ? { qc: screen.qcEvidence ?? null } : {}),
      ...(request.sections.includes("guides") ? { guides: evidence(screen.guides ?? []) } : {}),
      ...(request.sections.includes("disagreement") ? { disagreement: evidence(screen.disagreement ?? []) } : {}),
      ...(request.sections.includes("provenance") ? { provenance: { run: screen.run, stages: screen.stages ?? [] } } : {}),
    };
  });
  const dictionary = EXPORT_FIELDS.filter(f => request.fields.includes(f.key)).map(f => ({ field: f.key, label: f.label, description: f.description }));
  return {
    schema: "splicr.screens-export.v1",
    exported_at: exportedAt,
    source: "SplicR recorded current runs",
    selection: { fields: request.fields, sections: request.sections, rows: request.rowScope,
      ...(request.rowScope === "fdr" ? { filter: { metric: request.fdrMetric, operator: "<=", threshold: request.fdrThreshold, missing_values: "excluded" } } : {}) },
    notes: ["Statistics and evidence are recorded outputs; no analysis was rerun for this export.",
      "Blank cells and JSON null mean not recorded; zero is preserved.",
      "Artifact flags provide context and do not establish false hits. Atlas counts are the values stored at analysis.",
      "Screen QC verdicts remain applicable to the exported results.",
      ...(request.fields.includes("chance_real") ? ["Recorded model scores are uncalibrated and are not validation probabilities."] : []),
      ...(request.format === "csv" ? ["CSV text beginning with spreadsheet formula characters is prefixed with an apostrophe for safety. Use JSON for exact original text, or Excel for typed cells."] : [])],
    dictionary,
    screens: results,
  };
}
type Prepared = ReturnType<typeof prepareExport>;
function evidenceTables(data: Prepared): Table[] {
  const identity = (s: Prepared["screens"][number]): Row => ({ screen_id: s.screen.id, screen_name: s.screen.name, run_id: s.run_id });
  const tables: Table[] = [];
  if (data.selection.sections.includes("qc")) {
    const rows = data.screens.flatMap(s => s.qc === null ? [{ ...identity(s), field: "record", value: null }] :
      Object.entries(flatten(s.qc)).map(([field, value]) => ({ ...identity(s), field, value })));
    tables.push({ name: "Quality control", columns: ["screen_id", "screen_name", "run_id", "field", "value"], rows });
  }
  for (const section of ["guides", "disagreement"] as const) {
    if (!data.selection.sections.includes(section)) continue;
    const rows = data.screens.flatMap(s => (s[section] ?? []).map(row => ({ ...identity(s), ...Object.fromEntries(Object.entries(row).map(([key, value]) => [key, scalar(value)])) })));
    tables.push({ name: section === "guides" ? "Guide results" : "Guide disagreement", columns: columnsFor(rows, ["screen_id", "screen_name", "run_id", "comparison_id", "gene_symbol"]), rows });
  }
  if (data.selection.sections.includes("provenance")) {
    const rows = data.screens.flatMap(s => Object.entries(flatten(s.provenance)).map(([field, value]) => ({ ...identity(s), field, value })));
    tables.push({ name: "Run provenance", columns: ["screen_id", "screen_name", "run_id", "field", "value"], rows });
  }
  return tables;
}
export function uniqueSheetName(input: string, used: Set<string>): string {
  const base = input.replace(/[\[\]:*?/\\\x00-\x1f]/g, " ").replace(/^'+|'+$/g, "").trim() || "Screen";
  let name = base.slice(0, 31).replace(/'+$/g, "");
  let suffix = 2;
  while (used.has(name.toLowerCase()) || name.toLowerCase() === "history") {
    const tail = ` (${suffix++})`;
    name = `${base.slice(0, 31 - tail.length)}${tail}`;
  }
  used.add(name.toLowerCase());
  return name;
}
const probabilityKeys = new Set(["p_value", "fdr", "depleted_fdr", "enriched_fdr", "drugz_fdr", "mle_fdr", "fisher_p", "fisher_p_floor"]);
function addTable(workbook: ExcelJS.Workbook, table: Table, used: Set<string>, labels = false): string {
  const name = uniqueSheetName(table.name, used);
  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", xSplit: 1, ySplit: 1 }], pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  sheet.columns = table.columns.map(key => ({ key, header: labels ? EXPORT_FIELDS.find(f => f.key === key)?.label ?? key : key,
    width: /message|reason|description|value|reference|report|features/.test(key) ? 58 : /_id$/.test(key) ? 38 : 24 }));
  for (const row of table.rows) {
    const values = table.columns.map(key => {
      const value = row[key] ?? null;
      if (typeof value === "string" && (value.length > 32767 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))) {
        throw new Error("A recorded text value cannot be represented safely in Excel. Export JSON instead; no data was truncated.");
      }
      return value;
    });
    const added = sheet.addRow(values);
    added.eachCell((cell, column) => {
      cell.font = { name: "Arial", size: 10, color: { argb: "FF222222" } };
      cell.alignment = { vertical: "top", wrapText: true };
      const key = table.columns[column - 1];
      cell.numFmt = typeof cell.value === "string" ? "@" : probabilityKeys.has(key) ? "0.000E+00" : "General";
    });
  }
  const header = sheet.getRow(1);
  header.height = 32;
  header.eachCell(cell => {
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FF222222" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEFF1" } };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: "FFB8BDC4" } } };
  });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: table.columns.length } };
  sheet.pageSetup.printTitlesRow = "1:1";
  return name;
}
export function csvTable(table: Table): string {
  const quote = (value: Cell | undefined): string => {
    let text = value == null ? "" : String(value);
    if (typeof value === "string" && (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [table.columns.map(quote).join(","), ...table.rows.map(row => table.columns.map(key => quote(row[key])).join(","))].join("\r\n") + "\r\n";
}
export async function serializeScreensExport(screens: ExportScreen[], request: ExportRequest, exportedAt?: string) {
  const data = prepareExport(screens, request, exportedAt);
  const stamp = `${data.exported_at.slice(0, 10)}-${data.exported_at.slice(11, 19).replaceAll(":", "")}`;
  const filename = `SplicR-screens-${stamp}.${request.format === "csv" ? "zip" : request.format}`;
  if (request.format === "json") return { filename, contentType: "application/json; charset=utf-8", bytes: strToU8(JSON.stringify(data, null, 2) + "\n") };
  const evidence = evidenceTables(data);
  if (request.format === "csv") {
    const files: Record<string, Uint8Array> = {};
    data.screens.forEach((s, index) => {
      const folder = `${String(index + 1).padStart(2, "0")}-${s.screen.name.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 70)}`;
      files[`${folder}/gene-results.csv`] = strToU8(csvTable({ name: s.screen.name, columns: request.fields, rows: s.genes }));
      for (const table of evidence) files[`${folder}/${table.name.toLowerCase().replace(/ /g, "-")}.csv`] = strToU8(csvTable({ ...table, rows: table.rows.filter(row => row.screen_id === s.screen.id) }));
    });
    files["manifest.json"] = strToU8(JSON.stringify({ ...data, screens: data.screens.map(({ genes, qc, guides, disagreement, provenance, ...metadata }) => {
      void genes; void qc; void guides; void disagreement; void provenance; return metadata;
    }) }, null, 2) + "\n");
    files["data-dictionary.csv"] = strToU8(csvTable({ name: "Dictionary", columns: ["field", "label", "description"], rows: data.dictionary }));
    return { filename, contentType: "application/zip", bytes: zipSync(files, { level: 6 }) };
  }
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "SplicR";
  workbook.created = new Date(data.exported_at);
  workbook.title = "SplicR screen results";
  const used = new Set<string>();
  const overview: Table = { name: "Screens", columns: ["screen", "results_sheet", "cell_line", "phenotype", "qc", "run_id", "recorded_gene_rows", "exported_gene_rows", "screen_id", "source_ref"], rows: [] };
  const reserved = new Set(["screens", "data dictionary", "export record", ...evidence.map(table => table.name.toLowerCase())]);
  const resultTables = data.screens.map(s => ({ name: uniqueSheetName(s.screen.name, reserved), columns: request.fields, rows: s.genes }));
  for (const [index, s] of data.screens.entries()) {
    const name = resultTables[index].name;
    overview.rows.push({ screen: s.screen.name, results_sheet: name, cell_line: s.screen.cell_line, phenotype: s.screen.phenotype, qc: s.screen.qc,
      run_id: s.run_id, recorded_gene_rows: s.recorded_gene_rows, exported_gene_rows: s.exported_gene_rows, screen_id: s.screen.id, source_ref: s.screen.source_ref ?? null });
  }
  addTable(workbook, overview, used);
  for (const table of resultTables) addTable(workbook, table, used, true);
  for (const table of evidence) addTable(workbook, table, used);
  addTable(workbook, { name: "Data dictionary", columns: ["field", "label", "description"], rows: data.dictionary }, used);
  addTable(workbook, { name: "Export record", columns: ["field", "value"], rows: Object.entries(flatten({ schema: data.schema, exported_at: data.exported_at, source: data.source, selection: data.selection, notes: data.notes })).map(([field, value]) => ({ field, value })) }, used);
  return { filename, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes: new Uint8Array(await workbook.xlsx.writeBuffer()) };
}
