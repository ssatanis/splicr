"use client";

/**
 * "Validate next": the table the console exists for, and the page's one tall panel.
 *
 * The decision behind it is narrow and expensive. A postdoc has a few hundred
 * genes past FDR 0.10 and a PI who has approved one validation round, which is
 * thirty to fifty constructs and six to twelve weeks of bench time. They are not
 * choosing the best genes. They are choosing the most defensible ones, under
 * three constraints at once, and every column here is one of those constraints:
 *
 *   real        chance real, guides agree, and the flag marker on the call
 *   interesting the call itself, and the Atlas history in the evidence drawer
 *   testable    which screen it came from, and that screen's re-test assay
 *
 * So the table is the interface, not a fallback: sticky header, every column
 * sortable, numeric columns right aligned on tabular figures, nothing truncated,
 * and as many rows as the panel can hold. Sort and filter state live in the URL
 * because the view has to be sendable. The checkbox is the thing the page was
 * missing entirely: a way to actually pick one.
 */

import { ArrowUpRight, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { ModalDrawer } from "@/components/dashboard/drawer";
import {
  DenseTable,
  Empty,
  FootLink,
  FootNote,
  NotRecorded,
  Panel,
  ROW_HIT,
  Segmented,
  SortTh,
  Th,
} from "@/components/dashboard/ui";
import type { Verdict } from "@/lib/mock/data";
import { cn, formatNumber } from "@/lib/utils";

import { useShortlist } from "./shortlist";
import type { CandidateRow } from "./types";
import { usePanelSort, usePanelUrl, type Cell } from "./url-state";

/**
 * The call, short enough for a dense column. The full verdict is on the cell as
 * its title and spelled out in the drawer, so nothing is only ever abbreviated.
 */
const CALL_SHORT: Record<Verdict, string> = {
  "Real and new": "Real, new",
  "Real but generic": "Real, generic",
  "Real and known": "Real, known",
  Artifact: "Artifact",
  Uncertain: "Uncertain",
};

/**
 * The chip is tinted rather than dotted. A dot plus its gap cost twelve pixels
 * of a column that has to fit six others in 490px, and the tint carries the same
 * grouping. The word is always there, so a colour-blind reader loses nothing.
 */
const CALL_TONE: Record<Verdict, string> = {
  "Real and new": "bg-orange-50 text-orange-700",
  "Real and known": "bg-cyan-50 text-cyan-700",
  "Real but generic": "bg-mist-soft text-body",
  Artifact: "bg-red-50 text-red-700",
  Uncertain: "bg-mist-soft text-muted",
};

type View = "all" | "clean" | "picked";

const VIEWS: { value: View; label: string }[] = [
  { value: "all", label: "All" },
  { value: "clean", label: "No flags" },
  { value: "picked", label: "Picked" },
];

const asView = (value: string): View =>
  value === "clean" || value === "picked" ? value : "all";

const cellOf = (row: CandidateRow, key: string): Cell => {
  switch (key) {
    case "gene":
      return row.gene;
    case "chance":
      return row.chance;
    case "lfc":
      // Direction is read off the sign in the cell; ranking is by size of effect.
      return row.lfc === null ? null : Math.abs(row.lfc);
    case "fdr":
      return row.fdr;
    case "guides":
      return row.guidesAgree;
    default:
      return null;
  }
};

/** Signed, because which arm a gene came out of is half of what it means. */
const lfc = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}`;

export function CandidatesPanel({
  rows,
  ranked,
  count,
  provenance,
  exportHref,
  emptyBody,
  className,
}: {
  rows: CandidateRow[];
  /** What the list is ordered by before anybody picks a column. */
  ranked: "chance" | "fdr";
  /** The panel's denominator, with its unit spelled out. */
  count: string;
  /** Tool version, thresholds and library, for the footer. */
  provenance: string;
  /** The CSV of the rows behind these figures, or null when there is not one. */
  exportHref: string | null;
  emptyBody: string;
  className?: string;
}) {
  const { get, set } = usePanelUrl("c");
  const view = asView(get("view"));
  const { picked, toggle } = useShortlist();

  const shown = useMemo(() => {
    if (view === "clean") return rows.filter((row) => row.flags.length === 0);
    if (view === "picked") return rows.filter((row) => picked.includes(row.gene));
    return rows;
  }, [rows, view, picked]);

  const fallback = useMemo(
    () => ({ key: ranked, dir: ranked === "chance" ? ("desc" as const) : ("asc" as const) }),
    [ranked],
  );
  const { sorted, key, dir, toggle: sort } = usePanelSort(shown, "c", fallback, cellOf);

  const [openId, setOpenId] = useState<string | null>(null);
  const close = useCallback(() => setOpenId(null), []);
  const open = rows.find((row) => row.id === openId) ?? null;

  const pickedHere = rows.filter((row) => picked.includes(row.gene)).length;

  return (
    <Panel
      title="Validate next"
      /* Hidden on a phone, where the title, the denominator and a three way
         control cannot share 343px without the title becoming "Validate n...".
         The same figure is in the strip above, with its denominator. */
      count={<span className="hidden sm:inline">{count}</span>}
      span={6}
      body="flush"
      className={className}
      control={
        <Segmented
          label="Filter candidates"
          value={view}
          options={VIEWS}
          onChange={(next) => set({ view: next === "all" ? null : next })}
        />
      }
      footer={
        <>
          <FootNote>{provenance}</FootNote>
          <span className="flex shrink-0 items-center gap-3">
            <span className="num" aria-live="polite">
              {pickedHere === 0 ? "None picked" : `${formatNumber(pickedHere)} picked`}
            </span>
            {exportHref && (
              <FootLink href={exportHref}>Export rows (CSV)</FootLink>
            )}
          </span>
        </>
      }
    >
      {sorted.length === 0 ? (
        <div className="px-[var(--panel-gutter)] py-3.5">
          <Empty
            title={view === "all" ? "No candidates to show" : "Nothing in this view"}
            body={
              view === "all"
                ? emptyBody
                : view === "picked"
                  ? "Tick a gene in the All view to put it on the shortlist."
                  : "Every candidate here carries at least one artifact flag."
            }
          />
        </div>
      ) : (
        <DenseTable minWidth={460}>
          <thead>
            <tr>
              <SortTh
                label="Gene"
                active={key === "gene"}
                dir={dir}
                onToggle={() => sort("gene", "asc")}
                title="Tick to shortlist. Select the symbol for the evidence behind the row."
              />
              <Th>Call</Th>
              <SortTh
                label="Real"
                align="right"
                active={key === "chance"}
                dir={dir}
                onToggle={() => sort("chance", "desc")}
                title="Calibrated probability the hit is real, in percent, net of any flag."
              />
              <SortTh
                label="LFC"
                align="right"
                active={key === "lfc"}
                dir={dir}
                onToggle={() => sort("lfc", "desc")}
                title="log2 fold change at the endpoint against T0. Positive is the enriched arm."
              />
              <SortTh
                label="FDR"
                align="right"
                active={key === "fdr"}
                dir={dir}
                onToggle={() => sort("fdr", "asc")}
                title="Benjamini-Hochberg q-value, to one significant figure."
              />
              <SortTh
                label="Agree"
                align="right"
                active={key === "guides"}
                dir={dir}
                onToggle={() => sort("guides", "desc")}
                title="sgRNAs against this gene that move in the same direction, of the guides it has."
              />
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const on = picked.includes(row.gene);
              return (
                <tr key={row.id} className={ROW_HIT}>
                  <td>
                    <span className="flex items-center gap-2">
                      {/* A native checkbox: it is the one control that is already
                          keyboard and screen reader correct everywhere, and the
                          global focus ring finds it without help. */}
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(row.gene)}
                        aria-label={`Shortlist ${row.gene}`}
                        className="h-3.5 w-3.5 shrink-0 accent-teal-800"
                      />
                      <button
                        type="button"
                        onClick={() => setOpenId(row.id)}
                        aria-haspopup="dialog"
                        aria-expanded={openId === row.id}
                        className="truncate font-medium text-ink transition-colors duration-[var(--dur-1)] hover:text-orange-500 motion-reduce:transition-none"
                      >
                        {row.gene}
                        <span className="sr-only">, open the evidence for this hit</span>
                      </button>
                    </span>
                  </td>
                  <td>
                    <span className="flex items-center gap-1.5">
                      {row.verdict ? <Call verdict={row.verdict} /> : <NotRecorded />}
                      {row.flags.length > 0 && <FlagMark flags={row.flags} />}
                    </span>
                  </td>
                  <td className="num-col">
                    {row.chance !== null ? `${Math.round(row.chance * 100)}%` : <NotRecorded />}
                  </td>
                  <td className="num-col">{row.lfc !== null ? lfc(row.lfc) : <NotRecorded />}</td>
                  <td className="num-col">
                    {row.fdr !== null ? row.fdr.toExponential(1) : <NotRecorded />}
                  </td>
                  <td className="num-col">
                    {row.guidesAgree !== null && row.guides !== null ? (
                      `${row.guidesAgree} of ${row.guides}`
                    ) : (
                      <NotRecorded />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </DenseTable>
      )}

      {open && (
        <Evidence
          row={open}
          picked={picked.includes(open.gene)}
          onPick={() => toggle(open.gene)}
          onClose={close}
        />
      )}
    </Panel>
  );
}

/** The call, as a square dense chip. The word is always there; the tint only groups. */
function Call({ verdict, full = false }: { verdict: Verdict; full?: boolean }) {
  return (
    <span
      title={verdict}
      className={cn(
        "inline-flex h-[18px] max-w-full items-center truncate rounded-[4px] px-1.5 text-[11px] leading-none",
        CALL_TONE[verdict],
      )}
    >
      {full ? verdict : CALL_SHORT[verdict]}
    </span>
  );
}

/**
 * Artifact flags, as a mark rather than a column. The seventh column cost more
 * width than the panel has, so the row keeps the signal and the drawer names the
 * flags themselves, which is where the reader is actually deciding.
 */
function FlagMark({ flags }: { flags: string[] }) {
  const label = `${flags.length === 1 ? "1 artifact flag" : `${flags.length} artifact flags`}: ${flags.join(", ")}`;
  return (
    <span
      title={label}
      className="inline-flex shrink-0 items-center rounded-[4px] bg-orange-50 px-1 text-orange-700"
    >
      <TriangleAlert className="h-2.5 w-2.5" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/**
 * One click from the number to what produced it. Every figure in the drawer
 * carries its definition next to it, because a figure this audience cannot trace
 * to a measurement is the thing they find embarrassing.
 */
function Evidence({
  row,
  picked,
  onPick,
  onClose,
}: {
  row: CandidateRow;
  picked: boolean;
  onPick: () => void;
  onClose: () => void;
}) {
  return (
    <ModalDrawer eyebrow="Evidence" title={row.gene} onClose={onClose} closeLabel="Close evidence">
      {row.verdict && (
        <div className="mt-3">
          <Call verdict={row.verdict} full />
        </div>
      )}

      {row.why && <p className="mt-3 text-[13px] leading-relaxed text-body">{row.why}</p>}

      <dl className="mt-4 divide-y divide-line border-y border-line text-[13px]">
        <Fact
          term="Chance real"
          value={row.chance !== null ? `${Math.round(row.chance * 100)}%` : null}
          note="Calibrated probability from the scoring stage, net of every flag below."
        />
        <Fact
          term="Effect size"
          value={row.lfc !== null ? `${lfc(row.lfc)} log2` : null}
          note="Fold change at the endpoint against T0. Positive is the enriched arm."
        />
        <Fact
          term="FDR"
          value={row.fdr !== null ? row.fdr.toExponential(2) : null}
          note="Benjamini-Hochberg q-value, from the hit-calling stage."
        />
        <Fact
          term="Guide agreement"
          value={
            row.guidesAgree !== null && row.guides !== null
              ? `${row.guidesAgree} of ${row.guides} guides`
              : null
          }
          note="sgRNAs against this gene moving in the same direction."
        />
        <Fact
          term="Atlas context"
          value={
            row.atlasHits !== null && row.atlasScreens !== null
              ? `Called in ${formatNumber(row.atlasHits)} of ${formatNumber(row.atlasScreens)} screens`
              : null
          }
          note="Atlas screens that assayed this gene, which is a subset of the corpus, not its size."
        />
        <Fact
          term="Re-test it would take"
          value={row.benchAssay}
          note="The assay this screen's validation plan orders, which is what testable means here."
        />
      </dl>

      <div className="mt-4">
        <div className="text-[11px] uppercase tracking-[0.06em] text-muted">Artifact flags</div>
        {row.flags.length === 0 ? (
          <p className="mt-1 text-[13px] text-body">None raised by the artifact stage.</p>
        ) : (
          <>
            <p className="mt-1 text-[11px] text-muted">
              Each flag cost this gene log-odds on the score above.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {row.flags.map((flag) => (
                <span
                  key={flag}
                  className="inline-flex rounded-md bg-orange-50 px-2 py-0.5 text-[11px] text-orange-700"
                >
                  {flag}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onPick}
          aria-pressed={picked}
          className={cn(
            "btn btn-sm rounded-lg",
            picked ? "btn-teal" : "btn-ghost",
          )}
        >
          {picked ? "On the shortlist" : "Add to shortlist"}
        </button>
        <Link
          href={`/dashboard/screens/${row.screenId}?tab=hits`}
          className="btn btn-ghost btn-sm rounded-lg"
        >
          {row.screenName ? `Open ${row.screenName}` : "Open the screen"}
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </ModalDrawer>
  );
}

function Fact({ term, value, note }: { term: string; value: string | null; note: string }) {
  return (
    <div className="py-2.5">
      <dt className="text-[11px] uppercase tracking-[0.06em] text-muted">{term}</dt>
      <dd className="num mt-0.5 text-ink">{value ?? <NotRecorded />}</dd>
      <dd className="mt-0.5 text-[11px] leading-snug text-muted">{note}</dd>
    </div>
  );
}
