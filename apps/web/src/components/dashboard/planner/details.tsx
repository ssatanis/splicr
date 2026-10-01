"use client";

/**
 * Everything behind the six figures, folded away until it is asked for.
 *
 * Presentation only: every number printed here is a field of the `Plan` that
 * `buildPlan` returned, so the page, the CSV and the JSON cannot disagree, and
 * each figure sits beside the working that produced it. A number a reader
 * cannot trace to an input is a number they will not put in a grant.
 *
 * None of this was removed when the planner became a guided flow. It stopped
 * being the first thing on the screen, which is a different thing: a researcher
 * deciding whether they can afford a genome-wide screen does not need the
 * lognormal representation integral in front of them, and the one who is
 * writing the methods section does.
 */
import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";

import {
  formatCount,
  formatFraction,
  formatInt,
  formatLog2,
  formatMicrograms,
  formatUsd,
} from "@/lib/planner/format";
import { PUBLISHED_REFERENCE, type Plan, type PlanInputs } from "@/lib/planner/model";
import { cn } from "@/lib/utils";

import { DenseTable, Th } from "../ui";

/** One foldable section of the review. Closed until a reader opens it. */
export function Detail({ title, summary, children, defaultOpen = false }: {
  title: string;
  summary: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="group border-b border-line last:border-0" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-baseline justify-between gap-3 py-2.5 text-[12.5px] font-medium text-ink [&::-webkit-details-marker]:hidden">
        <span className="flex items-baseline gap-1.5">
          <span aria-hidden="true" className="inline-block w-2.5 text-muted transition-transform duration-[var(--dur-1)] group-open:rotate-90 motion-reduce:transition-none">
            {"›"}
          </span>
          {title}
        </span>
        <span className="num shrink-0 text-[11.5px] font-normal text-muted">{summary}</span>
      </summary>
      <div className="pb-3 pl-4">{children}</div>
    </details>
  );
}

function Fact({ term, value, note }: { term: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-1.5 last:border-0">
      <dt className="min-w-0">
        <span className="block text-[12px] leading-tight text-ink">{term}</span>
        {note && <span className="mt-0.5 block text-[11px] leading-snug text-muted">{note}</span>}
      </dt>
      <dd className="num shrink-0 text-[12px] leading-tight text-ink">{value}</dd>
    </div>
  );
}

export function RepresentationDetail({ plan, inputs }: { plan: Plan; inputs: PlanInputs }) {
  const r = plan.representation;
  return (
    <>
      <DenseTable minWidth={460} compact>
        <caption className="sr-only">
          How evenly the library is expected to be represented at transduction and at sequencing
        </caption>
        <thead>
          <tr>
            <Th>Stage</Th>
            <Th align="right">Mean</Th>
            <Th align="right">10th percentile</Th>
            <Th align="right">Under the floor</Th>
            <Th align="right">Mean for 99% over it</Th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Cells, at transduction</td>
            <td className="num-col">{formatInt(inputs.coverage)}</td>
            <td className="num-col">{formatInt(r.p10Cells)}</td>
            <td className="num-col">
              {formatFraction(r.cellsBelowFloor)} <span className="text-muted">&lt; {inputs.cellFloor}</span>
            </td>
            <td className="num-col">{r.coverageFor99 === null ? "Not reachable" : formatInt(r.coverageFor99)}</td>
          </tr>
          <tr>
            <td>Reads, at sequencing</td>
            <td className="num-col">{formatInt(inputs.readsPerGuide)}</td>
            <td className="num-col">{formatInt(r.p10Reads)}</td>
            <td className="num-col">
              {formatFraction(r.readsBelowFloor)} <span className="text-muted">&lt; {inputs.readFloor}</span>
            </td>
            <td className="num-col">{r.depthFor99 === null ? "Not reachable" : formatInt(r.depthFor99)}</td>
          </tr>
        </tbody>
      </DenseTable>
      <p className="mt-2 text-[11px] leading-snug text-muted">
        Guide abundance is lognormal with the skew entered; cells and reads per guide are Poisson.
      </p>
    </>
  );
}

const PHASE_TONE = ["bg-teal-800", "bg-cyan-600", "bg-cyan-500", "bg-orange-500", "bg-teal-700", "bg-cyan-700", "bg-orange-400", "bg-teal-600"];

export function TimelineDetail({ plan }: { plan: Plan }) {
  const { phases, totalDays } = plan.timeline;
  const shown = phases.filter((phase) => phase.days > 0);
  return (
    <>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-mist-soft" aria-hidden="true">
        {shown.map((phase, index) => (
          <div
            key={phase.id}
            title={`${phase.label}: ${phase.days} days`}
            className={cn("h-full border-r border-white last:border-r-0", PHASE_TONE[index % PHASE_TONE.length])}
            style={{ width: `${(phase.days / Math.max(1, totalDays)) * 100}%` }}
          />
        ))}
      </div>
      <table className="mt-2 w-full text-[12px]">
        <caption className="sr-only">Phases of the screen and their duration in days</caption>
        <thead className="sr-only">
          <tr><th>Phase</th><th>Days</th></tr>
        </thead>
        <tbody>
          {shown.map((phase, index) => (
            <tr key={phase.id} className="border-b border-line last:border-0">
              <td className="py-1">
                <span className={cn("mr-2 inline-block h-2 w-2 rounded-sm align-middle", PHASE_TONE[index % PHASE_TONE.length])} aria-hidden="true" />
                {phase.label}
                {phase.computed && <span className="ml-1.5 text-[11px] text-muted">from your doubling time</span>}
              </td>
              <td className="num whitespace-nowrap py-1 text-right text-ink">{phase.days} days</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] leading-snug text-muted">
        A service screen is published at {PUBLISHED_REFERENCE.weeksLow} to {PUBLISHED_REFERENCE.weeksHigh} weeks.
      </p>
    </>
  );
}

export function SequencingDetail({ plan, inputs }: { plan: Plan; inputs: PlanInputs }) {
  const s = plan.sequencing;
  const n = plan.noise;
  return (
    <div className="grid gap-x-6 md:grid-cols-2">
      <dl>
        <Fact term="Reads per sample" value={formatCount(s.readsPerSample)} note={`${formatInt(plan.library.guides)} guides x ${formatInt(inputs.readsPerGuide)} reads`} />
        <Fact term="Reads, all samples" value={formatCount(s.totalReads)} note={`${plan.samples.total} samples`} />
        <Fact
          term="Sequencing runs"
          value={s.runsNeeded === 1 ? `${formatFraction(s.runFraction)} of one` : `${s.runsNeeded} runs`}
          note={`${formatInt(inputs.runReadsM)} million reads per run`}
        />
        <Fact term="gDNA, all samples" value={formatMicrograms(s.gdnaTotalUg)} note={`${formatMicrograms(s.gdnaPerSampleUg)} per sample`} />
        <Fact term="PCR reactions" value={formatInt(s.pcrTotal)} note={`${s.pcrPerSample} per sample at ${inputs.gdnaUgPerPcr} µg each`} />
      </dl>
      <dl>
        <Fact
          term="One guide, log2 fold change"
          value={`±${formatLog2(n.guideSeLog2)}`}
          note={`From ${formatInt(inputs.coverage)} cells and ${formatInt(inputs.readsPerGuide)} reads over ${inputs.replicates} replicate${inputs.replicates === 1 ? "" : "s"}`}
        />
        <Fact
          term="One gene, log2 fold change"
          value={`±${formatLog2(n.geneSeLog2)}`}
          note={`Averaging ${plan.library.guidesPerGene.toFixed(1)} independent guides`}
        />
        <Fact
          term="95% interval on a gene"
          value={`±${formatLog2(n.geneHalfWidth95)}`}
          note="From sampling alone. This is a lower bound, not statistical power"
        />
      </dl>
    </div>
  );
}

export function CostDetail({ plan }: { plan: Plan }) {
  return (
    <>
      <DenseTable minWidth={380} compact>
        <caption className="sr-only">Estimated cost by line, from the driver and the unit cost set</caption>
        <thead>
          <tr>
            <Th>Line</Th>
            <Th>Driver</Th>
            <Th align="right">Estimate</Th>
          </tr>
        </thead>
        <tbody>
          {plan.costs.lines.map((line) => (
            <tr key={line.id}>
              <td>{line.label}</td>
              <td className="text-muted">{line.driver}</td>
              <td className="num-col">{formatUsd(line.amount)}</td>
            </tr>
          ))}
          <tr>
            <td className="font-medium text-ink">Total</td>
            <td />
            <td className="num-col font-medium text-ink">{formatUsd(plan.costs.total)}</td>
          </tr>
        </tbody>
      </DenseTable>
      <p className="mt-2 text-[11px] leading-snug text-muted">
        Placeholder unit costs, editable under Advanced. Excludes labour, equipment time and
        analysis, which a service price includes. For scale, {PUBLISHED_REFERENCE.label} lists one
        pooled genome-wide screen at <span className="num">${formatInt(PUBLISHED_REFERENCE.usd)}</span>.{" "}
        <a
          href={PUBLISHED_REFERENCE.href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-cyan-600 underline decoration-line-strong underline-offset-2"
        >
          Source <ExternalLink className="h-3 w-3" aria-hidden="true" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </p>
    </>
  );
}

export function MethodDetail() {
  const rows: [string, string][] = [
    ["Fraction infected", "1 − exp(−MOI). Cells carry a Poisson number of integrations."],
    ["Cells to transduce", "guides × coverage ÷ fraction infected, so coverage is held after selection."],
    ["Two or more guides", "1 − MOI × exp(−MOI) ÷ (1 − exp(−MOI)), among infected cells."],
    ["Representation", "Guide abundance is lognormal with mean 1 and a 90th/10th percentile ratio equal to the skew entered. Cells or reads per guide are Poisson. The fraction under a floor is that mixture, integrated numerically."],
    ["Noise floor", "Picking cells adds 1/coverage to the variance of each log abundance and reading reads adds 1/depth. A comparison has two samples; replicates and guides average it down."],
    ["gDNA", "cells × pg per cell. A diploid human cell holds about 6.6 pg."],
  ];
  return (
    <>
      <dl>
        {rows.map(([term, text]) => (
          <div key={term} className="grid gap-x-4 border-b border-line py-1.5 last:border-0 sm:grid-cols-[9rem_1fr]">
            <dt className="text-[12px] font-medium text-ink">{term}</dt>
            <dd className="text-[12px] leading-snug text-body">{text}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[11px] leading-snug text-muted">
        Working ranges follow Joung et al., Nature Protocols 2017:{" "}
        <a
          href="https://doi.org/10.1038/nprot.2017.016"
          target="_blank"
          rel="noreferrer"
          title="Joung et al., Nature Protocols, 2017"
          className="text-cyan-600 underline decoration-line-strong underline-offset-2"
        >
          10.1038/nprot.2017.016<span className="sr-only"> (opens in a new tab)</span>
        </a>
        . Over 500 cells per guide, MOI under 0.3, over 500 reads per guide, skew under 10. Their
        worked example divides by the MOI; the Poisson form used here divides by the fraction
        infected, which is why its cell count is higher. There is no statistical power figure
        because none can be honest before the screen: a power estimate needs the dispersion of
        guide counts in your cells, the effect sizes you expect, your multiple-testing correction
        and guide efficacy, and none of those is known yet.
      </p>
    </>
  );
}
