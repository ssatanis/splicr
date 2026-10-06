/**
 * A first guess at the experimental design, from the names the researcher
 * already chose.
 *
 * Sequencing cores and lab notebooks converge on the same handful of words:
 * T0, plasmid, DMSO, vehicle, untreated. Reading them saves a researcher from
 * filling in a table they have effectively already written. It is a guess and
 * the page says so: every row stays editable, and nothing is queued until a
 * person has looked at it.
 *
 * Pure, so the browser and the server apply the same rules.
 */
import type { IntakeSample, SampleRole } from "./shape";

const REFERENCE = /(^|[^a-z])(t0|d0|day ?0|plasmid|library|initial|input|early|reference|ref|start)([^a-z]|$)/i;
const CONTROL = /(^|[^a-z])(dmso|vehicle|veh|control|ctrl|untreated|untx|unt|mock|parental|wt|neg)([^a-z]|$)/i;
const PLASMID = /(^|[^a-z])(plasmid|pdna|library ?pool)([^a-z]|$)/i;

/** Which arm a sample name reads as. Treatment is the default, not a finding. */
export function guessRole(label: string): SampleRole {
  if (PLASMID.test(label)) return "plasmid";
  if (REFERENCE.test(label)) return "reference";
  if (CONTROL.test(label)) return "control";
  return "treatment";
}

const REPLICATE = /(?:^|[_\-. ])(?:r|rep|replicate)[_\-. ]?(\d{1,2}|[a-z])(?:$|[_\-. ])/i;
const TRAILING = /(?:[_\-. ])(\d{1,2}|[a-z])$/i;

export function guessReplicate(label: string): number {
  const parse = (val: string) => /^\d+$/.test(val) ? Number(val) : val.toUpperCase().charCodeAt(0) - 64;
  const named = label.match(REPLICATE);
  if (named) return Math.max(1, parse(named[1]));
  const trailing = label.match(TRAILING);
  if (trailing) return Math.max(1, parse(trailing[1]));
  return 1;
}

/** A FASTQ file name reduced to the sample it belongs to. */
export function sampleFromFileName(name: string): string {
  const base = (name.split("/").pop() ?? name)
    .replace(/\.(fastq|fq)(\.gz|\.bz2)?$/i, "")
    .replace(/[._-](R[12])(_001)?$/i, "")
    .replace(/_S\d+_L\d{3}$/i, "");
  const folder = name.includes("/") ? name.slice(0, name.lastIndexOf("/") + 1) : "";
  return folder + (base || name);
}

export function deriveSamples(
  countColumns: string[],
  fastqNames: { fileId: string; name: string }[],
): IntakeSample[] {
  if (countColumns.length > 0) {
    return countColumns.map((label) => ({
      label,
      role: guessRole(label),
      replicate: guessReplicate(label),
      file_id: null,
    }));
  }

  const grouped = new Map<string, typeof fastqNames>();
  for (const file of fastqNames) {
    const label = sampleFromFileName(file.name);
    grouped.set(label, [...(grouped.get(label) ?? []), file]);
  }
  return [...grouped].map(([label, files]) => {
    const read2 = files.filter((file) => /[._-]R2(?:_001)?\.(?:fastq|fq)(?:\.gz)?$/i.test(file.name));
    const read1 = files.filter((file) => !read2.includes(file));
    const chosen = read1.length ? read1 : read2;
    return {
      label,
      role: guessRole(label),
      replicate: guessReplicate(label),
      file_id: chosen[0].fileId,
      file_ids: chosen.map((file) => file.fileId),
      read1_file_ids: read1.map((file) => file.fileId),
      read2_file_ids: read2.map((file) => file.fileId),
    };
  });
}
