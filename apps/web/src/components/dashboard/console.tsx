/**
 * The pieces that sit inside a panel, for the console pages.
 *
 * This file used to hold a second panel, a second table and a second chip,
 * written before the same system landed in `ui.tsx`. Two containers with the
 * same geometry is how a console drifts into two consoles, so the duplicates
 * are gone: `Panel`, `DenseTable`, `StatusChip` and the KPI strip come from
 * `ui.tsx` and there is exactly one of each.
 *
 * What is left is the three things a page owes a reader that a container cannot
 * carry for it. Whether the figures are real. How one of them was arrived at.
 * How to get the rows out into R, Excel or Prism.
 */
import { Info } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The sample-data label, which is not optional anywhere a fixture is rendered.
 * One line at 11.5px rather than a three-line banner: it has to be read once,
 * and every pixel it takes is a pixel of table somebody does not get to see.
 */
export function SampleNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex min-w-0 shrink-0 items-start gap-1.5 rounded-lg border border-orange-100 bg-orange-50 px-2.5 py-1 text-[11.5px] leading-snug text-orange-700">
      <Info className="mt-[2px] h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/**
 * A term and its value on one line, for provenance and for arithmetic.
 *
 * The note is where the working goes. A figure whose derivation is not on the
 * same line as the figure is a figure this audience will not quote.
 */
export function DefRow({
  term,
  value,
  note,
  tone = "ink",
}: {
  term: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  tone?: "ink" | "orange" | "cyan";
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-1.5 last:border-0">
      <div className="min-w-0">
        <div className="text-[12px] leading-tight text-ink">{term}</div>
        {note && <div className="mt-0.5 text-[11px] leading-snug text-muted">{note}</div>}
      </div>
      <div
        className={cn(
          "num shrink-0 text-[12px] leading-tight",
          tone === "orange" ? "text-orange-600" : tone === "cyan" ? "text-cyan-600" : "text-ink",
        )}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * The design law: every number on screen is one click from an export that opens
 * in R, Excel or Prism. The three formats are the same document, so they sit
 * together rather than behind a menu that hides which formats exist.
 */
export function ExportLinks({
  screenId,
  className,
  label = "Export",
}: {
  screenId: string;
  className?: string;
  label?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", className)}>
      {label !== "" && <span className="text-muted">{label}</span>}
      {(["csv", "json", "pdf"] as const).map((format) => (
        <a
          key={format}
          href={`/api/report/${screenId}?format=${format}`}
          className="rounded-sm uppercase text-cyan-600 underline decoration-line-strong underline-offset-2 transition-colors duration-[var(--dur-1)] hover:decoration-cyan-600 motion-reduce:transition-none"
        >
          {format}
          <span className="sr-only"> export for this screen</span>
        </a>
      ))}
    </span>
  );
}

/**
 * Stretches a row's first link over the whole row, so the target is the row
 * rather than the few characters of its name. Goes with `ROW_HIT` from ui.tsx,
 * which is what supplies the positioning context and the hover tint.
 */
export const ROW_LINK = "before:absolute before:inset-0 before:content-['']";

/** Anything clickable in a later cell has to paint above that stretched area. */
export const ABOVE_ROW_LINK = "relative z-10";
