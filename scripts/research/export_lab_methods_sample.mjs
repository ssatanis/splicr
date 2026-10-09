/** Exercise the production serializer with a local real-count run; no database writes. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { loadTs } from "../../apps/web/tests/helpers/load-ts.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const evidence = resolve(root, "research/artifacts/20261008");
const smoke = JSON.parse(readFileSync(resolve(evidence, "lab-methods-smoke.json"), "utf8"));
const report = JSON.parse(readFileSync(resolve(root, smoke.report_path), "utf8"));
const { serializeScreensExport } = loadTs("lib/report/screens-export.ts");
const runId = `local-report-sha256:${smoke.report_sha256}`;
const comparisonId = "local-comparison:kidney-vs-D0";
const screen = {
  screen: { id: "local-study:millman-2026-methods-smoke", name: "Millman methods verification",
    cell_line: report.context.cell_line, phenotype: report.context.phenotype, modality: report.context.modality,
    qc: report.qc.verdict, status: "complete", source_ref: "Local real-count verification; not a database run" },
  run: { id: runId, status: "complete", engine_version: smoke.engine_version, image_digest: null,
    settings: { normalization: "control", fdr_threshold: 0.1, hit_callers: ["mageck_rra"], fitness_assay: false,
      treatment: ["kidney"], control: ["D0"], roles: { D0: "reference", kidney: "treatment" } } },
  comparisons: [{ id: comparisonId, name: "kidney vs D0", kind: "treatment_vs_control" }],
  hits: report.genes.map(gene => ({ ...gene, id: `local-result:${gene.gene}`, gene_symbol: gene.gene,
    comparison_id: comparisonId, hit_flags: gene.flags })),
  qcEvidence: report.qc, stages: report.execution.stages,
};
const request = { screenIds: [screen.screen.id], format: "csv",
  fields: ["gene_symbol", "comparison", "comparison_id", "direction", "lfc", "p_value", "fdr",
    "depleted_fdr", "enriched_fdr", "n_guides", "guide_lfcs", "flags", "flag_messages"],
  sections: ["qc", "provenance"], rowScope: "all", fdrMetric: "fdr", fdrThreshold: 0.1 };
const output = await serializeScreensExport([screen], request);
const files = unzipSync(output.bytes);
const manifest = JSON.parse(strFromU8(files["manifest.json"]));
assert.equal(manifest.screens[0].exported_gene_rows, smoke.n_genes);
for (const entry of manifest.files) {
  assert.equal(entry.byte_length, files[entry.path].byteLength);
  assert.equal(entry.sha256, createHash("sha256").update(files[entry.path]).digest("hex"));
}
const folder = "01-Millman-methods-verification";
const methods = JSON.parse(strFromU8(files[`${folder}/methods-record.json`]));
assert.deepEqual(methods.completed_methods, ["mageck_rra"]);
assert.equal(methods.effective_parameters.normalization_controls.n_guides, 3755);
assert.equal(methods.effective_parameters.normalization_controls.sha256, smoke.hit_stage.metrics.normalization_controls.sha256);
for (const name of ["methods_text.txt", "methods-record.json"]) {
  writeFileSync(resolve(evidence, `sample-${name}`), files[`${folder}/${name}`]);
}
writeFileSync(resolve(evidence, "sample-lab-methods-bundle.zip"), output.bytes);
console.log(JSON.stringify({ verified: true, files: manifest.files.length,
  gene_rows: smoke.n_genes, identity: "local content IDs; no database or cloud run created", bytes: output.bytes.byteLength }));
