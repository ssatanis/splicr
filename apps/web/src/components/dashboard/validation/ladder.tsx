/**
 * The validation ladder for one candidate.
 *
 * Six rungs instead of one number, because the rungs are what a scientist
 * already thinks in, and because one number cannot hold what this gene's
 * evidence actually says.
 *
 * PRKDC in doi:10.1158/0008-5472.CAN-24-0775 is the standing example. Individual
 * gRNAs reduced organoid growth. The LTURM34 and AZD7648 inhibitors showed no
 * potent activity at the tested concentrations. Both of those are true, and the
 * only way to show both is to show them on separate rungs with separate
 * endpoints.
 *
 * THE FOUR STATES, AND THE TWO THAT GET CONFUSED
 *
 *   met          an outcome met the prespecified endpoint
 *   not met      an outcome ran and did not meet it
 *   mixed        outcomes of this kind disagree with each other
 *   not tested   nobody ran this. Not a negative.
 *
 * `mixed` exists because of PTK2 in the same paper: of two inhibitors, one had
 * no effect on either organoid line and the other produced a partial response
 * in one. A ladder that could only say "met" or "not met" would have to pick
 * one of those and be wrong either way.
 *
 * `not tested` is never styled as a failure. An unrun experiment and a failed
 * one are different claims about a gene, and confusing them is the mistake this
 * product exists to prevent.
 */
import { CircleDashed, CircleSlash, MinusCircle, CheckCircle2 } from "lucide-react";

import { FootNote, Panel } from "@/components/dashboard/ui";
import type { LadderRung, LadderView } from "@/lib/data/validation-network";
import { cn } from "@/lib/utils";
import { RUNG_STATE_GLOSS, RUNG_STATE_LABEL, type RungState } from "@/lib/validation/model";

/**
 * How each state looks.
 *
 * `not_tested` is grey and dashed, deliberately the quietest of the four: it is
 * an absence, and an absence drawn in red reads as a result.
 */
const STATE_STYLE: Record<
  RungState,
  { icon: typeof CheckCircle2; className: string; rail: string }
> = {
  met: { icon: CheckCircle2, className: "text-cyan-700", rail: "bg-cyan-500" },
  not_met: { icon: CircleSlash, className: "text-red-700", rail: "bg-red-400" },
  mixed: { icon: MinusCircle, className: "text-orange-700", rail: "bg-orange-400" },
  not_tested: { icon: CircleDashed, className: "text-muted", rail: "bg-line-strong" },
};

function Rung({ rung, last }: { rung: LadderRung; last: boolean }) {
  const style = STATE_STYLE[rung.state];
  const Icon = style.icon;
  const counts = [
    rung.nMet > 0 ? `${rung.nMet} met` : null,
    rung.nNotMet > 0 ? `${rung.nNotMet} did not` : null,
    rung.nInconclusive > 0 ? `${rung.nInconclusive} inconclusive` : null,
    rung.nPending > 0 ? `${rung.nPending} pending` : null,
  ].filter(Boolean);

  return (
    <li className="flex gap-2.5">
      {/* The rail is decorative; the icon and the state label carry the
          meaning, so a reader who cannot see colour loses nothing. */}
      <div className="flex flex-col items-center" aria-hidden="true">
        <Icon className={cn("h-4 w-4 shrink-0", style.className)} />
        {!last && <span className={cn("mt-0.5 w-px flex-1", style.rail)} />}
      </div>
      <div className={cn("min-w-0 flex-1", last ? "pb-0" : "pb-3")}>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[12.5px] font-medium text-ink">{rung.label}</span>
          <span
            className={cn("text-[11px] font-medium", style.className)}
            title={rung.nUnscored ? "Includes reported bench evidence that the endpoint could not score." : RUNG_STATE_GLOSS[rung.state]}
          >
            {rung.nUnscored ? "Reported " : ""}{RUNG_STATE_LABEL[rung.state]}
          </span>
          {counts.length > 0 && (
            <span className="text-[11px] text-muted">{counts.join(", ")}</span>
          )}
        </div>
        <p className="text-[11.5px] leading-snug text-muted">{rung.because}</p>
        {/* A calibrated probability for this rung's question, when one exists.
            Until then the rung says the probability is unavailable rather than
            leaving a space a reader would fill in with an assumption. */}
        {rung.question !== null && (
          <p className="mt-0.5 text-[11px] leading-snug text-muted">
            {rung.estimateAvailable
              ? "A calibrated probability is available for this question on the Validation Network page."
              : (rung.estimateBecause ?? "No calibrated probability is available for this question.")}
          </p>
        )}
      </div>
    </li>
  );
}

export function ValidationLadder({
  view,
  span = 6,
}: {
  view: LadderView;
  span?: 4 | 6 | 8 | 12;
}) {
  return (
    <Panel
      span={span}
      title={`Validation ladder: ${view.gene}`}
      count={
        view.nOutcomes === 1 ? "1 outcome recorded" : `${view.nOutcomes} outcomes recorded`
      }
      footer={
        <FootNote>
          {view.next
            ? `Next: ${view.next.label}. ${view.next.why}`
            : "Every rung has an outcome recorded."}{" "}
          A rung marked not tested is an experiment nobody has run. It is not a
          negative result about this gene.
        </FootNote>
      }
    >
      <ol className="flex flex-col">
        {view.rungs.map((rung, index) => (
          <Rung key={rung.key} rung={rung} last={index === view.rungs.length - 1} />
        ))}
      </ol>
    </Panel>
  );
}
