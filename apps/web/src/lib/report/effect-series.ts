/**
 * The shape the effect plot is drawn from, and the meaning of its mark bits.
 *
 * This lives apart from `lib/data/disagreement.ts` because that module is
 * `server-only`: it opens a Supabase client. The plot is a client component and
 * needs the bit constants at runtime, not just the types, so importing them
 * from there would drag the server module into the browser bundle.
 */

/**
 * Every recorded gene of one comparison, as parallel arrays.
 *
 * A genome-wide comparison is about twenty thousand genes and all of them are
 * drawn: a plot that quietly keeps the rows it finds convenient misrepresents
 * the experiment. Twenty thousand objects would cross to the browser with the
 * four keys repeated twenty thousand times. Four arrays carry the same values
 * in roughly half the bytes and load straight into typed arrays on the canvas
 * side.
 */
export interface EffectSeries {
  /** Gene symbols, ordered as the arrays below are. */
  gene: string[];
  lfc: number[];
  /** Recorded FDR. Null is kept as null and drawn on its own labelled row. */
  fdr: (number | null)[];
  /** Bit 1 a stored report exists, bit 2 fragile, bit 4 discordant. */
  marks: number[];
  /** Genes drawn. */
  recorded: number;
  /** Recorded in this comparison with no log2 fold change, so not placeable. */
  withoutEffect: number;
}

/** A stored guide-disagreement report exists, so the dot opens. */
export const MARK_HAS_REPORT = 1;
/** The gene's call turns on a single guide. */
export const MARK_FRAGILE = 2;
/** Its guides disagree more than this screen's own norm. */
export const MARK_DISCORDANT = 4;
