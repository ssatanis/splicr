"use client";

/**
 * The sortable tables and the evidence panel used by the overview.
 *
 * These sit apart from `app/dashboard/page.tsx` because that page is a Server
 * Component: it reads cookies and Postgres. Sorting and the panel need state, so
 * they are a client island the page hands rows to. Both the real workspace and
 * the sample workspace feed the same components, which is what stops the two
 * branches drifting into two different products.
 *
 * Nothing here invents a value. A field the caller could not supply arrives as
 * null and is drawn as "not recorded", because a dash that looks like a zero is
 * the failure this console is meant to avoid.
 *
 * The sorting primitives at the top are shared with the all-screens table, so
 * a column sorts the same way wherever a researcher meets one.
 */

import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import type { Verdict } from "@/lib/mock/data";
import { cn, formatDate, formatNumber } from "@/lib/utils";

import { ModalDrawer } from "./drawer";
import { OutcomeBadge } from "./outcome-badge";
import { Chance, Flag, StatusBadge, VerdictBadge } from "./ui";

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

export interface TriageHit {
  id: string;
  gene: string;
  /** Null until the artifact stage has classified the hit. */
  verdict: Verdict | null;
  /** Stored model score, or null when unscored; calibration is not established. */
  chance: number | null;
  /** log2 fold change, endpoint versus T0. */
  lfc: number | null;
  fdr: number | null;
  guides: number | null;
  guidesAgree: number | null;
  flags: string[];
  why: string | null;
  atlasHits: number | null;
  atlasScreens: number | null;
  screenId: string;
  screenName: string | null;
}

export interface ScreenRow {
  id: string;
  name: string;
  context: string;
  library: string;
  status: "complete" | "running" | "queued" | "failed" | "draft";
  qc: "pass" | "warn" | "fail" | "pending";
  /** Stages finished out of nine, or null when no run has started. */
  stage: number | null;
  hits: number | null;
  realHits: number | null;
  createdAt: string;
}

export interface OutcomeRow {
  id: string;
  gene: string;
  /** Null when the read cannot say which screen the outcome belongs to. */
  screenId: string | null;
  assay: string | null;
  predicted: number | null;
  result: "validated" | "failed" | "inconclusive" | "pending";
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export type Dir = "asc" | "desc";
export type Cell = string | number | null;
export type SortState = { key: string; dir: Dir };

/** Nulls sink to the bottom in both directions: an unknown is not a small number. */
function compare(a: Cell, b: Cell, dir: Dir): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const delta =
    typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
  return dir === "asc" ? delta : -delta;
}

export function useSorted<T>(rows: T[], initial: SortState, cell: (row: T, key: string) => Cell) {
  const [sort, setSort] = useState<SortState>(initial);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => compare(cell(a, sort.key), cell(b, sort.key), sort.dir));
    return copy;
  }, [rows, sort, cell]);

  // First click on a new column uses the direction that column is normally read
  // in: biggest effect first for numbers, A to Z for names.
  const toggle = useCallback((key: string, preferred: Dir) => {
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        : { key, dir: preferred },
    );
  }, []);

  return { sorted, sort, toggle };
}

export function SortHeader({
  label,
  sortKey,
  sort,
  toggle,
  preferred = "asc",
  className,
}: {
  label: string;
  sortKey: string;
  sort: SortState;
  toggle: (key: string, preferred: Dir) => void;
  preferred?: Dir;
  className?: string;
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ChevronUp : ChevronDown;
  return (
    <th
      scope="col"
      className={className}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => toggle(sortKey, preferred)}
        className={cn(
          "inline-flex items-center gap-1 rounded-sm text-[0.7rem] font-medium uppercase tracking-[0.06em]",
          active ? "text-ink" : "text-muted hover:text-ink",
        )}
      >
        {label}
        <Icon className={cn("h-3 w-3", active ? "opacity-100" : "opacity-45")} aria-hidden="true" />
      </button>
    </th>
  );
}

/**
 * Stretches a row's first link or button over the whole row, so the target is
 * the row rather than a few characters of text. The row is the positioning
 * context; the pseudo-element is the hit area.
 */
export const ROW_TARGET = "before:absolute before:inset-0 before:content-['']";
export const ROW = "relative hover:bg-mist-soft/60 has-[a:focus-visible]:bg-mist-soft has-[button:focus-visible]:bg-mist-soft";

function NotRecorded() {
  return <span className="text-muted">Not recorded</span>;
}

// ---------------------------------------------------------------------------
// Candidate hits: the primary table
// ---------------------------------------------------------------------------

const hitCell = (hit: TriageHit, key: string): Cell => {
  switch (key) {
    case "gene":
      return hit.gene;
    case "chance":
      return hit.chance;
    case "lfc":
      // Direction is read off the sign elsewhere; ranking is by size of effect.
      return hit.lfc === null ? null : Math.abs(hit.lfc);
    case "fdr":
      return hit.fdr;
    case "guides":
      return hit.guidesAgree;
    default:
      return null;
  }
};

export function TriageTable({ hits, ranked }: { hits: TriageHit[]; ranked: "chance" | "fdr" }) {
  const { sorted, sort, toggle } = useSorted<TriageHit>(
    hits,
    { key: ranked, dir: ranked === "chance" ? "desc" : "asc" },
    hitCell,
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const close = useCallback(() => setOpenId(null), []);
  const open = sorted.find((hit) => hit.id === openId) ?? null;

  return (
    <>
      <div className="overflow-x-auto thin-scroll">
        <table className="table-base min-w-[720px]">
          <thead>
            <tr>
              <SortHeader label="Gene" sortKey="gene" sort={sort} toggle={toggle} />
              <th scope="col">Call</th>
              <SortHeader
                label="Model score"
                sortKey="chance"
                sort={sort}
                toggle={toggle}
                preferred="desc"
              />
              <SortHeader
                label="LFC (log2)"
                sortKey="lfc"
                sort={sort}
                toggle={toggle}
                preferred="desc"
              />
              <SortHeader label="FDR" sortKey="fdr" sort={sort} toggle={toggle} />
              <SortHeader
                label="Guides agree"
                sortKey="guides"
                sort={sort}
                toggle={toggle}
                preferred="desc"
              />
              <th scope="col">Flags</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((hit) => (
              <tr key={hit.id} className={ROW}>
                <td>
                  <button
                    type="button"
                    onClick={() => setOpenId(hit.id)}
                    aria-haspopup="dialog"
                    aria-expanded={openId === hit.id}
                    className={cn("font-medium text-ink hover:text-orange-500", ROW_TARGET)}
                  >
                    {hit.gene}
                    <span className="sr-only">, open the evidence for this hit</span>
                  </button>
                </td>
                <td>{hit.verdict ? <VerdictBadge verdict={hit.verdict} /> : <NotRecorded />}</td>
                <td>{hit.chance !== null ? <Chance value={hit.chance} size="sm" /> : <NotRecorded />}</td>
                <td className="tabular-nums">
                  {hit.lfc !== null ? hit.lfc.toFixed(2) : <NotRecorded />}
                </td>
                <td className="tabular-nums">
                  {hit.fdr !== null ? hit.fdr.toExponential(1) : <NotRecorded />}
                </td>
                <td className="tabular-nums whitespace-nowrap">
                  {hit.guidesAgree !== null && hit.guides !== null ? (
                    `${hit.guidesAgree} of ${hit.guides}`
                  ) : (
                    <NotRecorded />
                  )}
                </td>
                <td>
                  {hit.flags.length === 0 ? (
                    <span className="text-muted text-xs">None</span>
                  ) : (
                    <span className="flex flex-wrap gap-1">
                      {hit.flags.map((flag) => (
                        <Flag key={flag} label={flag} />
                      ))}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
        Model score is a recorded, uncalibrated model output. LFC is the recorded log2 fold change for the comparison,
        signed: negative is the depleted arm and positive the enriched one. FDR is a
        Benjamini-Hochberg q-value, shown to one significant figure. Guides agree counts the sgRNAs
        against that gene moving in the same direction.
      </p>

      {open && <HitPanel hit={open} onClose={close} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Evidence panel
// ---------------------------------------------------------------------------

function HitPanel({ hit, onClose }: { hit: TriageHit; onClose: () => void }) {
  return (
    <ModalDrawer eyebrow="Evidence" title={hit.gene} onClose={onClose} closeLabel="Close evidence panel">
      {hit.verdict && (
        <div className="mt-3">
          <VerdictBadge verdict={hit.verdict} />
        </div>
      )}

      {hit.why && <p className="mt-4 text-sm text-body">{hit.why}</p>}

      <dl className="mt-5 divide-y divide-line border-y border-line text-sm">
        <PanelFact
          term="Model score"
          value={hit.chance !== null ? hit.chance.toFixed(3) : null}
          note="Recorded model output; no validated probability or uncertainty interval is available."
        />
        <PanelFact
          term="Effect size"
          value={hit.lfc !== null ? `${hit.lfc.toFixed(2)} log2` : null}
          note="Fold change at the endpoint against T0. A positive value is the enriched arm."
        />
        <PanelFact
          term="FDR"
          value={hit.fdr !== null ? hit.fdr.toExponential(2) : null}
          note="Benjamini-Hochberg q-value, from the hit-calling stage."
        />
        <PanelFact
          term="Guide agreement"
          value={
            hit.guidesAgree !== null && hit.guides !== null
              ? `${hit.guidesAgree} of ${hit.guides} guides`
              : null
          }
          note="sgRNAs against this gene moving in the same direction."
        />
        <PanelFact
          term="Atlas context"
          value={
            hit.atlasHits !== null && hit.atlasScreens !== null
              ? `Called in ${formatNumber(hit.atlasHits)} of ${formatNumber(hit.atlasScreens)} screens`
              : null
          }
          note="Atlas screens that assayed this gene, which is a subset of the corpus, not its size."
        />
      </dl>

      <div className="mt-5">
        <div className="text-xs uppercase tracking-[0.06em] text-muted">Artifact flags</div>
        {hit.flags.length === 0 ? (
          <p className="mt-1 text-sm text-body">None raised by the artifact stage.</p>
        ) : (
          <>
            <p className="mt-1 text-xs text-muted">Each flag cost this gene log-odds on the score above.</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {hit.flags.map((flag) => (
                <Flag key={flag} label={flag} />
              ))}
            </div>
          </>
        )}
      </div>

      <Link
        href={`/dashboard/screens/${hit.screenId}?tab=hits`}
        className="btn btn-teal btn-sm mt-6 w-full"
      >
        {hit.screenName ? `Open ${hit.screenName}` : "Open the screen this hit came from"}
      </Link>
    </ModalDrawer>
  );
}

function PanelFact({ term, value, note }: { term: string; value: string | null; note: string }) {
  return (
    <div className="py-3">
      <dt className="text-xs uppercase tracking-[0.06em] text-muted">{term}</dt>
      <dd className="mt-0.5 text-ink">{value ?? <NotRecorded />}</dd>
      <dd className="mt-0.5 text-xs text-muted">{note}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent screens
// ---------------------------------------------------------------------------

const screenCell = (screen: ScreenRow, key: string): Cell => {
  switch (key) {
    case "name":
      return screen.name;
    case "library":
      return screen.library;
    case "status":
      return screen.status;
    case "hits":
      return screen.realHits;
    case "created":
      return Date.parse(screen.createdAt);
    default:
      return null;
  }
};

export function RecentScreensTable({ screens }: { screens: ScreenRow[] }) {
  const { sorted, sort, toggle } = useSorted<ScreenRow>(
    screens,
    { key: "created", dir: "desc" },
    screenCell,
  );

  return (
    <div className="overflow-x-auto thin-scroll">
      <table className="table-base min-w-[680px]">
        <thead>
          <tr>
            <SortHeader label="Screen" sortKey="name" sort={sort} toggle={toggle} />
            <SortHeader label="Library" sortKey="library" sort={sort} toggle={toggle} />
            <SortHeader label="Status" sortKey="status" sort={sort} toggle={toggle} />
            <th scope="col">QC</th>
            <SortHeader
              label="Hits (real / called)"
              sortKey="hits"
              sort={sort}
              toggle={toggle}
              preferred="desc"
            />
            <SortHeader
              label="Created"
              sortKey="created"
              sort={sort}
              toggle={toggle}
              preferred="desc"
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map((screen) => (
            <tr key={screen.id} className={ROW}>
              <td>
                <Link
                  href={`/dashboard/screens/${screen.id}`}
                  className={cn("font-medium text-ink hover:text-orange-500", ROW_TARGET)}
                >
                  {screen.name}
                  <span className="sr-only">, open this screen</span>
                </Link>
                <div className="text-xs text-muted">{screen.context}</div>
              </td>
              <td>{screen.library}</td>
              <td>
                <StatusBadge status={screen.status} />
                {screen.status !== "complete" && screen.stage !== null && (
                  <div className="mt-1 text-xs text-muted whitespace-nowrap">
                    {screen.stage} of 9 stages
                  </div>
                )}
              </td>
              <td>
                <StatusBadge status={screen.qc} />
              </td>
              <td className="tabular-nums whitespace-nowrap">
                {screen.status === "complete" && screen.realHits !== null && screen.hits !== null ? (
                  `${formatNumber(screen.realHits)} / ${formatNumber(screen.hits)}`
                ) : (
                  <span className="text-muted">Not called yet</span>
                )}
              </td>
              <td className="text-sm text-muted whitespace-nowrap">{formatDate(screen.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent bench outcomes
// ---------------------------------------------------------------------------

const outcomeCell = (outcome: OutcomeRow, key: string): Cell => {
  switch (key) {
    case "gene":
      return outcome.gene;
    case "predicted":
      return outcome.predicted;
    case "result":
      return outcome.result;
    default:
      return null;
  }
};

export function OutcomesTable({ outcomes }: { outcomes: OutcomeRow[] }) {
  const { sorted, sort, toggle } = useSorted<OutcomeRow>(
    outcomes,
    { key: "predicted", dir: "desc" },
    outcomeCell,
  );

  return (
    <div className="overflow-x-auto thin-scroll">
      <table className="table-base min-w-[560px]">
        <thead>
          <tr>
            <SortHeader label="Gene" sortKey="gene" sort={sort} toggle={toggle} />
            <th scope="col">Assay</th>
            <SortHeader
              label="Model score when called"
              sortKey="predicted"
              sort={sort}
              toggle={toggle}
              preferred="desc"
            />
            <SortHeader label="Bench result" sortKey="result" sort={sort} toggle={toggle} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((outcome) => (
            <tr key={outcome.id} className={ROW}>
              <td>
                {outcome.screenId ? (
                  <Link
                    href={`/dashboard/screens/${outcome.screenId}?tab=validation`}
                    className={cn("font-medium text-ink hover:text-orange-500", ROW_TARGET)}
                  >
                    {outcome.gene}
                    <span className="sr-only">, open the screen this outcome belongs to</span>
                  </Link>
                ) : (
                  <span className="font-medium text-ink">{outcome.gene}</span>
                )}
              </td>
              <td className="text-sm">{outcome.assay ?? <NotRecorded />}</td>
              <td className="tabular-nums">
                {outcome.predicted !== null ? outcome.predicted.toFixed(3) : <NotRecorded />}
              </td>
              <td>
                <OutcomeBadge result={outcome.result} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
