"use client";

/**
 * A scroll container a keyboard can reach.
 *
 * A wide table scrolls sideways inside its panel, and a mouse user drags or
 * wheels it. A keyboard user has nothing to Tab to, so the rest of the table is
 * unreachable: WCAG 2.1.1 and the axe rule `scrollable-region-focusable`. The
 * fix is to make the container a focus stop, but only when it actually scrolls.
 * A tab stop on a table that fits is noise, and this console has a table on
 * nearly every page.
 *
 * Whether it scrolls depends on the width it is given, so it is measured, and
 * measured again when the width changes. The measurement lives in a resize
 * observer's callback and not in an effect body, which also means the server
 * render and the first client render agree (not focusable) and never mismatch.
 */
import { useEffect, useRef, useState } from "react";

export function ScrollRegion({
  className,
  style,
  label,
  children,
}: {
  className?: string;
  style?: React.CSSProperties;
  label: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    // Any overflow at all counts. A container that scrolls by one pixel is
    // still a scroll container to a keyboard, and to the accessibility rule that
    // checks for it, so a tolerance here would reintroduce the failure it fixes.
    const measure = () => setScrolls(node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight);
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    // The table inside can grow without the container resizing (rows arrive).
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={style}
      // role and name only when it can be focused, because a focusable region
      // has to have both and a region that cannot be focused has no business
      // being announced as one.
      {...(scrolls ? { tabIndex: 0, role: "region", "aria-label": label } : {})}
    >
      {children}
    </div>
  );
}
