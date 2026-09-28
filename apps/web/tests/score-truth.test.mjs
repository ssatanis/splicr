/** Execute the real exporters and score component; no database or external service. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";

const nativeRequire = createRequire(import.meta.url);
const src = path.join(import.meta.dirname, "../src");
function loader(adapters = {}) {
  const cache = new Map();
  function load(file) {
    const absolute = path.resolve(src, file);
    if (cache.has(absolute)) return cache.get(absolute);
    const exports = {};
    cache.set(absolute, exports);
    const compiled = ts.transpileModule(fs.readFileSync(absolute, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const requireAdapter = (name) => {
      if (name in adapters) return adapters[name];
      if (name === "server-only") return {};
      if (name.startsWith("@/") || name.startsWith(".")) {
        const base = name.startsWith("@/") ? path.join(src, name.slice(2)) : path.resolve(path.dirname(absolute), name);
        return load(fs.existsSync(`${base}.ts`) ? `${base}.ts` : `${base}.tsx`);
      }
      return nativeRequire(name);
    };
    vm.runInNewContext(compiled, { exports, require: requireAdapter, console, Buffer, TextEncoder, TextDecoder, Uint8Array });
    return exports;
  }
  return load;
}
const row = { screenId: "real-screen", screenName: "Actual screen", gene: "TEST1", verdict: null, chance: 0.91, novelty: null, lfc: 0, fdr: 0, guides: null, guidesAgree: null, flags: [], benchAssay: null };

for (const sample of [false, true]) {
  test(`${sample ? "demo" : "real"} candidate CSV never fabricates uncertainty intervals`, () => {
    const { candidatesCsv } = loader()("components/dashboard/overview/export-rows.ts");
    const csv = candidatesCsv([row, { ...row, chance: 0 }, { ...row, chance: null }], {
      filter: "all", sort: "score descending", provenance: "recorded rows", caveat: null,
      sample, picked: [], keyOf: () => "key",
    });
    assert.match(csv, /uncalibrated model score/);
    assert.doesNotMatch(csv, /plus or minus|0\.06/);
    const data = csv.replace(/^\uFEFF/, "").trim().split("\r\n").filter((line) => !line.startsWith("#"));
    const columns = data[0].split(",");
    const values = data.slice(1).map((line) => line.split(","));
    assert.deepEqual(values.map((cells) => cells[columns.indexOf("chance_real")]), ["0.91", "0", ""]);
    for (const cells of values) {
      assert.equal(cells[columns.indexOf("chance_lower")], "");
      assert.equal(cells[columns.indexOf("chance_upper")], "");
      assert.equal(cells[columns.indexOf("sample_data")], sample ? '"yes"' : '"no"');
    }
  });
}

test("shared score display prints raw score rather than a validation percentage", () => {
  const { Chance } = loader()("components/dashboard/ui.tsx");
  for (const value of [0, 0.91, 1]) {
    const html = renderToStaticMarkup(Chance({ value }));
    const visibleText = html.replace(/<[^>]*>/g, "");
    assert.equal(visibleText, value.toFixed(3));
    assert.match(html, /not a validation probability/);
  }
});

test("sample report builder rejects workspace provenance before fixture lookup", () => {
  const { buildReport } = loader()("lib/report/document.ts");
  assert.throws(() => buildReport(null, "workspace"), /cannot produce workspace reports/);
});

test("sample report and serializers preserve explicit scientific limitations", () => {
  const load = loader();
  const { buildReport } = load("lib/report/document.ts");
  const { screens } = load("lib/mock/data.ts");
  const doc = buildReport(screens.find((screen) => screen.id === "scr_demo"));
  const methods = doc.methods.map(({ body }) => body).join(" ");
  assert.match(methods, /No sequencing, counting/);
  assert.match(methods, /not a calibrated validation probability/);
  assert.match(methods, /does not retrain any model/);
  assert.doesNotMatch(methods, /plus or minus 0\.06|was produced by splicr.score/);
  const json = JSON.parse(load("lib/report/json.ts").toJson(doc, new Date(0)));
  assert.equal(json.sample_data, true);
  assert.equal(json.score_interpretation, "uncalibrated_model_score");
  assert.equal(json.validation_probability, null);
  assert.equal(json.score_uncertainty_interval, null);
  assert.match(load("lib/report/csv.ts").toCsv(doc, new Date(0)), /chance_real is an uncalibrated model score/);
});

test("descriptive outcome diagnostics exclude invalid scores from bins and denominator", async () => {
  const data = [
    ...Array.from({ length: 10 }, (_, i) => ({ predicted: i % 2, result: i % 2 ? "validated" : "failed" })),
    ...[-1, 2, NaN, Infinity, null].map((predicted) => ({ predicted, result: "failed" })),
  ];
  const chain = { select() { return chain; }, eq() { return chain; }, in() { return chain; }, not() { return chain; }, limit() { return Promise.resolve({ data, error: null }); } };
  const load = loader({
    "@/lib/supabase/server": { createClient: async () => ({ from: () => chain }) },
    "@/lib/supabase/env": { supabaseConfigured: () => true },
  });
  const result = await load("lib/data/overview.ts").getCalibration("00000000-0000-4000-8000-000000000002");
  assert.equal(result.interpretation, "descriptive_only");
  assert.equal(result.resolved, 10);
  assert.equal(result.bins.reduce((sum, bin) => sum + bin.n, 0), 10);
  assert.equal(result.error, 0);
});
