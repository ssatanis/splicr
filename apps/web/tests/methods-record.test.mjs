import assert from "node:assert/strict";
import test from "node:test";
import { unzipSync, strFromU8 } from "fflate";
import { loadTs } from "./helpers/load-ts.mjs";

const { methodsRecord, methodsText } = loadTs("lib/report/methods-record.ts");
const { serializeScreensExport } = loadTs("lib/report/screens-export.ts");
const request = { screenIds: ["screen"], format: "csv", fields: ["gene_symbol", "comparison"],
  sections: ["provenance"], rowScope: "all", fdrMetric: "fdr", fdrThreshold: 0.1 };
const screen = (stages = []) => ({ screen: { id: "screen", name: "Methods", qc: "fail" },
  run: { id: "run", status: "complete", engine_version: "engine-revision", settings: {
    hit_callers: ["mageck_rra", "bagel2"], normalization: "total", fdr_threshold: 0.05,
  } }, comparisons: [{ id: "comparison", name: "WT vs EV" }], hits: [], stages });
const done = metrics => ({ stage: "hits", status: "done", metrics });
const now = "2026-10-08T12:00:00Z";

test("requested or skipped callers cannot become executed methods", () => {
  for (const stages of [[], [{ stage: "hits", status: "skipped", metrics: { methods: ["bagel2"] } }],
    [{ stage: "hits", status: "failed", metrics: { methods: ["bagel2"] } }]]) {
    const record = methodsRecord(screen(stages), request, now);
    assert.equal(record.completed_methods, null);
    assert.equal(record.effective_parameters.normalization, null);
    assert.deepEqual(record.requested_settings.hit_callers, ["mageck_rra", "bagel2"]);
  }
});

test("effective stage parameters are distinct from requested settings and retain false/zero", () => {
  const record = methodsRecord(screen([done({ methods: ["mageck_rra"], normalization: "median",
    fdr_threshold: 0, essentiality_contrast: false, warnings: ["QC failed"],
    mle_design: { random_seed: 0 }, normalization_controls: null })]), request, now);
  assert.deepEqual(record.completed_methods, ["mageck_rra"]);
  assert.equal(record.effective_parameters.normalization, "median");
  assert.equal(record.requested_settings.normalization, "total");
  assert.equal(record.effective_parameters.fdr_threshold, 0);
  assert.equal(record.effective_parameters.essentiality_contrast, false);
  assert.equal(record.effective_parameters.mle_design.random_seed, 0);
  assert.equal(record.tool_versions, null);
  assert.equal(record.container_digest, null);
  assert.equal(record.qc.verdict, "fail");
  assert.match(methodsText(record), /Tool-specific versions: not recorded/);
});

test("ambiguous and malformed execution evidence cannot fabricate a method list", () => {
  for (const stages of [[done({ methods: ["mageck_rra"] }), done({ methods: ["jacks"] })],
    [done({ methods: "mageck_rra" })], [done({ methods: ["mageck_rra", null] })]]) {
    assert.equal(methodsRecord(screen(stages), request, now).completed_methods, null);
  }
});

test("export filtering is recorded separately from the analysis FDR threshold", () => {
  const record = methodsRecord(screen([done({ fdr_threshold: 0.05 })]), { ...request, rowScope: "fdr", fdrMetric: "mle_fdr", fdrThreshold: 0.2 }, now);
  assert.equal(record.effective_parameters.fdr_threshold, 0.05);
  assert.deepEqual(record.export_selection.filter, { metric: "mle_fdr", threshold: 0.2, operator: "<=" });
  assert.match(methodsText(record), /does not establish a calibrated validation probability/);
});

test("ZIP methods files preserve run and comparisons, enter the checksum inventory, and respect provenance selection", async () => {
  const input = screen([done({ methods: ["mageck_rra"], tool_versions: { mageck: "0.5.9.5" } })]);
  const files = unzipSync((await serializeScreensExport([input], request, now)).bytes);
  const record = JSON.parse(strFromU8(files["01-Methods/methods-record.json"]));
  assert.equal(record.run_id, "run");
  assert.deepEqual(record.comparisons, input.comparisons);
  assert.equal(record.tool_versions.mageck, "0.5.9.5");
  const text = strFromU8(files["01-Methods/methods_text.txt"]);
  assert.match(text, /draft for author review/);
  assert.deepEqual(JSON.parse(text.split("Exact recorded evidence:\n")[1]), record);
  const manifest = JSON.parse(strFromU8(files["manifest.json"]));
  assert.ok(manifest.files.some(file => file.path === "01-Methods/methods_text.txt"));
  assert.ok(manifest.files.some(file => file.path === "01-Methods/methods-record.json"));
  const omitted = unzipSync((await serializeScreensExport([input], { ...request, sections: [] }, now)).bytes);
  assert.equal(Object.keys(omitted).some(path => /methods/.test(path)), false);
});
