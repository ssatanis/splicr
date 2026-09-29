/**
 * How a recorded statistic is printed on the report. Never rounds a small value
 * to zero: 0.0000123 is 1.23e-5, because a p-value that reads 0.000 has lost the
 * one thing a reader wanted from it. A missing value is said to be missing.
 */

export function formatStat(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "Not recorded";
  const n = Number(value);
  return n !== 0 && Math.abs(n) < 0.001 ? n.toExponential(2) : n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

/** A signed effect size: the sign is the direction and is never dropped. */
export function formatSigned(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "Not recorded";
  const n = Number(value);
  const text = formatStat(n);
  return n > 0 ? `+${text}` : text;
}

export function formatPercent(fraction: number | null): string {
  if (fraction === null || !Number.isFinite(fraction)) return "Not recorded";
  const pct = fraction * 100;
  return `${pct >= 10 || pct === 0 ? pct.toFixed(0) : pct.toFixed(1)}%`;
}

/** How many recorded guide effects point the same way as the gene-level effect. */
export function guidesAgreeing(guideLfcs: readonly number[] | null, geneLfc: number | null): { agree: number; total: number } | null {
  if (!guideLfcs || guideLfcs.length === 0 || geneLfc === null || geneLfc === 0 || !Number.isFinite(geneLfc)) return null;
  const finite = guideLfcs.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return null;
  return { agree: finite.filter((value) => Math.sign(value) === Math.sign(geneLfc)).length, total: finite.length };
}
