import { sampleFactors } from "./inference.ts";
import { deriveSamples, guessReplicate } from "./derive.ts";
import type { IntakeSample } from "./shape.ts";
import { publishedStudyComparisons } from "./published-study.ts";

export interface ExperimentTable {
  study?: { id: string; culture: "2d" | "3d"; dataset: string; paper: string; source_sha256: string };
  fileId: string;
  name: string;
  sheet: string;
  model: string;
  samples: IntakeSample[];
  rows: number;
  preview: string[][];
  warnings: string[];
  mapping?: import("./mapping.ts").TableMapping;
}
export interface ExperimentComparison {
  id: string;
  table: number;
  name: string;
  model: string;
  phenotype: string;
  treatment: string[];
  control: string[];
  drug: boolean;
  enabled: boolean;
  fitness?: boolean;
  mle_design?: import("./analysis-plan.ts").MleDesign;
  lab_evidence?: import("@/lib/lab/options").LabOptions;
}

export function suggestComparisons(tables: ExperimentTable[]): ExperimentComparison[] {
  const out: ExperimentComparison[] = [];
  tables.forEach((table, index) => {
    const published = publishedStudyComparisons(table, index);
    if (published) { out.push(...published); return; }
    const models = [
      ...new Set(
        table.samples
          .filter((s) => !["reference", "plasmid"].includes(s.role))
          .map((s) => s.factors?.model || table.model),
      ),
    ];
    for (const model of models) {
      const samples = table.samples.filter(
        (s) =>
          (s.factors?.model || table.model) === model ||
          (["reference", "plasmid"].includes(s.role) && !s.factors?.model),
      );
      const references = samples
        .filter((s) => s.role === "reference" || s.role === "plasmid")
        .map((s) => s.label);
      const controls = samples.filter((s) => s.role === "control");
      const groups = new Map<
        string,
        { condition: string; timepoint: string; treatment: string[]; drug: boolean }
      >();
      // A vehicle endpoint can itself be compared with the start of the screen.
      for (const sample of samples.filter(
        (s) => s.role === "treatment" || (s.role === "control" && references.length),
      )) {
        if (/^empty$/i.test(sample.label)) continue;
        const factors = { ...sampleFactors(sample.label), ...sample.factors };
        const condition = factors.condition || sample.label;
        const timepoint = factors.timepoint || "";
        const key = [condition, timepoint, factors.dose].filter(Boolean).join(" / ");
        const drug = sample.role === "treatment" && controls.length > 0;
        groups.set(key, {
          condition,
          timepoint,
          drug,
          treatment: [...(groups.get(key)?.treatment ?? []), sample.label],
        });
      }
      for (const [label, group] of groups) {
        const denominator = group.drug
          ? controls
              .filter(
                (s) =>
                  !group.timepoint ||
                  !s.factors?.timepoint ||
                  s.factors.timepoint === group.timepoint,
              )
              .map((s) => s.label)
          : references;
        if (!denominator.length) continue;
        out.push({
          id: `${index}:${model}:${label}`,
          table: index,
          name: `${label} ${group.drug ? "vs control" : "vs baseline"}`,
          model,
          phenotype: group.drug ? "Drug interaction" : "Fitness",
          treatment: group.treatment,
          control: denominator,
          drug: group.drug,
          fitness: !group.drug,
          enabled: true,
        });
      }
    }
  });
  return out;
}

export function applySampleMetadata(
  tables: ExperimentTable[],
  records: Record<string, string>[],
  sampleColumn?: string,
): ExperimentTable[] {
  const get = (row: Record<string, string>, names: RegExp) =>
    Object.entries(row).find(([key]) => names.test(key))?.[1];
  const assignments = new Map<string, Record<string, string>>();
  for (const row of records) {
    const label = sampleColumn
      ? row[sampleColumn]
      : get(row, /^(sample|sample[_ ]?(id|name)|run)$/i);
    if (!label)
      throw new Error("Sample metadata needs a nonempty sample ID in every row.");
    const sheet = get(row, /^(sheet|table)$/i),
      model = get(row, /^(model|cell[_ ]?line)$/i);
    const candidates = tables.flatMap((table, i) =>
      table.samples.some((sample) => sample.label === label) &&
      (!sheet || sheet === table.sheet) &&
      (!model ||
        table.model === model ||
        tables.filter((value) => value.samples.some((sample) => sample.label === label))
          .length === 1)
        ? [i]
        : [],
    );
    if (!candidates.length)
      throw new Error(
        `Metadata sample ${label} is not present in its declared count table.`,
      );
    if (candidates.length > 1)
      throw new Error(
        `Sample ${label} occurs in multiple tables. Include a sheet or model column to disambiguate it.`,
      );
    const key = `${candidates[0]}:${label}`;
    if (assignments.has(key))
      throw new Error(`Duplicate metadata for ${label}. Resolve it before applying.`);
    assignments.set(key, row);
  }
  return tables.map((table, i) => ({
    ...table,
    samples: table.samples.map((sample) => {
      const row = assignments.get(`${i}:${sample.label}`);
      if (!row) return sample;
      const role = get(row, /^role$/i)?.toLowerCase();
      const aliases: Record<string, IntakeSample["role"]> = {
        baseline: "reference",
        t0: "reference",
        reference: "reference",
        plasmid: "plasmid",
        control: "control",
        vehicle: "control",
        treatment: "treatment",
        treated: "treatment",
        endpoint: "treatment",
      };
      if (role && !aliases[role])
        throw new Error(`Sample ${sample.label}: role ${role} is not recognized.`);
      const replicate = get(row, /^(rep|replicate|biological[_ ]?replicate)$/i);
      if (replicate && (!Number.isInteger(Number(replicate)) || Number(replicate) < 1))
        throw new Error(`Sample ${sample.label} needs a positive integer replicate.`);
      const factors: Record<string, string> = {
        ...sample.factors,
        ...row,
        model:
          get(row, /^(model|cell[_ ]?line)$/i) || sample.factors?.model || table.model,
        condition:
          get(row, /^(condition|treatment|drug)$/i) || sample.factors?.condition || "",
      };
      for (const key of ["timepoint", "dose", "batch", "donor"]) {
        const value = get(row, new RegExp(`^${key}$`, "i"));
        if (value) factors[key] = value;
      }
      return {
        ...sample,
        role: role ? aliases[role] : sample.role,
        replicate: replicate ? Number(replicate) : sample.replicate,
        factors,
      };
    }),
  }));
}

/** The earliest unlabelled day is proposed as baseline only when later vehicle arms exist. */
export function tableSamples(columns: string[]): IntakeSample[] {
  const samples = deriveSamples(columns, []);
  if (
    !samples.some((sample) => sample.role === "reference") &&
    samples.some((sample) => sample.role === "control")
  ) {
    const days = columns
      .map((label) => label.match(/^(?:D|day)[_ ]?(\d+)(?:[_ .-]|$)/i))
      .filter(Boolean)
      .map((match) => Number(match![1]));
    if (new Set(days).size > 1) {
      const first = Math.min(...days);
      samples.forEach((sample) => {
        const match = sample.label.match(
          /^(?:D|day)[_ ]?(\d+)[_ .-]+(?:rep(?:licate)?|r)?[_ .-]?\d+$/i,
        );
        if (match && Number(match[1]) === first) sample.role = "reference";
      });
    }
  }
  return samples.map((sample) => ({
    ...sample,
    replicate: guessReplicate(sample.label),
    factors: sampleFactors(sample.label),
  }));
}
