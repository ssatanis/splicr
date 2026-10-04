"use client";

/**
 * The Truth Loop.
 *
 * This page answers "what did the bench find?" and keeps four answers apart:
 * validated, did not validate, inconclusive, and still at the bench. It states a
 * validation rate only over the two that decide the question, with the count and
 * an interval, and it says in words what recording an outcome does not do: it
 * does not change a score and it does not retrain a model. No such retraining
 * exists in this repository.
 *
 * ONE VIEW, TWO BACKENDS. In a workspace the rows come from the server for the
 * address in the address bar, and the three verbs are server actions that check
 * the caller's role again on the server. In the demonstration the same view
 * holds a list in the browser tab and validates with the same schema, so a
 * visitor can rehearse the whole flow without a database and without anything
 * being saved. The page says which one it is.
 */
import { ExternalLink, Loader2, Plus, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";

import {
  OUTCOME_PAGE_SIZE,
  OUTCOME_RESULTS,
  RESULT_COPY,
  countsInScope,
  decidedRate,
  filterOutcomes,
  outcomeHref,
  type OutcomeCounts,
  type OutcomeFilters,
  type OutcomeResult,
  type OutcomeRow,
} from "@/lib/outcomes/model";
import { outcomesCsv } from "@/lib/outcomes/csv";
import {
  measurementFromValues,
  parseOutcomeDraft,
  type OutcomeDraft,
} from "@/lib/outcomes/schema";
import { cn, formatNumber } from "@/lib/utils";
import {
  ENDPOINT_DECISION_LABEL,
  QUESTION_LABEL,
  TYPE_QUESTION,
  VALIDATION_TYPE_LABEL,
} from "@/lib/validation/model";

import { SampleNote, ABOVE_ROW_LINK, ROW_LINK } from "../console";
import { TextFootLink } from "../console-controls";
import { OutcomeBadge } from "../outcome-badge";
import { DenseTable, Empty, FootLink, FootNote, KpiStrip, KpiTile, PageHeader, Panel, ROW_HIT, Th } from "../ui";
import type { OutcomeAdapter, RemoveResult, SaveResult } from "./adapter";
import { OutcomeDrawer } from "./form";

export interface WorkspaceActions {
  log: (draft: OutcomeDraft) => Promise<SaveResult>;
  update: (id: string, draft: OutcomeDraft) => Promise<SaveResult>;
  remove: (id: string) => Promise<RemoveResult>;
}

export interface TruthLoopProps {
  mode: "demo" | "workspace";
  /** Workspace: this page of rows. Demo: every row, filtered and paged here. */
  rows: OutcomeRow[];
  /** Workspace only: matching rows before paging. */
  total?: number;
  /** Workspace only: totals from the database. */
  counts?: OutcomeCounts;
  screens: { id: string; name: string }[];
  filters: OutcomeFilters;
  canWrite: boolean;
  canDelete: boolean;
  /** Workspace only. */
  actions?: WorkspaceActions;
  /** Open the form already filled in, from a link on a hit. */
  prefill: { gene: string; screenId: string } | null;
  exportHref: string;
}

const BASE = "/dashboard/validation";
const DEMO_NOTE = "Sample workspace: this entry lives in this browser tab and is not saved.";

const shortDate = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

/**
 * Whether the engine's endpoint verdict contradicts the label the lab recorded.
 *
 * `insufficient_record` is not a contradiction: it means a criterion the
 * endpoint requires was not written down, which is a gap in the record rather
 * than a disagreement about the result. Flagging it as one would nag every
 * outcome logged outside a round, since those have no prespecified effect bar.
 */
/** The experiment, and which of the four questions it bears on. */
function experimentTitle(type: NonNullable<OutcomeRow["validationType"]>): string {
  const question = TYPE_QUESTION[type];
  return question
    ? `${VALIDATION_TYPE_LABEL[type]} — bears on ${QUESTION_LABEL[question].toLowerCase()}`
    : `${VALIDATION_TYPE_LABEL[type]} — bears on none of the four questions`;
}

function disagrees(row: OutcomeRow): boolean {
  if (row.endpointDecision === null) return false;
  if (row.endpointDecision === "insufficient_record") return false;
  return row.endpointDecision !== row.result;
}

function percent(value: number): string {
  const pct = value * 100;
  return `${pct >= 10 || pct === 0 || pct === 100 ? pct.toFixed(0) : pct.toFixed(1)}%`;
}

export function TruthLoopView(props: TruthLoopProps) {
  const { mode, screens, filters, canWrite, canDelete, prefill } = props;
  const demo = mode === "demo";

  const [demoRows, setDemoRows] = useState<OutcomeRow[]>(demo ? props.rows : []);
  const [drawer, setDrawer] = useState<{ kind: "new" } | { kind: "edit"; row: OutcomeRow } | null>(
    canWrite && prefill ? { kind: "new" } : null,
  );
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (status === null) return;
    const timer = window.setTimeout(() => setStatus(null), 7000);
    return () => window.clearTimeout(timer);
  }, [status]);

  const adapter: OutcomeAdapter = useMemo(() => {
    if (!demo && props.actions) return { demo: false, ...props.actions };
    const screenName = (id: string) => screens.find((screen) => screen.id === id)?.name ?? null;
    const save = (id: string | null, draft: OutcomeDraft): SaveResult => {
      const parsed = parseOutcomeDraft(draft);
      if (!parsed.ok) return { ok: false, error: "Some fields need attention.", fieldErrors: parsed.errors };
      const v = parsed.value;
      if (id === null) {
        if (!screens.some((screen) => screen.id === v.screenId)) {
          return { ok: false, error: "Some fields need attention.", fieldErrors: { screenId: "That screen is not in this workspace." } };
        }
        // Built here, outside the state updater, so the result that goes back to
        // the form is the row that was added and not whatever the updater had
        // done by the time it was read.
        const created: OutcomeRow = {
          id: `demo-${Date.now().toString(36)}-${v.gene}`,
          screenId: v.screenId, screenName: screenName(v.screenId), gene: v.gene, result: v.result,
          validationType: v.validationType,
          // The demo scores nothing. An endpoint decision is the engine's
          // verdict on a real measurement, and inventing one here would put a
          // fabricated judgement in the same column a workspace shows a real
          // one in.
          endpoint: null, endpointDecision: null, decisionBecause: null,
          labId: v.labId, arm: "unassigned", roundId: null,
          measurement: measurementFromValues(v),
          assay: v.assay, effectSize: v.effectSize, nGuides: v.nGuides, predicted: null, modelVersion: null,
          notes: v.notes, evidenceUrl: v.evidenceUrl, loggedAt: new Date().toISOString(), loggedBy: "You", hitLinked: false,
        };
        setDemoRows((current) => [created, ...current]);
        return { ok: true, outcome: created, note: DEMO_NOTE };
      }
      const existing = demoRows.find((row) => row.id === id);
      if (!existing) return { ok: false, error: "That outcome is not in this workspace." };
      const updated: OutcomeRow = {
        ...existing, result: v.result, validationType: v.validationType, labId: v.labId,
        measurement: measurementFromValues(v),
        assay: v.assay, effectSize: v.effectSize, nGuides: v.nGuides, notes: v.notes, evidenceUrl: v.evidenceUrl,
      };
      setDemoRows((current) => current.map((row) => (row.id === id ? updated : row)));
      return { ok: true, outcome: updated, note: DEMO_NOTE };
    };
    return {
      demo: true,
      log: async (draft) => save(null, draft),
      update: async (id, draft) => save(id, draft),
      remove: async (id) => {
        setDemoRows((current) => current.filter((row) => row.id !== id));
        return { ok: true };
      },
    };
  }, [demo, props.actions, screens, demoRows]);

  // What the table shows. A workspace page arrives already filtered and paged;
  // the demo list is filtered and paged here with the same functions.
  const shown = useMemo(() => {
    if (!demo) return { rows: props.rows, total: props.total ?? props.rows.length, counts: props.counts as OutcomeCounts };
    const matching = filterOutcomes(demoRows, filters);
    const start = (filters.page - 1) * OUTCOME_PAGE_SIZE;
    return { rows: matching.slice(start, start + OUTCOME_PAGE_SIZE), total: matching.length, counts: countsInScope(demoRows, filters) };
  }, [demo, demoRows, filters, props.rows, props.total, props.counts]);

  const rate = decidedRate(shown.counts);
  const pages = Math.max(1, Math.ceil(shown.total / OUTCOME_PAGE_SIZE));
  const filtered = filters.result !== null || filters.q !== "" || filters.screen !== null;
  const screenScoped = filters.screen !== null;
  const scopeName = screens.find((screen) => screen.id === filters.screen)?.name ?? null;

  // A link from a hit opens the form with `?log=GENE`. Once the form is closed
  // that parameter has done its job, and leaving it in the address would reopen
  // the form on every refresh and in every link sent to a colleague.
  const forgetPrefill = useCallback(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("log") && !url.searchParams.has("logScreen")) return;
    url.searchParams.delete("log");
    url.searchParams.delete("logScreen");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, []);
  const closeDrawer = useCallback(() => {
    setDrawer(null);
    forgetPrefill();
  }, [forgetPrefill]);
  const done = (message: string) => {
    setDrawer(null);
    forgetPrefill();
    setStatus(message);
  };

  const first = shown.rows.length === 0 ? 0 : (filters.page - 1) * OUTCOME_PAGE_SIZE + 1;
  const last = (filters.page - 1) * OUTCOME_PAGE_SIZE + shown.rows.length;

  return (
    <div className="flex flex-col gap-3 pb-6">
      <PageHeader
        dense
        title="Truth Loop"
        body="What the bench found, kept next to the model output stored when each gene was called."
        actions={
          canWrite ? (
            <button
              type="button"
              onClick={() => setDrawer({ kind: "new" })}
              className="btn btn-orange h-8 rounded-lg px-3 py-0 text-[12.5px]"
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> Log an outcome
            </button>
          ) : undefined
        }
      />

      {demo && (
        <SampleNote>
          Sample workspace. These outcomes are invented to show the layout. You can log, amend and delete them to try
          the flow, and nothing is saved when you leave the page.
        </SampleNote>
      )}

      <p className="max-w-3xl text-[12px] leading-snug text-body">
        Recorded outcomes are kept for review. No model is retrained from them, and a stored score is an uncalibrated model
        output, not a probability. A validation rate is stated only over outcomes that were decided.
      </p>

      <div role="status" aria-live="polite" className="min-h-0">
        {status && (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-cyan-100 bg-cyan-50 px-3 py-2 text-[12.5px] text-cyan-800">
            <span>{status}</span>
            <button type="button" onClick={() => setStatus(null)} className="shrink-0 text-cyan-700" aria-label="Dismiss this message">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      <KpiStrip
        title={scopeName ? `Outcomes in ${scopeName}` : "Outcomes"}
        count={`${formatNumber(shown.counts.total)} recorded`}
        className="shrink-0"
        footer={
          <FootNote>
            {rate.rate === null
              ? "Nothing has been decided yet, so no validation rate is stated."
              : `${percent(rate.rate)} of decided outcomes validated: ${rate.validated} of ${rate.decided}, 95% interval ${percent(rate.lower ?? 0)} to ${percent(rate.upper ?? 1)}. Descriptive, not a calibration.`}
          </FootNote>
        }
      >
        <KpiTile
          label="Validated"
          value={formatNumber(shown.counts.validated)}
          denominator={`of ${formatNumber(rate.decided)} decided`}
          definition="An independent assay supported the hit."
          tone="cyan"
          href={outcomeHref(BASE, filters, { result: "validated" })}
        />
        <KpiTile
          label="Did not validate"
          value={formatNumber(shown.counts.failed)}
          denominator={`of ${formatNumber(rate.decided)} decided`}
          definition="The assay ran and did not support the hit."
          tone="orange"
          href={outcomeHref(BASE, filters, { result: "failed" })}
        />
        <KpiTile
          label="Inconclusive"
          value={formatNumber(shown.counts.inconclusive)}
          denominator="not decided"
          definition="The assay could not decide. Not counted as a failure."
          href={outcomeHref(BASE, filters, { result: "inconclusive" })}
        />
        <KpiTile
          label="Still at the bench"
          value={formatNumber(shown.counts.pending)}
          denominator="no result yet"
          definition="Open one to record its result when it is in."
          href={outcomeHref(BASE, filters, { result: "pending" })}
        />
      </KpiStrip>

      <Panel
        title="All outcomes"
        count={filtered ? `${formatNumber(shown.total)} match${shown.total === 1 ? "es" : ""}` : `${formatNumber(shown.total)} recorded`}
        body="flush"
        className="min-h-[300px]"
        footer={
          <>
            <FootNote className="hidden md:block">Newest first. Result is what the assay measured, not the model&apos;s verdict.</FootNote>
            <span className="ml-auto flex shrink-0 items-center gap-4">
              <nav aria-label="Pages" className="flex items-center gap-2 text-[11px] text-muted">
                <span className="num" aria-live="polite">
                  {first === 0 ? "No rows" : `${formatNumber(first)}–${formatNumber(last)} of ${formatNumber(shown.total)}`}
                </span>
                {filters.page > 1 ? (
                  <Link className="rounded px-1.5 py-0.5 text-cyan-600 hover:bg-cyan-50" href={outcomeHref(BASE, filters, { page: filters.page - 1 })} replace scroll={false}>
                    Previous
                  </Link>
                ) : (
                  <span className="px-1.5 text-muted/60" aria-disabled="true">Previous</span>
                )}
                <span className="num">Page {filters.page} of {pages}</span>
                {filters.page < pages ? (
                  <Link className="rounded px-1.5 py-0.5 text-cyan-600 hover:bg-cyan-50" href={outcomeHref(BASE, filters, { page: filters.page + 1 })} replace scroll={false}>
                    Next
                  </Link>
                ) : (
                  <span className="px-1.5 text-muted/60" aria-disabled="true">Next</span>
                )}
              </nav>
              {demo ? (
                <TextFootLink
                  filename="splicr-sample-outcomes.csv"
                  build={() =>
                    outcomesCsv(filterOutcomes(demoRows, filters), { filters, generatedAt: new Date(), sample: true, screenLabel: scopeName })
                  }
                >
                  Export CSV
                </TextFootLink>
              ) : (
                <FootLink href={props.exportHref} download>
                  Export CSV
                  <span className="sr-only"> of every outcome matching these filters</span>
                </FootLink>
              )}
            </span>
          </>
        }
      >
        <Filters filters={filters} screens={screens} />

        {shown.rows.length === 0 ? (
          <div className="p-4">
            <Empty
              title={filtered ? "No outcome matches these filters" : "No outcome has been recorded yet"}
              body={
                filtered
                  ? "Clear a filter to see more."
                  : canWrite
                    ? "When a gene goes back on a plate, log what the assay found. It is kept next to the score the model gave it."
                    : "Members of this workspace can log outcomes. Yours is a read-only role."
              }
              action={
                filtered ? (
                  <Link href={BASE} replace className="text-[12px] text-cyan-600 underline decoration-line-strong underline-offset-2">
                    Clear the filters
                  </Link>
                ) : canWrite ? (
                  <button type="button" onClick={() => setDrawer({ kind: "new" })} className="btn btn-orange rounded-lg px-3 py-1.5 text-[12.5px]">
                    Log the first outcome
                  </button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <DenseTable minWidth={1020}>
            <caption className="sr-only">
              Bench outcomes, newest first. {canWrite ? "Select a row to amend it." : "Read only."}
            </caption>
            <thead>
              <tr>
                <Th>Gene</Th>
                <Th>Screen</Th>
                <Th>Experiment</Th>
                <Th>Result</Th>
                <Th>Assay</Th>
                <Th align="right">Effect</Th>
                <Th align="right">Guides</Th>
                <Th align="right">Score then</Th>
                <Th>Logged</Th>
              </tr>
            </thead>
            <tbody>
              {shown.rows.map((row) => (
                <tr key={row.id} className={canWrite ? ROW_HIT : undefined}>
                  <td className="font-medium text-ink">
                    {canWrite ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setDrawer({ kind: "edit", row })}
                          className={cn("text-left font-medium text-ink hover:text-orange-600", ROW_LINK)}
                        >
                          {row.gene}
                          <span className="sr-only">
                            , {RESULT_COPY[row.result].label}, {row.result === "pending" ? "open to record the result" : "open to amend"}
                          </span>
                        </button>
                        {/* The ladder, not another number. One outcome says what
                            one experiment found; the ladder says which of the
                            six experiments have been run at all, which is the
                            question a reader actually has next. */}
                        {!demo && (
                          <Link
                            href={`${BASE}?gene=${encodeURIComponent(row.gene)}${filters.screen ? `&screen=${encodeURIComponent(filters.screen)}` : ""}`}
                            className={cn("ml-1.5 text-[10.5px] font-normal text-cyan-600 underline decoration-line-strong underline-offset-2 hover:decoration-cyan-500", ABOVE_ROW_LINK)}
                          >
                            ladder
                            <span className="sr-only"> for {row.gene}</span>
                          </Link>
                        )}
                      </>
                    ) : (
                      row.gene
                    )}
                  </td>
                  <td>
                    <Link
                      href={`/dashboard/screens/${row.screenId}${demo ? "?tab=validation" : ""}`}
                      title={row.screenName ?? row.screenId}
                      className={cn("block max-w-[200px] truncate text-body underline decoration-line-strong underline-offset-2 hover:decoration-orange-500", ABOVE_ROW_LINK)}
                    >
                      {row.screenName ?? row.screenId}
                    </Link>
                  </td>
                  {/* Which experiment this was. A result without its experiment
                      is not a measurement of anything: a genetic reproduction
                      and a pharmacologic test answer different questions, and
                      a row recorded before the Validation Network existed says
                      "Not recorded" rather than being assigned a guess. */}
                  <td>
                    {row.validationType === null ? (
                      <span
                        className="text-muted"
                        title="Recorded before the experiment was a required field. It is kept exactly as recorded and bears on none of the four questions."
                      >
                        Not recorded
                      </span>
                    ) : (
                      <span
                        className="block max-w-[170px] truncate text-ink"
                        title={experimentTitle(row.validationType)}
                      >
                        {VALIDATION_TYPE_LABEL[row.validationType]}
                      </span>
                    )}
                  </td>
                  <td>
                    <OutcomeBadge result={row.result} />
                    {/* The engine's verdict, shown only when it disagrees with
                        the label the laboratory gave it. The label is never
                        overwritten: a console that silently corrected a
                        scientist's own result would be asserting something
                        nobody measured. Agreement needs no annotation, and
                        "not scorable" is a gap in the record rather than a
                        disagreement, so neither is flagged. */}
                    {disagrees(row) && (
                      <span
                        className="mt-0.5 block text-[10.5px] leading-tight text-orange-700"
                        title={row.decisionBecause ?? undefined}
                      >
                        {ENDPOINT_DECISION_LABEL[row.endpointDecision!]} against the endpoint
                      </span>
                    )}
                  </td>
                  <td>
                    <span className="block max-w-[200px] truncate" title={row.assay ?? undefined}>
                      {row.assay ?? <span className="text-muted">Not recorded</span>}
                    </span>
                  </td>
                  <td className="num-col">{row.effectSize === null ? <span className="text-muted">Not recorded</span> : formatNumber(row.effectSize, { maximumSignificantDigits: 5 })}</td>
                  <td className="num-col">{row.nGuides === null ? <span className="text-muted">Not recorded</span> : formatNumber(row.nGuides)}</td>
                  <td
                    className="num-col"
                    title="Uncalibrated model output stored when the gene was called. Not a probability."
                  >
                    {row.predicted === null ? <span className="text-muted">Not recorded</span> : row.predicted.toFixed(3)}
                  </td>
                  <td className="text-muted" title={`${shortDate(row.loggedAt)}${row.loggedBy ? `, logged by ${row.loggedBy}` : ""}`}>
                    {shortDate(row.loggedAt)}
                    {row.loggedBy && <span className="ml-1.5 text-ink">{row.loggedBy}</span>}
                    {row.evidenceUrl && (
                      <a
                        href={row.evidenceUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className={cn("ml-2 inline-flex text-cyan-600", ABOVE_ROW_LINK)}
                      >
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        <span className="sr-only">Evidence link for {row.gene}, opens in a new tab</span>
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </DenseTable>
        )}
      </Panel>

      {screenScoped && scopeName && (
        <p className="text-[11px] text-muted">
          The tiles and the rate count outcomes in {scopeName} only.{" "}
          <Link href={outcomeHref(BASE, filters, { screen: null })} replace className="text-cyan-600 underline">
            Show every screen
          </Link>
        </p>
      )}

      {drawer && (
        <OutcomeDrawer
          key={drawer.kind === "edit" ? drawer.row.id : "new"}
          adapter={adapter}
          screens={screens}
          editing={drawer.kind === "edit" ? drawer.row : null}
          prefill={drawer.kind === "new" ? prefill : null}
          canDelete={canDelete || demo}
          onClose={closeDrawer}
          onDone={done}
        />
      )}
    </div>
  );
}

/** Result, screen and gene: all in the address, so a view can be sent to a colleague. */
function Filters({ filters, screens }: { filters: OutcomeFilters; screens: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const go = useCallback(
    (patch: Partial<Record<keyof OutcomeFilters, string | number | null>>) => {
      startTransition(() => router.replace(outcomeHref(pathname, filters, patch), { scroll: false }));
    },
    [filters, pathname, router],
  );

  // What the reader is typing, reconciled with the address during render (see
  // the same pattern in the Atlas filters): the box takes the address's value
  // only when the address moved to something this box did not write.
  const [text, setText] = useState(filters.q);
  const [written, setWritten] = useState(filters.q);
  const [seen, setSeen] = useState(filters.q);
  if (filters.q !== seen) {
    setSeen(filters.q);
    if (filters.q !== written) {
      setWritten(filters.q);
      setText(filters.q);
    }
  }
  useEffect(() => {
    if (text === written) return;
    const timer = window.setTimeout(() => {
      setWritten(text);
      go({ q: text.trim() === "" ? null : text.trim() });
    }, 260);
    return () => window.clearTimeout(timer);
  }, [text, written, go]);

  const FIELD =
    "h-7 rounded-md border bg-white px-2 text-[12px] text-ink outline-none focus:border-cyan-500";
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-line px-[var(--panel-gutter)] py-2" role="search" aria-label="Filter outcomes">
      <div className="relative min-w-[160px] max-w-[240px] flex-1">
        <label htmlFor="outcome-gene-filter" className="sr-only">Filter by gene symbol</label>
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input
          id="outcome-gene-filter"
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Gene symbol"
          autoComplete="off"
          spellCheck={false}
          className={cn(FIELD, "w-full border-line pl-7")}
        />
      </div>
      <select
        aria-label="Result"
        value={filters.result ?? ""}
        onChange={(event) => go({ result: event.target.value === "" ? null : (event.target.value as OutcomeResult) })}
        className={cn(FIELD, "w-[170px] pr-6", filters.result ? "border-cyan-500" : "border-line")}
      >
        <option value="">All results</option>
        {OUTCOME_RESULTS.map((result) => (
          <option key={result} value={result}>
            {RESULT_COPY[result].label}
          </option>
        ))}
      </select>
      <select
        aria-label="Screen"
        value={filters.screen ?? ""}
        onChange={(event) => go({ screen: event.target.value === "" ? null : event.target.value })}
        className={cn(FIELD, "w-[190px] max-w-full pr-6", filters.screen ? "border-cyan-500" : "border-line")}
      >
        <option value="">All screens</option>
        {screens.map((screen) => (
          <option key={screen.id} value={screen.id}>
            {screen.name}
          </option>
        ))}
      </select>
      {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" aria-label="Updating" />}
      {(filters.result || filters.screen || filters.q) && (
        <Link href={BASE} replace scroll={false} className="text-[11px] text-cyan-600 underline decoration-line-strong underline-offset-2">
          Clear filters
        </Link>
      )}
    </div>
  );
}
