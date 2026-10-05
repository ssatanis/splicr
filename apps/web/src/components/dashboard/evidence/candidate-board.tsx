"use client";

/**
 * The candidates, as a list of decisions waiting to be made.
 *
 * A row carries the six facts somebody scans: the gene, which way it went and
 * how far, its FDR, how many of its guides agree, whether anything flagged it,
 * and what this lab has already decided. Everything else is one click down,
 * arranged around the questions a researcher asks rather than around the tables
 * the values came out of.
 *
 * The decision form writes to an append-only log. Changing a decision records
 * another one; it does not overwrite the first. The console says so where the
 * history is shown, because a researcher choosing what to put on a plate is
 * entitled to know the record of that choice will survive the next reanalysis.
 */
import { AlertTriangle, ChevronRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useId, useState } from "react";

import { recordCandidateDecision } from "@/lib/data/candidate-actions";
import { RESULT_COPY } from "@/lib/outcomes/model";
import {
  CANDIDATE_STATES,
  STATE_COPY,
  nextExperiment,
  readCandidate,
  tally,
  type Candidate,
  type CandidateStatus,
} from "@/lib/report/candidates";
import { cn, formatNumber } from "@/lib/utils";

import { StatusChip, type ChipTone } from "../ui";
import { useGeneFocus } from "./gene-focus";

const TONE: Record<CandidateStatus, ChipTone> = {
  unreviewed: "idle",
  shortlisted: "run",
  needs_validation: "wait",
  hold: "idle",
  excluded: "idle",
  validated: "ok",
};

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] leading-none text-muted">{label}</div>
      <div className="num mt-1 text-[12.5px] leading-none text-ink">{children}</div>
    </div>
  );
}

function DecisionForm({ screenId, gene, current }: {
  screenId: string;
  gene: string;
  current: CandidateStatus;
}) {
  const id = useId();
  const [state, action, pending] = useActionState(
    async (_previous: { error: string } | null, formData: FormData) => {
      const result = await recordCandidateDecision(formData);
      return result.ok ? null : { error: result.error };
    },
    null,
  );
  const [choice, setChoice] = useState<string>(current === "unreviewed" ? "shortlisted" : current);

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="screenId" value={screenId} />
      <input type="hidden" name="gene" value={gene} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[150px]">
          <label htmlFor={`${id}-state`} className="mb-1 block text-[11px] text-muted">Decision</label>
          <select
            id={`${id}-state`}
            name="state"
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
            className="h-7 w-full rounded-md border border-line bg-white px-2 pr-6 text-[12px] text-ink outline-none focus:border-cyan-500"
          >
            {CANDIDATE_STATES.map((value) => (
              <option key={value} value={value}>{STATE_COPY[value].label}</option>
            ))}
          </select>
        </div>
        <div className="min-w-[200px] flex-1">
          <label htmlFor={`${id}-reason`} className="mb-1 block text-[11px] text-muted">
            Why, in your words <span className="text-muted">(optional)</span>
          </label>
          <input
            id={`${id}-reason`}
            name="reason"
            maxLength={2000}
            autoComplete="off"
            className="h-7 w-full rounded-md border border-line bg-white px-2 text-[12px] text-ink outline-none focus:border-cyan-500"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-ink px-3 text-[12px] font-medium text-white hover:bg-ink/90 disabled:bg-mist disabled:text-muted"
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          Record
        </button>
      </div>

      {state?.error && (
        <p role="alert" className="rounded-md bg-orange-50 px-2.5 py-1.5 text-[12px] leading-snug text-orange-700">
          {state.error}
        </p>
      )}
    </form>
  );
}

function CandidateRow({ candidate, screenId, canDecide }: {
  candidate: Candidate;
  screenId: string;
  canDecide: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const { gene: focused, focus } = useGeneFocus();
  const isFocused = focused === candidate.gene.toUpperCase();
  const readings = readCandidate(candidate);
  const next = nextExperiment(candidate);
  const agree = candidate.guidesAgreeing;

  return (
    <li className={cn("border-b border-line last:border-0", isFocused && "bg-cyan-50/50")}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-[var(--panel-gutter)] py-2.5">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => {
            const next = !open;
            setOpen(next);
            focus(next ? candidate.gene : null);
          }}
          className="inline-flex min-w-[110px] items-center gap-1 rounded-sm text-[13px] font-medium text-ink hover:text-orange-600"
        >
          <ChevronRight
            className={cn("h-3.5 w-3.5 shrink-0 text-muted transition-transform duration-[var(--dur-1)] motion-reduce:transition-none", open && "rotate-90")}
            aria-hidden="true"
          />
          {candidate.gene}
          <span className="sr-only">{open ? ", hide the evidence" : ", show the evidence"}</span>
        </button>

        <Stat label={candidate.direction === "depleted" ? "Depleted" : "Enriched"}>
          {candidate.lfc === null ? "not recorded" : `${candidate.lfc > 0 ? "+" : ""}${candidate.lfc.toFixed(2)}`}
        </Stat>
        <Stat label="FDR">
          {candidate.fdr === null ? "not recorded" : candidate.fdr < 0.001 ? candidate.fdr.toExponential(1) : candidate.fdr.toFixed(4)}
        </Stat>
        <Stat label="Guides agreeing">
          {agree === null ? "not recorded" : `${agree.agree} of ${agree.total}`}
        </Stat>
        <Stat label="Artifact flags">
          {candidate.flags.length === 0
            ? <span className="text-muted">None recorded</span>
            : <span className="inline-flex items-center gap-1 text-orange-700">
                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                {candidate.flags.length}
              </span>}
        </Stat>
        <Stat label="Seen before">
          {candidate.atlas === null
            ? <span className="text-muted">Not looked up</span>
            : candidate.atlas.tested === 0
              ? <span className="text-muted">Not measured</span>
              : `${formatNumber(candidate.atlas.hits)} of ${formatNumber(candidate.atlas.tested)}`}
        </Stat>

        <span className="ml-auto flex shrink-0 items-center gap-2">
          {candidate.status === "needs_validation" && !candidate.outcome && (
            <Link
              href={`/dashboard/validation?log=${encodeURIComponent(candidate.gene)}&logScreen=${screenId}`}
              className="rounded-sm text-[11.5px] text-cyan-600 underline decoration-line-strong underline-offset-2"
            >
              Add to validation
            </Link>
          )}
          {candidate.outcome && (
            <StatusChip tone="ok">{RESULT_COPY[candidate.outcome].short}</StatusChip>
          )}
          <StatusChip tone={TONE[candidate.status]}>{STATE_COPY[candidate.status].label}</StatusChip>
        </span>
      </div>

      {open && (
        <div id={panelId} className="border-t border-line bg-canvas/60 px-[var(--panel-gutter)] py-3">
          <div className="grid gap-x-8 gap-y-4 lg:grid-cols-2">
            <div className="space-y-3">
              {readings.map((reading) => (
                <div key={reading.question}>
                  <div className="text-[11px] uppercase tracking-[0.08em] text-muted">{reading.question}</div>
                  {reading.points.length > 0 ? (
                    <ul className="mt-1 space-y-1">
                      {reading.points.map((point) => (
                        <li key={point} className="text-[12px] leading-snug text-body">{point}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-[12px] leading-snug text-muted">{reading.absent}</p>
                  )}
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.08em] text-muted">What would resolve it</div>
                {next.kind === "none" ? (
                  <p className="mt-1 text-[12px] leading-snug text-muted">{next.because}</p>
                ) : (
                  <>
                    <p className="mt-1 text-[12.5px] font-medium leading-snug text-ink">Suggested: {next.objective}</p>
                    <p className="mt-0.5 text-[12px] leading-snug text-body">{next.reason}</p>
                    <dl className="mt-1.5 space-y-1 text-[11.5px] leading-snug">
                      <div>
                        <dt className="inline text-muted">Evidence: </dt>
                        <dd className="inline text-body">{next.evidence.join(" ")}</dd>
                      </div>
                      <div>
                        <dt className="inline text-muted">Assumes: </dt>
                        <dd className="inline text-body">{next.assumption}</dd>
                      </div>
                      <div>
                        <dt className="inline text-muted">Reduces uncertainty about: </dt>
                        <dd className="inline text-body">{next.reduces}</dd>
                      </div>
                    </dl>
                    {next.alternative && (
                      <p className="mt-1.5 text-[11.5px] leading-snug text-muted">
                        Alternative: {next.alternative.objective}. {next.alternative.reason}
                      </p>
                    )}
                    <p className="mt-1.5 text-[11px] leading-snug text-muted">
                      A proposal from the recorded evidence, not a prediction that it will work.
                    </p>
                  </>
                )}
              </div>

              {canDecide ? (
                <div className="border-t border-line pt-3">
                  <DecisionForm screenId={screenId} gene={candidate.gene} current={candidate.status} />
                  {candidate.decision && (
                    <p className="mt-2 text-[11px] leading-snug text-muted">
                      Recorded {new Date(candidate.decision.at).toLocaleDateString("en-US", { dateStyle: "medium" })}
                      {candidate.decision.reason && `. "${candidate.decision.reason}"`}
                    </p>
                  )}
                  {candidate.history.length > 0 && (
                    <details className="group mt-1.5">
                      <summary className="cursor-pointer list-none text-[11px] text-muted [&::-webkit-details-marker]:hidden">
                        <span className="underline decoration-line-strong underline-offset-2">
                          Decision history ({candidate.history.length})
                        </span>
                      </summary>
                      <ol className="mt-1.5 space-y-1.5 border-l border-line pl-2.5">
                        {candidate.history.map((entry) => (
                          <li key={entry.id} className="text-[11px] leading-snug">
                            <span className="text-ink">{STATE_COPY[entry.state as CandidateStatus]?.label ?? entry.state}</span>
                            <span className="text-muted">
                              {" "}on {new Date(entry.at).toLocaleDateString("en-US", { dateStyle: "medium" })}
                              {entry.evidence?.fdr != null && `, at FDR ${Number(entry.evidence.fdr).toFixed(4)}`}
                              {entry.evidence?.engine_version && ` from engine ${entry.evidence.engine_version}`}
                            </span>
                            {entry.reason && <span className="block text-muted">&ldquo;{entry.reason}&rdquo;</span>}
                          </li>
                        ))}
                      </ol>
                      <p className="mt-1.5 text-[11px] leading-snug text-muted">
                        Nothing here is overwritten. Each entry keeps the statistics as they stood when it was
                        taken, so a reanalysis cannot change what was known at the time.
                      </p>
                    </details>
                  )}
                </div>
              ) : (
                <p className="border-t border-line pt-3 text-[12px] leading-snug text-muted">
                  Your role in this workspace is read-only, so you cannot record a decision.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

export function CandidateBoard({ candidates, screenId, canDecide, decisionsKnown, beyondCap = 0 }: {
  candidates: Candidate[];
  screenId: string;
  canDecide: boolean;
  /** False when the decision log could not be read, which is not "no decisions". */
  decisionsKnown: boolean;
  /** Candidates past the board's cap. Named rather than hidden. */
  beyondCap?: number;
}) {
  const counts = tally(candidates);
  const shown: CandidateStatus[] = ["unreviewed", "shortlisted", "needs_validation", "hold", "excluded", "validated"];
  const [view, setView] = useState<"all" | CandidateStatus | "flagged">("all");
  const [sort, setSort] = useState<"fdr" | "effect" | "gene" | "decision">("fdr");

  if (candidates.length === 0) {
    return (
      <p className="px-[var(--panel-gutter)] py-6 text-center text-[12.5px] leading-snug text-muted">
        No record in this run is at or below the threshold. That does not establish the experiment had no hits:
        a record with no recorded FDR is not counted here.
      </p>
    );
  }

  // Four views, not fifteen: the ones that correspond to a decision somebody is
  // in the middle of making.
  const views: { id: typeof view; label: string; count: number }[] = [
    { id: "all", label: "All", count: candidates.length },
    { id: "unreviewed", label: "Unreviewed", count: counts.unreviewed },
    { id: "shortlisted", label: "Shortlisted", count: counts.shortlisted },
    { id: "needs_validation", label: "Needs validation", count: counts.needs_validation },
    { id: "flagged", label: "With artifact flags", count: candidates.filter((c) => c.flags.length > 0).length },
  ];

  const visible = candidates
    .filter((candidate) =>
      view === "all" ? true
        : view === "flagged" ? candidate.flags.length > 0
        : candidate.status === view)
    .slice()
    .sort((a, b) => {
      // Null is always last: a missing value is not a small one.
      const bySize = (x: number | null, y: number | null, descending: boolean) => {
        if (x === null && y === null) return 0;
        if (x === null) return 1;
        if (y === null) return -1;
        return descending ? y - x : x - y;
      };
      switch (sort) {
        case "effect": return bySize(a.lfc === null ? null : Math.abs(a.lfc), b.lfc === null ? null : Math.abs(b.lfc), true);
        case "gene": return a.gene.localeCompare(b.gene);
        case "decision": return shown.indexOf(a.status) - shown.indexOf(b.status) || bySize(a.fdr, b.fdr, false);
        default: return bySize(a.fdr, b.fdr, false);
      }
    });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-[var(--panel-gutter)] py-2 text-[11px]">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter candidates">
          {views.filter((entry) => entry.id === "all" || entry.count > 0).map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={view === entry.id}
              onClick={() => setView(entry.id)}
              className={cn(
                "rounded border px-1.5 py-0.5 transition-colors duration-[var(--dur-1)] motion-reduce:transition-none",
                view === entry.id ? "border-ink bg-ink text-white" : "border-line text-body hover:bg-canvas",
              )}
            >
              {entry.label} <span className="num opacity-70">{entry.count}</span>
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-1.5 text-muted">
          Sort
          <select
            aria-label="Sort candidates"
            value={sort}
            onChange={(event) => setSort(event.target.value as typeof sort)}
            className="h-6 rounded border border-line bg-white px-1.5 pr-5 text-[11px] text-ink outline-none focus:border-cyan-500"
          >
            <option value="fdr">Recorded FDR</option>
            <option value="effect">Effect size</option>
            <option value="gene">Gene</option>
            <option value="decision">Decision</option>
          </select>
        </label>
        {!decisionsKnown && (
          <span className="basis-full text-orange-700">
            The decision log could not be read, so every gene reads as unreviewed. That is not the same as
            nobody having decided.
          </span>
        )}
      </div>
      {visible.length === 0 ? (
        <p className="px-[var(--panel-gutter)] py-6 text-center text-[12.5px] text-muted">
          No candidate is in that state yet.
        </p>
      ) : (
        <ul>
          {visible.map((candidate) => (
            <CandidateRow key={candidate.gene} candidate={candidate} screenId={screenId} canDecide={canDecide} />
          ))}
        </ul>
      )}
      {beyondCap > 0 && (
        <p className="border-t border-line px-[var(--panel-gutter)] py-2 text-[11px] leading-snug text-muted">
          {formatNumber(beyondCap)} more candidates clear the threshold than this board shows. A list this
          long is a threshold to reconsider rather than a list to page through; the full set is in the
          recorded results below.
        </p>
      )}
    </div>
  );
}
