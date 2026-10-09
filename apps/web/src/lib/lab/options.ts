import { z } from "zod";
const timePoint = z.object({ sample: z.string().min(1), day: z.number().finite().min(0), replicate: z.string().trim().min(1), condition: z.string().trim().min(1) }).strict();
export const labOptionsSchema = z.object({
  isoforms: z.boolean().optional(), context: z.boolean().optional(), depmap_release: z.enum(["24Q4", "26Q1"]).optional(),
  transcript_expression_file_id: z.uuid().optional(),
  transcript_expression: z.record(z.string().min(1), z.number().finite().min(0)).optional(), expression_source: z.string().trim().min(1).max(400).optional(),
  time_course: z.array(timePoint).max(500).optional(), kinetic_normalization: z.enum(["median", "control"]).optional(),
  pseudocount: z.number().finite().positive().optional(), reagent_lot: z.string().trim().max(200).optional(),
}).strict();
export type LabOptions = z.infer<typeof labOptionsSchema>;
export function validateLabOptions(value: unknown, samples: string[]): string | null {
  const parsed = labOptionsSchema.safeParse(value);
  if (!parsed.success) return `Lab evidence settings: ${parsed.error.issues[0]?.message ?? "Invalid input"}.`;
  const options = parsed.data;
  if (options.transcript_expression_file_id && (!options.isoforms || options.transcript_expression)) return "Choose either an uploaded expression matrix or inline transcript measurements, with isoform mapping enabled.";
  if (options.transcript_expression && (!options.isoforms || !options.expression_source || !Object.keys(options.transcript_expression).length)) return "Transcript measurements need isoform mapping, a named source and at least one measurement.";
  const used = new Set<string>(); const groups = new Map<string, Set<number>>();
  for (const point of options.time_course ?? []) {
    if (!samples.includes(point.sample) || used.has(point.sample)) return "Each time-course sample must be selected exactly once in the count matrix.";
    used.add(point.sample);
    const key = JSON.stringify([point.condition, point.replicate]);
    const days = groups.get(key) ?? new Set<number>();
    if (days.has(point.day)) return "Each condition / biological trajectory must have distinct time points. Aggregate technical repeats before this fit.";
    days.add(point.day); groups.set(key, days);
  }
  if ([...groups.values()].some(days => days.size < 3)) return "Each biological trajectory needs at least three distinct time points.";
  return null;
}
/** Import measured abundances, never guessed expression or duplicate identifiers. */
export function parseTranscriptExpression(text: string): Record<string, number> {
  let values: Record<string, number>;
  if (text.trim().startsWith("{")) {
    const keys = new Set<string>();
    for (const match of text.matchAll(/("(?:\\.|[^"\\])*")\s*:/g)) {
      const key: string = JSON.parse(match[1]);
      if (keys.has(key)) throw new Error(`Duplicate transcript identifier ${key}.`);
      keys.add(key);
    }
    values = JSON.parse(text);
  }
  else {
    values = Object.create(null); const rows = text.trim().split(/\r?\n/).map(line => line.split("\t"));
    if (!rows.length || rows[0].length !== 2 || !/^(transcript|transcript_id)$/i.test(rows[0][0]) || !/^(tpm|abundance)$/i.test(rows[0][1])) throw new Error("Use two-column TSV with transcript_id and TPM headers, or a transcript-to-abundance JSON object.");
    for (const row of rows.slice(1)) {
      if (row.length !== 2 || !row[0].trim() || !row[1].trim()) throw new Error("Every transcript needs one explicit abundance; blanks are not zero.");
      if (Object.hasOwn(values, row[0])) throw new Error(`Duplicate transcript identifier ${row[0]}.`);
      values[row[0]] = Number(row[1]);
    }
  }
  const parsed = z.record(z.string().min(1), z.number().finite().min(0)).safeParse(values);
  if (!parsed.success || !Object.keys(values).length) throw new Error("Transcript measurements must be finite nonnegative numbers.");
  return parsed.data;
}
