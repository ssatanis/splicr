import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import ExcelJS from "exceljs";
import { unzipSync, strFromU8 } from "fflate";
import { loadTs } from "./helpers/load-ts.mjs";

const { serializeScreensExport, prepareExport, uniqueSheetName, csvTable } = loadTs("lib/report/screens-export.ts");
const { exportRequestSchema, EXPORT_FIELDS } = loadTs("lib/report/export-options.ts");
const ID = "00000000-0000-4000-8000-000000000001";
const CMP = "00000000-0000-4000-8000-000000000002";
const RUN = "00000000-0000-4000-8000-000000000003";
const hit = over => ({ id: "h", comparison_id: CMP, gene_symbol: "SEPT1", direction: "depleted", lfc: -1, p_value: 1.2e-30,
  fdr: 0, drugz_fdr: 0.1, depleted_fdr: 0.3, n_guides: 4, cn_corrected: false, hit_flags: [], ...over });
const screen = over => ({ screen: { id: ID, name: "Screen A", cell_line: "D39", phenotype: "growth", qc: "fail", source_ref: "can-24-0775", status: "complete" },
  run: { id: RUN, status: "complete", settings: { caller: "mageck", normalize: true }, started_at: "2026-10-05T00:00:00Z" },
  comparisons: [{ id: CMP, name: "Day 4 vs Day 39", kind: "treatment_vs_control" }], hits: [hit()], truncated: false,
  qcEvidence: { verdict: "fail", nnmd: 0, notes: "Recorded warning", metrics: { samples: [{ label: "r1", mapping_rate: 0.75 }] } },
  guides: [{ guide_key: "g1", comparison_id: CMP, gene_symbol: "SEPT1", sequence: "AACTG", lfc: -1, reference_versions: { mane: "1.4" } }],
  disagreement: [{ comparison_id: CMP, gene_symbol: "SEPT1", fragile: true, report: { confound: "one guide" } }], stages: [{ stage: "call", duration_sec: 0, status: "done" }], ...over });
const request = over => ({ screenIds: [ID], format: "json", fields: ["gene_symbol", "comparison", "lfc", "p_value", "fdr", "cn_corrected"],
  sections: ["qc", "guides", "disagreement", "provenance"], rowScope: "all", fdrMetric: "fdr", fdrThreshold: 0.1, ...over });
const now = "2026-10-05T12:00:00Z";

test("request contract rejects duplicates, arbitrary columns, missing identity and invalid filters", () => {
  assert.equal(exportRequestSchema.safeParse(request()).success, true);
  for (const change of [{ screenIds: [] }, { screenIds: [ID, ID] }, { screenIds: ["not-id"] }, { fields: ["gene_symbol", "password"] },
    { fields: ["gene_symbol", "lfc"] }, { fields: ["gene_symbol", "comparison", "comparison"] }, { sections: ["qc", "qc"] },
    { fdrThreshold: -1 }, { fdrThreshold: 1.1 }, { fdrThreshold: NaN }, { format: "pdf" }, { extra: true }]) {
    assert.equal(exportRequestSchema.safeParse(request(change)).success, false, JSON.stringify(change));
  }
});

test("JSON contains only the selected gene columns and evidence, preserves null, zero and precision", async () => {
  const output = await serializeScreensExport([screen({ hits: [hit({ lfc: 0 }), hit({ gene_symbol: "MARCH1", fdr: null })] })], request({ sections: [] }), now);
  const data = JSON.parse(strFromU8(output.bytes));
  assert.equal(data.screens[0].genes[0].p_value, 1.2e-30);
  assert.equal(data.screens[0].genes[0].fdr, 0);
  assert.equal(data.screens[0].genes[0].lfc, 0);
  assert.equal(data.screens[0].genes[0].cn_corrected, false);
  assert.equal(data.screens[0].genes[1].fdr, null);
  assert.deepEqual(Object.keys(data.screens[0].genes[0]), request().fields);
  for (const key of ["qc", "guides", "disagreement", "provenance"]) assert.equal(Object.hasOwn(data.screens[0], key), false);
  assert.equal(data.screens[0].screen.qc, "fail");
  assert.equal(data.screens[0].run_id, RUN);
});

for (const metric of ["fdr", "depleted_fdr", "enriched_fdr", "drugz_fdr", "mle_fdr"]) {
  test(`inclusive filtering uses ${metric} and aligns guide evidence by gene AND comparison`, () => {
    const input = screen({ hits: [hit({ [metric]: 0.1 }), hit({ gene_symbol: "NO", [metric]: null }), hit({ gene_symbol: "OTHER", [metric]: 0.10001 })],
      guides: [{ comparison_id: CMP, gene_symbol: "SEPT1" }, { comparison_id: "other", gene_symbol: "SEPT1" }, { comparison_id: CMP, gene_symbol: "NO" }] });
    const data = prepareExport([input], request({ rowScope: "fdr", fdrMetric: metric }), now);
    assert.equal(data.screens[0].genes.length, 1);
    assert.equal(data.screens[0].guides.length, 1);
    assert.equal(data.screens[0].disagreement.length, 1);
    assert.equal(data.screens[0].recorded_gene_rows, 3);
  });
}

test("Excel roundtrip preserves researcher IDs as text, exact numbers, evidence and restrained formatting", async () => {
  const output = await serializeScreensExport([screen()], request({ format: "xlsx" }), now);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(output.bytes);
  assert.deepEqual(workbook.worksheets.map(s => s.name), ["Screens", "Screen A", "Quality control", "Guide results", "Guide disagreement", "Run provenance", "Data dictionary", "Export record"]);
  const sheet = workbook.getWorksheet("Screen A");
  assert.equal(sheet.getCell("A2").value, "SEPT1");
  assert.equal(sheet.getCell("A2").type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell("D2").value, 1.2e-30);
  assert.equal(sheet.getCell("E2").value, 0);
  assert.equal(sheet.getCell("F2").value, false);
  assert.equal(sheet.getCell("A2").font.name, "Arial");
  assert.equal(sheet.getCell("A1").fill.fgColor.argb, "FFEDEFF1");
  assert.equal(sheet.views[0].state, "frozen");
  assert.equal(sheet.views[0].ySplit, 1);
  assert.ok(sheet.autoFilter);
  const qc = workbook.getWorksheet("Quality control");
  assert.ok(qc.getColumn(4).values.includes("metrics.samples.0.mapping_rate"));
  assert.ok(workbook.getWorksheet("Run provenance").getColumn(4).values.includes("run.settings.caller"));
});

test("Excel handles empty results and duplicate, reserved, invalid and long screen names", async () => {
  const names = ["Screens", "history", "A/B:*?[]", "same", "SAME", "x".repeat(80), "'tail'", "", "data dictionary"];
  const inputs = names.map((name, i) => screen({ screen: { ...screen().screen, id: `id${i}`, name }, hits: [] }));
  const output = await serializeScreensExport(inputs, request({ format: "xlsx", sections: [] }), now);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(output.bytes);
  const sheets = workbook.worksheets.map(s => s.name);
  assert.equal(new Set(sheets.map(s => s.toLowerCase())).size, sheets.length);
  assert.ok(sheets.every(s => s.length <= 31 && !/[\[\]:*?/\\]/.test(s)));
  assert.equal(workbook.getWorksheet("Screens").rowCount, names.length + 1);
  assert.equal(workbook.worksheets[1].rowCount, 1);
});

test("CSV ZIP contains one folder per screen and only selected tables/columns", async () => {
  const inputs = [screen(), screen({ screen: { ...screen().screen, id: "second", name: "Screen A" } })];
  const output = await serializeScreensExport(inputs, request({ format: "csv", sections: ["guides"], fields: ["gene_symbol", "comparison", "lfc"] }), now);
  const files = unzipSync(output.bytes);
  assert.equal(Object.keys(files).length, 10);
  assert.match(strFromU8(files["01-Screen-A/gene-results.csv"]), /^gene_symbol,comparison,lfc\r\nSEPT1,Day 4 vs Day 39,-1\r\n$/);
  assert.ok(files["02-Screen-A/gene-results.csv"]);
  assert.equal(Object.keys(files).some(f => /quality|provenance|disagreement/.test(f)), false);
  assert.equal(JSON.parse(strFromU8(files["manifest.json"])).screens[0].recorded_gene_rows, 1);
});

test("CSV bundle inventory matches every payload byte and individual metadata preserves run identity", async () => {
  const output = await serializeScreensExport([screen()], request({ format: "csv" }), now);
  const files = unzipSync(output.bytes);
  const manifest = JSON.parse(strFromU8(files["manifest.json"]));
  assert.deepEqual(manifest.files.map(file => file.path).sort(), Object.keys(files).filter(path => path !== "manifest.json").sort());
  for (const file of manifest.files) {
    assert.equal(file.byte_length, files[file.path].length);
    assert.equal(file.sha256, createHash("sha256").update(files[file.path]).digest("hex"));
  }
  const metadata = JSON.parse(strFromU8(files["01-Screen-A/screen.json"]));
  assert.equal(metadata.run_id, RUN);
  assert.equal(metadata.comparisons[0].id, CMP);
  const settings = JSON.parse(strFromU8(files["01-Screen-A/analysis-settings.json"]));
  assert.equal(settings.run_id, RUN);
  assert.deepEqual(settings.settings, screen().run.settings);
  assert.equal(settings.container_digest, null);
  assert.match(strFromU8(files["README.md"]), /not a validation probability/);
});

test("standalone Python verifier detects modified, missing and escaping paths without SplicR", async () => {
  const output = await serializeScreensExport([screen()], request({ format: "csv", sections: [] }), now);
  const files = unzipSync(output.bytes);
  const root = mkdtempSync(join(tmpdir(), "splicr-bundle-"));
  try {
    for (const [path, bytes] of Object.entries(files)) {
      const dest = join(root, path); mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, bytes);
    }
    const verify = () => spawnSync("python3", [join(root, "verify-bundle.py")], { encoding: "utf8" });
    assert.equal(verify().status, 0);
    const target = "01-Screen-A/gene-results.csv";
    writeFileSync(join(root, target), "changed");
    assert.match(verify().stderr, /Changed file/);
    rmSync(join(root, target));
    assert.match(verify().stderr, /Missing or unsafe file/);
    writeFileSync(join(root, target), files[target]);
    const manifest = JSON.parse(strFromU8(files["manifest.json"]));
    manifest.files.push({ path: "../outside.csv", byte_length: 0, sha256: "x" });
    writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest));
    assert.match(verify().stderr, /Invalid or duplicate inventory path/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("settings files respect provenance selection and preserve unknown rather than invent defaults", async () => {
  const missing = screen({ run: { ...screen().run, settings: null } });
  const selected = unzipSync((await serializeScreensExport([missing], request({ format: "csv", sections: ["provenance"] }), now)).bytes);
  assert.equal(JSON.parse(strFromU8(selected["01-Screen-A/analysis-settings.json"])).settings, null);
  const omitted = unzipSync((await serializeScreensExport([missing], request({ format: "csv", sections: [] }), now)).bytes);
  assert.equal(Object.hasOwn(omitted, "01-Screen-A/analysis-settings.json"), false);
});

test("spreadsheet formulas remain safe, while JSON and Excel preserve original text", async () => {
  const dangerous = '=HYPERLINK("https://example.test","x")';
  const output = await serializeScreensExport([screen({ hits: [hit({ gene_symbol: dangerous })] })], request({ format: "xlsx", sections: [] }), now);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(output.bytes);
  assert.equal(workbook.getWorksheet("Screen A").getCell("A2").value, dangerous);
  assert.equal(workbook.getWorksheet("Screen A").getCell("A2").type, ExcelJS.ValueType.String);
  const csv = csvTable({ name: "test", columns: ["text", "number"], rows: [{ text: dangerous, number: -2 }, { text: "  +formula", number: 0 }, { text: 'comma,quote"\nnewline', number: null }] });
  assert.match(csv, /"'=HYPERLINK/);
  assert.match(csv, /,-2\r\n/);
  assert.match(csv, /'  \+formula,0/);
  assert.match(csv, /"comma,quote""\nnewline",/);
});

test("all column and evidence choices survive every format without recomputing model outputs", async () => {
  for (const format of ["json", "csv", "xlsx"]) for (const sections of [[], ["qc"], ["guides"], ["disagreement"], ["provenance"], request().sections]) {
    const output = await serializeScreensExport([screen({ hits: [hit({ chance_real: 0.71, model_version: "stored", reason: "Recorded text", hit_flags: [{ flag: "frequent_hitter", severity: "warn", message: "Recorded Atlas evidence" }] })] })], request({ format, sections, fields: EXPORT_FIELDS.map(f => f.key) }), now);
    assert.ok(output.bytes.length > 100);
    assert.equal(prepareExport([screen()], request({ format, sections, fields: EXPORT_FIELDS.map(f => f.key) }), now).dictionary.length, EXPORT_FIELDS.length);
  }
});

test("large exports contain every row beyond the database page size", async () => {
  const hits = Array.from({ length: 2501 }, (_, i) => hit({ id: `h${i}`, gene_symbol: `G${i}` }));
  for (const format of ["json", "csv", "xlsx"]) {
    const output = await serializeScreensExport([screen({ hits })], request({ format, sections: [] }), now);
    if (format === "json") assert.equal(JSON.parse(strFromU8(output.bytes)).screens[0].genes.length, 2501);
    if (format === "csv") assert.equal(strFromU8(unzipSync(output.bytes)["01-Screen-A/gene-results.csv"]).trimEnd().split("\r\n").length, 2502);
    if (format === "xlsx") { const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(output.bytes); assert.equal(workbook.getWorksheet("Screen A").rowCount, 2502); }
  }
});

test("Excel refuses unsupported long text rather than silently truncating evidence", async () => {
  await assert.rejects(serializeScreensExport([screen({ hits: [hit({ reason: "x".repeat(32768) })] })], request({ format: "xlsx", fields: ["gene_symbol", "comparison", "reason"], sections: [] }), now), /no data was truncated/);
  const used = new Set(); assert.notEqual(uniqueSheetName("ABC", used), uniqueSheetName("abc", used));
});

function loader({ context = { user: { id: "user" }, org: { id: "org" } }, result = { status: "found", data: screen() }, failTable, evidence = [] } = {}) {
  const calls = [];
  const client = { from(table) { const call = { table, filters: {}, range: null }; calls.push(call);
    const query = { select() { return this; }, eq(k, v) { call.filters[k] = v; return this; }, order() { return this; },
      range(a, b) { call.range = [a, b]; return Promise.resolve({ data: evidence.slice(a, b + 1), error: table === failTable ? { code: "failure" } : null }); },
      maybeSingle() { return Promise.resolve({ data: table === "run_qc" ? screen().qcEvidence : null, error: table === failTable ? { code: "failure" } : null }); },
      then(resolve) { return Promise.resolve({ data: [], error: table === failTable ? { code: "failure" } : null }).then(resolve); } };
    return query;
  } };
  const loaded = loadTs("lib/data/screens-export.ts", { mocks: { "server-only": {}, "@/lib/data/org": { getCurrentContext: async () => context },
    "@/lib/supabase/server": { createClient: async () => client }, "./screen-report": { getScreenReportData: async () => result } } });
  return { ...loaded, calls };
}
test("loader requires workspace authentication and refuses unknown, incomplete and truncated records", async () => {
  const anonymous = loader({ context: { user: null, org: null } });
  await assert.rejects(anonymous.getScreensExport(request()), error => error.status === 401);
  assert.equal(anonymous.calls.length, 0);
  for (const [result, status] of [[{ status: "not_found" }, 404], [{ status: "unavailable" }, 503],
    [{ status: "found", data: screen({ run: null }) }, 409], [{ status: "found", data: screen({ run: { id: RUN, status: "running" } }) }, 409],
    [{ status: "found", data: screen({ truncated: true }) }, 413]]) {
    const mod = loader({ result }); await assert.rejects(mod.getScreensExport(request()), error => error.status === status);
    assert.equal(mod.calls.length, 0);
  }
});
test("loader pages optional evidence and scopes all guide reads to the captured screen and run", async () => {
  const mod = loader({ evidence: Array.from({ length: 1001 }, (_, i) => ({ guide_key: `g${i}` })) });
  const data = await mod.getScreensExport(request({ sections: ["guides"] }));
  assert.equal(data[0].guides.length, 1001);
  assert.deepEqual(mod.calls.map(c => c.range), [[0, 999], [1000, 1999]]);
  assert.ok(mod.calls.every(c => c.filters.screen_id === ID && c.filters.run_id === RUN));
});
test("selected evidence failure aborts; unselected evidence is not read", async () => {
  const mod = loader({ failTable: "guide_effects" });
  await assert.rejects(mod.getScreensExport(request({ sections: ["guides"] })), error => error.status === 503);
  const noEvidence = loader({ failTable: "guide_effects" });
  assert.equal((await noEvidence.getScreensExport(request({ sections: [] }))).length, 1);
  assert.equal(noEvidence.calls.length, 0);
});

test("route validates origin and input before loading and preserves safe download headers", async () => {
  let reads = 0;
  const { ExportError } = loader();
  const route = loadTs("app/api/screens/export/route.ts", { mocks: { "@/lib/data/screens-export": { ExportError, getScreensExport: async () => { reads++; return [screen()]; } } } });
  const send = (body, origin = "http://localhost:3000") => route.POST(new Request("http://localhost:3000/api/screens/export", { method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(body) }));
  assert.equal((await send(request(), "https://evil.test")).status, 403);
  assert.equal((await send({ ...request(), fields: ["org_secret"] })).status, 400);
  assert.equal(reads, 0);
  for (const format of ["xlsx", "csv", "json"]) {
    const response = await send(request({ format, sections: [] }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(response.headers.get("content-disposition"), /attachment; filename="SplicR-screens-/);
    assert.ok((await response.arrayBuffer()).byteLength > 100);
  }
});
