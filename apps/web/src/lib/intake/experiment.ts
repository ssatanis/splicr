import { deriveSamples, guessReplicate } from "./derive.ts";
import type { IntakeSample } from "./shape.ts";

export interface ExperimentTable {
  fileId: string; name: string; sheet: string; model: string;
  samples: IntakeSample[]; rows: number; preview: string[][]; warnings: string[];
  mapping?: import("./mapping.ts").TableMapping;
}
export interface ExperimentComparison {
  id: string; table: number; name: string; model: string; phenotype: string;
  treatment: string[]; control: string[]; drug: boolean; enabled: boolean;
  fitness?: boolean;
  mle_design?: import("./analysis-plan.ts").MleDesign;
}

export function suggestComparisons(tables: ExperimentTable[]): ExperimentComparison[] {
  const out: ExperimentComparison[] = [];
  tables.forEach((table, index) => {
    const models = [...new Set(table.samples.map((sample) => sample.factors?.model || table.model))];
    for (const model of models) {
    const samples = table.samples.filter((sample) => (sample.factors?.model || table.model) === model);
    const references = samples.filter((sample) => sample.role === "reference" || sample.role === "plasmid").map((sample) => sample.label);
    const controls = samples.filter((sample) => sample.role === "control").map((sample) => sample.label);
    if (references.length && controls.length) out.push({ id: `${index}:${model}:fitness`, table: index, name: `Essentiality ${model}`, model, phenotype: "Growth", treatment: controls, control: references, drug: false, fitness: true, enabled: true });
    const groups = new Map<string, { condition: string; timepoint: string; treatment: string[] }>();
    samples.filter((sample) => sample.role === "treatment").forEach((sample) => {
      const condition = sample.factors?.condition || sample.label.replace(/(?:^|[_ .-])(?:(?:rep(?:licate)?|r)[_ .-]?([0-9]{1,2}|[A-Za-z])|[_ .-]+([0-9]{1,2}|[A-Za-z]))$/i, "").replace(/^(?:D|day)[_ ]?\d+[_ .-]+/i, "");
      const timepoint = sample.factors?.timepoint ?? "", dose = sample.factors?.dose ?? "";
      const key = [condition, timepoint, dose].filter(Boolean).join(" / ");
      groups.set(key, { condition, timepoint, treatment: [...(groups.get(key)?.treatment ?? []), sample.label] });
    });
    for (const [label, { condition, timepoint, treatment }] of groups) {
      const matchingControls = samples.filter((sample) => sample.role === "control" && (!timepoint || !sample.factors?.timepoint || sample.factors.timepoint === timepoint)).map((sample) => sample.label);
      const denominator = controls.length ? matchingControls : references;
      if (!denominator.length) continue;
      const drug = controls.length > 0;
      out.push({ id: `${index}:${model}:${label}`, table: index, name: `${label === condition && condition === "GEF" ? "Gefitinib" : label === condition && condition === "TRM" ? "Trametinib" : label} ${model}`, model, phenotype: drug ? "Drug sensitisation and resistance" : "Growth", treatment, control: denominator, drug, fitness: !drug, enabled: true });
    }
    }
  });
  return out;
}

export function applySampleMetadata(tables: ExperimentTable[], records: Record<string, string>[], sampleColumn?: string): ExperimentTable[] {
  const get = (row: Record<string, string>, names: RegExp) => Object.entries(row).find(([key]) => names.test(key))?.[1];
  const assignments = new Map<string, Record<string, string>>();
  for (const row of records) {
    const label = sampleColumn ? row[sampleColumn] : get(row, /^(sample|sample[_ ]?(id|name)|run)$/i);
    if (!label) throw new Error("Sample metadata needs a nonempty sample ID in every row.");
    const sheet = get(row, /^(sheet|table)$/i), model = get(row, /^(model|cell[_ ]?line)$/i);
    const candidates = tables.flatMap((table, i) => table.samples.some((sample) => sample.label === label) && (!sheet || sheet === table.sheet) && (!model || table.model === model || tables.filter((value) => value.samples.some((sample) => sample.label === label)).length === 1) ? [i] : []);
    if (!candidates.length) throw new Error(`Metadata sample ${label} is not present in its declared count table.`);
    if (candidates.length > 1) throw new Error(`Sample ${label} occurs in multiple tables. Include a sheet or model column to disambiguate it.`);
    const key = `${candidates[0]}:${label}`;
    if (assignments.has(key)) throw new Error(`Duplicate metadata for ${label}. Resolve it before applying.`);
    assignments.set(key, row);
  }
  return tables.map((table, i) => ({ ...table, samples: table.samples.map((sample) => {
    const row = assignments.get(`${i}:${sample.label}`); if (!row) return sample;
    const role = get(row, /^role$/i)?.toLowerCase();
    const aliases: Record<string, IntakeSample["role"]> = { baseline: "reference", t0: "reference", reference: "reference", plasmid: "plasmid", control: "control", vehicle: "control", treatment: "treatment", treated: "treatment", endpoint: "treatment" };
    if (role && !aliases[role]) throw new Error(`Sample ${sample.label}: role ${role} is not recognized.`);
    const replicate = get(row, /^(rep|replicate|biological[_ ]?replicate)$/i);
    if (replicate && (!Number.isInteger(Number(replicate)) || Number(replicate) < 1)) throw new Error(`Sample ${sample.label} needs a positive integer replicate.`);
    const factors: Record<string, string> = { ...sample.factors, ...row, model: get(row, /^(model|cell[_ ]?line)$/i) || sample.factors?.model || table.model, condition: get(row, /^(condition|treatment|drug)$/i) || sample.factors?.condition || "" };
    for (const key of ["timepoint", "dose", "batch", "donor"]) { const value = get(row, new RegExp(`^${key}$`, "i")); if (value) factors[key] = value; }
    return { ...sample, role: role ? aliases[role] : sample.role, replicate: replicate ? Number(replicate) : sample.replicate, factors };
  }) }));
}

/** The earliest unlabelled day is proposed as baseline only when later vehicle arms exist. */
export function tableSamples(columns: string[]): IntakeSample[] {
  const samples = deriveSamples(columns, []);
  if (!samples.some((sample) => sample.role === "reference") && samples.some((sample) => sample.role === "control")) {
    const days = columns.map((label) => label.match(/^(?:D|day)[_ ]?(\d+)(?:[_ .-]|$)/i)).filter(Boolean).map((match) => Number(match![1]));
    if (new Set(days).size > 1) {
      const first = Math.min(...days);
      samples.forEach((sample) => {
        const match = sample.label.match(/^(?:D|day)[_ ]?(\d+)[_ .-]+(?:rep(?:licate)?|r)?[_ .-]?\d+$/i);
        if (match && Number(match[1]) === first) sample.role = "reference";
      });
    }
  }
  return samples.map((sample) => ({ ...sample, replicate: guessReplicate(sample.label) }));
}
