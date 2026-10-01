/**
 * The console's data palette.
 *
 * Chrome colours live in CSS, where `.console` can repaint them. Chart colours
 * cannot: a Recharts `stroke` or an SVG `fill` is a literal string in a prop, so
 * a repaint of the interface leaves the figures painting the old palette. That
 * is how a console can look redesigned everywhere except inside its charts.
 *
 * So the figures read from here, and here reads from the same decisions as the
 * stylesheet:
 *
 * - Chrome in a figure (axis, grid, reference line, a bar with no meaning of its
 *   own) is near black at an opacity, flattened to hex because SVG attributes
 *   do not take a CSS variable.
 * - Encoding is not chrome. Depleted and enriched are opposite directions of an
 *   effect and have to stay distinguishable, so they keep their own two colours
 *   and those two are the only hues in the console. Both clear WCAG AA as text.
 * - A sequential quantity uses one hue at three lightnesses rather than three
 *   hues, because the reader is meant to see more and less, not red and blue.
 */

/** Near black, and near black over white at 58%, 16%, 10% and 7%. */
export const INK = "#111111";
export const MUTED = "#6b6b6b";
export const LINE_STRONG = "#d6d6d6";
export const LINE = "#e2e2e2";
export const GRID = "#ededed";

/** The one accent, for a series that carries no direction of its own. */
export const NAVY = "#24334b";

/** Direction of effect. Not decoration: a guide that drops out is depleted
 *  whatever the interface looks like. */
export const DEPLETED = "#14596b";
export const ENRICHED = "#9a4a16";
export const DEPLETED_SOFT = "#d9e7eb";
export const ENRICHED_SOFT = "#f3e4d9";

/** Attention, matching the amber the status badges use. */
export const ATTENTION = "#8a4b0f";

/** More to less, in one hue. Used where a value is a quantity rather than a
 *  category, so the ramp reads as an ordering. */
export const SEQUENTIAL = ["#24334b", "#5b6b84", "#9aa3b2"] as const;

/** Recharts axis and tooltip chrome, so every figure in the console shares one. */
export const axisStyle = { fontSize: 11, fill: MUTED };
export const tooltipStyle = {
  borderRadius: 10,
  border: `1px solid ${LINE}`,
  fontSize: 12,
  color: INK,
};
