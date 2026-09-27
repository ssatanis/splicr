/**
 * The overview's panel grid.
 *
 * Twelve columns, one row, and from lg the row is exactly the height left over
 * after the title and the strip. `grid-rows-1` makes that a definite
 * `minmax(0, 1fr)` track rather than an `auto` one: an auto row grows to its
 * tallest item, so a panel holding seventy-six candidate rows would push the
 * page past the viewport and the fixed shell would have nothing left to do. With
 * the track definite each panel is handed a height and absorbs its own overflow,
 * which is the whole bargain of a console that does not scroll.
 *
 * The flex behaviour is written out rather than left to `flex-1`, because the
 * two cases are genuinely different and `flex-1` only gets one of them right:
 *
 *  - From lg: grow into the free space, basis zero, never shrink. The page fits
 *    the viewport and the tables scroll inside their panels.
 *  - Below lg: natural height, and `shrink-0` so the shell's `h-full` wrapper
 *    cannot squeeze it instead. Squeezing is what silently clipped the runs and
 *    the outcomes off the bottom of a 375px screen with nothing to scroll to.
 *    Overflowing the wrapper is the correct behaviour here: `main` scrolls it,
 *    and a phone has no other option.
 */
export function OverviewGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 shrink-0 grow-0 basis-auto grid-cols-12 gap-4 lg:min-h-0 lg:grow lg:basis-0 lg:grid-rows-1">
      {children}
    </div>
  );
}
