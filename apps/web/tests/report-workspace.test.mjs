/**
 * The workspace Hit Report export: the file builders, the reader behind them and
 * the route that serves them. A workspace file is the recorded run and nothing
 * else, it never carries a sample label, and the route never loads a sample
 * builder for a signed-in member.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { loadTs } from "./helpers/load-ts.mjs";

const ORG = "00000000-0000-4000-8000-0000000000aa";
const USER = "00000000-0000-4000-8000-0000000000c1";
const SCREEN = "00000000-0000-4000-8000-000000000001";
const RUN = "00000000-0000-4000-8000-000000000003";
const CMP = "00000000-0000-4000-8000-0000000000cc";

const screen = {
  id: SCREEN, name: "RSL3 screen", description: null, cell_line: "A375", modality: "knockout",
  phenotype: "ferroptosis", status: "complete", qc: "pass", current_run_id: RUN, taxid: 9606,
};
const run = { id: RUN, status: "complete", engine_version: "splicr 0.1.0", image_digest: "sha256:abc", created_at: "2026-09-27T00:00:00Z", error: null };
const comparison = { id: CMP, name: "RSL3 vs DMSO", kind: "treatment", is_primary: true };

const hit = (over = {}) => ({
  id: "h1", comparison_id: CMP, gene_symbol: "GPX4", direction: "depleted", lfc: -2.4, p_value: 1.2e-24, fdr: 3.4e-20,
  bayes_factor: null, n_guides: 4, n_good_guides: 4, cn_corrected: false, chance_real: null, novelty: null, verdict: null,
  reason: null, model_version: null, atlas_hit_count: null, atlas_screen_count: null, atlas_hit_rate: null, hit_flags: [], ...over,
});

const data = (over = {}) => ({ screen, run, comparisons: [comparison], hits: [hit()], truncated: false, ...over });
const NOW = new Date("2026-09-29T12:00:00Z");
const builders = loadTs("lib/report/workspace.ts");

const parseCsv = (csv) => {
  const lines = csv.replace(/^﻿/, "").trimEnd().split("\r\n");
  const header = lines.findIndex((line) => line.startsWith("screen_id,"));
  const columns = lines[header].split(",");
  return { preamble: lines.slice(0, header), columns, rows: lines.slice(header + 1).map((line) => line.split(",")) };
};
const col = (parsed, name, row = 0) => parsed.rows[row][parsed.columns.indexOf(name)];

test("the CSV is the recorded run: full precision, blanks stay blank, zero stays zero", () => {
  const csv = builders.workspaceCsv(
    data({ hits: [hit({ p_value: 1.2e-24, fdr: 0, lfc: 0, bayes_factor: null }), hit({ id: "h2", gene_symbol: "TP53", p_value: null, fdr: null, lfc: null })] }),
    NOW,
  );
  const parsed = parseCsv(csv);
  assert.equal(col(parsed, "p_value", 0), "1.2e-24", "a tiny p-value keeps its exponent");
  assert.equal(col(parsed, "fdr", 0), "0", "a measured zero is zero");
  assert.equal(col(parsed, "log2_fold_change", 0), "0");
  assert.equal(col(parsed, "bayes_factor", 0), "", "an unrecorded value is blank, not zero");
  assert.equal(col(parsed, "p_value", 1), "");
  assert.equal(col(parsed, "fdr", 1), "");
  assert.equal(col(parsed, "log2_fold_change", 1), "");
});

test("the file says what it is and what it is not, and carries no sample label", () => {
  const csv = builders.workspaceCsv(data(), NOW);
  assert.ok(csv.startsWith("﻿# SplicR hit report"));
  const head = parseCsv(csv).preamble.join("\n");
  assert.match(head, /data_source: SplicR workspace/);
  assert.match(head, /engine splicr 0\.1\.0; container sha256:abc/);
  assert.match(head, /recorded_model_score: a stored, uncalibrated model output\. It is not a validation probability/);
  assert.match(head, /Blank means not recorded, which is not zero/);
  assert.match(head, /screen: 00000000-0000-4000-8000-000000000001, RSL3 screen/);
  assert.doesNotMatch(csv, /SAMPLE|sample data|invented/i);
});

test("flags, concordance and the stored score are written for what they are", () => {
  const parsed = parseCsv(builders.workspaceCsv(
    data({ hits: [hit({ n_guides: 4, n_good_guides: 3, chance_real: 0.91, model_version: "v1", hit_flags: [{ flag: "copy_number", severity: "warn", message: "Amplified region" }, { flag: "single_guide", severity: "info", message: "One guide" }] })] }),
    NOW,
  ));
  assert.equal(col(parsed, "guide_concordance"), "0.75");
  assert.equal(col(parsed, "artifact_flags"), '"copy_number:warn; single_guide:info"');
  assert.equal(col(parsed, "recorded_model_score"), "0.91");
  assert.equal(col(parsed, "model_version"), '"v1"');
  assert.ok(parsed.columns.includes("recorded_model_score"));
  assert.ok(!parsed.columns.includes("validation_probability"));
  const none = builders.guideConcordance({ n_guides: 0, n_good_guides: 0 });
  assert.equal(none, null, "no guides is not a concordance of zero");
  assert.equal(builders.guideConcordance({ n_guides: null, n_good_guides: 2 }), null);
});

test("free text cannot run a formula, quotes are doubled and date-like symbols are named", () => {
  const csv = builders.workspaceCsv(
    data({ hits: [hit({ gene_symbol: "MARCH1", reason: '=HYPERLINK("http://x")', model_version: '+cmd' }), hit({ id: "h2", gene_symbol: "SEPT9" })] }),
    NOW,
  );
  assert.match(csv, /"'=HYPERLINK\(""http:\/\/x""\)"/);
  assert.match(csv, /"'\+cmd"/);
  assert.match(csv, /# excel_warning: 2 gene symbol\(s\).*MARCH1, SEPT9/);
  assert.match(builders.workspaceCsv(data(), NOW), /# excel_note: no gene symbol/);
});

test("a run with no rows is a file that says so, and a truncated run says it stopped", () => {
  const none = builders.workspaceCsv(data({ hits: [] }), NOW);
  assert.equal(parseCsv(none).rows.length, 0);
  assert.match(none, /rows: 0 gene and comparison records/);
  const cut = builders.workspaceCsv(data({ truncated: true }), NOW);
  assert.match(cut, /STOPPED AT THE ROW LIMIT/);
  const noRun = builders.workspaceCsv(data({ run: null, hits: [] }), NOW);
  assert.match(noRun, /run: none recorded, so this file has no hit rows\. That does not establish that the experiment had no hits/);
});

test("the JSON keeps precision, nulls, and says the score is not a probability", () => {
  const doc = JSON.parse(builders.workspaceJson(data({ hits: [hit({ fdr: 1e-30, p_value: Number.NaN, lfc: Infinity, chance_real: 0.5 })] }), NOW));
  assert.equal(doc.schema, "splicr.workspace-hit-report/1");
  assert.equal(doc.sample_data, false);
  assert.equal(doc.data_source, "workspace");
  assert.equal(doc.validation_probability, null);
  assert.equal(doc.score_uncertainty_interval, null);
  assert.equal(doc.score_interpretation, "stored_uncalibrated_model_output");
  assert.equal(doc.hits[0].fdr, 1e-30);
  assert.equal(doc.hits[0].p_value, null, "a nonfinite value is invalid and is not written as a number");
  assert.equal(doc.hits[0].lfc, null);
  assert.equal(doc.hits[0].recorded_model_score, 0.5);
  assert.equal(doc.hits[0].comparison, "RSL3 vs DMSO");
  assert.equal(doc.run.container_digest, "sha256:abc");
  assert.equal(doc.rows.count, 1);
  assert.deepEqual(JSON.parse(builders.workspaceJson(data({ run: null, hits: [] }), NOW)).run, null);
});

test("filenames name the screen and the day", () => {
  assert.equal(builders.workspaceFilename(data(), "csv", NOW), `splicr-hit-report_${SCREEN}_2026-09-29.csv`);
  assert.doesNotMatch(builders.workspaceFilename(data(), "json", NOW), /SAMPLE/);
});

// ---------------------------------------------------------------------------
// The reader
// ---------------------------------------------------------------------------

function makeClient(handler) {
  const queries = [];
  const client = { from(table) {
    const q = { table, filters: [], orders: [], range: null };
    queries.push(q);
    const chain = new Proxy({}, { get(_, method) {
      if (method === "then") return (resolve, reject) => Promise.resolve(handler(q)).then(resolve, reject);
      if (method === "maybeSingle" || method === "single") return () => Promise.resolve(handler(q));
      return (...args) => {
        if (method === "eq") q.filters.push([args[0], args[1]]);
        else if (method === "range") q.range = args;
        else if (method === "order") q.orders.push(args);
        return chain;
      };
    } });
    return chain;
  } };
  return { client, queries };
}

function reader({ context, handler }) {
  const { client, queries } = makeClient(handler);
  const mod = loadTs("lib/data/screen-report.ts", {
    mocks: {
      "server-only": {},
      "@/lib/data/org": { getCurrentContext: async () => context },
      "@/lib/supabase/server": { createClient: async () => client },
    },
  });
  return { ...mod, queries };
}

const member = { isDemo: false, user: { id: USER }, org: { id: ORG } };
const answer = () => (q) => {
  if (q.table === "screens") return { data: screen, error: null };
  if (q.table === "runs") return { data: run, error: null };
  if (q.table === "comparisons") return { data: [comparison], error: null };
  if (q.table === "hits") return { data: [hit()], error: null };
  return { data: null, error: null };
};

test("the reader is scoped to the session's organization and the screen's current run", async () => {
  const app = reader({ context: member, handler: answer() });
  const result = await app.getScreenReportData(SCREEN);
  assert.equal(result.status, "found");
  assert.deepEqual(app.queries.find((q) => q.table === "screens").filters, [["id", SCREEN], ["org_id", ORG]]);
  assert.deepEqual(app.queries.find((q) => q.table === "runs").filters, [["screen_id", SCREEN], ["org_id", ORG], ["id", RUN]]);
  assert.deepEqual(app.queries.find((q) => q.table === "hits").filters, [["screen_id", SCREEN], ["run_id", RUN]]);
});

test("the reader refuses demo, signed-out and malformed requests before any query", async () => {
  for (const context of [{ isDemo: true, user: null, org: null }, { isDemo: false, user: null, org: null }, { isDemo: false, user: { id: USER }, org: null }]) {
    const app = reader({ context, handler: answer() });
    assert.equal((await app.getScreenReportData(SCREEN)).status, "workspace_required");
    assert.equal(app.queries.length, 0);
  }
  const app = reader({ context: member, handler: answer() });
  assert.equal((await app.getScreenReportData("not-a-uuid")).status, "not_found");
  assert.equal(app.queries.length, 0);
});

test("another workspace's screen is not found, and a failed read is unavailable, never empty", async () => {
  const missing = reader({ context: member, handler: (q) => (q.table === "screens" ? { data: null, error: null } : answer()(q)) });
  assert.equal((await missing.getScreenReportData(SCREEN)).status, "not_found");
  assert.equal(missing.queries.some((q) => q.table === "hits"), false);
  for (const failing of ["runs", "comparisons", "hits"]) {
    const app = reader({ context: member, handler: (q) => (q.table === failing ? { data: null, error: { code: "42501", message: "secret" } } : answer()(q)) });
    const result = await app.getScreenReportData(SCREEN);
    assert.equal(result.status, "unavailable", failing);
    assert.equal(JSON.stringify(result).includes("secret"), false);
  }
  const dangling = reader({ context: member, handler: (q) => (q.table === "runs" ? { data: null, error: null } : answer()(q)) });
  assert.equal((await dangling.getScreenReportData(SCREEN)).status, "unavailable");
});

test("a screen that has never been run exports an explicit empty run, not an error", async () => {
  const app = reader({ context: member, handler: (q) => (q.table === "screens" ? { data: { ...screen, current_run_id: null }, error: null } : q.table === "runs" ? { data: null, error: null } : answer()(q)) });
  const result = await app.getScreenReportData(SCREEN);
  assert.equal(result.status, "found");
  assert.equal(result.data.run, null);
  assert.equal(result.data.hits.length, 0);
});

test("a big run is read in chunks of a thousand and stops at the cap, saying so", async () => {
  let served = 0;
  const big = reader({
    context: member,
    handler: (q) => {
      if (q.table !== "hits") return answer()(q);
      const [from, to] = q.range;
      const rows = Array.from({ length: to - from + 1 }, (_, i) => hit({ id: `h${from + i}` }));
      served += rows.length;
      return { data: rows, error: null };
    },
  });
  const result = await big.getScreenReportData(SCREEN);
  assert.equal(result.data.truncated, true);
  assert.equal(result.data.hits.length, big.REPORT_ROW_CAP);
  assert.ok(served >= big.REPORT_ROW_CAP && served <= big.REPORT_ROW_CAP + 1000);
  const ranges = big.queries.filter((q) => q.table === "hits").map((q) => q.range);
  assert.deepEqual(ranges.slice(0, 2), [[0, 999], [1000, 1999]]);

  const exact = reader({ context: member, handler: (q) => (q.table === "hits" ? { data: [hit(), hit({ id: "h2" })], error: null } : answer()(q)) });
  const small = await exact.getScreenReportData(SCREEN);
  assert.equal(small.data.truncated, false);
  assert.equal(small.data.hits.length, 2);
  assert.equal(exact.queries.filter((q) => q.table === "hits").length, 1, "a short first chunk ends the read");
});

// ---------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------

class R extends Response {
  static json(body, init = {}) {
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json");
    return new R(JSON.stringify(body), { ...init, headers });
  }
}

function routeHarness({ context, result }) {
  const loaded = [];
  const track = (name, value) => ({ get [name]() { loaded.push(name); return value; } });
  const mocks = {
    "server-only": {},
    "next/server": { NextResponse: R },
    "@/lib/data/org": { getCurrentContext: async () => context },
    "@/lib/data/screen-report": { getScreenReportData: async () => result },
  };
  for (const name of ["@/lib/mock/data", "@/lib/report/document", "@/lib/report/csv", "@/lib/report/json", "@/lib/report/pdf"]) {
    Object.defineProperty(mocks, name, { get() { loaded.push(name); return {}; }, enumerable: true });
  }
  void track;
  const mod = loadTs("app/api/report/[id]/route.ts", { mocks });
  return {
    loaded,
    get: (format, id = SCREEN) => mod.GET(new Request(`https://x.test/api/report/${id}${format === undefined ? "" : `?format=${format}`}`), { params: Promise.resolve({ id }) }),
  };
}

const signedIn = { isDemo: false, user: { id: USER } };

test("a member gets their recorded run as CSV and JSON, with honest headers", async () => {
  const app = routeHarness({ context: signedIn, result: { status: "found", data: data() } });
  const csv = await app.get("csv");
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-type"), /text\/csv/);
  assert.match(csv.headers.get("content-disposition"), new RegExp(`filename="splicr-hit-report_${SCREEN}_\\d{4}-\\d{2}-\\d{2}\\.csv"`));
  assert.equal(csv.headers.get("x-splicr-data-source"), "workspace");
  assert.equal(csv.headers.get("cache-control"), "no-store");
  const bytes = new Uint8Array(await csv.clone().arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.match(await csv.text(), /GPX4/);

  const json = await app.get("json");
  assert.equal(json.status, 200);
  assert.match(json.headers.get("content-disposition"), /\.json"/);
  assert.equal((await json.json()).sample_data, false);
  assert.deepEqual(app.loaded, [], "no sample builder was loaded for a member");
});

test("a truncated export says so in a header as well as in the file", async () => {
  const app = routeHarness({ context: signedIn, result: { status: "found", data: data({ truncated: true }) } });
  assert.equal((await app.get("csv")).headers.get("x-splicr-truncated"), "true");
});

test("PDF is not built for workspace runs, and the route says so instead of serving a sample", async () => {
  const app = routeHarness({ context: signedIn, result: { status: "found", data: data() } });
  const response = await app.get("pdf");
  assert.equal(response.status, 501);
  assert.equal((await response.json()).error.code, "workspace_pdf_unavailable");
  assert.deepEqual(app.loaded, []);
});

test("every failure has its own status: bad format, unknown screen, unavailable, not run, no workspace", async () => {
  const cases = [
    [undefined, { status: "found", data: data() }, 400],
    ["xml", { status: "found", data: data() }, 400],
    ["csv", { status: "not_found" }, 404],
    ["csv", { status: "unavailable" }, 503],
    ["csv", { status: "workspace_required" }, 403],
    ["csv", { status: "found", data: data({ run: null, hits: [] }) }, 409],
  ];
  for (const [format, result, status] of cases) {
    const app = routeHarness({ context: signedIn, result });
    const response = await app.get(format);
    assert.equal(response.status, status, `${format} ${result.status}`);
    assert.equal(response.headers.get("x-splicr-data-source"), null);
    assert.deepEqual(app.loaded, []);
  }
});

test("a signed-out request is refused before the reader is consulted", async () => {
  const app = routeHarness({ context: { isDemo: false, user: null }, result: { status: "found", data: data() } });
  for (const format of ["csv", "json", "pdf"]) assert.equal((await app.get(format)).status, 401);
});
