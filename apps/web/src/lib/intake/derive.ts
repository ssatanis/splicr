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

const REPLICATE = /(?:^|[_\-. ])(?:r|rep|replicate)[_\-. ]?(\d{1,2})(?:$|[_\-. ])/i;
const TRAILING = /(\d{1,2})$/;

export function guessReplicate(label: string): number {
  const named = label.match(REPLICATE);
  if (named) return Math.max(1, Number(named[1]));
  const trailing = label.match(TRAILING);
  if (trailing) return Math.max(1, Number(trailing[1]));
  return 1;
}

/** A FASTQ file name reduced to the sample it belongs to. */
export function sampleFromFileName(name: string): string {
  const base = (name.split("/").pop() ?? name)
    .replace(/\.(fastq|fq)(\.gz|\.bz2)?$/i, "")
    .replace(/[._-](R?[12])(_001)?$/i, "")
    .replace(/_S\d+_L\d{3}$/i, "");
  return base || name;
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

  const byLabel = new Map<string, IntakeSample>();
  for (const file of fastqNames) {
    const label = sampleFromFileName(file.name);
    if (byLabel.has(label)) continue;
    byLabel.set(label, {
      label,
      role: guessRole(label),
      replicate: guessReplicate(label),
      file_id: file.fileId,
    });
  }
  return [...byLabel.values()];
}
