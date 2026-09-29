/**
 * How the planner prints a quantity. One place, so "149 million cells" is
 * written the same way in a tile, a table and an export, and so a reader never
 * has to count zeros.
 */

const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function formatInt(n: number): string {
  return int.format(Math.round(n));
}

/** 1,234 stays 1,234; 149,394,000 becomes "149 million"; 3.9e9 becomes "3.9 billion". */
export function formatCount(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${trim(n / 1e9)} billion`;
  if (abs >= 1e6) return `${trim(n / 1e6)} million`;
  return formatInt(n);
}

/** The same quantity for a narrow tile: 149M, 3.9B. */
export function formatShort(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${trim(n / 1e9)}B`;
  if (abs >= 1e6) return `${trim(n / 1e6)}M`;
  return formatInt(n);
}

function trim(value: number): string {
  const digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2;
  return Number(value.toFixed(digits)).toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function formatUsd(n: number): string {
  if (n >= 100_000) return `$${trim(n / 1e3)}k`;
  return `$${int.format(Math.round(n))}`;
}

/** A fraction as a percentage that stays readable at both ends of its range. */
export function formatFraction(fraction: number): string {
  if (fraction === 0) return "0%";
  const pct = fraction * 100;
  if (pct < 0.001) return "under 0.001%";
  if (pct < 0.1) return `${pct.toFixed(3)}%`;
  if (pct < 10) return `${pct.toFixed(2)}%`;
  return `${pct.toFixed(1)}%`;
}

export function formatMicrograms(ug: number): string {
  return ug >= 1000 ? `${trim(ug / 1000)} mg` : `${Math.round(ug).toLocaleString("en-US")} µg`;
}

export function formatLog2(value: number): string {
  return value.toFixed(3);
}
