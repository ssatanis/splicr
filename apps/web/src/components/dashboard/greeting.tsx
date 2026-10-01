"use client";

import { useEffect, useState } from "react";

import {
  FALLBACK_TIME_ZONE,
  TIME_ZONE_COOKIE,
  clockIn,
  greetingIn,
  isValidTimeZone,
} from "@/lib/time";

/**
 * The heading on the overview: who is reading, which laboratory they are in,
 * and what time it is there.
 *
 * The greeting has to be right on the first paint, so it is computed on the
 * server from a zone the server already has, and this component starts from
 * exactly those two strings. That is what `initialGreeting` and `initialClock`
 * are for: rendering them unchanged on hydration is what stops the heading
 * flickering from one wording to another while the reader is looking at it.
 *
 * Then two things happen, both quietly:
 *
 *  - the clock re-renders on the minute, so a console left open overnight does
 *    not still say 6:26 PM;
 *  - if the server had no zone to work from, the browser's own zone is written
 *    to a cookie, so the next server render is right without asking anyone.
 *
 * The cookie is the reader's time zone and nothing else. It is not a location:
 * a zone is a clock, and the console needs a clock.
 */
export function Greeting({
  name,
  lab,
  timeZone,
  initialGreeting,
  initialClock,
  /** Rendered beside the laboratory name, for a sample workspace label. */
  badge,
}: {
  /** Already formatted by `greetingName`: a first name, or a title with the
   *  full name. Empty when SplicR does not know who is reading, in which case
   *  the greeting stands on its own rather than addressing nobody by name. */
  name: string;
  lab: string;
  /** The zone the server rendered with, or undefined when it had none. */
  timeZone?: string;
  initialGreeting: string;
  initialClock: string;
  badge?: React.ReactNode;
}) {
  const [{ greeting, clock }, setNow] = useState({
    greeting: initialGreeting,
    clock: initialClock,
  });

  useEffect(() => {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const browser = isValidTimeZone(resolved) ? resolved : FALLBACK_TIME_ZONE;

    // The lab's configured zone wins. The browser's is only consulted when the
    // server had nothing, which is the first request from a new device.
    const zone = isValidTimeZone(timeZone) ? timeZone : browser;

    if (!timeZone && browser !== FALLBACK_TIME_ZONE) {
      document.cookie = `${TIME_ZONE_COOKIE}=${encodeURIComponent(browser)}; path=/; max-age=31536000; samesite=lax`;
    }

    const tick = () => {
      const now = new Date();
      setNow({ greeting: greetingIn(now, zone), clock: clockIn(now, zone) });
    };
    tick();

    // Line up with the top of the next minute, then run once a minute, so the
    // displayed minute changes when the reader's clock does.
    let interval: ReturnType<typeof setInterval> | undefined;
    const timeout = setTimeout(() => {
      tick();
      interval = setInterval(tick, 60_000);
    }, 60_000 - (Date.now() % 60_000));

    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, [timeZone]);

  return (
    <div>
      {/* The strongest line on the page, and the only one at this size. It
          steps down on narrow screens so a long name with a title still fits on
          one line rather than wrapping under itself. */}
      <h1 className="text-[26px] font-medium leading-[1.15] tracking-[-0.022em] text-ink md:text-[30px] lg:text-[32px]">
        {name ? `${greeting}, ${name}` : greeting}
      </h1>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] leading-snug text-muted">
        <span className="text-ink">{lab}</span>
        {/* The clock is not a live region: it changes once a minute and
            announcing it would interrupt a screen reader mid-sentence for
            something nobody asked to be told. */}
        <span className="num" suppressHydrationWarning>
          {clock}
        </span>
        {badge}
      </p>
    </div>
  );
}
