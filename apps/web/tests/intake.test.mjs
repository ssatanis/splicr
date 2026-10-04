/**
 * Browser-intake rules that keep the upload path honest before it reaches
 * Supabase: classify only formats the inspector can read, derive editable
 * sample guesses, and reject incomplete experimental designs.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const shape = await import("../src/lib/intake/shape.ts");
const derive = await import("../src/lib/intake/derive.ts");

test("file classification matches the formats the inspector can read", () => {
  assert.equal(shape.classify("treated_R1.fastq.gz"), "fastq");
  assert.equal(shape.classify("counts.csv"), "counts");
  assert.equal(shape.classify("Brunello_library.tsv"), "library");
  assert.equal(shape.classify("lane.fastq.bz2"), null);
  assert.equal(shape.classify("notes.pdf"), null);
});

test("sample names become editable arm and replicate guesses", () => {
  assert.deepEqual(derive.deriveSamples(["T0", "DMSO_rep2", "olaparib_R3"], []), [
    { label: "T0", role: "reference", replicate: 1, file_id: null },
    { label: "DMSO_rep2", role: "control", replicate: 2, file_id: null },
    { label: "olaparib_R3", role: "treatment", replicate: 3, file_id: null },
  ]);
});

test("design validation requires analyzable files and a real contrast", () => {
  const base = { name: "Olaparib resistance", cell_line: "HAP1", phenotype: "survival", modality: "knockout", library_id: null };
  const files = [{ id: "f", name: "counts.tsv", bytes: 123, kind: "counts", compressed: false, storage_key: "k", checksum_sha256: "a".repeat(64), status: "complete" }];

  assert.equal(shape.checkDesign({ ...base, samples: [] }, files)[0].field, "samples");
  assert.equal(
    shape.checkDesign({
      ...base,
      samples: [
        { label: "DMSO", role: "control", replicate: 1 },
        { label: "Olaparib", role: "treatment", replicate: 1 },
      ],
    }, files).length,
    0,
  );
  assert.equal(shape.checkDesign({ ...base, samples: [{ label: "Olaparib", role: "treatment", replicate: 1 }] }, [])[0].field, "files");
});

test("the database gate locks the draft before it decides whether to queue", () => {
  const migration = fs.readFileSync(
    path.join(import.meta.dirname, "../../../supabase/migrations/20261002000100_private_screen_intake.sql"),
    "utf8",
  );
  assert.match(migration, /where id = p_screen_id for update/i);
});

test("private upload manifests are R2-backed and job leasing is explicit", () => {
  const migration = fs.readFileSync(
    path.join(import.meta.dirname, "../../../supabase/migrations/20261002000200_private_pipeline_jobs.sql"),
    "utf8",
  );
  const upload = fs.readFileSync(path.join(import.meta.dirname, "../src/lib/intake/upload.ts"), "utf8");
  const modal = fs.readFileSync(path.join(import.meta.dirname, "../../../engine/modal_app.py"), "utf8");
  assert.match(upload, /\/api\/intake\/r2/);
  assert.doesNotMatch(upload, /storage\/v1\/upload\/resumable|tus-js-client/);
  const actions = fs.readFileSync(path.join(import.meta.dirname, "../src/lib/intake/actions.ts"), "utf8");
  assert.match(actions, /The upload has to finish before it can be recorded/);
  assert.match(migration, /claim_pipeline_job/);
  assert.match(modal, /process_private_screen/);
});
