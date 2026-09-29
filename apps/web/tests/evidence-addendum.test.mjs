/**
 * The published research addendum must agree, exactly, with the original
 * experiment outputs.
 *
 * These tests do not trust `summary.json`, the publisher, or the gate's own
 * bookkeeping. They re-read the per-screen result files the experiment runners
 * wrote, recompute each mean from those rows, and compare against what the
 * website actually serves. A number can only appear on the site if it survives
 * that round trip.
 *
 * They verify provenance and arithmetic. They establish nothing biological.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";
import { ROOT, validateInputs, validatePublished } from "../../../scripts/research/evidence_gate.mjs";

const sha = raw => createHash("sha256").update(raw).digest("hex");
const load = (root, file) => JSON.parse(fs.readFileSync(path.join(root, file)));
const save = (root, file, value) => fs.writeFileSync(path.join(root, file), JSON.stringify(value));
const contract = () => load(ROOT, "research/evidence_contract.json");
const published = () => load(ROOT, "apps/web/public/evidence/summary.json");

const mean = rows => rows.reduce((sum, row) => sum + row["adjusted_ndcg@100"], 0) / rows.length;

/** A throwaway copy of every file the gate reads, so tampering is safe. */
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "splicr-addendum-fixture-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const c = contract();
  const files = ["research/evidence_contract.json", ...Object.keys(c.source_sha256)];
  for (const pin of Object.values(c.research_addendum?.experiments ?? {})) {
    files.push(pin.descriptor);
    for (const artifact of Object.keys(load(ROOT, pin.descriptor).artifacts)) files.push(artifact);
  }
  if (c.post_screen) {
    files.push(c.post_screen.descriptor);
    for (const artifact of Object.keys(load(ROOT, c.post_screen.descriptor).artifacts)) files.push(artifact);
    files.push("engine/splicr/replication/_pairs_v1.json", "engine/splicr/replication/dataset.py");
  }
  const manifest = load(ROOT, "apps/web/public/evidence/manifest.json");
  files.push("apps/web/public/evidence/manifest.json");
  for (const name of Object.keys(manifest.files_sha256)) {
    files.push(`apps/web/public/evidence/${name}`);
    if (name.endsWith(".md")) files.push(`research/${name}`);
  }
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, file), path.join(root, file));
  }
  return root;
}

test("a research addendum is published and approved by the contract", () => {
  const c = contract();
  assert.ok(c.research_addendum.published, "the addendum must remain published");
  assert.equal(c.research_addendum.published, true);
  assert.ok(c.approval?.authorized_by, "an approved contract names who authorized it");
  assert.ok(c.previous_snapshot.snapshot_id, "the superseded snapshot's provenance is retained");
  assert.notEqual(c.previous_snapshot.snapshot_id, c.snapshot_id);
});

test("every published addendum figure recomputes from its own per-screen results", () => {
  const c = contract();
  const site = published().research_addendum;
  assert.deepEqual(Object.keys(site.experiments).sort(), Object.keys(c.research_addendum.experiments).sort());
  for (const [id, pin] of Object.entries(c.research_addendum.experiments)) {
    const descriptor = load(ROOT, pin.descriptor);
    const rows = load(ROOT, descriptor.screen_results);
    const shown = site.experiments[id];
    assert.ok(Math.abs(mean(rows) - shown.mean) < 1e-12,
      `${id}: the website mean does not recompute from ${descriptor.screen_results}`);
    assert.equal(shown.n_screens, rows.length, `${id}: screen count drift`);
    assert.equal(shown.n_publications, new Set(rows.map(r => r.source_id)).size,
      `${id}: publication count drift`);
    const predictions = load(ROOT, descriptor.predictions);
    assert.deepEqual(Object.keys(predictions).sort(), rows.map(r => r.dataset_name).sort(),
      `${id}: predictions do not cover exactly the scored cohort`);
  }
});

test("published addendum results are labelled research, on validation, never public test", () => {
  const site = published().research_addendum;
  assert.match(site.split, /validation/i);
  for (const [id, shown] of Object.entries(site.experiments)) {
    assert.equal(shown.promotion_status, "research_only", `${id} must not be published as promoted`);
    assert.notEqual(shown.evaluation_kind, "retrospective_public_test",
      `${id} must not be published as a public-test result`);
  }
});

test("the 334-screen public-test results are unchanged by the addendum", () => {
  const site = published();
  assert.equal(site.split.test, 334);
  assert.equal(site.references.published_ensemble.mean, 0.16309105341547825);
  assert.equal(site.references.published_oracle_knn.mean, 0.29178431087462314);
  assert.equal(site.router.mean, 0.16036947764886397);
  assert.ok(site.router.paired_vs_ensemble.ci95[0] <= 0 && site.router.paired_vs_ensemble.ci95[1] >= 0,
    "the no-superiority claim must still be supported by the published interval");
});

test("markdown downloads are byte-identical to the research reports", () => {
  const manifest = load(ROOT, "apps/web/public/evidence/manifest.json");
  for (const name of Object.keys(manifest.files_sha256)) {
    if (!name.endsWith(".md")) continue;
    assert.deepEqual(
      fs.readFileSync(path.join(ROOT, "apps/web/public/evidence", name)),
      fs.readFileSync(path.join(ROOT, "research", name)),
      `${name} served to the public differs from the research report`);
  }
});

test("published research figures cannot drift from the source artifact", t => {
  const root = fixture(t);
  const site = load(root, "apps/web/public/evidence/summary.json");
  const id = Object.keys(site.research_addendum.experiments)[0];
  site.research_addendum.experiments[id].mean += 0.05;
  save(root, "apps/web/public/evidence/summary.json", site);
  // Repin both the manifest entry and the contract, so this exercises the semantic
  // gate rather than stopping at the checksum gate.
  const raw = fs.readFileSync(path.join(root, "apps/web/public/evidence/summary.json"));
  const manifest = load(root, "apps/web/public/evidence/manifest.json");
  manifest.files_sha256["summary.json"] = sha(raw);
  save(root, "apps/web/public/evidence/manifest.json", manifest);
  const c = load(root, "research/evidence_contract.json");
  c.public_summary_sha256 = sha(raw);
  c.public_manifest_sha256 = sha(fs.readFileSync(path.join(root, "apps/web/public/evidence/manifest.json")));
  save(root, "research/evidence_contract.json", c);
  assert.throws(() => validatePublished(root), /research addendum disagrees with its source artifact/);
});

test("an addendum experiment cannot be published as promoted", t => {
  const root = fixture(t);
  const c = load(root, "research/evidence_contract.json");
  const pin = Object.values(c.research_addendum.experiments)[0];
  const descriptor = load(root, pin.descriptor);
  descriptor.promotion_status = "production";
  save(root, pin.descriptor, descriptor);
  pin.descriptor_sha256 = sha(fs.readFileSync(path.join(root, pin.descriptor)));
  save(root, "research/evidence_contract.json", c);
  assert.throws(() => validateInputs(root), /addendum cannot promote a model/);
});

test("an addendum experiment cannot be relabelled a public-test result", t => {
  const root = fixture(t);
  const c = load(root, "research/evidence_contract.json");
  const pin = Object.values(c.research_addendum.experiments)[0];
  const descriptor = load(root, pin.descriptor);
  descriptor.evaluation_kind = "retrospective_public_test";
  save(root, pin.descriptor, descriptor);
  pin.descriptor_sha256 = sha(fs.readFileSync(path.join(root, pin.descriptor)));
  save(root, "research/evidence_contract.json", c);
  assert.throws(() => validateInputs(root), /must not be published as public-test results/);
});

test("a tampered per-screen file is rejected even when the descriptor is repinned", t => {
  const root = fixture(t);
  const c = load(root, "research/evidence_contract.json");
  const pin = Object.values(c.research_addendum.experiments)[0];
  const descriptor = load(root, pin.descriptor);
  const rows = load(root, descriptor.screen_results);
  rows[0]["adjusted_ndcg@100"] = 0.99;
  save(root, descriptor.screen_results, rows);
  descriptor.artifacts[descriptor.screen_results] = sha(fs.readFileSync(path.join(root, descriptor.screen_results)));
  save(root, pin.descriptor, descriptor);
  pin.descriptor_sha256 = sha(fs.readFileSync(path.join(root, pin.descriptor)));
  save(root, "research/evidence_contract.json", c);
  assert.throws(() => validateInputs(root), /addendum summary differs from its own screens/);
});

test("a published addendum requires an approving contract", t => {
  const root = fixture(t);
  const c = load(root, "research/evidence_contract.json");
  delete c.research_addendum;
  save(root, "research/evidence_contract.json", c);
  // Either guard is a correct refusal: the source-count pin trips first because the
  // published summary still cites the descriptors the contract no longer approves.
  assert.throws(() => validatePublished(root),
    /research addendum without an approving contract|unexpected\/missing primary sources/);
});
