import type { ExperimentComparison, ExperimentTable } from "./experiment.ts";

/** Exact archive bytes, not a filename or a desired hit, identify this study. */
export const FERRARONE = {
  id: "ferrarone-2024-lkb1",
  paper: "https://doi.org/10.1073/pnas.2403685121",
  dataset: "https://doi.org/10.7910/DVN/8DEPIT",
  sources: [
    { culture: "2d", sha256: "b5e01844036815b4636b7e958e5678fd814a7b5c7e11130e93b423c37ed58601", fileId: 7440985 },
    { culture: "3d", sha256: "efa79d1cb179db64240e1be0f732de35d145038b473dc49ba33c3697c05f2dec", fileId: 7440983 },
  ],
} as const;

export function publishedStudyTable(table: ExperimentTable, sha256?: string | null): ExperimentTable {
  const source = FERRARONE.sources.find((source) => source.sha256 === sha256);
  if (!source || table.rows !== 70116) return table;
  const expected = ["tkov3_plasmid", ...["ev", "wt"].flatMap((arm) => ["a", "b"].map((rep) => `${arm}_${source.culture}_d21_${rep}`))];
  if (table.samples.length !== expected.length || expected.some((label) => !table.samples.some((sample) => sample.label === label))) return table;
  return {
    ...table,
    model: "A549",
    study: { id: FERRARONE.id, culture: source.culture, dataset: FERRARONE.dataset, paper: FERRARONE.paper, source_sha256: source.sha256 },
    samples: table.samples.map((sample) => ({
      ...sample,
      role: sample.label === "tkov3_plasmid" ? "plasmid" : sample.label.startsWith("ev_") ? "control" : "treatment",
      replicate: sample.label.endsWith("_b") ? 2 : 1,
      factors: {
        model: "A549",
        condition: sample.label === "tkov3_plasmid" ? "TKOv3 plasmid" : sample.label.startsWith("ev_") ? "LKB1-null (EV)" : "LKB1 restored (WT)",
        culture: source.culture === "3d" ? "spheroid" : "2D monolayer",
        timepoint: sample.label === "tkov3_plasmid" ? "plasmid" : "21",
        perturbation_type: "genetic restoration",
      },
    })),
    warnings: [...table.warnings, "Verified Ferrarone 2024 archive: EV is LKB1-null; WT restores LKB1. The plasmid is one shared reference, not a biological replicate. These are editable reanalysis comparisons; the paper used MAGeCK MLE and a low-read filter whose precise rule is not specified."],
  };
}

export function publishedStudyComparisons(table: ExperimentTable, index: number): ExperimentComparison[] | null {
  if (table.study?.id !== FERRARONE.id) return null;
  const culture = table.study.culture;
  const title = culture === "3d" ? "Spheroid" : "2D";
  const ev = ["a", "b"].map((rep) => `ev_${culture}_d21_${rep}`);
  const wt = ["a", "b"].map((rep) => `wt_${culture}_d21_${rep}`);
  const make = (arm: string, treatment: string[], control: string[], fitness: boolean): ExperimentComparison => ({
    id: `${index}:${FERRARONE.id}:${culture}:${arm}`, table: index,
    name: `${title}: ${arm}`, model: table.model,
    phenotype: fitness ? "Proliferation" : "LKB1-dependent growth suppression",
    treatment, control, fitness, drug: false, enabled: true,
  });
  return [make("EV vs plasmid", ev, ["tkov3_plasmid"], true), make("WT vs plasmid", wt, ["tkov3_plasmid"], true), make("WT vs EV", wt, ev, false)];
}
