/** Actual route/loader execution using isolated adapters; no live database writes. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

const workspace = { isDemo: false, user: { id: "u" }, org: { id: "workspace-from-session" } };
const compile = (file) => ts.transpileModule(fs.readFileSync(path.join(import.meta.dirname, "../src", file), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const execute = (code, dependencies) => {
  const exports = {};
  vm.runInNewContext(code, { exports, require: dependencies, console: { error() {} } });
  return exports;
};
const listCode = compile("lib/data/workspace-lists.ts");

function listHarness(context = workspace, response = { data: [], count: 0, error: null }) {
  const reads = [];
  const client = { from(table) {
    const read = { table, filters: [], range: null };
    reads.push(read);
    const chain = {
      select() { return chain; }, order() { return chain; },
      eq(key, value) { read.filters.push([key, value]); return chain; },
      range(start, end) { read.range = [start, end]; return chain; },
      then(resolve, reject) { return Promise.resolve(response).then(resolve, reject); },
    };
    return chain;
  } };
  const exports = execute(listCode, (name) => {
    if (name === "server-only") return {};
    if (name === "@/lib/data/org") return {
      getCurrentContext: async () => context,
      getOrgSettings: async () => ({
        defaults: {
          modality: "knockout",
          library_slug: null,
          normalization: "median_ratio",
          hit_callers: ["mageck"],
          fdr_threshold: 0.05,
          cn_correction: true,
        },
        retention: { raw_reads_days: 30 },
      }),
    };
    if (name === "@/lib/supabase/server") return { createClient: async () => client };
    throw new Error(`Unexpected dependency ${name}`);
  });
  return { ...exports, reads };
}

for (const [method, table] of [["getWorkspaceScreens", "screens"]]) {
  test(`${method} uses session organization and bounded pagination`, async () => {
    const row = { id: "real-record" };
    const app = listHarness(workspace, { data: [row], count: 110, error: null });
    const result = await app[method](3);
    assert.equal(result.status, "ready");
    assert.equal(result.rows[0], row);
    assert.equal(result.total, 110);
    assert.equal(app.reads[0].table, table);
    assert.deepEqual(app.reads[0].filters, [["org_id", workspace.org.id]]);
    assert.deepEqual(app.reads[0].range, [100, 149]);
  });
  test(`${method} rejects expired session and invalid pages before queries`, async () => {
    for (const context of [{ ...workspace, user: null }, { ...workspace, org: null }]) {
      const app = listHarness(context);
      assert.equal((await app[method]()).status, "workspace_required");
      assert.equal(app.reads.length, 0);
    }
    const app = listHarness();
    assert.equal((await app[method](10001)).status, "invalid_page");
    assert.equal(app.reads.length, 0);
  });
  test(`${method} distinguishes empty evidence from a failed read`, async () => {
    assert.equal((await listHarness()[method]()).status, "ready");
    const failed = listHarness(workspace, { data: null, count: null, error: { code: "42501" } });
    assert.equal((await failed[method]()).status, "unavailable");
    const missing = listHarness(workspace, { data: [], count: null, error: null });
    assert.equal((await missing[method]()).status, "unavailable");
  });
}

// Atlas, Planner and Truth Loop are not here on purpose. The Atlas and the
// Planner read no workspace row and are the same for everyone, and the Truth
// Loop has its own page tests (truth-loop-page.test.mjs). What is left are the
// two routes that previously exposed sample records to a demo session.
const samples = new Set(["@/components/dashboard/screens-table"]);

function routeHarness(route, context = workspace, result = { status: "ready", rows: [], total: 0, page: 1 }) {
  let sampleReads = 0;
  let dataReads = 0;
  const sampleComponent = () => React.createElement("p", null, "EXPLICIT_DEMO_CONTENT");
  const exports = execute(compile(`app/dashboard/${route}/page.tsx`), (name) => {
    if (name === "react/jsx-runtime") return jsxRuntime;
    if (name === "react") return React;
    if (name === "next/link") return { default: ({ children, href }) => React.createElement("a", { href }, children) };
    if (name === "@/lib/supabase/server") return { createClient: async () => { throw new Error("A missing member role must not read drafts"); } };
    if (name === "@/lib/data/org") return {
      getCurrentContext: async () => context,
      getOrgSettings: async () => ({
        defaults: {
          modality: "knockout",
          library_slug: null,
          normalization: "median_ratio",
          hit_callers: ["mageck"],
          fdr_threshold: 0.05,
          cn_correction: true,
        },
        retention: { raw_reads_days: 30 },
      }),
    };
    if (name === "@/lib/data/workspace-lists") return {
      getWorkspaceScreens: async () => { dataReads++; return result; },
    };
    if (name === "@/components/dashboard/ui") return {
      Card: ({ children, title }) => React.createElement("section", null, title, children),
      Panel: ({ children, title }) => React.createElement("section", null, title, children),
      PageHeader: ({ title, body }) => React.createElement("header", null, title, body),
      DenseTable: ({ children }) => React.createElement("table", null, children),
    };
    if (name === "@/lib/data/screen-requests") return { listScreenRequests: async () => ({ status: "found", requests: [] }) };
    if (name === "@/lib/data/libraries") return { listLibraries: async () => ({ libraries: [], unavailable: false }) };
    if (name === "@/components/dashboard/intake/intake-workspace") return {
      IntakeWorkspace: ({ own, published }) => React.createElement("div", null, own, published),
    };
    if (name === "@/components/dashboard/intake/upload-flow") return {
      UploadFlow: () => React.createElement("div", null, "PRIVATE_UPLOAD_PATH"),
    };
    if (name === "@/lib/data/types") return {
      ROLE_RANK: { viewer: 1, member: 2, admin: 3, owner: 4 },
      DEFAULT_WORKSPACE_SETTINGS: {
        defaults: {
          modality: "knockout",
          library_slug: null,
          normalization: "median_ratio",
          hit_callers: ["mageck"],
          fdr_threshold: 0.05,
          cn_correction: true,
        },
        retention: { raw_reads_days: 30 },
      },
    };
    if (name === "@/components/dashboard/request-form") return { RequestForm: () => null };
    if (name === "lucide-react") return new Proxy({}, { get: () => () => null });
    if (name === "@/components/dashboard/workspace-records") return {
      WorkspaceReadNotice: ({ status }) => React.createElement("p", null, status),
      RecordPages: () => null,
    };
    if (samples.has(name)) {
      sampleReads++;
      return { ScreensTable: sampleComponent, UploadWizard: sampleComponent };
    }
    throw new Error(`Unexpected dependency ${name}`);
  });
  return {
    async render() { return renderToStaticMarkup(await exports.default({ searchParams: Promise.resolve({}) })); },
    reads() { return { sampleReads, dataReads }; },
  };
}

for (const route of ["screens", "new"]) {
  test(`${route}: signed-in workspace never imports or renders demonstration data`, async () => {
    const app = routeHarness(route);
    const html = await app.render();
    assert.doesNotMatch(html, /EXPLICIT_DEMO_CONTENT/);
    assert.equal(app.reads().sampleReads, 0);
  });
  test(`${route}: a retired demo marker cannot select fixture content`, async () => {
    const app = routeHarness(route, { ...workspace, isDemo: true });
    assert.doesNotMatch(await app.render(), /EXPLICIT_DEMO_CONTENT/);
    assert.equal(app.reads().sampleReads, 0);
    assert.equal(app.reads().dataReads, route === "screens" ? 1 : 0);
  });
}

test("screen list renders only returned real records and links to real detail", async () => {
  const app = routeHarness("screens", workspace, { status: "ready", page: 1, total: 1, rows: [
    { id: "real-screen", name: "Actual experiment", cell_line: null, phenotype: "fitness", modality: "knockout", status: "failed", qc: "fail" },
  ] });
  const html = await app.render();
  assert.match(html, /Actual experiment/);
  assert.match(html, /\/dashboard\/screens\/real-screen/);
  assert.match(html, /Not recorded/);
  assert.match(html, /failed/);
  assert.doesNotMatch(html, /EXPLICIT_DEMO_CONTENT/);
});

test("database failure and missing workspace never display sample or empty evidence claims", async () => {
  for (const route of ["screens"]) {
    for (const status of ["unavailable", "workspace_required"]) {
      const app = routeHarness(route, workspace, { status });
      const html = await app.render();
      assert.match(html, new RegExp(status));
      assert.doesNotMatch(html, /no recorded|No validation outcomes|EXPLICIT_DEMO_CONTENT/);
      assert.equal(app.reads().sampleReads, 0);
    }
  }
});

for (const [route, label] of [["app/dashboard/page.tsx", "Workspace unavailable"], ["app/dashboard/settings/members/page.tsx", "Session unavailable"]]) {
  test(`${route}: missing session/workspace cannot fall back to sample records`, async () => {
    const exports = execute(compile(route), (name) => {
      if (name === "react/jsx-runtime") return jsxRuntime;
      if (name === "react") return React;
      if (name === "@/lib/data/org") return { getCurrentContext: async () => ({ isDemo: false, user: null, org: null, role: null }) };
      if (name === "@/components/dashboard/ui") return {
        Card: ({ children, title }) => React.createElement("section", null, title, children),
        PageHeader: ({ title, body }) => React.createElement("header", null, title, body),
      };
      // No sample arrays are supplied: calling the old fallback would fail.
      if (name === "@/lib/mock/data") return { LIKELY_REAL_THRESHOLD: 0.6 };
      return {};
    });
    const html = renderToStaticMarkup(await exports.default({ searchParams: Promise.resolve({}) }));
    assert.match(html, new RegExp(label));
    assert.doesNotMatch(html, /Sample data|Demo user/);
  });
}
