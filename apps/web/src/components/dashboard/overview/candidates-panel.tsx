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
 *   real        model score, guides agree, and the flag marker on the call
 *   interesting the call, and novelty: how little of the Atlas has called it
 *   testable    which screen it came from, and that screen's re-test assay
 *
 * WHAT CHANGED, AND WHAT IT COST
 *
 * Novelty is a column now. It is one of the three constraints and it was on
 * neither the row nor the drawer, so the panel could not express "real but a core
 * essential", which is the commonest reason to drop a candidate. The seventh
 * column it would have needed does not fit: the table measures 480px inside a
 * 490px panel at 1280, so a seventh column puts the whole table into sideways
 * scroll at every desktop width. FDR gave up its place instead. Every row here is
 * already past the cut, the cut is named in the footer, and the q-value is still
 * in the drawer, in the export and on the screen's own Hits tab, so what is lost
 * is a digit a reader was not deciding on. Novelty is not available anywhere else
 * on this page.
 *
 * Stored model scores are uncalibrated. No probability or interval is inferred.
 *
 * The header carries the QC verdict of the screen the rows came from, and the
 * caveat line under it says what that verdict means, because every row on this
 * panel can come from one screen and that screen can be a warned one.
 */

import { ArrowUpRight, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { ModalDrawer } from "@/components/dashboard/drawer";
import {
  DenseTable,
  Empty,
  FootNote,
  NotRecorded,
  Panel,
  PANEL_CHROME,
  PanelSelect,
  ROW_HIT,
  SortTh,
  Th,
} from "@/components/dashboard/ui";
import { type Verdict } from "@/lib/mock/data";
import { cn, formatNumber } from "@/lib/utils";

import { candidatesCsv, downloadCsv } from "./export-rows";
import { useFitRows } from "./fit-rows";
import { pickGene, pickKey, useShortlist } from "./shortlist";
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
 * of a column that has to fit five others in 490px, and the tint carries the same
 * grouping. The word is always there, so a colour-blind reader loses nothing.
 */
const CALL_TONE: Record<Verdict, string> = {
  "Real and new": "bg-orange-50 text-orange-700",
  "Real and known": "bg-cyan-50 text-cyan-700",
  "Real but generic": "bg-mist-soft text-body",
  Artifact: "bg-red-50 text-red-700",
  Uncertain: "bg-mist-soft text-muted",
};

/**
 * The views, as a closed set with a predicate each.
 *
 * WHY THIS IS A SELECT AND NOT A SEGMENTED CONTROL. There were three views: All,
 * No flags, Picked. The workflow is a sequence of filters and three of them is
 * not a sequence, so a reader could not ask the two questions they actually ask
 * next, which are "only the new ones" and "only the ones I would defend". A
 * segmented control cannot hold nine options in the 110px a 40px header can spare
 * beside a title and a count; a native select can, and it is the one control that
 * is already keyboard and screen reader correct on every platform.
 *
 * Every predicate is a filter on evidence the row already shows, so a reader can
 * always see why a row survived the filter.
 */
interface ViewSpec {
  value: string;
  label: string;
  group: string;
  /** Spelled out for the export preamble, which has to say what subset it is. */
  described: string;
  keep: (row: CandidateRow, picked: readonly string[]) => boolean;
}

const VIEWS: ViewSpec[] = [
  {
    value: "all",
    label: "All candidates",
    group: "Everything",
    described: "all candidates",
    keep: () => true,
  },
  {
    value: "clean",
    label: "No artifact flags",
    group: "How defensible",
    described: "candidates carrying no artifact flag",
    // A row whose flags were never fetched is not a clean row. Null fails the
    // filter, so "No artifact flags" means the artifact stage ran and raised
    // nothing, never that nobody looked.
    keep: (row) => row.flags !== null && row.flags.length === 0,
  },
  {
    value: "agree",
    label: "All guides agree",
    group: "How defensible",
    described: "candidates whose every guide moves the same way",
    keep: (row) =>
      row.guides !== null && row.guidesAgree !== null && row.guidesAgree === row.guides,
  },
  {
    value: "c90",
    label: "Model score 0.90 or more",
    group: "How defensible",
    described: "candidates at model score 0.90 or above",
    keep: (row) => row.chance !== null && row.chance >= 0.9,
  },
  {
    value: "c80",
    label: "Model score 0.80 or more",
    group: "How defensible",
    described: "candidates at model score 0.80 or above",
    keep: (row) => row.chance !== null && row.chance >= 0.8,
  },
  {
    value: "new",
    label: "Called: real and new",
    group: "How interesting",
    described: "candidates the artifact stage called real and new",
    keep: (row) => row.verdict === "Real and new",
  },
  {
    value: "known",
    label: "Called: real and known",
    group: "How interesting",
    described: "candidates the artifact stage called real and known",
    keep: (row) => row.verdict === "Real and known",
  },
  {
    value: "n70",
    label: "Novelty 70% or more",
    group: "How interesting",
    described: "candidates at novelty 0.70 or above",
    keep: (row) => row.novelty !== null && row.novelty >= 0.7,
  },
  {
    value: "picked",
    label: "Picked for this round",
    group: "This round",
    described: "the candidates on the shortlist",
    keep: (row, picked) => picked.includes(pickKey(row.screenId, row.gene)),
  },
];

const VIEW_GROUPS = [...new Set(VIEWS.map((view) => view.group))];

const asView = (value: string): ViewSpec =>
  VIEWS.find((view) => view.value === value) ?? VIEWS[0];

const cellOf = (row: CandidateRow, key: string): Cell => {
  switch (key) {
    case "gene":
      return row.gene;
    case "chance":
      return row.chance;
    case "fdr":
      return row.fdr;
    case "lfc":
      // Direction is read off the sign in the cell; ranking is by size of effect.
      return row.lfc === null ? null : Math.abs(row.lfc);
    case "novelty":
      return row.novelty;
    case "guides":
      return row.guidesAgree;
    default:
      return null;
  }
};

/** What each sort key is called in a sentence, for the export preamble. */
const SORT_LABEL: Record<string, string> = {
  gene: "gene symbol",
  chance: "model score",
  lfc: "size of effect",
  novelty: "novelty",
  guides: "guides agreeing",
  fdr: "FDR",
};

/** Signed, because which arm a gene came out of is half of what it means. */
const lfc = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}`;

const pct = (value: number) => `${Math.round(value * 100)}%`;

export function CandidatesPanel({
  rows,
  ranked,
  total,
  unit,
  provenance,
  qc,
  emptyBody,
  sample,
  className,
}: {
  rows: CandidateRow[];
  /** What the list is ordered by before anybody picks a column. */
  ranked: "chance" | "fdr";
  /** The panel's denominator: how many candidates exist before any filter. */
  total: number;
  /** What one row is, spelled out, because a bare count is a marketing number. */
  unit: string;
  /** Tool version, thresholds and library, for the footer. */
  provenance: string;
  /**
   * The QC verdict of the screen these rows came from, and what it means. Null
   * only when every screen behind the rows passed, which is the one case where
   * silence is honest.
   */
  qc: { verdict: "warn" | "fail" | "pending"; note: string; href: string } | null;
  emptyBody: string;
  /** True in the sample workspace. The export says so in its own preamble. */
  sample: boolean;
  className?: string;
}) {
  const { get, set } = usePanelUrl("c");
  const view = asView(get("view"));
  const { picked, toggle } = useShortlist(get, set);

  const shown = useMemo(() => rows.filter((row) => view.keep(row, picked)), [rows, view, picked]);

  const fallback = useMemo(
    () => ({ key: ranked, dir: ranked === "chance" ? ("desc" as const) : ("asc" as const) }),
    [ranked],
  );
  const { sorted, key, dir, toggle: sort } = usePanelSort(shown, "c", fallback, cellOf);

  // How many whole rows the height this panel was handed will hold. Without it
  // the bottom row was cut through the middle of its digits at three of the four
  // desktop sizes measured.
  const { ref, maxRows } = useFitRows({
    rowPx: PANEL_CHROME.rowCompact,
    footer: true,
    caveat: qc !== null,
  });

  const [openId, setOpenId] = useState<string | null>(null);
  const close = useCallback(() => setOpenId(null), []);
  const open = rows.find((row) => row.id === openId) ?? null;

  const pickedHere = rows.filter((row) => picked.includes(pickKey(row.screenId, row.gene))).length;

  const onExport = useCallback(() => {
    const csv = candidatesCsv(sorted, {
      filter: view.described,
      sort: `${SORT_LABEL[key] ?? key}, ${dir === "asc" ? "ascending" : "descending"}`,
      provenance,
      caveat: qc === null ? null : qc.note,
      sample,
      picked,
      keyOf: (row) => pickKey(row.screenId, row.gene),
    });
    downloadCsv(`splicr-candidates-${view.value}-${sorted.length}-rows.csv`, csv);
  }, [sorted, view, key, dir, provenance, qc, sample, picked]);

  return (
    <Panel
      id="panel-candidates"
      sectionRef={ref}
      title="Validate next"
      /* "N of M", not M. Measured before this: the header read "76 candidates"
         while the body held 43 rows, so the panel's own denominator disagreed
         with the panel. Hidden below xl, where the title, a denominator and a
         nine-option filter cannot share 362px. */
      count={
        <span className="hidden xl:inline">
          {sorted.length === total
            ? `${formatNumber(total)} ${unit}`
            : `${formatNumber(sorted.length)} of ${formatNumber(total)} ${unit}`}
        </span>
      }
      caveat={
        qc === null ? undefined : (
          <>
            <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">{qc.note}</span>
            <Link
              href={qc.href}
              className="shrink-0 underline decoration-orange-300 underline-offset-2 hover:decoration-orange-700"
            >
              QC
            </Link>
          </>
        )
      }
      span={6}
      body="flush"
      className={className}
      control={
        <PanelSelect
          label="Which candidates to list"
          value={view.value}
          onChange={(event) =>
            set({ view: event.target.value === "all" ? null : event.target.value })
          }
        >
          {VIEW_GROUPS.map((group) => (
            <optgroup key={group} label={group}>
              {VIEWS.filter((option) => option.group === group).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ))}
        </PanelSelect>
      }
      footer={
        <>
          <FootNote>{provenance}</FootNote>
          <span className="flex shrink-0 items-center gap-3">
            <span className="num" aria-live="polite">
              {pickedHere === 0 ? "None picked" : `${formatNumber(pickedHere)} picked`}
            </span>
            {/* A button, not a link: the file is the rows on screen, built here,
                so there is no URL that would produce it. */}
            <button
              type="button"
              onClick={onExport}
              disabled={sorted.length === 0}
              className="shrink-0 text-[11px] text-cyan-600 underline decoration-line-strong underline-offset-2 hover:decoration-cyan-600 disabled:text-muted disabled:no-underline"
            >
              Export these {formatNumber(sorted.length)} rows (CSV)
            </button>
          </span>
        </>
      }
    >
      {sorted.length === 0 ? (
        <div className="px-[var(--panel-gutter)] py-3.5">
          <Empty
            title={view.value === "all" ? "No candidates to show" : "Nothing in this view"}
            body={
              view.value === "all"
                ? emptyBody
                : view.value === "picked"
                  ? "Tick a gene in any other view to put it on the shortlist. The picks go into this page's address, so the view you are looking at is the view you can send."
                  : `No candidate here is ${view.described.replace(/^(the )?candidates? /, "")}. Switch the filter back to all candidates.`
            }
          />
        </div>
      ) : (
        <DenseTable compact maxRows={maxRows} minWidth={460}>
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
                label="Score"
                align="right"
                active={key === "chance"}
                dir={dir}
                onToggle={() => sort("chance", "desc")}
                title="Recorded model score. Calibration and uncertainty are not established; this is not a validation probability."
              />
              <SortTh
                label="LFC"
                align="right"
                active={key === "lfc"}
                dir={dir}
                onToggle={() => sort("lfc", "desc")}
                title="Recorded log2 fold change for this comparison. Interpret the sign with the recorded contrast."
              />
              <SortTh
                label="New"
                align="right"
                active={key === "novelty"}
                dir={dir}
                onToggle={() => sort("novelty", "desc")}
                title="Historical novelty score when available. Frequent hits may still matter for this assay; novelty alone does not determine experimental value."
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
              const pick = pickKey(row.screenId, row.gene);
              const on = picked.includes(pick);
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
                        onChange={() => toggle(pick)}
                        aria-label={`Shortlist ${row.gene}`}
                        className="h-3.5 w-3.5 shrink-0 accent-teal-800"
                      />
                      <button
                        type="button"
                        onClick={() => setOpenId(row.id)}
                        aria-haspopup="dialog"
                        aria-expanded={openId === row.id}
                        /* orange-600, not 500. The row tints to mist-soft on
                           hover and focus, where orange-500 measured 4.11:1 at
                           13px and 500 weight, under the 4.5 the house rules
                           require. This pair measures 5.26:1. */
                        className="truncate font-medium text-ink transition-colors duration-[var(--dur-1)] hover:text-orange-600 motion-reduce:transition-none"
                      >
                        {row.gene}
                        <span className="sr-only">, open the evidence for this hit</span>
                      </button>
                    </span>
                  </td>
                  <td>
                    <span className="flex items-center gap-1.5">
                      {row.verdict ? <Call verdict={row.verdict} /> : <NotRecorded />}
                      {row.flags !== null && row.flags.length > 0 && (
                        <FlagMark flags={row.flags} />
                      )}
                    </span>
                  </td>
                  <td className="num-col" title="Uncalibrated model score">
                    {row.chance !== null ? row.chance.toFixed(3) : <NotRecorded />}
                  </td>
                  <td className="num-col">{row.lfc !== null ? lfc(row.lfc) : <NotRecorded />}</td>
                  <td className="num-col">
                    {row.novelty !== null ? pct(row.novelty) : <NotRecorded />}
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
          qc={qc}
          sample={sample}
          picked={picked.includes(pickKey(open.screenId, open.gene))}
          onPick={() => toggle(pickKey(open.screenId, open.gene))}
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
 * Artifact flags, as a mark rather than a column. A seventh column cost more
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
 *
 * What is deliberately not here: the four guide-level log2 values behind the
 * chance. There is no guide table behind these rows, and the project's standing
 * decision is to say so rather than invent one, which is the same reason the
 * plate order file carries no oligos. The drawer links out to the screen's own
 * Hits tab and to the Atlas record instead, which are the two places the
 * underlying rows actually live.
 */
function Evidence({
  row,
  qc,
  sample,
  picked,
  onPick,
  onClose,
}: {
  row: CandidateRow;
  qc: { verdict: string; note: string; href: string } | null;
  sample: boolean;
  picked: boolean;
  onPick: () => void;
  onClose: () => void;
}) {
  const onExport = useCallback(() => {
    const csv = candidatesCsv([row], {
      filter: `the single candidate ${row.gene}`,
      sort: "not applicable, one row",
      provenance: row.screenName ?? row.screenId,
      caveat: qc === null ? null : qc.note,
      sample,
      picked: picked ? [pickKey(row.screenId, row.gene)] : [],
      keyOf: (candidate) => pickKey(candidate.screenId, candidate.gene),
    });
    downloadCsv(`splicr-${row.gene}.csv`, csv);
  }, [row, qc, sample, picked]);

  return (
    <ModalDrawer eyebrow="Evidence" title={row.gene} onClose={onClose} closeLabel="Close evidence">
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {row.verdict && <Call verdict={row.verdict} full />}
        {/* Repeated here on purpose. The header chip is easy to walk past, and
            this is the moment a reader decides to spend six weeks on the row. */}
        {qc !== null && (
          <Link
            href={qc.href}
            className="inline-flex items-center gap-1 rounded-[4px] bg-orange-50 px-1.5 py-0.5 text-[11px] text-orange-700 underline decoration-orange-300 underline-offset-2 hover:decoration-orange-700"
          >
            <TriangleAlert className="h-2.5 w-2.5" aria-hidden="true" />
            QC {qc.verdict} on this screen
          </Link>
        )}
      </div>

      {qc !== null && <p className="mt-2 text-[11px] leading-snug text-orange-700">{qc.note}</p>}

      {row.why && <p className="mt-3 text-[13px] leading-relaxed text-body">{row.why}</p>}

      <dl className="mt-4 divide-y divide-line border-y border-line text-[13px]">
        <Fact
          term="Model score"
          value={row.chance !== null ? row.chance.toFixed(3) : null}
          note="Recorded model output. No validated probability or uncertainty interval is available."
        />
        <Fact
          term="Novelty"
          value={row.novelty !== null ? pct(row.novelty) : null}
          note="Historical novelty score when available. Frequent hits may be relevant; interpret them in the assay context."
        />
        <Fact
          term="Effect size"
          value={row.lfc !== null ? `${lfc(row.lfc)} log2` : null}
          note="Recorded log2 fold change; the comparison defines its reference and direction."
        />
        <Fact
          term="FDR"
          value={row.fdr !== null ? row.fdr.toExponential(2) : null}
          note="Recorded false-discovery estimate from the hit-calling method. Check run provenance for the test and correction."
        />
        <Fact
          term="Bayes factor"
          value={row.bayes !== null ? row.bayes.toFixed(1) : null}
          note="Recorded Bayes factor when available. Check the analysis method and reference sets in run provenance."
        />
        <Fact
          term="Guide agreement"
          value={
            row.guidesAgree !== null && row.guides !== null
              ? `${row.guidesAgree} of ${row.guides} guides`
              : null
          }
          note="sgRNAs against this gene moving in the same direction. The per-guide fold changes are on the screen's Hits tab; there is no guide table behind these rows, so none is drawn here."
        />
        <Fact
          term="Atlas context"
          value={
            row.atlasHits !== null && row.atlasScreens !== null
              ? `Called in ${formatNumber(row.atlasHits)} of ${formatNumber(row.atlasScreens)} screens`
              : null
          }
          note="Atlas screens that assayed this gene, which is a subset of the corpus, not its size."
          href={`/dashboard/atlas?gene=${encodeURIComponent(row.gene)}`}
          hrefLabel="Open the Atlas record"
        />
        <Fact
          term="Re-test it would take"
          value={row.benchAssay}
          note="The assay this screen's validation plan orders, which is what testable means here."
        />
      </dl>

      <div className="mt-4">
        <div className="text-[11px] uppercase tracking-[0.06em] text-muted">Artifact flags</div>
        {row.flags === null ? (
          <p className="mt-1 text-[13px] text-body">
            Not recorded. The artifact stage has not reported on this hit, which is
            not the same as reporting nothing.
          </p>
        ) : row.flags.length === 0 ? (
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
          className={cn("btn btn-sm rounded-lg", picked ? "btn-teal" : "btn-ghost")}
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
        <button type="button" onClick={onExport} className="btn btn-ghost btn-sm rounded-lg">
          This gene (CSV)
        </button>
      </div>
    </ModalDrawer>
  );
}

function Fact({ term, value, note, href, hrefLabel }: {
  term: string;
  value: string | null;
  note: string;
  /** Where the rows behind this one figure are, when there is such a place. */
  href?: string;
  hrefLabel?: string;
}) {
  return (
    <div className="py-2.5">
      <dt className="text-[11px] uppercase tracking-[0.06em] text-muted">{term}</dt>
      <dd className="num mt-0.5 text-ink">{value ?? <NotRecorded />}</dd>
      <dd className="mt-0.5 text-[11px] leading-snug text-muted">
        {note}
        {href && value !== null && (
          <>
            {" "}
            <Link
              href={href}
              className="text-cyan-600 underline decoration-line-strong underline-offset-2 hover:decoration-cyan-600"
            >
              {hrefLabel ?? "Open"}
            </Link>
          </>
        )}
      </dd>
    </div>
  );
}

/** Exported for the page's shortlist summary, which counts the same keys. */
export { pickGene, pickKey };
