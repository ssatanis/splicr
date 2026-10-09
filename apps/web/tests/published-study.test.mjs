import assert from "node:assert/strict";
import test from "node:test";
import { FERRARONE, publishedStudyTable } from "../src/lib/intake/published-study.ts";
import { tableSamples, suggestComparisons, applySampleMetadata } from "../src/lib/intake/experiment.ts";
import { validateMle, defaultMle } from "../src/lib/intake/analysis-plan.ts";

const sourceTable = (culture) => ({ fileId: culture, name: "renamed-counts.txt", sheet: "Table", model: "", rows: 70116, preview: [], warnings: [], samples: tableSamples(["tkov3_plasmid", ...["ev", "wt"].flatMap(arm => ["a", "b"].map(rep => `${arm}_${culture}_d21_${rep}`))]) });

test("verified archive bytes generate six correctly oriented genetic comparisons without pooling cultures", () => {
  const tables = FERRARONE.sources.map(source => publishedStudyTable(sourceTable(source.culture), source.sha256));
  const comparisons = suggestComparisons(tables);
  assert.equal(comparisons.length, 6);
  assert.equal(comparisons.filter(row => row.fitness).length, 4);
  assert.ok(comparisons.every(row => !row.drug && row.model === "A549"));
  for (const row of comparisons) {
    const table = tables[row.table];
    assert.equal(new Set([...row.treatment, ...row.control]).size, row.treatment.length + row.control.length);
    assert.ok(row.treatment.every(label => label.includes(table.study.culture)));
    assert.equal(validateMle(defaultMle(table.samples, row.treatment, row.control), [...row.control, ...row.treatment]), null);
    if (row.name.endsWith("WT vs EV")) {
      assert.ok(row.treatment.every(label => label.startsWith("wt_")));
      assert.ok(row.control.every(label => label.startsWith("ev_")));
      assert.equal(row.fitness, false);
    } else assert.deepEqual(row.control, ["tkov3_plasmid"]);
  }
  assert.deepEqual(tables[0].samples.map(row => row.replicate), [1, 1, 2, 1, 2]);
  assert.equal(tables[0].samples[1].role, "control");
  assert.equal(tables[0].samples[3].role, "treatment");
});

test("filenames, absent checksums, modified content and edited columns cannot impersonate the paper", () => {
  const source = FERRARONE.sources[0], table = sourceTable("2d");
  table.name = "2d_crispr_screen_read_counts.txt";
  assert.equal(publishedStudyTable(table), table);
  assert.equal(publishedStudyTable(table, "a".repeat(64)), table);
  assert.equal(publishedStudyTable({ ...table, rows: 5 }, source.sha256).study, undefined);
  assert.equal(publishedStudyTable({ ...table, samples: table.samples.slice(1) }, source.sha256).study, undefined);
  assert.equal(publishedStudyTable(sourceTable("3d"), source.sha256).study, undefined);
});

test("explicit uploaded metadata takes precedence over published defaults", () => {
  const table = publishedStudyTable(sourceTable("2d"), FERRARONE.sources[0].sha256);
  const [edited] = applySampleMetadata([table], [{ sample: "wt_2d_d21_a", model: "Reviewed model", replicate: "3", donor: "reviewed" }]);
  assert.equal(edited.samples[3].replicate, 3);
  assert.equal(edited.samples[3].factors.model, "Reviewed model");
  assert.equal(edited.samples[3].factors.donor, "reviewed");
});
