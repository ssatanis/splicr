/**
 * Truth Loop rules: what an outcome is, how a rate is stated, and what a form
 * may submit. Pure logic, no database.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { loadTs } from "./helpers/load-ts.mjs";

const model = loadTs("lib/outcomes/model.ts");
const schema = loadTs("lib/outcomes/schema.ts");

const row = (over = {}) => ({
  id: "o1", screenId: "s1", screenName: "Screen one", gene: "TP53", result: "validated", assay: null,
  effectSize: null, nGuides: null, predicted: null, modelVersion: null, notes: null, evidenceUrl: null,
  loggedAt: "2026-09-01T10:00:00Z", loggedBy: "u1", hitLinked: false, ...over,
});

test("the four results stay four, each with its own words", () => {
  assert.deepEqual([...model.OUTCOME_RESULTS], ["validated", "failed", "inconclusive", "pending"]);
  const labels = new Set(model.OUTCOME_RESULTS.map((r) => model.RESULT_COPY[r].label));
  assert.equal(labels.size, 4);
  assert.equal(model.RESULT_COPY.failed.label, "Did not validate");
  assert.doesNotMatch(JSON.stringify(model.RESULT_COPY), /artifact|uncertain/i);
  assert.equal(model.isOutcomeResult("validated"), true);
  assert.equal(model.isOutcomeResult("Validated"), false);
  assert.equal(model.isOutcomeResult(undefined), false);
});

test("a rate is stated over decided outcomes only, with its interval", () => {
  const counts = model.countOutcomes([
    ...Array.from({ length: 4 }, () => row({ result: "validated" })),
    row({ result: "failed" }),
    row({ result: "pending" }), row({ result: "pending" }),
    row({ result: "inconclusive" }),
  ]);
  assert.deepEqual(counts, { validated: 4, failed: 1, inconclusive: 1, pending: 2, total: 8 });
  const rate = model.decidedRate(counts);
  assert.equal(rate.decided, 5);
  assert.equal(rate.validated, 4);
  assert.equal(rate.rate, 0.8);
  // Wilson 95% interval for 4 of 5: 0.376 to 0.964.
  assert.ok(Math.abs(rate.lower - 0.3755) < 2e-3, `${rate.lower}`);
  assert.ok(Math.abs(rate.upper - 0.9638) < 2e-3, `${rate.upper}`);
  const big = model.decidedRate({ validated: 400, failed: 100, inconclusive: 0, pending: 0, total: 500 });
  assert.equal(big.rate, 0.8);
  assert.ok(big.upper - big.lower < 0.08, "the same 80% is much tighter at n = 500");
});

test("nothing decided means no rate, not a zero rate", () => {
  const empty = model.decidedRate(model.emptyCounts());
  assert.deepEqual(empty, { decided: 0, validated: 0, rate: null, lower: null, upper: null });
  const onlyPending = model.decidedRate(model.countOutcomes([row({ result: "pending" }), row({ result: "inconclusive" })]));
  assert.equal(onlyPending.rate, null);
  const allFailed = model.decidedRate({ validated: 0, failed: 3, inconclusive: 0, pending: 0, total: 3 });
  assert.equal(allFailed.rate, 0, "a real zero is a zero");
  assert.equal(allFailed.lower, 0);
});

test("filters read the address, ignore junk, and round-trip", () => {
  const parsed = model.parseOutcomeFilters({ result: "failed", screen: "abc-123", q: "  tp5 ", page: "3" });
  assert.deepEqual(parsed, { result: "failed", screen: "abc-123", q: "tp5", page: 3 });
  const junk = model.parseOutcomeFilters({ result: "artifact", screen: "a b;c", q: "x".repeat(100), page: "-2" });
  assert.equal(junk.result, null);
  assert.equal(junk.screen, null);
  assert.equal(junk.q.length, 40);
  assert.equal(junk.page, 1);
  assert.equal(model.parseOutcomeFilters({ page: "10001" }).page, 1);
  assert.equal(model.parseOutcomeFilters({ result: ["pending", "failed"] }).result, "pending");

  const href = model.outcomeHref("/dashboard/validation", parsed, {});
  assert.equal(href, "/dashboard/validation?result=failed&screen=abc-123&q=tp5&page=3");
  assert.doesNotMatch(model.outcomeHref("/x", parsed, { result: "pending" }), /page=/, "a new filter returns to page one");
  assert.match(model.outcomeHref("/x", parsed, { page: 4 }), /page=4/);
  assert.equal(model.outcomeHref("/x", model.parseOutcomeFilters({}), {}), "/x");
});

test("filtering and sorting are stable and case-insensitive on the gene", () => {
  const rows = [
    row({ id: "a", gene: "TP53", loggedAt: "2026-09-02T00:00:00Z" }),
    row({ id: "b", gene: "tp53bp1", result: "failed", loggedAt: "2026-09-03T00:00:00Z" }),
    row({ id: "c", gene: "KRAS", screenId: "s2", loggedAt: "2026-09-03T00:00:00Z" }),
  ];
  const all = model.filterOutcomes(rows, model.parseOutcomeFilters({}));
  assert.deepEqual(all.map((r) => r.id), ["b", "c", "a"], "newest first, ties by id");
  assert.deepEqual(model.filterOutcomes(rows, model.parseOutcomeFilters({ q: "TP5" })).map((r) => r.id), ["b", "a"]);
  assert.deepEqual(model.filterOutcomes(rows, model.parseOutcomeFilters({ result: "failed" })).map((r) => r.id), ["b"]);
  assert.deepEqual(model.filterOutcomes(rows, model.parseOutcomeFilters({ screen: "s2" })).map((r) => r.id), ["c"]);
  // The tiles count the screen's outcomes whatever result is chosen.
  const scoped = model.countsInScope(rows, model.parseOutcomeFilters({ screen: "s1", result: "failed" }));
  assert.equal(scoped.total, 2);
});

test("a valid form parses to typed values, and blanks are missing, not zero", () => {
  const ok = schema.parseOutcomeDraft({
    screenId: "0199f4c2-1f8b-7c31-9a0e-2f4f1d8c77aa", gene: " tp53 ", result: "validated",
    validationType: "independent_guide",
    assay: " Arrayed KO ", nGuides: "3", effectSize: "0", notes: "", evidenceUrl: "https://example.org/nb/12",
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.gene, "tp53");
  assert.equal(ok.value.assay, "Arrayed KO");
  assert.equal(ok.value.nGuides, 3);
  assert.equal(ok.value.effectSize, 0, "an effect of zero is a measurement");
  assert.equal(ok.value.notes, null);
  assert.equal(ok.value.evidenceUrl, "https://example.org/nb/12");

  const blank = schema.parseOutcomeDraft({ screenId: "s", gene: "KRAS", result: "pending", validationType: "independent_guide", assay: "", nGuides: "", effectSize: "", notes: "", evidenceUrl: "" });
  assert.equal(blank.ok, true);
  assert.equal(blank.value.effectSize, null);
  assert.equal(blank.value.nGuides, null);
  assert.equal(blank.value.assay, null);
});

test("a new outcome must say which experiment it was", () => {
  // A result without its experiment is not a measurement of anything: a
  // genetic reproduction and a pharmacologic test are different questions with
  // different answers, and a row that says only "validated" belongs to
  // neither.
  const missing = schema.parseOutcomeDraft({ screenId: "s", gene: "G1", result: "validated" });
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.validationType);
  const unknown = schema.parseOutcomeDraft({
    screenId: "s", gene: "G1", result: "validated", validationType: "vibes",
  });
  assert.equal(unknown.ok, false);
  assert.ok(unknown.errors.validationType);
});

test("a prespecified criterion left blank is not recorded, and never a 'no'", () => {
  // The whole reason these are three-state and not checkboxes. An unchecked
  // checkbox would record "the perturbation was not independent" for every
  // form filled in a hurry, which is a measurement claim nobody made.
  const blank = schema.parseOutcomeDraft({
    screenId: "s", gene: "G1", result: "validated", validationType: "independent_guide",
    independentPerturbation: "", distinctConstructs: "", nReplicates: "",
  });
  assert.equal(blank.ok, true);
  assert.equal(blank.value.independentPerturbation, null);
  assert.equal(blank.value.distinctConstructs, null);
  assert.equal(blank.value.nReplicates, null);

  const measurement = schema.measurementFromValues(blank.value);
  assert.equal(measurement.independent_perturbation, null);
  assert.equal(measurement.n_replicates, null);
  assert.ok(!("compound" in measurement), "an unrecorded compound is absent, not empty");

  const answered = schema.parseOutcomeDraft({
    screenId: "s", gene: "G1", result: "validated", validationType: "independent_guide",
    independentPerturbation: "no", distinctConstructs: "yes", nReplicates: "3",
  });
  assert.equal(answered.value.independentPerturbation, false);
  assert.equal(answered.value.distinctConstructs, true);
  assert.equal(answered.value.nReplicates, 3);
  // false and null must stay distinguishable all the way into the measurement.
  assert.equal(schema.measurementFromValues(answered.value).independent_perturbation, false);
});

test("a compound and a concentration ride along only where they mean something", () => {
  const fields = schema.fieldsFor("small_molecule");
  assert.equal(fields.compound, true);
  assert.equal(schema.fieldsFor("crispri").compound, false);
  assert.equal(schema.fieldsFor("independent_guide").constructs, true);
  assert.equal(schema.fieldsFor("in_vivo").constructs, false);
  assert.equal(schema.fieldsFor("").compound, false);

  const drug = schema.parseOutcomeDraft({
    screenId: "s", gene: "PRKDC", result: "failed", validationType: "small_molecule",
    compound: " AZD7648 ", concentrationUm: "10",
  });
  assert.equal(drug.ok, true);
  const measurement = schema.measurementFromValues(drug.value);
  assert.equal(measurement.compound, "AZD7648");
  assert.equal(measurement.concentration_um, 10);
});

test("a concentration must be a non-negative number", () => {
  const bad = (concentrationUm) => schema.parseOutcomeDraft({
    screenId: "s", gene: "G1", result: "failed", validationType: "small_molecule", concentrationUm,
  });
  assert.equal(bad("-1").ok, false);
  assert.equal(bad("abc").ok, false);
  assert.equal(bad("0").ok, true, "a vehicle-equivalent zero is a real concentration");
});

test("a replicate count must be a whole number", () => {
  const n = (nReplicates) => schema.parseOutcomeDraft({
    screenId: "s", gene: "G1", result: "validated", validationType: "crispri", nReplicates,
  });
  assert.equal(n("2.5").ok, false);
  assert.equal(n("0").ok, false);
  assert.equal(n("3").ok, true);
});

test("each bad field gets its own plain message", () => {
  const bad = schema.parseOutcomeDraft({
    screenId: "", gene: "TP 53!", result: "artifact", assay: "x".repeat(200), nGuides: "1.5",
    effectSize: "abc", notes: "y".repeat(2001), evidenceUrl: "javascript:alert(1)",
  });
  assert.equal(bad.ok, false);
  for (const key of ["screenId", "gene", "result", "assay", "nGuides", "effectSize", "notes", "evidenceUrl"]) {
    assert.ok(typeof bad.errors[key] === "string" && bad.errors[key].length > 5, `${key} has a message`);
  }
  assert.match(bad.errors.gene, /letters and digits/);
  assert.match(bad.errors.evidenceUrl, /full web address/);
  assert.match(bad.errors.screenId, /Choose the screen/);
});

test("gene symbols: real ones pass, hostile ones do not", () => {
  for (const good of ["TP53", "Trp53", "H2AFX", "MARCH1", "C1orf112", "HLA-A", "KRAS_G12V", "MT-CO1", "A1BG-AS1", "5S_rRNA", "TBC1D3@"]) {
    assert.match(good, schema.GENE_SYMBOL, good);
  }
  for (const bad of ["", " ", "-TP53", "TP 53", "TP53;DROP", "a".repeat(41), "TP53\n", "<b>", "TP53'--"]) {
    assert.doesNotMatch(bad, schema.GENE_SYMBOL, JSON.stringify(bad));
  }
});

test("only web links are stored, whatever the case or the trickery", () => {
  const link = (evidenceUrl) => schema.parseOutcomeDraft({
    screenId: "s", gene: "G1", result: "pending", validationType: "independent_guide", evidenceUrl,
  });
  assert.equal(link("HTTPS://Example.org/x").ok, true);
  assert.equal(link("http://example.org/x").ok, true);
  for (const evil of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>", "file:///etc/passwd", "//example.org", "example.org", "ftp://x.org/a", " javascript:alert(1)"]) {
    assert.equal(link(evil).ok, false, evil);
  }
});

test("non-object input is an error map, never an exception", () => {
  for (const junk of [null, undefined, 5, "x", [], { gene: 5 }, { result: {} }]) {
    const out = schema.parseOutcomeDraft(junk);
    assert.equal(out.ok, false);
    assert.ok(Object.keys(out.errors).length > 0);
  }
});
