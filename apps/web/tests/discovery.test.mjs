import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const schema = loadTs("lib/discovery/schema.ts");
const model = loadTs("lib/discovery/model.ts");
const { canonicalJson, sha256 } = loadTs("lib/discovery/receipt.ts");
const { evaluateBatch } = loadTs("lib/discovery/evaluate.ts");
const { blindedWorksheet } = loadTs("lib/discovery/export.ts");
const context = { model_id: "PDO-A", biological_unit: "PATIENT-A", lineage: "breast", subtype: null, culture: "organoid", medium: "M1", matrix: "BME", library: "KINOME", modality: "knockout", endpoint: "viability", time_hours: 336, effect_metric: "log2_fold_change" };
const source = { id: "local", citation: "Lab experiment", usage: "laboratory_owned", rights_statement: "Owned by the laboratory, consented for this workspace." };
function document(extra = {}) { return schema.discoveryDocumentSchema.parse({ ...model.blankDocument(context), sources: [source], ...extra }); }
const hit = (gene = "FGFR1", extra = {}) => ({ gene, lfc: -1.5, fdr: 0.01, guide_lfcs: [-1.4, -1.5, -1.7], flags: [], ...extra });
const drug = (extra = {}) => ({ id: "D1", gene: "FGFR1", source_id: "local", model_id: "PDO-A", compound: "CMP-1", dose_um: 1, time_hours: 72, relative_viability: 0.3, biological_replicates: 3, engagement: "unknown", selective: "unknown", ...extra });
const design = (extra = {}) => schema.batchDesignSchema.parse({ name: "Round", budget: 20, default_cost: 1, cost_unit: "assays", endpoint_key: "arrayed_crispr_v1", ...extra });

test("strict imports preserve unknown, zero, false and provenance", () => {
  const d = document({ molecular: [{ gene: "fgfr1", source_id: "local", expression: 0, expression_unit: "TPM", copy_number: 0, pan_essential: false }] });
  assert.equal(d.molecular[0].gene, "FGFR1"); assert.equal(d.molecular[0].expression, 0); assert.equal(d.molecular[0].protein_loss_fraction, null);
  assert.throws(() => document({ mystery_score: 0.98 }));
  assert.throws(() => document({ drugs: [drug({ source_id: "not-declared" })] }));
  assert.throws(() => document({ drugs: [drug({ dose_um: "1" })] }));
  assert.throws(() => document({ drugs: [drug({ relative_viability: true })] }));
  assert.throws(() => document({ sources: [{ ...source, usage: "publicly_downloadable" }] }));
  assert.throws(() => document({ sources: [source, source] }));
  assert.throws(() => document({ molecular: [{ gene: "A", source_id: "local", expression: 1 }] }));
  assert.throws(() => schema.parseDiscoveryDocument("bad json"));
  assert.throws(() => schema.parseDiscoveryDocument(" ".repeat(1_500_001)));
});

test("known-answer genetic/drug patterns nominate discriminating experiments", () => {
  const agree = model.buildWorklist([hit()], document({ drugs: [drug()] }));
  assert.deepEqual(agree.map((e) => e.kind), ["orthogonal_confirmation", "pharmacologic_confirmation"]);
  assert.ok(agree.some((e) => e.warnings.some((w) => /selectivity/.test(w))));
  const discordant = model.buildWorklist([hit()], document({ drugs: [drug({ relative_viability: 0.9 })] }));
  assert.equal(discordant[0].kind, "engagement"); assert.match(discordant[0].next_experiment, /engagement/);
  const engaged = model.buildWorklist([hit()], document({ drugs: [drug({ relative_viability: 0.9, engagement: "yes" })] }));
  assert.match(engaged[0].next_experiment, /catalytic/);
  const drugOnly = model.buildWorklist([hit("FGFR1", { fdr: 0.9, lfc: 0 })], document({ drugs: [drug()] }));
  assert.equal(drugOnly[0].kind, "perturbation_check");
});

test("failed, absent and conflicting assay support never become reliable agreement", () => {
  assert.throws(() => model.buildWorklist([hit("gene"), hit("GENE")], document()), /duplicate normalized gene/);
  for (const extra of [{ guide_lfcs: null }, { guide_lfcs: [-1] }, { flags: ["single_guide"] }, { flags: ["copy_number_cluster"] }, { fdr: null }, { lfc: null }]) {
    const w = model.buildWorklist([hit("FGFR1", extra)], document({ drugs: [drug()] }));
    assert.ok(w.every((e) => e.kind !== "pharmacologic_confirmation"));
  }
  const wrongModel = model.buildWorklist([hit()], document({ drugs: [drug({ model_id: "PDO-B" })] }));
  assert.equal(wrongModel.length, 1); assert.equal(wrongModel[0].compound, null);
  const underReplicated = model.buildWorklist([hit()], document({ drugs: [drug({ biological_replicates: 1 })] }));
  assert.equal(underReplicated[0].pattern, "Drug/genetic comparison is unresolved");
  const conflicting = model.buildWorklist([hit()], document({ drugs: [drug(), drug({ id: "D2", relative_viability: 0.99 })] }));
  assert.equal(conflicting[0].pattern, "Drug/genetic comparison is unresolved");
  const differentTiming = model.buildWorklist([hit()], document({ drugs: [drug(), drug({ id: "D2", time_hours: 48, relative_viability: 0.99 })] }));
  assert.equal(new Set(differentTiming.map((e) => e.id)).size, 3);
});

test("modifier effects are not baseline essentiality; pan-essential status does not demote a target", () => {
  const modifier = model.buildWorklist([hit()], document({ context: { ...context, modality: "drug_modifier" }, drugs: [drug()] }));
  assert.ok(modifier.every((e) => e.kind !== "orthogonal_confirmation"));
  assert.match(modifier[0].warnings.join(" "), /not a baseline/);
  const pan = model.buildWorklist([hit()], document({ molecular: [{ gene: "FGFR1", source_id: "local", pan_essential: true, copy_number: 8 }] }));
  assert.equal(pan[0].priority, model.buildWorklist([hit()], document())[0].priority);
  assert.match(pan[0].warnings.join(" "), /partial suppression/);
  assert.match(pan[0].warnings.join(" "), /cutting toxicity or incomplete disruption/);
});

test("context matching rejects incompatible scales and repeated-patient pseudoreplication", () => {
  const ref = (id, effect, overrides = {}) => ({ id, gene: "FGFR1", source_id: "local", study_id: "S1", context: { ...context, model_id: id, biological_unit: id, ...overrides }, effect });
  const d = document({ references: [ref("B", -0.2), { ...ref("B2", -0.4, { biological_unit: "B" }), study_id: "S2" }, ref("C", -0.5), ref("D", -0.7), ref("local-copy", -2, { biological_unit: "PATIENT-A" }), ref("2D", -4, { culture: "cell_line" }), ref("CHRONOS", -8, { effect_metric: "chronos" })] });
  const matched = model.matchedReference("FGFR1", -1.5, d);
  assert.equal(matched.n_biological_units, 3); assert.equal(matched.n_studies, 2); assert.equal(matched.excluded, 3);
  assert.ok(Math.abs(matched.mean - -0.5) < 1e-10); assert.ok(Math.abs(matched.local_minus_reference - -1) < 1e-10);
  assert.ok(matched.sd > 0);
  for (const key of ["lineage", "medium", "matrix", "library", "endpoint", "time_hours"]) {
    const incomplete = { ...d, context: { ...d.context, [key]: null } };
    assert.equal(model.matchedReference("FGFR1", -1, incomplete).mean, null, key);
  }
  const missing = model.matchedReference("FGFR1", null, d); assert.equal(missing.local_minus_reference, null);
});

test("combinations need local context, available reagents and controls; shared pathways are insufficient", () => {
  const p = { id: "P1", gene: "A", partner: "B", source_id: "local", model_id: context.model_id, biological_unit: context.biological_unit, evidence: "paralog_loss", reagents_available: true };
  const pairs = model.buildWorklist([], document({ pairs: [p] }));
  assert.equal(pairs.length, 1); assert.equal(pairs[0].kind, "combination"); assert.match(pairs[0].controls.join(" "), /Each single/);
  assert.equal(model.buildWorklist([], document({ pairs: [{ ...p, reagents_available: false }] })).length, 0);
  assert.equal(model.buildWorklist([], document({ pairs: [{ ...p, model_id: "different" }] })).length, 0);
  assert.throws(() => document({ pairs: [{ ...p, partner: "A" }] }));
  assert.throws(() => document({ pairs: [{ ...p, evidence: "same_pathway" }] }));
  assert.equal(model.buildWorklist([], document({ pairs: [p, { ...p, id: "P2", gene: "B", partner: "A" }] })).length, 1);
});

test("laboratory nominations outside the depletion cutoff remain eligible for independent validation", () => {
  const d = document({ nominations: [{ id: "expert-1", gene: "MISSED", source_id: "local", assay: "orthogonal_confirmation", rationale: "Expert hypothesis based on the laboratory's complete workflow." }] });
  const w = model.buildWorklist([hit("MISSED", { fdr: 0.8, lfc: 0 })], d);
  assert.equal(w.length, 1); assert.equal(w[0].kind, "orthogonal_confirmation"); assert.equal(w[0].priority, 0);
  assert.throws(() => document({ nominations: [{ ...d.nominations[0], assay: "pharmacologic_confirmation" }] }));
});

test("GR and Bliss reject insufficient inputs and use the documented nulls", () => {
  assert.equal(model.growthRate(100, 400, 200), Math.sqrt(2) - 1);
  assert.equal(model.growthRate(100, 400, 100), 0); assert.equal(model.growthRate(100, 400, 0), -1);
  assert.equal(model.growthRate(100, 100, 50), null); assert.equal(model.growthRate(null, 400, 100), null);
  assert.equal(model.blissExcess(0.5, 0.8, 0.2), 0.2); assert.equal(model.blissExcess(0.5, 0.8, 0.4), 0);
  for (const v of [-1, 1.5, NaN, Infinity]) assert.throws(() => model.blissExcess(v, 0.5, 0.4));
});

test("combination matrices retain doses, singles, replication and the declared interaction null", () => {
  const combination = { id: "C1", gene: "A", partner: "B", source_id: "local", model_id: context.model_id, biological_unit: context.biological_unit, compound_a: "DA", compound_b: "DB", dose_a_um: 1, dose_b_um: 2, time_hours: 72, single_a_viability: 0.5, single_b_viability: 0.8, combination_viability: 0.2, biological_replicates: 3, matched_controls: true };
  const w = model.buildWorklist([], document({ combination_assays: [combination] }));
  assert.equal(w.length, 1); assert.equal(w[0].combination_evidence[0].bliss_excess, 0.2);
  assert.match(w[0].next_experiment, /DA at 1 µM with DB at 2 µM/);
  const underpowered = model.buildWorklist([], document({ combination_assays: [{ ...combination, biological_replicates: 1 }] }));
  assert.equal(underpowered[0].combination_evidence[0].bliss_excess, null);
  assert.ok(underpowered[0].priority < w[0].priority);
  const wrongContext = model.buildWorklist([], document({ combination_assays: [{ ...combination, biological_unit: "OTHER-PATIENT" }] }));
  assert.equal(wrongContext.length, 0);
});

test("costed batches preserve overlap and charge the union once", () => {
  const w = model.buildWorklist([hit("A"), hit("B"), hit("C"), hit("D"), hit("E")], document());
  const plan = model.selectBatch(w, design({ budget: 2, exploration_fraction: 0, investigator_ids: [w[0].id, w[2].id], missed_ids: [w[4].id] }));
  assert.equal(plan.splicr_cost, 2); assert.equal(plan.investigator_cost, 2); assert.equal(plan.union_cost, 4);
  assert.deepEqual(plan.experiments[0].wanted_by, ["splicr", "investigator"]);
  assert.throws(() => model.selectBatch(w, design({ investigator_ids: ["fabricated"] })));
  assert.throws(() => model.selectBatch(w, design({ budget: 1, investigator_ids: w.slice(0, 2).map((e) => e.id) })));
  assert.throws(() => model.selectBatch(w, design({ missed_ids: [w[0].id] })));
  assert.throws(() => model.selectBatch(w, design({ default_cost: 30 })));
});

test("1,000 randomized batches respect costs, uniqueness, determinism and candidate identity", () => {
  let seed = 101;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32; };
  const hits = Array.from({ length: 25 }, (_, i) => hit(`G${i}`));
  const original = model.buildWorklist(hits, document());
  for (let i = 0; i < 1000; i++) {
    const w = original.map((e) => ({ ...e, allocation: random() < 0.4 ? "exploration" : "confirmation" }));
    const costs = Object.fromEntries(w.map((e) => [e.id, Math.ceil(random() * 10)]));
    const d = design({ budget: 10 + Math.ceil(random() * 50), exploration_fraction: random() / 2, costs });
    const p = model.selectBatch(w, d);
    assert.ok(p.splicr_cost <= d.budget); assert.ok(p.exploration_cost <= p.splicr_cost);
    assert.equal(p.splicr_ids.length, new Set(p.splicr_ids).size);
    assert.equal(p.splicr_cost, p.splicr_ids.reduce((s, id) => s + costs[id], 0));
    assert.deepEqual(p, model.selectBatch(w, d));
  }
});

test("receipts are canonical and tampering changes their hashes; blinded exports hide strategy", () => {
  assert.equal(canonicalJson({ z: 3, a: { y: 2, x: 1 } }), canonicalJson({ a: { x: 1, y: 2 }, z: 3 }));
  assert.throws(() => canonicalJson({ x: NaN })); assert.throws(() => canonicalJson({ x: undefined }));
  const w = model.buildWorklist([hit()], document());
  const plan = model.selectBatch(w, design());
  const receipt = { plan, blind_ids: Object.fromEntries(plan.experiments.map((e) => [e.id, "blind-1"])) };
  assert.notEqual(sha256(receipt), sha256({ ...receipt, blind_ids: { wrong: "changed" } }));
  const csv = blindedWorksheet(receipt);
  assert.ok(csv.includes("FGFR1")); assert.ok(!/wanted_by|priority|investigator|splicr|rank|Genetic depletion/.test(csv));
  const malicious = { ...receipt, plan: { ...plan, experiments: [{ ...plan.experiments[0], model_id: "=HYPERLINK(1)", compound: '@CMD', dose_um: 1 }] } };
  assert.ok(blindedWorksheet(malicious).includes("'=HYPERLINK")); assert.ok(blindedWorksheet(malicious).includes("'@CMD"));
});

test("endpoint yield excludes missing and inconclusive results and credits shared experiments to both arms", () => {
  const w = model.buildWorklist([hit("A"), hit("B"), hit("C")], document());
  const plan = model.selectBatch(w, design({ investigator_ids: [w[0].id], budget: 3 }));
  const outcomes = [{ experiment_id: w[0].id, decision: "validated", measurement: { actual_cost: 3 } }, { experiment_id: w[1].id, decision: "insufficient_record", measurement: { actual_cost: 1 } }, { experiment_id: w[2].id, decision: "inconclusive", measurement: { actual_cost: 2 } }];
  const evaluation = evaluateBatch(plan, outcomes);
  assert.equal(evaluation.arms[0].confirmed, 1); assert.equal(evaluation.arms[0].decided, 1); assert.equal(evaluation.arms[0].unscored, 1);
  assert.equal(evaluation.arms[1].confirmed, 1); assert.equal(evaluation.overlap, 1); assert.equal(evaluation.comparable, false);
  assert.equal(evaluation.arms[0].actual_cost, 6); assert.equal(evaluation.arms[1].actual_cost, 3);
  assert.throws(() => evaluateBatch(plan, [outcomes[0], outcomes[0]]));
});
