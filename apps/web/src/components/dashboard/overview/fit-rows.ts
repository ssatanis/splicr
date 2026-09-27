"use client";

/**
 * How many whole rows fit in the height a grid track handed a panel.
 *
 * THE PROBLEM THIS SOLVES. A panel on the console's one-screen grid is a `1fr`
 * track, so its height is whatever is left after the title line and the strip,
 * which is never a whole multiple of a 26px row. Measured before this existed,
 * the candidate table showed 13.6, 14.8, 18.0 and 21.5 rows at the four desktop
 * sizes tested: at three of them the bottom row was cut through the middle of
 * its digits, and a reader cannot tell whether the figure they can half see is
 * the one they were looking for.
 *
 * `DenseTable`'s `maxRows` already caps a table at a whole number of rows. What
 * it could not do is know the number, because the number depends on a height the
 * browser only resolves during layout. So the panel is measured, and the row
 * count is arithmetic on the chrome tokens: head, the caveat line when there is
 * one, the sticky thead and the footer are all fixed heights.
 *
 * WHY IT CANNOT LOOP. The cap is applied to the table's scroller, never to the
 * element being observed, and it is only read at widths where the panel sits in
 * a definite track. Below that breakpoint the grid row is `auto`, the panel is as
 * tall as its content, and capping it would shrink the panel, which would shrink
 * the cap, forever. There the hook returns undefined and the table is uncapped,
 * which is correct anyway: `main` scrolls at those widths and a phone has no
 * other option.
 */
import { useEffect, useRef, useState } from "react";

import { PANEL_CHROME } from "@/components/dashboard/ui";

/** The `lg` breakpoint, where the overview grid starts handing out definite heights. */
const DEFINITE_TRACK = "(min-width: 1024px)";

export function useFitRows({
  rowPx = PANEL_CHROME.row,
  footer = false,
  caveat = false,
}: {
  rowPx?: number;
  footer?: boolean;
  caveat?: boolean;
} = {}) {
  const ref = useRef<HTMLElement>(null);
  const [maxRows, setMaxRows] = useState<number | undefined>(undefined);

  useEffect(() => {
    const node = ref.current;
    if (node === null || typeof ResizeObserver === "undefined") return;

    const definite = window.matchMedia(DEFINITE_TRACK);

    const measure = () => {
      if (!definite.matches) {
        setMaxRows(undefined);
        return;
      }
      const chrome =
        PANEL_CHROME.head +
        PANEL_CHROME.thead +
        (footer ? PANEL_CHROME.foot : 0) +
        (caveat ? PANEL_CHROME.caveat : 0);
      const rows = Math.floor((node.clientHeight - chrome) / rowPx);
      // One row, never zero. A panel showing its heading and nothing under it
      // reads as a panel that failed, and the floor on the panel itself
      // guarantees the space for one.
      setMaxRows(Math.max(1, rows));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    definite.addEventListener("change", measure);
    return () => {
      observer.disconnect();
      definite.removeEventListener("change", measure);
    };
  }, [rowPx, footer, caveat]);

  return { ref, maxRows };
}
