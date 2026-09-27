/**
 * The overview's panel grid.
 *
 * Twelve columns, one row, and the row is the height that is left after the title
 * and the strip. `grid-rows-1` is what makes it a definite `minmax(0, 1fr)` track
 * rather than an `auto` one: an auto row grows to its tallest item, so a panel
 * holding ninety candidate rows would push the page past the viewport and the
 * fixed shell would have nothing to do. With the track definite, each panel is
 * handed a height and absorbs its own overflow, which is the whole bargain of a
 * console that does not scroll.
 *
 * Only from lg, because that is where the rail appears and the height is known.
 * Below it the panels stack, the row is auto again and the page is free to scroll:
 * a phone has no other option, and cramming four panels into 600px would hide the
 * rows rather than fit them.
 */
export function OverviewGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-12 gap-4 lg:min-h-0 lg:flex-1 lg:grid-rows-1">
      {children}
    </div>
  );
}
