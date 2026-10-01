/**
 * Screen Doctor: what it is allowed to say about a run.
 *
 * Two things these guard.
 *
 * First, provenance. Every number it prints has to be one the run recorded and
 * every judgement has to name the published threshold it was made against. A
 * panel that tells a researcher their screen is fine is making a claim on their
 * behalf; the claim has to be traceable to a stored value.
 *
 * Second, causation. The QC cannot tell a bottleneck from selection strong
 * enough to remove guides on its own, so the copy says "consistent with" and
 * never "caused by". That distinction is the difference between a reading and
 * an assertion.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { loadTs, srcPath } from "./helpers/load-ts.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const { diagnose } = loadTs("lib/report/screen-doctor.ts");
const { QC } = loadTs("lib/report/qc-thresholds.ts");

/** The GSE145743 run, exactly as run_qc.metrics stores it. */
function gse145743() {
  return {
    verdict: "fail",
    nnmd: -2.634,
    nnmdContrast: "DMSO_r1+DMSO_r2 vs plasmid",
    auroc: 0.81,
    bottlenecked: [],
    replicates: [
      { a: "DMSO_r1", b: "DMSO_r2", r: 0.9036 },
      { a: "olaparib_r1", b: "olaparib_r2", r: 0.8513 },
    ],
    samples: [
      { label: "plasmid", role: "plasmid", verdict: "warn", mapping_rate: 0.8893, zero_fraction: 0.00177, skew_ratio: 7.64, mean_reads_per_guide: 43.4, gini: 0.1247, total_reads: 3119503 },
      { label: "T0", role: "reference", verdict: "warn", mapping_rate: 0.8863, zero_fraction: 0.00449, skew_ratio: 10.76, mean_reads_per_guide: 172.6, gini: 0.113, total_reads: 12449815 },
      { label: "DMSO_r1", role: "control", verdict: "warn", mapping_rate: 0.8143, zero_fraction: 0.02699, skew_ratio: 29.67, mean_reads_per_guide: 75.1, gini: 0.1967, total_reads: 5896213 },
      { label: "DMSO_r2", role: "control", verdict: "fail", mapping_rate: 0.4838, zero_fraction: 0.02046, skew_ratio: 26, mean_reads_per_guide: 110.8, gini: 0.1754, total_reads: 14638915 },
      { label: "olaparib_r1", role: "treatment", verdict: "warn", mapping_rate: 0.871, zero_fraction: 0.04266, skew_ratio: 40.25, mean_reads_per_guide: 66.4, gini: 0.2225, total_reads: 4871170 },
      { label: "olaparib_r2", role: "treatment", verdict: "warn", mapping_rate: 0.87, zero_fraction: 0.0346, skew_ratio: 40.67, mean_reads_per_guide: 100.4, gini: 0.2026, total_reads: 7380260 },
    ],
  };
}

const find = (diagnosis, id) => diagnosis.findings.find((finding) => finding.id === id);
const allText = (diagnosis) => JSON.stringify(diagnosis);

// ---------------------------------------------------------------------------
// The thresholds are the engine's
// ---------------------------------------------------------------------------

test("every threshold matches engine/splicr/config.py", () => {
  const source = fs.readFileSync(path.join(root, "engine/splicr/config.py"), "utf8");
  const block = source.slice(source.indexOf("class QcThresholds:"));
  const engine = {};
  for (const [, name, value] of block.matchAll(/^\s{4}(\w+):\s*float\s*=\s*(-?[\d.]+)$/gm)) {
    engine[name] = Number(value);
  }
  assert.ok(Object.keys(engine).length >= 8, "QcThresholds did not parse");

  const pairs = {
    mappingRateMin: "mapping_rate_min",
    mappingRateWarn: "mapping_rate_warn",
    zeroFractionMax: "zero_fraction_max",
    zeroFractionWarn: "zero_fraction_warn",
    skewRatioMax: "skew_ratio_max",
    meanReadsPerGuideMin: "mean_reads_per_guide_min",
    nnmdMax: "nnmd_max",
    replicateRMin: "replicate_r_min",
    giniPlasmidMax: "gini_plasmid_max",
    giniEndpointMax: "gini_endpoint_max",
  };
  for (const [ours, theirs] of Object.entries(pairs)) {
    assert.ok(theirs in engine, `config.py no longer defines ${theirs}`);
    assert.equal(QC[ours].value, engine[theirs],
      `${ours} is ${QC[ours].value} here and ${theirs} is ${engine[theirs]} in the engine; `
      + "the console would hold a screen to a line the engine does not use");
  }
});

test("every threshold is attributed to whoever set it", () => {
  for (const [name, threshold] of Object.entries(QC)) {
    assert.ok(typeof threshold.source === "string" && threshold.source.length > 2,
      `${name} has no source; a researcher is entitled to know whose line they are held to`);
  }
});

// ---------------------------------------------------------------------------
// What it says about a real run
// ---------------------------------------------------------------------------

test("the failing sample is the thing to look at first, and the action names it", () => {
  const diagnosis = diagnose(gse145743());
  assert.equal(diagnosis.verdict, "fail");
  assert.equal(diagnosis.concern.id, "mapping");
  assert.match(diagnosis.concern.title, /DMSO_r2/);
  assert.deepEqual(diagnosis.concern.samples, ["DMSO_r2"]);
  assert.match(diagnosis.action, /DMSO_r2/);
  // Not a generic "review QC": it says which sample and what to check about it.
  assert.match(diagnosis.action, /library call|guide offset/);
});

test("a failed run whose assay worked says so, because that changes what to do", () => {
  const diagnosis = diagnose(gse145743());
  // NNMD -2.63 is past the -1.25 threshold, so essentials did separate. A
  // reader told only "QC failed" would discard a screen that detected signal.
  assert.equal(find(diagnosis, "separation").level, "ok");
  assert.match(diagnosis.headline, /assay worked/);
});

test("the headline counts agree with the findings", () => {
  const diagnosis = diagnose(gse145743());
  const failing = diagnosis.findings.filter((f) => f.level === "fail").length;
  const warning = diagnosis.findings.filter((f) => f.level === "warn").length;
  assert.equal(failing, 1);
  assert.equal(warning, 2);
  assert.match(diagnosis.headline, /1 check failed/);
  assert.match(diagnosis.headline, /2 need attention/);
});

test("every evidence value is a recorded one, and names what it was judged against", () => {
  const diagnosis = diagnose(gse145743());
  for (const finding of diagnosis.findings) {
    assert.ok(finding.evidence.length > 0, `${finding.id} asserts something with no measurement`);
    for (const item of finding.evidence) {
      assert.ok(item.value && item.value !== "NaN" && !item.value.includes("undefined"),
        `${finding.id}: ${item.label} printed ${item.value}`);
    }
    // At least one piece of evidence per finding carries its threshold.
    assert.ok(finding.evidence.some((item) => item.against),
      `${finding.id} judges a value without naming the line it was judged against`);
  }
});

test("the mapping finding prints the outlier beside the others, not alone", () => {
  const diagnosis = diagnose(gse145743());
  const labels = find(diagnosis, "mapping").evidence.map((item) => item.label);
  assert.ok(labels.some((label) => label.includes("DMSO_r2")));
  // 48.4% means nothing without 87%.
  assert.ok(labels.some((label) => /other samples/i.test(label)));
});

// ---------------------------------------------------------------------------
// What it is not allowed to claim
// ---------------------------------------------------------------------------

test("representation drift is reported as association, never as cause", () => {
  const diagnosis = diagnose(gse145743());
  const representation = find(diagnosis, "representation");
  assert.equal(representation.level, "warn");
  assert.match(representation.detail, /consistent with/);
  for (const forbidden of [/\bcaused by\b/i, /\bbecause of\b/i, /\bdue to\b/i, /\bproves\b/i]) {
    assert.doesNotMatch(allText(diagnosis), forbidden,
      `Screen Doctor asserted causation (${forbidden}); the QC cannot distinguish a bottleneck from selection`);
  }
});

test("there is no quality score anywhere", () => {
  const diagnosis = diagnose(gse145743());
  const text = allText(diagnosis).toLowerCase();
  for (const forbidden of ["quality score", "health score", "confidence score", "out of 100", "/100"]) {
    assert.ok(!text.includes(forbidden),
      `a single figure collapses unrelated failures into one that answers neither (${forbidden})`);
  }
});

test("the verdict is the run's own and is never recomputed", () => {
  // Every check passes here, and the run still says warn. The panel reports warn.
  const clean = {
    ...gse145743(),
    verdict: "warn",
    samples: gse145743().samples.map((sample) => ({
      ...sample, mapping_rate: 0.9, zero_fraction: 0.001, skew_ratio: 5, mean_reads_per_guide: 400,
    })),
  };
  const diagnosis = diagnose(clean);
  assert.equal(diagnosis.verdict, "warn");
  assert.equal(diagnosis.concern, null);
  assert.match(diagnosis.headline, /passed/i);
});

test("a run with no QC says so, and does not read as a pass", () => {
  const diagnosis = diagnose(null);
  assert.equal(diagnosis.verdict, "pending");
  assert.equal(diagnosis.concern, null);
  assert.equal(diagnosis.action, null);
  assert.deepEqual(diagnosis.findings, []);
  assert.match(diagnosis.headline, /nothing here says the screen is sound/i);
});

test("a missing metric is absent rather than counted as zero", () => {
  const sparse = {
    verdict: "pass", nnmd: null, nnmdContrast: null, auroc: null, bottlenecked: [], replicates: [],
    samples: [{ label: "only", role: "control", verdict: "pass", mapping_rate: null, zero_fraction: null, skew_ratio: null, mean_reads_per_guide: null, gini: null, total_reads: null }],
  };
  const diagnosis = diagnose(sparse);
  // No finding may be built out of nulls: a null mapping rate is not 0%.
  for (const finding of diagnosis.findings) {
    for (const item of finding.evidence) {
      assert.ok(!/NaN|null|undefined/.test(item.value), `${finding.id} printed ${item.value} from a missing metric`);
    }
  }
  assert.equal(find(diagnosis, "mapping"), undefined);
  assert.equal(find(diagnosis, "separation"), undefined);
});

test("an assay that did not separate overrides everything else", () => {
  const broken = { ...gse145743(), nnmd: -0.3 };
  const diagnosis = diagnose(broken);
  assert.equal(find(diagnosis, "separation").level, "fail");
  assert.equal(diagnosis.concern.id, "separation");
  assert.match(diagnosis.action, /Do not read gene results/);
  assert.doesNotMatch(diagnosis.headline, /assay worked/);
});

test("weak replicates are named by pair", () => {
  const drifted = {
    ...gse145743(),
    replicates: [{ a: "olaparib_r1", b: "olaparib_r2", r: 0.11 }],
  };
  const diagnosis = diagnose(drifted);
  const replicates = find(diagnosis, "replicates");
  assert.equal(replicates.level, "fail");
  assert.deepEqual(replicates.samples, ["olaparib_r1", "olaparib_r2"]);
});

test("the panel reads the decision, the evidence and the detail in that order", () => {
  const source = fs.readFileSync(srcPath("components/dashboard/evidence/screen-doctor.tsx"), "utf8");
  // Anchored on the rendered strings, not on the file's own prose about them.
  const jsx = source.slice(source.indexOf("export function ScreenDoctor"));
  const decision = jsx.indexOf("Look at this first");
  const evidence = jsx.indexOf("What was checked");
  const detail = jsx.indexOf("recorded QC");
  assert.ok(decision > 0 && evidence > decision && detail > evidence,
    "the three layers must appear in the order a reader needs them");
  // The detail layers are closed until asked for.
  assert.equal((jsx.match(/<details/g) ?? []).length, 2);
  assert.ok(!jsx.includes("<details open"), "no layer may be open by default");
});
