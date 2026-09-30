/**
 * The three zones the overview is made of.
 *
 * The page this replaces put four panels on one screen at equal weight: a stat
 * strip, a 76-row candidate table, a runs panel and an outcomes panel. Measured,
 * that was 455 numbers and 190 interactive controls in one viewport. The density
 * was the symptom; the cause was that the page answered four questions at once
 * and none of them was the one a reader came for.
 *
 * So: three zones, in this order, and nothing else above the fold.
 *
 *   1. what is waiting on a decision      three counts, each a queue
 *   2. the screens this workspace holds   one row each
 *   3. what to do next                    four routes out
 *
 * The rule that keeps zone 1 honest is that every number counts things waiting
 * on a human. "6 screens" is inventory and does not appear; "4 screens need QC
 * review" is a queue and does. A total tells a reader nothing they can act on,
 * and this page exists to be acted on.
 */
import Link from "next/link";

import { StatusBadge } from "@/components/dashboard/ui";
import type { RunRow } from "@/components/dashboard/overview/types";

// ---------------------------------------------------------------------------
// Zone 1 — what is waiting on a decision
// ---------------------------------------------------------------------------

export interface Decision {
  /** The count. Null when the read could not answer, which is not zero. */
  value: number | null;
  /** What the number counts, as a queue rather than a total. Singular form. */
  one: string;
  /** The same, plural. */
  many: string;
  /** Where the reader goes to clear it. */
  href: string;
  /** Shown instead of the count when there is nothing waiting. */
  clear: string;
  /**
   * The one count that carries the accent, and there is only ever one.
   *
   * Three orange numbers beside an orange primary card is four things competing
   * to be looked at first, which is the same failure as the page this replaces,
   * only prettier. The accent marks the count that names the reader's actual
   * job, and it deliberately rhymes with the primary card at the foot of the
   * page: the same number, the same colour, top and bottom.
   */
  lead?: boolean;
}

/**
 * Three counts, each a link into the filtered view holding exactly those items.
 *
 * A zero is a good state and says so in words. Rendering `0` invites the reader
 * to wonder whether the number is a zero or a failure to load, and those are
 * different things: an unanswerable read renders "not recorded" instead.
 */
export function Decisions({ items }: { items: Decision[] }) {
  return (
    <section aria-label="Waiting on a decision">
      <ul className="grid gap-px overflow-hidden rounded-xl bg-line sm:grid-cols-3">
        {items.map((item) => {
          const settled = item.value === 0;
          return (
            <li key={item.many} className="bg-white">
              <Link
                href={item.href}
                className="group flex h-full flex-col justify-between gap-3 p-5 transition-colors hover:bg-cream focus-visible:bg-cream focus-visible:outline-none sm:p-6"
              >
                <span
                  className={[
                    "font-serif text-[2.6rem] leading-none tracking-[-0.01em]",
                    item.value === null
                      ? "text-muted"
                      : settled
                        ? "text-teal-800/45"
                        : item.lead
                          ? "text-orange-500"
                          : "text-ink",
                  ].join(" ")}
                >
                  {item.value === null ? "—" : settled ? "None" : item.value}
                </span>
                <span className="text-[13px] leading-snug text-body">
                  {item.value === null
                    ? "Not recorded"
                    : settled
                      ? item.clear
                      : item.value === 1
                        ? item.one
                        : item.many}
                  <span className="ml-1 inline-block text-muted transition-transform group-hover:translate-x-0.5">
                    &rarr;
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Zone 2 — the screens
// ---------------------------------------------------------------------------

/**
 * One row per screen: name, what it is, QC, and what is waiting on it.
 *
 * A screen whose QC verdict is `fail` shows no candidate count at all. A number
 * beside a failed verdict invites exactly the mistake this console exists to
 * prevent, which is taking a gene to a bench on the strength of a measurement
 * the QC stage already rejected.
 */
export function ScreenList({
  screens,
  hrefFor,
}: {
  screens: RunRow[];
  hrefFor: (screen: RunRow) => string;
}) {
  if (screens.length === 0) {
    return (
      <p className="rounded-xl border border-line bg-white p-6 text-[13px] text-body">
        No screens yet. Upload a count table to start one.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
      {screens.map((screen) => {
        const withheld = screen.qc === "fail";
        return (
          <li key={screen.id}>
            <Link
              href={hrefFor(screen)}
              className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-cream focus-visible:bg-cream focus-visible:outline-none"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-ink">
                  {screen.name}
                </span>
                <span className="mt-0.5 block truncate text-[11.5px] text-muted">
                  {screen.detail}
                </span>
              </span>

              <span className="hidden shrink-0 sm:block">
                <StatusBadge status={screen.qc} />
              </span>

              <span className="w-[8.5rem] shrink-0 text-right text-[12px] leading-snug">
                {withheld ? (
                  <span className="text-orange-700">Candidates withheld</span>
                ) : screen.hits === null ? (
                  <span className="text-muted">Not recorded</span>
                ) : screen.hits === 0 ? (
                  // Nothing waiting is a settled state, not a result to read.
                  <span className="text-muted">Nothing waiting</span>
                ) : (
                  <span className="text-body">
                    <span className="tabular-nums font-medium text-ink">{screen.hits}</span>{" "}
                    waiting
                  </span>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Zone 3 — what to do next
// ---------------------------------------------------------------------------

export interface NextAction {
  title: string;
  body: string;
  href: string;
  /** A count when something is waiting, which makes the card a queue too. */
  badge?: string | null;
  /** The one card that carries the accent. Exactly one, or none. */
  primary?: boolean;
}

/**
 * Four routes out of the overview.
 *
 * Orange marks the one card that wants a decision. If two cards were orange
 * neither would mean anything, so `primary` is set on at most one.
 */
export function NextActions({ actions }: { actions: NextAction[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {actions.map((action) => (
        <li key={action.title}>
          <Link
            href={action.href}
            className={[
              "group flex h-full flex-col gap-2 rounded-xl border p-5 transition-colors",
              action.primary
                ? "border-orange-500/35 bg-orange-50/60 hover:bg-orange-50"
                : "border-line bg-white hover:bg-cream",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-800/25",
            ].join(" ")}
          >
            <span className="flex items-baseline justify-between gap-2">
              <span
                className={[
                  "text-[14px] font-medium",
                  action.primary ? "text-orange-700" : "text-ink",
                ].join(" ")}
              >
                {action.title}
              </span>
              {action.badge ? (
                <span className="shrink-0 rounded-full bg-teal-800/8 px-2 py-0.5 text-[11px] tabular-nums text-ink">
                  {action.badge}
                </span>
              ) : null}
            </span>
            <span className="text-[12px] leading-snug text-muted">{action.body}</span>
            <span
              className={[
                "mt-auto pt-2 text-[12px] transition-transform group-hover:translate-x-0.5",
                action.primary ? "text-orange-600" : "text-teal-800/70",
              ].join(" ")}
            >
              &rarr;
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** A section heading small enough not to compete with the content under it. */
export function ZoneHeading({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
        {children}
      </h2>
      {action}
    </div>
  );
}
