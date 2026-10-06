import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import XLSX from "xlsx";
import { strFromU8, unzipSync } from "fflate";

const dir = import.meta.dirname;
const jsonPath = path.join(dir, "SplicR-Dow-kinome-results.json");
const excelPath = path.join(dir, "SplicR-Dow-kinome-results.xlsx");
const csvPath = path.join(dir, "SplicR-Dow-kinome-results-csv.zip");
const data = JSON.parse(await fs.readFile(jsonPath, "utf8"));
const excel = new ExcelJS.Workbook(); await excel.xlsx.readFile(excelPath);
const files = unzipSync(await fs.readFile(csvPath));
const manifest = JSON.parse(strFromU8(files["manifest.json"]));
assert.deepEqual(data.selection, manifest.selection);
assert.equal(data.screens.length, 6);
assert.equal(excel.worksheets.length, 13);
const totals = { gene_rows: 0, guide_rows: 0, disagreement_rows: 0, checked_cells: 0 };
const scalar = value => value == null ? null : typeof value === "object" ? JSON.stringify(value) : value;
const flatten = (value, at = "", output = {}) => {
  if (value !== null && typeof value === "object" && Object.keys(value).length) {
    for (const [key, child] of Object.entries(value)) flatten(child, at ? `${at}.${key}` : key, output);
  } else output[at] = scalar(value);
  return output;
};
const csvSafe = value => typeof value === "string" && (/^\s*[=+\-@]/.test(value) || /^[\t\r\n]/.test(value)) ? `'${value}` : value;
function checkCsv(filename, expectedRows, columns) {
  assert.ok(files[filename], `Missing ${filename}`);
  const parsed = XLSX.read(strFromU8(files[filename]), { type: "string", raw: true });
  const rows = XLSX.utils.sheet_to_json(parsed.Sheets[parsed.SheetNames[0]], { header: 1, raw: true, defval: "" });
  assert.equal(rows.length, expectedRows.length + 1, `${filename}: row count`);
  assert.deepEqual(rows[0], columns, `${filename}: columns`);
  expectedRows.forEach((row, i) => columns.forEach((key, j) => {
    const expected = scalar(row[key]);
    assert.equal(String(rows[i + 1][j] ?? ""), expected == null ? "" : String(csvSafe(expected)), `${filename}/${i}/${key}`);
    totals.checked_cells++;
  }));
}
function checkExcel(sheet, rows, columns) {
  assert.equal(sheet.rowCount, rows.length + 1, `${sheet.name}: row count`);
  assert.equal(sheet.columnCount, columns.length, `${sheet.name}: column count`);
  rows.forEach((row, i) => columns.forEach((key, j) => {
    const expected = scalar(row[key]);
    assert.deepEqual(sheet.getCell(i + 2, j + 1).value ?? null, expected, `${sheet.name}!${i + 2}/${key}`);
    totals.checked_cells++;
  }));
  assert.equal(sheet.getCell("A1").font.name, "Arial");
  assert.equal(sheet.views[0].state, "frozen"); assert.ok(sheet.autoFilter);
}
const ids = s => ({ screen_id: s.screen.id, screen_name: s.screen.name, run_id: s.run_id });
const summary = [];
data.screens.forEach((screen, index) => {
  const sheet = excel.worksheets[index + 1];
  assert.equal(excel.getWorksheet("Screens").getCell(index + 2, 6).value, screen.run_id);
  assert.equal(excel.getWorksheet("Screens").getCell(index + 2, 5).value, screen.screen.qc);
  checkExcel(sheet, screen.genes, data.selection.fields);
  const folder = `${String(index + 1).padStart(2, "0")}-${screen.screen.name.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 70)}`;
  checkCsv(`${folder}/gene-results.csv`, screen.genes, data.selection.fields);
  for (const [key, name] of [["guides", "Guide results"], ["disagreement", "Guide disagreement"], ["qc", "Quality control"], ["provenance", "Run provenance"]]) {
    const rows = key === "guides" || key === "disagreement" ? screen[key].map(row => ({ ...ids(screen), ...row })) :
      Object.entries(flatten(screen[key])).map(([field, value]) => ({ ...ids(screen), field, value }));
    checkCsv(`${folder}/${name.toLowerCase().replaceAll(" ", "-")}.csv`, rows, excel.getWorksheet(name).getRow(1).values.slice(1));
  }
  totals.gene_rows += screen.genes.length;
  totals.guide_rows += screen.guides.length;
  totals.disagreement_rows += screen.disagreement.length;
  assert.equal(manifest.screens[index].run_id, screen.run_id);
  summary.push({ screen: screen.screen.name, screen_id: screen.screen.id, run_id: screen.run_id, qc: screen.screen.qc, genes: screen.genes.length, guides: screen.guides.length, disagreement: screen.disagreement.length });
});
for (const [key, name] of [["guides", "Guide results"], ["disagreement", "Guide disagreement"]]) {
  const sheet = excel.getWorksheet(name);
  const columns = sheet.getRow(1).values.slice(1);
  const rows = data.screens.flatMap(s => s[key].map(row => ({ ...ids(s), ...row })));
  checkExcel(sheet, rows, columns);
}
for (const [key, name] of [["qc", "Quality control"], ["provenance", "Run provenance"]]) {
  const rows = data.screens.flatMap(s => Object.entries(flatten(s[key])).map(([field, value]) => ({ ...ids(s), field, value })));
  checkExcel(excel.getWorksheet(name), rows, ["screen_id", "screen_name", "run_id", "field", "value"]);
}
const hashes = {};
for (const file of [jsonPath, excelPath, csvPath]) hashes[path.basename(file)] = createHash("sha256").update(await fs.readFile(file)).digest("hex");
const report = { verified_at: new Date().toISOString(), source: "All three files downloaded from SplicR's authenticated bulk export", schema: data.schema, selected_columns: data.selection.fields.length, selected_sections: data.selection.sections, totals, screens: summary, sha256: hashes, checks: ["Every gene, guide, disagreement, QC and provenance cell matches across Excel, JSON and CSV", "Six screen/run IDs and QC statuses agree", "All 13 workbook sheets present; Arial, frozen panes and filters verified"] };
await fs.writeFile(path.join(dir, "verification.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
