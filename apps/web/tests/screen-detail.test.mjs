/* Exercise the real server data loader with isolated session/database adapters.
 * This verifies application query boundaries, not deployed Supabase RLS policies.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const screenId = "00000000-0000-4000-8000-000000000001";
const orgId = "00000000-0000-4000-8000-000000000002";
const runId = "00000000-0000-4000-8000-000000000003";
const workspace = { isDemo: false, user: { id: "user" }, org: { id: orgId } };
const source = fs.readFileSync(path.join(import.meta.dirname, "../src/lib/data/screen-detail.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function harness({ context = workspace, responses = {} } = {}) {
  const queries = [];
  const client = { from(table) {
    const query = { table, filters: [], range: null };
    queries.push(query);
    const result = () => responses[table] ?? { data: [], error: null, count: 0 };
    const chain = {
      select() { return chain; },
      eq(field, value) { query.filters.push([field, value]); return chain; },
      order() { return chain; },
      limit() { return chain; },
      range(start, end) { query.range = [start, end]; return chain; },
      maybeSingle() { return Promise.resolve(result()); },
      then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
    };
    return chain;
  } };
  const exports = {};
  const requireAdapter = (name) => {
    if (name === "server-only") return {};
    if (name === "@/lib/data/org") return { getCurrentContext: async () => context };
    if (name === "@/lib/data/types") return { isUuid: (value) => typeof value === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) };
    if (name === "@/lib/supabase/server") return { createClient: async () => client };
    throw new Error(`Unexpected dependency ${name}`);
  };
  vm.runInNewContext(compiled, { exports, require: requireAdapter, console: { error() {} } });
  return { getScreenDetail: exports.getScreenDetail, queries };
}

const present = (extra = {}) => ({
  screens: { data: { id: screenId, current_run_id: runId, name: "Actual screen" }, error: null },
  runs: { data: { id: runId, status: "complete" }, error: null },
  ...extra,
});

test("anonymous and demo contexts never query workspace rows", async () => {
  for (const context of [{ isDemo: false, user: null, org: null }, { ...workspace, isDemo: true }]) {
    const app = harness({ context });
    assert.equal((await app.getScreenDetail(screenId)).status, "not_found");
    assert.equal(app.queries.length, 0);
  }
});

test("invalid identity and unbounded page input are rejected before reads", async () => {
  const app = harness();
  assert.equal((await app.getScreenDetail("scr_demo")).status, "not_found");
  for (const page of [0, -1, 1.5, NaN, Infinity, 10001]) {
    assert.equal((await app.getScreenDetail(screenId, page)).status, "not_found");
  }
  assert.equal(app.queries.length, 0);
});

test("an inaccessible screen cannot trigger hit reads or demo fallback", async () => {
  const app = harness({ responses: { screens: { data: null, error: null } } });
  assert.equal((await app.getScreenDetail(screenId)).status, "not_found");
  assert.equal(app.queries.length, 1);
  assert.deepEqual(app.queries[0].filters, [["id", screenId], ["org_id", orgId]]);
});

test("screen, run and hit queries retain session ownership and run identity", async () => {
  const hit = { id: "actual-hit", gene_symbol: "TP53", chance_real: null };
  const app = harness({ responses: present({ hits: { data: [hit], count: 201, error: null } }) });
  const result = await app.getScreenDetail(screenId, 2);
  assert.equal(result.status, "found");
  assert.equal(result.detail.hits[0], hit);
  assert.equal(result.detail.total, 201);
  assert.deepEqual(app.queries.find((q) => q.table === "runs").filters,
    [["screen_id", screenId], ["org_id", orgId], ["id", runId]]);
  const hits = app.queries.find((q) => q.table === "hits");
  assert.deepEqual(hits.filters, [["screen_id", screenId], ["run_id", runId]]);
  assert.deepEqual(hits.range, [100, 199]);
});

test("missing current run is unavailable, not an invented empty analysis", async () => {
  const app = harness({ responses: present({ runs: { data: null, error: null } }) });
  assert.equal((await app.getScreenDetail(screenId)).status, "unavailable");
  assert.equal(app.queries.length, 2);
});

test("a genuinely unrun screen has explicit empty evidence", async () => {
  const app = harness({ responses: {
    screens: { data: { id: screenId, current_run_id: null }, error: null },
    runs: { data: null, error: null },
  } });
  const result = await app.getScreenDetail(screenId);
  assert.equal(result.status, "found");
  assert.equal(result.detail.run, null);
  assert.equal(result.detail.hits.length, 0);
});

test("database errors return unavailable and never substitute sample rows", async () => {
  const app = harness({ responses: present({ hits: { data: null, error: { code: "42501" } } }) });
  const result = await app.getScreenDetail(screenId);
  assert.equal(result.status, "unavailable");
  assert.equal(result.detail, undefined);
});

// Render the actual server page to verify missing/scientific values stay truthful.
const React = await import("react");
const jsxRuntime = await import("react/jsx-runtime");
const { renderToStaticMarkup } = await import("react-dom/server");
const pageSource = fs.readFileSync(path.join(import.meta.dirname, "../src/app/dashboard/screens/[id]/page.tsx"), "utf8");
const pageCompiled = ts.transpileModule(pageSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function pageHarness({ context = workspace, result } = {}) {
  let sampleReads = 0;
  let workspaceReads = 0;
  const exports = {};
  const requireAdapter = (name) => {
    if (name === "react/jsx-runtime") return jsxRuntime;
    if (name === "next/link") return { default: ({ children, href }) => React.createElement("a", { href }, children) };
    if (name === "next/navigation") return { notFound() { throw new Error("NOT_FOUND"); } };
    if (name === "@/components/dashboard/ui") return {
      Card: ({ children, title, subtitle }) => React.createElement("section", null, title, subtitle, children),
      DenseTable: ({ children }) => React.createElement("table", null, children),
      PageHeader: ({ title, body }) => React.createElement("header", null, title, body),
    };
    if (name === "@/lib/data/org") return { getCurrentContext: async () => context };
    if (name === "@/lib/data/screen-detail") return { DETAIL_PAGE_SIZE: 100, getScreenDetail: async () => { workspaceReads++; return result; } };
    if (name === "@/components/dashboard/screen-workspace") return { ScreenWorkspace: () => React.createElement("p", null, "SAMPLE_VIEW") };
    if (name === "@/lib/mock/data") { sampleReads++; return { screens: [{ id: "scr_demo" }] }; }
    throw new Error(`Unexpected dependency ${name}`);
  };
  vm.runInNewContext(pageCompiled, { exports, require: requireAdapter });
  return {
    async render(id = screenId) {
      return renderToStaticMarkup(await exports.default({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
    },
    reads: () => ({ sampleReads, workspaceReads }),
  };
}

test("real page renders recorded FDR and null confidence without sample substitution", async () => {
  const app = pageHarness({ result: { status: "found", detail: {
    screen: { id: screenId, name: "Actual experiment", modality: "knockout", status: "complete", qc: "pass" },
    run: { id: runId, status: "complete", engine_version: "actual-engine-version" },
    stages: [], comparisons: [{ id: "cmp", name: "Drug vs vehicle" }], total: 1, page: 1,
    hits: [{ id: "h", comparison_id: "cmp", gene_symbol: "TP53", direction: "enriched", lfc: 0,
      fdr: 0.00001234, p_value: null, bayes_factor: null, n_guides: 4, n_good_guides: 0,
      chance_real: null, hit_flags: [], guide_lfcs: [0, 1, 2, 3] }],
  } } });
  const html = await app.render();
  assert.match(html, /Actual experiment/);
  assert.match(html, /1\.23e-5/);
  assert.match(html, /actual-engine-version/);
  assert.match(html, /Not recorded/);
  assert.doesNotMatch(html, /SAMPLE_VIEW|Recorded model output:/);
  assert.equal(app.reads().sampleReads, 0);
});

test("sample detail is accessible only through explicit demo session", async () => {
  const app = pageHarness({ context: { ...workspace, isDemo: true } });
  assert.match(await app.render("scr_demo"), /SAMPLE_VIEW/);
  assert.equal(app.reads().workspaceReads, 0);
  const signedIn = pageHarness({ result: { status: "not_found" } });
  await assert.rejects(() => signedIn.render("scr_demo"), /NOT_FOUND/);
  assert.equal(signedIn.reads().sampleReads, 0);
});

test("unavailable workspace page names the read failure and contains no sample values", async () => {
  const app = pageHarness({ result: { status: "unavailable" } });
  const html = await app.render();
  assert.match(html, /could not be read/);
  assert.doesNotMatch(html, /SAMPLE_VIEW|TP53|91%/);
  assert.equal(app.reads().sampleReads, 0);
});
