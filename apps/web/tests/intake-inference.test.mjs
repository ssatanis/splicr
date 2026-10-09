import assert from "node:assert/strict";
import test from "node:test";
import {
  dateFromFiles,
  nameFromFiles,
  sampleFactors,
  confidentLibrary,
} from "../src/lib/intake/inference.ts";
import {
  suggestComparisons,
  tableSamples,
  applySampleMetadata,
} from "../src/lib/intake/experiment.ts";
const table = (labels) => ({
  fileId: "f",
  name: "counts.csv",
  sheet: "Table",
  model: "",
  samples: tableSamples(labels),
  rows: 2,
  preview: [],
  warnings: [],
});
test("date defaults accept an unambiguous real calendar date and reject ambiguous or invalid dates", () => {
  assert.equal(
    dateFromFiles(["counts-EK20250627_Jacquere.txt", "map.csv"]),
    "2025-06-27",
  );
  assert.equal(dateFromFiles(["2025-06-27_counts.csv", "2025-06-28_counts.csv"]), null);
  assert.equal(dateFromFiles(["counts_20250230.csv"]), null);
  assert.equal(dateFromFiles(["plate_1200.csv"]), null);
});
test("screen title uses the count file even when a library was uploaded first", () => {
  assert.equal(
    nameFromFiles(["guide-library.csv", "counts-EK20250627_Jacquere_allinone.txt"]),
    "EK20250627 Jacquere",
  );
});
test("opaque conditions and numbered cell lines are preserved, explicit replicates collapse", () => {
  assert.equal(sampleFactors("A375_CP0082_repA").condition, "A375_CP0082");
  assert.equal(sampleFactors("A375_CP0082_repA").model, "A375");
  assert.equal(sampleFactors("D31_DRUG42_rep_2").condition, "DRUG42");
  assert.equal(sampleFactors("DRUG42_rep_2").condition, "DRUG42");
  assert.equal(sampleFactors("D31_DRUG42_rep_2").timepoint, "31");
});
test("library selection uses matched input fraction and separates ambiguous fingerprints", () => {
  assert.equal(
    confidentLibrary([
      { library_id: "small", match_rate: 0.2, n_matched: 50, coverage: 1 },
    ]),
    null,
  );
  assert.equal(
    confidentLibrary([
      { library_id: "a", match_rate: 1, n_matched: 100 },
      { library_id: "b", match_rate: 1, n_matched: 100 },
    ]),
    null,
  );
  assert.equal(
    confidentLibrary([
      { library_id: "a", match_rate: 0.97, n_matched: 100 },
      { library_id: "b", match_rate: 0.8, n_matched: 80 },
    ]),
    "a",
  );
  assert.equal(
    confidentLibrary([{ library_id: "a", match_rate: 1, n_matched: 2 }]),
    null,
  );
});
test("Jacquere models share pDNA but endpoints remain distinct, and empty is excluded", () => {
  const comparisons = suggestComparisons([
    table([
      "A375_CP0082_repA",
      "A375_CP0082_repB",
      "A549_CP0082_repA",
      "A549_CP0082_repB",
      "CP0082_pDNA",
      "Empty",
    ]),
  ]);
  assert.equal(comparisons.length, 2);
  assert.deepEqual(
    comparisons.map((c) => c.model),
    ["A375", "A549"],
  );
  assert.deepEqual(comparisons[0].control, ["CP0082_pDNA"]);
  assert.equal(comparisons[0].treatment.length, 2);
  assert.ok(comparisons.every((c) => !c.treatment.includes("Empty")));
});
test("timepoint-specific vehicle controls are paired with the same endpoint day", () => {
  const comparisons = suggestComparisons([
    table(["T0", "D7_DMSO_rep1", "D14_DMSO_rep1", "D7_Drug_rep1", "D14_Drug_rep1"]),
  ]);
  const drug = comparisons.filter((c) => c.drug);
  assert.equal(drug.length, 2);
  assert.deepEqual(drug[0].control, ["D7_DMSO_rep1"]);
  assert.deepEqual(drug[1].control, ["D14_DMSO_rep1"]);
});
test("sample sheet roles and arbitrary factors override filename guesses without silently matching absent samples", () => {
  const input = [table(["opaqueA", "opaqueB"])];
  const mapped = applySampleMetadata(input, [
    {
      sample: "opaqueA",
      role: "baseline",
      replicate: "2",
      donor: "patient-1",
      passage: "P4",
    },
    { sample: "opaqueB", role: "treatment", replicate: "2", condition: "compound" },
  ]);
  assert.equal(mapped[0].samples[0].role, "reference");
  assert.equal(mapped[0].samples[0].factors.passage, "P4");
  assert.equal(suggestComparisons(mapped).length, 1);
  assert.throws(
    () => applySampleMetadata(input, [{ sample: "absent", role: "baseline" }]),
    /not present/,
  );
});
test("content detection recognizes transposed guide counts without guessing generic numeric spreadsheets", async () => {
  const { parseRows } = await import("../src/lib/intake/tables.ts");
  const transposed = parseRows("Table", [
    ["sample", "ACGTACGTACGTACGTACGT", "TGCATGCATGCATGCATGCA"],
    ["T0", 100, 50],
    ["treated", 10, 30],
  ]);
  assert.equal(transposed.kind, "counts");
  assert.equal(transposed.mapping.layout, "transposed");
  assert.deepEqual(transposed.sample_columns, ["T0", "treated"]);
  assert.equal(
    parseRows("Table", [
      ["sample", "Age", "Score"],
      ["Subject1", 50, 10],
      ["Subject2", 30, 20],
    ]).kind,
    "context",
  );
  // Generic spreadsheets remain editable; biological roles are never fabricated.
  assert.equal(suggestComparisons([table(["Age", "Score"])]).length, 0);
});
test("numeric validation checks every row beyond the detection probe", async () => {
  const { parseRows } = await import("../src/lib/intake/tables.ts");
  assert.throws(
    () =>
      parseRows("Table", [
        ["guide", "T0", "treated"],
        ...Array.from({ length: 101 }, (_, i) => [`g${i}`, 10, i === 100 ? -1 : 5]),
      ]),
    /negative/,
  );
});
test("numeric gene identifiers are library annotations rather than sample counts", async () => {
  const { parseRows } = await import("../src/lib/intake/tables.ts");
  const table = parseRows("Table", [
    ["sgRNA Sequence", "Target Gene ID", "Target Gene Symbol"],
    ["ACGTACGTACGTACGTACGT", 1, "A1BG"],
    ["TGCATGCATGCATGCATGCA", 673, "BRAF"],
  ]);
  assert.equal(table.kind, "library");
  assert.deepEqual(table.sample_columns, []);
  assert.equal(table.guides[1].gene, "BRAF");
});
