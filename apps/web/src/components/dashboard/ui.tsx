/**
 * The console's visual system.
 *
 * Two eras live in this file. `Card`, `Kpi` and the badges below are the first
 * pass, still used by the settings and validation pages. Everything under
 * "Console panels" is the system the overview is built from: one `Panel`, one
 * dense table, one KPI tile, one status chip. There is deliberately no second
 * container and no variant that is really a different component, because the
 * thing that made the old overview read as a pile of sections was that every
 * block invented its own rectangle.
 *
 * Nothing here uses a hook, so a Server Component can render a Panel directly.
 */

import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  CircleDashed,
  Clock,
  Loader2,
  XCircle,
} from "lucide-react";
import Link from "next/link";

import type { ScreenStatus, StageStatus, Verdict } from "@/lib/mock/data";
import { cn } from "@/lib/utils";

export function Card({ className, children, title, action, subtitle }: {
  className?: string;
  children: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className={cn("bg-white rounded-3xl border border-line p-5 md:p-6", className)}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            {/* h2, not h3: every dashboard page puts its h1 in PageHeader, so a
                card sits directly under it and skipping a level would leave a
                hole in the outline a screen reader has to guess at. */}
            {title && <h2 className="text-ink text-lg font-medium">{title}</h2>}
            {subtitle && <p className="text-sm text-muted mt-0.5">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Kpi({ label, value, hint, tone = "ink" }: { label: string; value: React.ReactNode; hint?: string; tone?: "ink" | "orange" | "cyan" }) {
  return (
    <div className="bg-white rounded-3xl border border-line p-5">
      <div className="text-sm text-muted">{label}</div>
      <div className={cn("mt-2 text-3xl font-medium tracking-tight", tone === "orange" ? "text-orange-500" : tone === "cyan" ? "text-cyan-600" : "text-ink")}>
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function PageHeader({ eyebrow, title, body, actions, dense = false }: {
  eyebrow?: string;
  title: React.ReactNode;
  body?: React.ReactNode;
  actions?: React.ReactNode;
  /**
   * One line, no bottom margin, for a page that has to fit on one screen. The
   * 4xl heading and its paragraph cost 145px of a 687px budget on the overview,
   * which is a fifth of the fold spent restating the page's own name.
   */
  dense?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex justify-between gap-4",
        dense
          ? "min-w-0 flex-row flex-wrap items-center gap-x-4 gap-y-2"
          : "mb-6 flex-col gap-4 md:flex-row md:items-end",
      )}
    >
      <div className={cn(dense && "flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1")}>
        {eyebrow && !dense && <div className="eyebrow mb-2">{eyebrow}</div>}
        <h1
          className={cn(
            "font-medium tracking-tight text-ink",
            dense ? "truncate text-lg leading-tight" : "text-3xl md:text-4xl",
          )}
        >
          {title}
        </h1>
        {body && (
          <p className={cn("text-body", dense ? "min-w-0 text-xs" : "mt-2 max-w-2xl")}>{body}</p>
        )}
      </div>
      {/* Wraps, because a header with two actions ran off the right edge of a
          375px viewport where the page cannot scroll sideways to reach it. */}
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export const verdictColor: Record<Verdict, string> = {
  "Real and new": "#f87315",
  "Real and known": "#07b6d3",
  "Real but generic": "#3f95a6",
  Artifact: "#174f62",
  Uncertain: "#b8c2ca",
};

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-mist-soft px-2.5 py-1 text-xs text-ink whitespace-nowrap">
      <span className="w-2 h-2 rounded-full" style={{ background: verdictColor[verdict] }} />
      {verdict}
    </span>
  );
}

export function StatusBadge({ status }: { status: ScreenStatus | "pass" | "warn" | "fail" | "pending" }) {
  const map: Record<string, string> = {
    complete: "bg-cyan-50 text-cyan-700",
    running: "bg-orange-50 text-orange-700",
    queued: "bg-mist-soft text-muted",
    failed: "bg-red-50 text-red-700",
    draft: "bg-mist-soft text-muted",
    pass: "bg-cyan-50 text-cyan-700",
    warn: "bg-orange-50 text-orange-700",
    fail: "bg-red-50 text-red-700",
    pending: "bg-mist-soft text-muted",
  };
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs capitalize", map[status])}>
      {status === "running" && <Loader2 className="w-3 h-3 animate-spin" />}
      {status}
    </span>
  );
}

export function Chance({ value, size = "md" }: { value: number; size?: "sm" | "md" }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.6 ? "#f87315" : value >= 0.4 ? "#07b6d3" : "#174f62";
  return (
    <span className="inline-flex items-center gap-2" title="Uncalibrated model score; not a validation probability">
      <span aria-hidden="true" className={cn("progress-track", size === "sm" ? "w-12 h-1.5" : "w-16")}>
        <span className="progress-fill block" style={{ width: `${pct}%`, background: color }} />
      </span>
      <span className={cn("tabular-nums text-ink", size === "sm" ? "text-xs" : "text-sm font-medium")}>{value.toFixed(3)}</span>
    </span>
  );
}

const stageIcon: Record<StageStatus, React.ReactNode> = {
  done: <Check className="w-3.5 h-3.5" />,
  running: <Loader2 className="w-3.5 h-3.5 animate-spin" />,
  queued: <Clock className="w-3.5 h-3.5" />,
  failed: <XCircle className="w-3.5 h-3.5" />,
  skipped: <CircleDashed className="w-3.5 h-3.5" />,
};

export function StageRail({ stages, compact = false }: { stages: { key: string; title: string; status: StageStatus }[]; compact?: boolean }) {
  return (
    <ol className={cn("flex items-center", compact ? "gap-1" : "gap-2 overflow-x-auto thin-scroll pb-1")}>
      {stages.map((s, i) => (
        <li key={s.key} className="flex items-center gap-2 shrink-0">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs",
              s.status === "done" && "bg-teal-800 text-white",
              s.status === "running" && "bg-orange-500 text-white",
              s.status === "queued" && "bg-white border border-line text-muted",
              s.status === "failed" && "bg-red-600 text-white",
              s.status === "skipped" && "bg-mist-soft text-muted",
            )}
            title={s.title}
          >
            {stageIcon[s.status]}
            {!compact && s.title}
          </span>
          {i < stages.length - 1 && <span className={cn("h-px bg-line-strong", compact ? "w-2" : "w-4")} />}
        </li>
      ))}
    </ol>
  );
}

/**
 * These are links that change the URL, not ARIA tabs, so they are a labelled
 * navigation landmark with aria-current rather than a tablist. Calling them a
 * tablist would promise a panel that moves with arrow keys, which it is not.
 */
export function Tabs({ tabs, active, hrefFor, label = "Sections" }: { tabs: { key: string; label: string; count?: number }[]; active: string; hrefFor: (k: string) => string; label?: string }) {
  return (
    <nav aria-label={label} className="flex gap-1 overflow-x-auto thin-scroll border-b border-line">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={hrefFor(t.key)}
          scroll={false}
          aria-current={active === t.key ? "page" : undefined}
          className={cn(
            "px-4 py-3 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors",
            active === t.key ? "border-orange-500 text-ink font-medium" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {t.label}
          {typeof t.count === "number" && <span className="ml-2 text-xs text-muted">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

/**
 * The empty state. Sized to sit inside a Panel body rather than to fill a page:
 * the old 40px padding and 24px radius made an empty panel taller than the same
 * panel with rows in it, which is the wrong way round.
 */
export function Empty({ title, body, action, className }: {
  title: string;
  body?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line-strong px-4 py-6 text-center",
        className,
      )}
    >
      <div className="text-[13px] font-medium text-ink">{title}</div>
      {body && <p className="mx-auto max-w-sm text-xs text-muted">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Flag({ label }: { label: string }) {
  return <span className="inline-flex rounded-md bg-orange-50 text-orange-700 px-2 py-0.5 text-[11px] whitespace-nowrap">{label}</span>;
}

// ===========================================================================
// Console panels
//
// Every rectangle on a console page is a Panel. Panels are separated by the one
// value step between the canvas behind them and the white inside them, plus a
// 1px line, and by nothing else: a shadow on a static panel is what makes a
// grid of twelve panels look like twelve stickers. --shadow-float stays
// reserved for things that overlay the page.
//
// A Panel has no hover state. Panels are not buttons. A panel that navigates
// somewhere does it through a named control in its header or footer.
// ===========================================================================

/**
 * The only widths a panel may take. Twelve, eight, six, four or three columns
 * of the page's twelve, and full width below md, because two 3-column panels
 * side by side on a phone is four characters per line.
 */
export type PanelSpan = 12 | 8 | 6 | 4 | 3;

const PANEL_SPAN: Record<PanelSpan, string> = {
  12: "col-span-12",
  // A two-thirds panel beside a third. Written out in full for the same reason
  // the others are: Tailwind only emits a class that appears literally in a
  // file, so a span composed at runtime produces no CSS at all.
  8: "col-span-12 lg:col-span-8",
  6: "col-span-12 md:col-span-6",
  4: "col-span-12 md:col-span-6 lg:col-span-4",
  3: "col-span-12 md:col-span-6 xl:col-span-3",
};

/** The page grid every console page lays its panels on. */
export const PANEL_GRID = "grid grid-cols-12 content-start gap-4";

/**
 * The span classes, for the rare cell that is not a Panel: a column that stacks
 * two panels, for instance. Go through this rather than writing the classes by
 * hand. A width outside the set, `lg:col-span-7`, compiles to nothing at all
 * because no file mentions it, and the cell silently falls back to full width
 * and pushes its neighbour onto a second row. That failure is invisible in the
 * markup and obvious only when you measure.
 */
export function panelSpan(span: PanelSpan): string {
  return PANEL_SPAN[span];
}

/**
 * Jump links into the panels of a page, for the keyboard.
 *
 * WHY THIS EXISTS. The overview's primary table holds seventy-six rows and each
 * row carries two focus stops, so the panel beside it was measured at 176 Tab
 * presses from the top of the page and the one under that at 190. That is not a
 * long route, it is an unreachable one, and WCAG 2.4.1 asks for a way past a
 * repeated block for exactly this case.
 *
 * Hidden until focused, because a visible row of jump links would spend 28px of
 * a page whose whole constraint is height, and because every reader who is not
 * on a keyboard already has the panels in front of them. The first Tab press on
 * the page reveals them.
 */
export function SkipLinks({ label = "Skip to a panel", links }: {
  label?: string;
  links: { id: string; label: string }[];
}) {
  return (
    <nav aria-label={label} className="contents">
      {links.map((link) => (
        <a key={link.id} href={`#${link.id}`} className="skip-link">
          {link.label}
        </a>
      ))}
    </nav>
  );
}

/** A column of panels occupying one span of the page grid. */
export function PanelStack({ span = 6, className, children }: {
  span?: PanelSpan;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-h-0 flex-col gap-4", PANEL_SPAN[span], className)}>{children}</div>
  );
}

export function Panel({
  title,
  count,
  caveat,
  control,
  footer,
  body = "pad",
  span = 12,
  id,
  sectionRef,
  className,
  bodyClassName,
  children,
}: {
  title: React.ReactNode;
  /**
   * The panel's denominator, beside the title. Always spelled out with its
   * unit: "1,284 genes", never "1,284". It is not a control and never sits in
   * the control slot.
   */
  count?: React.ReactNode;
  /**
   * A caveat that applies to every figure in the panel, on one line directly
   * under the header. Not a tooltip and not a footnote: a reader who is about to
   * spend six weeks of bench time on these rows has to meet the reason to
   * distrust them before the rows, not after.
   */
  caveat?: React.ReactNode;
  /**
   * At most one, right aligned, from the closed set below: Segmented,
   * SegmentedLinks, PanelSelect, PanelAction, PanelLink. Never an orange button
   * (orange is the page's one primary action), never a search field (the shell
   * owns search), never a second control.
   */
  control?: React.ReactNode;
  /**
   * Present in exactly two cases: the panel shows a figure whose definition,
   * units, precision, denominator or provenance is not already written in the
   * body, or the panel shows rows and therefore owes the reader an export.
   */
  footer?: React.ReactNode;
  /** `flush` when the child draws its own gutter, which a DenseTable does. */
  body?: "pad" | "flush";
  span?: PanelSpan;
  /** The anchor a page's skip links jump to. Focusable, so the jump lands. */
  id?: string;
  /**
   * The panel element itself, for the one thing a panel cannot compute: how many
   * whole rows fit in the height a grid track handed it. See `useFitRows`.
   */
  sectionRef?: React.Ref<HTMLElement>;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      ref={sectionRef}
      // -1, not absent. A skip link that points at a non-focusable element moves
      // the scroll position but leaves focus at the top of the page, so the next
      // Tab press goes back to stop two and the link has bought nothing.
      tabIndex={id ? -1 : undefined}
      // A string title names the region, so a screen reader user can jump
      // between panels instead of walking a dense table to reach the next one.
      aria-label={typeof title === "string" ? title : undefined}
      className={cn(
        // min-w-0: a Panel is often a flex child of a PanelStack, and without
        // it the panel refuses to shrink below its content and pushes the fixed
        // shell past the fold, which is the exact failure this system exists to
        // prevent.
        // panel-in is the only motion: 200ms, once, on mount, on the chrome.
        // Never on a figure or a row, because motion on a number tells the
        // reader the figure is a prop rather than a measurement.
        "panel-in flex min-w-0 flex-col overflow-hidden rounded-panel border border-line bg-white",
        PANEL_SPAN[span],
        className,
      )}
      // The floor, and the reason it is not min-h-0. A panel is usually laid on
      // a `1fr` grid track, and a `1fr` track does not overflow when the space
      // runs out, it collapses. Measured at 1024x768, where the strip and the
      // page title eat the whole 768px: the track resolved to 0 and all three
      // data panels rendered at zero height, so the reader arrived at a console
      // whose every table was invisible while the page still reported that it
      // fit. A panel that cannot show its heading and one row is worse than a
      // page that scrolls a little, so the floor wins and the page overflows
      // instead. Header, one row, and the footer when there is one.
      style={{
        minHeight: `calc(var(--panel-head-h) + var(--row-h)${footer ? " + var(--panel-foot-h)" : ""}${caveat ? " + var(--panel-caveat-h)" : ""})`,
      }}
    >
      {/* Fixed height, so a row of panels has its titles on one baseline no
          matter what the titles say. That is also why there is no subtitle: a
          40px header cannot hold two lines and stay on the grid. */}
      <header className="flex h-[var(--panel-head-h)] shrink-0 items-center gap-2.5 border-b border-line px-[var(--panel-gutter)]">
        {/* h2, not h3: the page's h1 is in PageHeader, so a panel title is the
            next level and skipping one leaves a hole in the outline. */}
        <h2 className="truncate text-[13px] font-medium leading-none tracking-[-0.01em] text-ink">
          {title}
        </h2>
        {count !== undefined && (
          <span className="num shrink-0 text-[11px] leading-none text-muted">{count}</span>
        )}
        {control && <div className="ml-auto flex shrink-0 items-center gap-1.5">{control}</div>}
      </header>

      {caveat && (
        <div className="flex h-[var(--panel-caveat-h)] shrink-0 items-center gap-1.5 border-b border-line bg-orange-50 px-[var(--panel-gutter)] text-[11px] leading-none text-orange-700">
          {caveat}
        </div>
      )}

      <div
        className={cn(
          body === "flush"
            ? "flex min-h-0 flex-1 flex-col"
            // A padded body scrolls itself rather than pushing the page taller.
            // The whole point of the fixed shell is that the page does not
            // scroll, so a panel that outgrows its row has to absorb it.
            : "thin-scroll min-h-0 flex-1 overflow-y-auto px-[var(--panel-gutter)] py-3.5",
          bodyClassName,
        )}
      >
        {children}
      </div>

      {footer && (
        <footer className="flex h-[var(--panel-foot-h)] shrink-0 items-center justify-between gap-3 border-t border-line px-[var(--panel-gutter)] text-[11px] text-muted">
          {footer}
        </footer>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Header controls: the closed set
// ---------------------------------------------------------------------------

/** Two or three mutually exclusive views of the same rows, held in state. */
export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex h-7 items-center gap-0.5 rounded-md bg-mist-soft p-0.5"
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-6 rounded-[5px] px-2 text-[11px] font-medium leading-none transition-colors duration-[var(--dur-1)]",
              on ? "bg-white text-ink shadow-[0_1px_1px_rgb(23_79_98/0.06)]" : "text-muted hover:text-ink",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The same control when the state lives in the URL, which is where filter state
 * belongs: the workflow is a sequence of filters and a researcher has to be
 * able to send their PI the exact view they are looking at.
 */
export function SegmentedLinks({ value, options, label }: {
  value: string;
  options: { value: string; label: string; href: string }[];
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex h-7 items-center gap-0.5 rounded-md bg-mist-soft p-0.5"
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <Link
            key={option.value}
            href={option.href}
            scroll={false}
            aria-current={on ? "true" : undefined}
            className={cn(
              "flex h-6 items-center rounded-[5px] px-2 text-[11px] font-medium leading-none transition-colors duration-[var(--dur-1)]",
              on ? "bg-white text-ink shadow-[0_1px_1px_rgb(23_79_98/0.06)]" : "text-muted hover:text-ink",
            )}
          >
            {option.label}
          </Link>
        );
      })}
    </div>
  );
}

/** Four or more options. A native select, because it is the one control that is
    already keyboard and screen reader correct on every platform. */
export function PanelSelect({ label, className, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return (
    <select
      aria-label={label}
      className={cn(
        "h-7 rounded-md border border-line bg-white pl-2 pr-6 text-[11px] text-ink",
        className,
      )}
      {...rest}
    />
  );
}

/**
 * One action that acts on this panel only. A rounded rectangle, not the pill:
 * the pill is the page-level button shape, and that difference is how a reader
 * tells a panel action from a page action.
 */
export function PanelAction({ className, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn("btn btn-ghost h-7 rounded-md px-2.5 py-0 text-[11px]", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

/** "See all". The one way out of a panel. */
export function PanelLink({ href, children, className }: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-7 items-center gap-1 text-[11px] text-cyan-600 underline decoration-line-strong underline-offset-2 hover:decoration-cyan-600",
        className,
      )}
    >
      {children}
      <ArrowUpRight className="h-3 w-3 shrink-0" aria-hidden="true" />
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Footer contents
// ---------------------------------------------------------------------------

/**
 * Provenance, on one line: which tool version, which threshold, which reference
 * release. A figure a reader cannot trace to a measurement is the thing this
 * audience finds embarrassing, so the trace is on screen, not in a tooltip.
 */
export function FootNote({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("num min-w-0 truncate text-[11px] text-muted", className)}>{children}</span>;
}

/**
 * The export. Every panel that shows rows carries one, because the design law
 * is that every number is one click from the rows that produced it and one
 * click from a file that opens in R, Excel or Prism.
 */
export function FootLink({ href, children, download }: {
  href: string;
  children: React.ReactNode;
  download?: boolean;
}) {
  return (
    <Link
      href={href}
      download={download}
      prefetch={false}
      className="shrink-0 text-[11px] text-cyan-600 underline decoration-line-strong underline-offset-2 hover:decoration-cyan-600"
    >
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// KPI strip
// ---------------------------------------------------------------------------

/**
 * The strip is one Panel with divided cells, not four panels. Four panels cost
 * four 40px headers, and the strip is not four separate things: it is one
 * answer to "what moved since I last looked".
 */
export function KpiStrip({ title, count, control, footer, span = 12, className, children }: {
  title: React.ReactNode;
  count?: React.ReactNode;
  control?: React.ReactNode;
  footer?: React.ReactNode;
  span?: PanelSpan;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Panel title={title} count={count} control={control} footer={footer} span={span} body="flush" className={className}>
      {/* The negative offsets pull the cells' own hairlines under the panel
          border and the header rule, so the grid lines read as one weight. */}
      <div className="-ml-px -mt-px grid grid-cols-2 sm:grid-cols-4">{children}</div>
    </Panel>
  );
}

/**
 * A cell of the strip. The definition sits in the tile with the figure, at a
 * weight that cannot be skipped: a count with no denominator and no threshold
 * is a marketing number, and this audience reads it as one.
 */
export function KpiTile({ label, value, denominator, definition, tone = "ink", href }: {
  label: string;
  value: React.ReactNode;
  /** The figure's denominator, beside it: "of 9 screens", "past FDR 0.10". */
  denominator?: string;
  /** What the figure counts, and over what window. */
  definition?: string;
  tone?: "ink" | "orange" | "cyan";
  /** Where the rows behind the figure are. */
  href?: string;
}) {
  const labelNode = href ? (
    <Link
      href={href}
      className="rounded-sm text-[11px] leading-none text-cyan-600 underline decoration-line-strong underline-offset-2 hover:decoration-cyan-600"
    >
      {label}
    </Link>
  ) : (
    <span className="text-[11px] leading-none text-muted">{label}</span>
  );

  return (
    <div className="flex min-w-0 flex-col gap-1.5 border-l border-t border-line px-[var(--panel-gutter)] py-2.5">
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span
          className={cn(
            "num text-[19px] font-medium leading-none tracking-[-0.02em]",
            tone === "orange" ? "text-orange-500" : tone === "cyan" ? "text-cyan-600" : "text-ink",
          )}
        >
          {value}
        </span>
        {denominator && (
          <span className="num min-w-0 truncate text-[11px] leading-none text-muted">{denominator}</span>
        )}
      </div>
      <div className="truncate">{labelNode}</div>
      {definition && <p className="text-[11px] leading-[1.35] text-muted">{definition}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The dense table
//
// The table is the primary interface wherever the task is comparing rows, not a
// fallback for people who dislike charts. Sticky header, every column sortable,
// numeric columns right aligned with tabular figures, no number truncated, and
// as many rows on screen as the panel can hold.
// ---------------------------------------------------------------------------

export function DenseTable({ children, compact = false, maxRows, minWidth, className, scrollClassName }: {
  children: React.ReactNode;
  /** 26px rows instead of 32px, for the table that has to show 40 at 1440. */
  compact?: boolean;
  /**
   * Cap the table at a whole number of rows and scroll the rest under the
   * sticky header.
   *
   * Without this a flush Panel takes its content height: a 40-row table made a
   * measured 1,811px page out of an 800px viewport, and the fixed shell has no
   * second scroll container to absorb that. Capping here rather than at the
   * call site does two things a height on the panel cannot. The panel's height
   * becomes arithmetic the page can budget against, thead + rows * row height
   * + 76px of chrome. And the cut always lands between two rows, so the reader
   * never sees a row sliced in half and never has to wonder whether the figure
   * they can half-see is the one they wanted.
   */
  maxRows?: number;
  /** Below this the table scrolls sideways rather than wrapping a figure. */
  minWidth?: number;
  className?: string;
  scrollClassName?: string;
}) {
  return (
    // The scroll container, and therefore the sticky header's context. min-h-0
    // is what stops a flex child from refusing to shrink below its content and
    // pushing the panel past the fold.
    <div
      className={cn("thin-scroll min-h-0 flex-1 overflow-auto", scrollClassName)}
      style={
        maxRows
          ? {
              // THEAD_H is the one number here that is not a token, because the
              // sticky header's height is set in the .dense-table rule and a
              // second source for it would be a second thing to keep in step.
              maxHeight: `calc(${THEAD_H}px + ${maxRows} * var(${compact ? "--row-h-compact" : "--row-h"}))`,
            }
          : undefined
      }
    >
      <table
        className={cn("dense-table", compact && "dense-table-compact", className)}
        style={minWidth ? { minWidth } : undefined}
      >
        {children}
      </table>
    </div>
  );
}

/**
 * Panel chrome, in pixels, mirroring the tokens in globals.css.
 *
 * They are duplicated here because arithmetic is the only way a page can know
 * how many whole rows a panel will hold before the browser has laid it out, and
 * `getComputedStyle` on a custom property returns a string in whatever unit the
 * author wrote. Keep them in step with `--panel-head-h`, `--panel-foot-h`,
 * `--panel-caveat-h`, `--row-h` and `--row-h-compact`.
 */
export const PANEL_CHROME = {
  head: 40,
  foot: 36,
  caveat: 22,
  /** Measured: `.dense-table thead th` is 1.75rem. */
  thead: 28,
  row: 32,
  rowCompact: 26,
} as const;

const THEAD_H = PANEL_CHROME.thead;

/**
 * The height a capped table panel needs, so a page can budget before it renders
 * rather than discovering the overflow in the browser. Chrome is the 40px
 * header plus, when the panel carries an export or a provenance line, the 36px
 * footer.
 *
 * This is the panel's own height, which is a floor and not a prediction: grid
 * items stretch, so a row takes the height of its tallest cell. Measured, a
 * panel wanting 572px next to a 741px stack of small panels rendered at 741px.
 * Budget a row as the larger of its cells, not the sum of them.
 */
export function tablePanelHeight({ rows, compact = false, footer = true }: {
  rows: number;
  compact?: boolean;
  footer?: boolean;
}): number {
  return 40 + (footer ? 36 : 0) + THEAD_H + rows * (compact ? 26 : 32);
}

export type SortDir = "asc" | "desc";

/**
 * The sort affordance. Presentation only: the state and the comparator stay
 * with the table that owns the rows, so one column sorts the same way wherever
 * a researcher meets it.
 */
export function SortTh({ label, active, dir, onToggle, align = "left", width, className, title }: {
  label: React.ReactNode;
  active: boolean;
  dir: SortDir;
  onToggle: () => void;
  align?: "left" | "right";
  width?: number;
  className?: string;
  /** Spelled-out definition of the column, for a header that had to abbreviate. */
  title?: string;
}) {
  const Icon = !active ? ChevronsUpDown : dir === "asc" ? ChevronUp : ChevronDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      style={width ? { width } : undefined}
      className={cn(align === "right" && "num-col", className)}
    >
      <button
        type="button"
        onClick={onToggle}
        title={title}
        className={cn(
          // h-7 matches the 1.75rem thead cell. Measured without it the button
          // was 13px tall inside a 28px header, so more than half of a column
          // heading looked clickable and did nothing, and the target was well
          // under any usable size for a tap.
          "inline-flex h-7 w-full items-center gap-1 rounded-sm uppercase tracking-[0.06em]",
          align === "right" ? "justify-end" : "justify-start",
          active ? "text-ink" : "text-muted hover:text-ink",
        )}
      >
        {label}
        <Icon className={cn("h-3 w-3 shrink-0", active ? "opacity-100" : "opacity-45")} aria-hidden="true" />
      </button>
    </th>
  );
}

/** A column head that does not sort, so it still looks like the ones that do. */
export function Th({ children, align = "left", width, className }: {
  children: React.ReactNode;
  align?: "left" | "right";
  width?: number;
  className?: string;
}) {
  return (
    <th scope="col" style={width ? { width } : undefined} className={cn(align === "right" && "num-col", className)}>
      {children}
    </th>
  );
}

/**
 * Put this on a `tr` whose row is actually a target. Hover and focus-within
 * tint, no lift: a transform on a table row drags its borders with it. A tint
 * on an inert row is a promise the table does not keep, which is why it is opt
 * in rather than a rule on every row.
 */
export const ROW_HIT = "row-hit";

/** The value a read could not supply. A dash that looks like a zero is the
    failure this console exists to avoid. */
export function NotRecorded() {
  return <span className="text-muted">Not recorded</span>;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type ChipTone = "ok" | "run" | "wait" | "bad" | "idle";

const CHIP_TONE: Record<ChipTone, string> = {
  ok: "bg-cyan-50 text-cyan-700",
  run: "bg-orange-50 text-orange-700",
  wait: "bg-mist-soft text-body",
  bad: "bg-red-50 text-red-700",
  idle: "bg-mist-soft text-muted",
};

/**
 * Status as a small coloured chip, the square-cornered dense counterpart of the
 * pill StatusBadge the settings pages use. Colour is never the only signal: the
 * word is always there, because five of these in a column read as five words
 * faster than they read as five hues, and because a colour-blind reader gets
 * nothing from the hue.
 */
export function StatusChip({ tone, children, spinning = false, className }: {
  tone: ChipTone;
  children: React.ReactNode;
  spinning?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[18px] max-w-full items-center gap-1 truncate rounded-[4px] px-1.5 text-[11px] leading-none",
        CHIP_TONE[tone],
        className,
      )}
    >
      {spinning && <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin" aria-hidden="true" />}
      {children}
    </span>
  );
}

/** The one mapping from a pipeline or QC state to a chip tone, so "failed"
    never means orange on one page and red on the next. */
export function statusTone(status: string): ChipTone {
  switch (status) {
    case "complete":
    case "pass":
    case "validated":
      return "ok";
    case "running":
    case "warn":
    case "inconclusive":
      return "run";
    case "failed":
    case "fail":
      return "bad";
    case "queued":
    case "pending":
      return "wait";
    default:
      return "idle";
  }
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span className={cn("skeleton block h-3", className)} style={style} aria-hidden="true" />;
}

/**
 * Rows the size of the rows that are coming, so the panel does not change
 * height when the data lands and nothing below it jumps. Widths cycle through a
 * fixed pattern rather than a random one, because a random width differs
 * between the server render and the client one.
 */
const SKELETON_WIDTHS = ["72%", "48%", "60%", "40%", "56%"];

export function TableSkeleton({ rows = 6, cols = 4, compact = false }: {
  rows?: number;
  cols?: number;
  compact?: boolean;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-hidden" role="status" aria-label="Loading rows">
      <table className={cn("dense-table", compact && "dense-table-compact")}>
        <tbody>
          {Array.from({ length: rows }, (_, row) => (
            <tr key={row}>
              {Array.from({ length: cols }, (_, col) => (
                <td key={col}>
                  {/* The last column is the numeric one, so its placeholder sits
                      where the digits will. */}
                  <Skeleton
                    className={col === cols - 1 ? "ml-auto w-10" : undefined}
                    style={col === cols - 1 ? undefined : { width: SKELETON_WIDTHS[(row + col) % SKELETON_WIDTHS.length] }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
