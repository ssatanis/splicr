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
      <p className="text-[11px] leading-snug text-muted">
        {STATE_COPY[choice as CandidateStatus].help} Recorded with the statistics as they stand now, and kept
        when the screen is reanalysed.
      </p>
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
              {next && (
                <div>
                  <div className="text-[11px] uppercase tracking-[0.08em] text-muted">What would resolve it</div>
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
                </div>
              )}

              {canDecide ? (
                <div className="border-t border-line pt-3">
                  <DecisionForm screenId={screenId} gene={candidate.gene} current={candidate.status} />
                  {candidate.decision && (
                    <p className="mt-2 text-[11px] leading-snug text-muted">
                      Current decision recorded {new Date(candidate.decision.at).toLocaleDateString("en-US", { dateStyle: "medium" })}
                      {candidate.decision.count > 1 && `, after ${candidate.decision.count - 1} earlier one${candidate.decision.count === 2 ? "" : "s"}`}.
                      {candidate.decision.reason && ` "${candidate.decision.reason}"`}
                    </p>
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

export function CandidateBoard({ candidates, screenId, canDecide, decisionsKnown }: {
  candidates: Candidate[];
  screenId: string;
  canDecide: boolean;
  /** False when the decision log could not be read, which is not "no decisions". */
  decisionsKnown: boolean;
}) {
  const counts = tally(candidates);
  const shown: CandidateStatus[] = ["unreviewed", "shortlisted", "needs_validation", "hold", "excluded", "validated"];

  if (candidates.length === 0) {
    return (
      <p className="px-[var(--panel-gutter)] py-6 text-center text-[12.5px] leading-snug text-muted">
        No record in this run is at or below the threshold. That does not establish the experiment had no hits:
        a record with no recorded FDR is not counted here.
      </p>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-[var(--panel-gutter)] py-2 text-[11px]">
        {shown.filter((state) => counts[state] > 0).map((state) => (
          <span key={state} className="text-muted" title={STATE_COPY[state].help}>
            <span className="num text-ink">{counts[state]}</span> {STATE_COPY[state].label.toLowerCase()}
          </span>
        ))}
        {!decisionsKnown && (
          <span className="text-orange-700">
            The decision log could not be read, so every gene reads as unreviewed. That is not the same as nobody having decided.
          </span>
        )}
      </div>
      <ul>
        {candidates.map((candidate) => (
          <CandidateRow key={candidate.gene} candidate={candidate} screenId={screenId} canDecide={canDecide} />
        ))}
      </ul>
    </div>
  );
}
