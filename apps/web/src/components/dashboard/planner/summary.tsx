"use client";

/**
 * The plan, as the six numbers somebody actually has to find before ordering
 * anything, and whatever needs attention.
 *
 * This panel is on screen at every step and updates as the design changes, so a
 * reader can see what moving coverage from 300 to 500 costs them without
 * leaving the field they are typing in. Everything deeper - how evenly the
 * library will be represented, the week-by-week timeline, the PCR count, the
 * noise floor, the cost lines, the equations - is in the Review step, because
 * none of it changes the decision being made here.
 */
import { AlertTriangle, Check } from "lucide-react";

import { formatInt, formatMicrograms, formatShort, formatUsd } from "@/lib/planner/format";
import type { Check as PlanCheck, Plan, PlanInputs } from "@/lib/planner/model";
import { cn } from "@/lib/utils";

function Figure({ label, value, note, tone = "ink" }: {
  label: string;
  value: string;
  note: string;
  tone?: "ink" | "orange";
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 border-l border-t border-line px-[var(--panel-gutter)] py-2.5">
      <span className={cn("num text-[19px] font-medium leading-none tracking-[-0.02em]",
        tone === "orange" ? "text-orange-500" : "text-ink")}>
        {value}
      </span>
      <span className="truncate text-[11px] leading-none text-muted">{label}</span>
      <span className="num truncate text-[11px] leading-none text-muted">{note}</span>
    </div>
  );
}

/** The six figures, in the order the question is usually asked. */
export function PlanFigures({ plan, inputs }: { plan: Plan; inputs: PlanInputs }) {
  return (
    <div className="-ml-px -mt-px grid grid-cols-2 xl:grid-cols-3">
      <Figure
        label="Cells to transduce"
        value={formatShort(plan.transduction.cellsToTransduce)}
        note={`${(plan.transduction.pInfected * 100).toFixed(0)}% infected`}
      />
      <Figure
        label="Cells per sample"
        value={formatShort(plan.samples.cellsPerSample)}
        note={`${formatInt(inputs.coverage)} per guide`}
      />
      <Figure
        label="Samples"
        value={formatInt(plan.samples.total)}
        note={`${plan.samples.flasks} flasks + day 0`}
      />
      <Figure
        label="Reads"
        value={formatShort(plan.sequencing.totalReads)}
        note={plan.sequencing.runsNeeded === 1
          ? `${(plan.sequencing.runFraction * 100).toFixed(0)}% of a run`
          : `${plan.sequencing.runsNeeded} runs`}
        tone={plan.sequencing.runFraction > 1 ? "orange" : "ink"}
      />
      <Figure
        label="Time"
        value={`${plan.timeline.totalWeeks} wk`}
        note={`${plan.timeline.totalDays} days`}
      />
      <Figure
        label="Consumables"
        value={formatUsd(plan.costs.total)}
        note={`${formatMicrograms(plan.sequencing.gdnaTotalUg)} gDNA`}
      />
    </div>
  );
}

/**
 * Warnings, then notes. Checks that passed are folded away: eight green rows
 * push the one amber row off the screen, and the amber row is the whole point.
 */
export function PlanChecks({ checks }: { checks: readonly PlanCheck[] }) {
  const warn = checks.filter((check) => check.level === "warn");
  const info = checks.filter((check) => check.level === "info");
  const ok = checks.filter((check) => check.level === "ok");

  return (
    <div className="px-[var(--panel-gutter)] py-2">
      {warn.length === 0 && info.length === 0 ? (
        <p className="flex items-center gap-2 py-1 text-[12px] text-body">
          <Check className="h-3.5 w-3.5 shrink-0 text-cyan-600" aria-hidden="true" />
          Nothing in this design needs attention.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {[...warn, ...info].map((check) => (
            <li key={check.id} className="flex gap-2 py-2">
              {check.level === "warn"
                ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-600" aria-hidden="true" />
                : <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-line-strong" aria-hidden="true" />}
              <div className="min-w-0">
                <div className={cn("text-[12px] font-medium leading-snug",
                  check.level === "warn" ? "text-orange-700" : "text-ink")}>
                  <span className="sr-only">{check.level === "warn" ? "Attention: " : "Note: "}</span>
                  {check.title}
                </div>
                <p className="mt-0.5 text-[11.5px] leading-snug text-body">{check.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {ok.length > 0 && (
        <details className="group mt-1 border-t border-line pt-1.5">
          <summary className="cursor-pointer list-none text-[11px] text-muted [&::-webkit-details-marker]:hidden">
            <span className="underline decoration-line-strong underline-offset-2">
              {ok.length} check{ok.length === 1 ? "" : "s"} passed
            </span>
          </summary>
          <ul className="mt-1 space-y-1.5 pb-1">
            {ok.map((check) => (
              <li key={check.id} className="text-[11.5px] leading-snug text-muted">
                <span className="text-ink">{check.title}.</span> {check.detail}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
