import type { IntakeSample } from "./shape.ts";

export type Profile = "pooled_abundance" | "single_cell" | "combinatorial" | "variant" | "imaging";
export const PROFILES = [
  { id: "pooled_abundance", label: "Pooled guide abundance", available: true },
  { id: "single_cell", label: "Single-cell perturbation", available: false },
  { id: "combinatorial", label: "Guide pairs / genetic interactions", available: false },
  { id: "variant", label: "Variant or noncoding effects", available: false },
  { id: "imaging", label: "Imaging / feature measurements", available: false },
] as const;
export interface MleDesign { columns: string[]; rows: { sample: string; values: number[] }[]; coefficient: string; permutation_round: number; random_seed?: number }
export interface DrugzOptions { pseudocount: number; half_window_size: number }
export interface LibraryImportOptions { organism_taxid: number; modality: "knockout" | "crispri" | "crispra"; cas: string }
export const DEFAULT_LIBRARY: LibraryImportOptions = { organism_taxid: 9606, modality: "knockout", cas: "SpCas9" };

export function matrixRank(input: number[][]): number {
  const a = input.map((row) => [...row]); let rank = 0;
  for (let column = 0; column < (a[0]?.length ?? 0) && rank < a.length; column++) {
    const pivot = a.findIndex((row, i) => i >= rank && Math.abs(row[column]) > 1e-9);
    if (pivot < 0) continue;
    [a[rank], a[pivot]] = [a[pivot], a[rank]];
    const scale = a[rank][column]; a[rank] = a[rank].map((value) => value / scale);
    for (let i = rank + 1; i < a.length; i++) { const factor = a[i][column]; a[i] = a[i].map((value, j) => value - factor * a[rank][j]); }
    rank++;
  }
  return rank;
}

export function validateMle(design: MleDesign, samples: string[]): string | null {
  if (!design || !Array.isArray(design.columns) || !Array.isArray(design.rows)) return "The MLE design is incomplete.";
  if (design.columns.length < 2 || design.columns.length > 20 || new Set(design.columns).size !== design.columns.length || design.columns.some((name) => typeof name !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name))) return "MLE coefficients need unique names using letters, numbers and underscores.";
  if (!design.columns.slice(1).includes(design.coefficient)) return "Select an MLE coefficient other than the baseline.";
  if (design.rows.length !== samples.length || new Set(design.rows.map((row) => row?.sample)).size !== samples.length || design.rows.some((row) => !row || !samples.includes(row.sample))) return "MLE rows must match every selected sample exactly once.";
  if (design.rows.some((row) => !Array.isArray(row.values) || row.values.length !== design.columns.length || row.values.some((value) => !Number.isFinite(value)) || row.values[0] !== 1)) return "MLE values must be finite numbers with a baseline of 1.";
  if (samples.length <= design.columns.length) return "The MLE design needs more samples than coefficients to retain residual degrees of freedom.";
  if (matrixRank(design.rows.map((row) => row.values)) !== design.columns.length) return "MLE factors are confounded or constant. Remove redundant columns.";
  if (!Number.isInteger(design.permutation_round) || design.permutation_round < 10 || design.permutation_round > 1000) return "MLE permutation rounds must be an integer from 10 to 1,000.";
  if (!Number.isInteger(design.random_seed ?? 0) || (design.random_seed ?? 0) < 0 || (design.random_seed ?? 0) > 4294967295) return "MLE random seed must be an integer from 0 to 4,294,967,295.";
  return null;
}

export function defaultMle(samples: IntakeSample[], treatment: string[], control: string[]): MleDesign {
  const selected = new Set(samples.map((sample) => sample.label));
  if ([...treatment, ...control].some((label) => !selected.has(label))) throw new Error("Selected MLE samples are missing.");
  return { columns: ["baseline", "treatment"], coefficient: "treatment", permutation_round: 10, random_seed: 0, rows: [...control, ...treatment].map((sample) => ({ sample, values: [1, Number(treatment.includes(sample))] })) };
}

export function validateDrugz(options: DrugzOptions): string | null {
  if (!Number.isInteger(options.pseudocount) || options.pseudocount <= 0 || options.pseudocount > 1000) return "DrugZ pseudocount must be an integer from 1 to 1,000.";
  if (!Number.isInteger(options.half_window_size) || options.half_window_size < 2 || options.half_window_size > 10000) return "DrugZ smoothing half-window must be an integer from 2 to 10,000.";
  return null;
}

export function validateLibrary(options: LibraryImportOptions): string | null {
  if (![9606, 10090].includes(options.organism_taxid)) return "This abundance workflow currently supports human and mouse guide libraries.";
  if (!["knockout", "crispri", "crispra"].includes(options.modality)) return "Choose knockout, CRISPRi or CRISPRa for this guide-abundance workflow.";
  if (!["SpCas9", "dCas9"].includes(options.cas)) return "This intake currently supports Cas9 and dCas9 guide libraries.";
  return null;
}

export function methodRecommendations(fitness: boolean, drug: boolean, paired: boolean) {
  return [
    { method: "MAGeCK RRA", state: "Primary", reason: "Selected numerator versus denominator." },
    { method: "MAGeCK MLE", state: "Optional", reason: "Use explicit factors and a selected coefficient." },
    { method: "DrugZ", state: drug ? "Recommended" : "Not selected", reason: drug ? paired ? "Matched biological replicates must be confirmed." : "Unpaired drug versus vehicle comparison." : "Declare a chemogenetic comparison to use this method." },
    { method: "BAGEL2", state: fitness && !drug ? "Optional" : "Not appropriate", reason: "Requires a fitness endpoint and essential/nonessential reference overlap." },
  ];
}
