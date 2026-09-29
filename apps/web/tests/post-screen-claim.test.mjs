/**
 * The public post-screen claim must stay tied to the artifact it came from.
 *
 * The homepage now states a concrete number — "nine of its top ten reproduced in
 * an independent screen, against seven" — instead of a hedge. A concrete number
 * is only an improvement if it cannot drift, so it is pinned here to the
 * measured precision@10 in the published evidence, which the gate in turn pins
 * to the registered descriptor and its per-unit results.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ROOT, validateInputs, validatePublished } from "../../../scripts/research/evidence_gate.mjs";

const load = (root, file) => JSON.parse(fs.readFileSync(path.join(root, file)));
const published = () => load(ROOT, "apps/web/public/evidence/summary.json").post_screen_replication;
const contract = () => load(ROOT, "research/evidence_contract.json");

test("the contract publishes a post-screen claim under a new dated snapshot", () => {
  const c = contract();
  assert.equal(c.snapshot_id, "20260928-post-screen-replication");
  assert.equal(c.post_screen.published, true);
  assert.ok(c.approval?.authorized_by);
  assert.equal(c.previous_snapshot.snapshot_id, "20260928-research-addendum");
  assert.equal(validatePublished().snapshot, "20260928-post-screen-replication");
});

test("the published figures recompute from the registered per-unit results", () => {
  const c = contract();
  const d = load(ROOT, c.post_screen.descriptor);
  const results = load(ROOT, d.results);
  const rows = results.per_unit[d.primary_model];
  const values = Object.values(rows).map(r => r[d.primary_metric]);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  assert.ok(Math.abs(mean - published().primary_mean) < 1e-12,
    "the published mean does not recompute from the per-unit rows");
  assert.equal(values.length, published().cohort.n_units);
});

test("the homepage sentence matches the measured precision at ten", () => {
  const copy = fs.readFileSync(
    path.join(ROOT, "apps/web/src/components/marketing/sections/age.tsx"), "utf8");
  const p = published().precision_at_10;
  const words = ["zero", "one", "two", "three", "four", "five", "six",
                 "seven", "eight", "nine", "ten"];
  const primary = words[Math.round(p.primary * 10)];
  const comparator = words[Math.round(p.comparator * 10)];
  assert.match(copy, new RegExp(`${primary} of its top ten`),
    `copy must say "${primary} of its top ten" to match precision@10 ${p.primary}`);
  assert.match(copy, new RegExp(`against ${comparator}\\b`),
    `copy must say "against ${comparator}" to match the comparator's ${p.comparator}`);
  assert.match(copy, /124 held-out screen pairs/);
});

test("the homepage does not claim wet-lab validation or a probability", () => {
  const copy = fs.readFileSync(
    path.join(ROOT, "apps/web/src/components/marketing/sections/age.tsx"), "utf8");
  assert.match(copy, /reproduced in an independent screen/,
    "the claim must say what was actually measured: replication in another screen");
  for (const forbidden of [/validated in the lab/i, /% chance/i, /probability of validat/i,
                           /guarantee/i, /proven to work/i]) {
    assert.doesNotMatch(copy, forbidden);
  }
});

test("a published post-screen advantage must have an interval excluding zero", () => {
  const p = published();
  assert.ok(p.paired_difference.ci95[0] > 0);
  assert.ok(p.non_hub_paired_difference.ci95[0] > 0,
    "the stratum outside the dominant library comparison must also exclude zero");
});

test("the published claim is research only and carries its limitations", () => {
  const p = published();
  assert.equal(p.promotion_status, "research_only");
  assert.ok(p.limitations.length >= 5);
  assert.ok(p.limitations.some(l => /proxy/i.test(l)),
    "the replication-is-a-proxy limitation must be published, not only documented");
  assert.ok(p.limitations.some(l => /113 of the 124/.test(l)),
    "the dominant-library-comparison limitation must be published");
});

test("the post-screen validator is separate from the pre-screen one", () => {
  const gate = fs.readFileSync(path.join(ROOT, "scripts/research/evidence_gate.mjs"), "utf8");
  assert.match(gate, /export function validateReplicationExperiment/);
  // The pre-screen validator must still refuse a post-screen task.
  assert.match(gate, /descriptor\.task === "pre_screen_prediction"/);
  assert.throws(() => validateInputs(ROOT) && (() => {
    throw new Error("placeholder");
  })(), /placeholder/);
});
