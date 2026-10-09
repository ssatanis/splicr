import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import type { LabReceipt } from "@/lib/lab/evidence";
import { evidenceScenes, sceneSvg, scenePdf, escapeMarkup } from "@/lib/lab/figures";
import { fileInventory, VERIFY_BUNDLE } from "./bundle-integrity";

/** Every displayed chart has its own specification, vector files and original receipt. */
export function labEvidenceFiles(records: LabReceipt[], metadata: Record<string, unknown>): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const articles: string[] = [];
  for (const [index, record] of records.entries()) {
    const folder = `${String(index + 1).padStart(3, "0")}-${record.kind}-${record.gene.replace(/[^A-Za-z0-9._-]/g, "_")}-${record.sha256.slice(0, 12)}`;
    const canonical = record.canonical;
    if (!canonical || createHash("sha256").update(canonical).digest("hex") !== record.sha256) throw new Error("A lab evidence receipt is missing its canonical bytes or fails SHA-256 verification. No bundle was created.");
    if (!isDeepStrictEqual(JSON.parse(canonical), { schema: record.schema, kind: record.kind, gene: record.gene, inputs: record.inputs, payload: record.payload }))
      throw new Error("Displayed measurements differ from their canonical receipt. No bundle was created.");
    files[`${folder}/receipt.canonical.json`] = strToU8(canonical);
    files[`${folder}/receipt.json`] = strToU8(JSON.stringify(record, null, 2) + "\n");
    const scenes = evidenceScenes(record);
    scenes.forEach((scene, i) => {
      files[`${folder}/figure-${i + 1}.svg`] = strToU8(sceneSvg(scene));
      files[`${folder}/figure-${i + 1}.pdf`] = scenePdf(scene);
      files[`${folder}/figure-${i + 1}.spec.json`] = strToU8(JSON.stringify({ schema: "splicr.vector-scene.v1", receipt_sha256: record.sha256, scene }, null, 2));
    });
    const title = `${record.gene} · ${record.kind}`;
    articles.push(`<article data-record="${escapeMarkup(title.toUpperCase())}"><h2>${escapeMarkup(title)}</h2><p>${escapeMarkup(record.payload.interpretation ?? record.payload.reason ?? record.payload.status)}</p><p class="hash">Receipt ${record.sha256} · comparison ${escapeMarkup(record.comparison_id ?? "not recorded")}</p><p><a download href="${folder}/receipt.canonical.json">Original receipt</a> · <a download href="${folder}/receipt.json">JSON and provenance</a></p>${scenes.map((scene, i) => `<div class="figure">${sceneSvg(scene)}</div><p><a download href="${folder}/figure-${i + 1}.svg">SVG</a> · <a download href="${folder}/figure-${i + 1}.pdf">PDF</a> · <a download href="${folder}/figure-${i + 1}.spec.json">Plot specification</a></p>`).join("")}<details><summary>Every recorded value</summary><pre>${escapeMarkup(JSON.stringify(record.payload, null, 2))}</pre></details></article>`);
  }
  files["index.html"] = strToU8(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SplicR laboratory evidence</title><style>body{font:14px/1.6 system-ui;color:#25313a;background:#f6f8f9;max-width:1100px;margin:auto;padding:30px}article{background:white;border:1px solid #dae0e4;border-radius:12px;padding:24px;margin:20px 0}h1,h2{line-height:1.2}.figure{overflow:auto}svg{max-width:100%;height:auto;min-width:650px}input{padding:12px;width:80%;border:1px solid #aab6bf;border-radius:6px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f6f8f9;padding:12px}.hash{font:11px monospace;overflow-wrap:anywhere}a{color:#087f8c}</style><h1>SplicR laboratory evidence</h1><p>This bundle works offline after extraction. Hover chart marks for measured values. Filter records below. Every figure and its source can be downloaded individually.</p><label>Filter gene or evidence type <input id="filter" placeholder="PIKFYVE, kinetics, isoforms…"></label><p id="coverage">${records.length} recorded receipts</p>${articles.join("")}<script>document.getElementById('filter').addEventListener('input',function(){const q=this.value.toUpperCase().trim();let n=0;document.querySelectorAll('article[data-record]').forEach(function(a){a.hidden=!a.dataset.record.includes(q);if(!a.hidden)n++});document.getElementById('coverage').textContent=n+' visible receipts';});</script></html>`);
  files["settings-and-scope.json"] = strToU8(JSON.stringify(metadata, null, 2) + "\n");
  files["README.md"] = strToU8("# SplicR lab evidence\n\nExtract this ZIP, open index.html offline, and run `python3 verify-bundle.py` to verify byte integrity. Each receipt.canonical.json is the exact committed byte string; its SHA-256 is in receipt.json. Hashes detect changes and do not authenticate authorship or prove execution time. Repeated receipt versions are retained, not counted as independent experiments.\n\nAll plots show recorded values. Annotation is not measured isoform expression; temporal slopes are descriptive; DepMap context is not independent validation; library/control diagnostics cannot identify contaminants. Native count-derived and log-count QC Gini definitions differ. PDF uses standard Helvetica with WinAnsi encoding: unsupported glyphs appear as '?'; SVG, JSON and HTML retain exact Unicode labels. Methods, settings and absent evidence require author review before publication.\n");
  return files;
}
export function labEvidenceBundle(records: LabReceipt[], metadata: Record<string, unknown>): Uint8Array {
  const files = labEvidenceFiles(records, metadata);
  files["verify-bundle.py"] = strToU8(VERIFY_BUNDLE);
  files["manifest.json"] = strToU8(JSON.stringify({ schema: "splicr.lab-evidence-bundle.v1", ...metadata, files: fileInventory(files),
    integrity: { algorithm: "sha256", scope: "All listed files except manifest.json; byte integrity only" } }, null, 2));
  return zipSync(files, { level: 6 });
}
