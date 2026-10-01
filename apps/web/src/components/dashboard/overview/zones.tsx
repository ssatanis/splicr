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
import { FlaskConical, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/dashboard/empty-state";
import { StatusBadge } from "@/components/dashboard/ui";
import type { RunRow } from "@/components/dashboard/overview/types";
import { cn } from "@/lib/utils";

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
      <EmptyState
        icon={FlaskConical}
        title="Run your first screen"
        body="Upload a count table or FASTQ files, or enter a public GEO, SRA or ENA accession."
        action={{ label: "New screen", href: "/dashboard/upload" }}
      />
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
  /** A count when something is waiting, which makes the row a queue too. */
  badge?: string | null;
  /** Marks the one row that wants a decision. At most one, or none. */
  primary?: boolean;
  icon?: LucideIcon;
}

/**
 * The routes out of the overview.
 *
 * These used to be four tall cards, each ending in a large arrow that pointed at
 * nothing and grew on hover. The arrow said "this is a link", which the title
 * already said, and the space it needed made a list of four short sentences as
 * tall as the table of screens above it.
 *
 * So: compact rows, an icon at the start rather than an arrow at the end, and
 * one line of description. Two columns on a wide screen, one on a narrow one,
 * because a four-across grid squeezes each sentence into four words per line.
 */
export function NextActions({ actions }: { actions: NextAction[] }) {
  if (actions.length === 0) return null;
  return (
    <ul className="grid gap-2 lg:grid-cols-2">
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <li key={action.title}>
            <Link
              href={action.href}
              className={cn(
                "flex items-start gap-3 rounded-lg border px-3.5 py-3 transition-colors duration-[var(--dur-1)] motion-reduce:transition-none",
                action.primary
                  ? "border-line-strong bg-navy-tint hover:bg-navy-tint/70"
                  : "border-line bg-white hover:bg-mist-soft",
              )}
            >
              {Icon && (
                <Icon
                  className={cn(
                    "mt-0.5 h-4 w-4 shrink-0",
                    action.primary ? "text-navy" : "text-muted",
                  )}
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="text-[13.5px] font-medium text-ink">{action.title}</span>
                  {action.badge ? (
                    <span className="num shrink-0 rounded-full bg-mist px-1.5 py-px text-[11px] text-body">
                      {action.badge}
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-[12px] leading-snug text-muted">{action.body}</span>
              </span>
            </Link>
          </li>
        );
      })}
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
