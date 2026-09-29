/**
 * The planner's answer, as panels.
 *
 * Presentation only: everything printed here is a field of the `Plan` that
 * `buildPlan` returned, so the page, the CSV and the JSON cannot disagree, and
 * each figure sits beside the working that produced it. A number a reader
 * cannot trace to an input is a number they will not put in a grant.
 */
import { AlertTriangle, Check, ExternalLink, Info } from "lucide-react";
import type { ReactNode } from "react";

import {
  PUBLISHED_REFERENCE,
  type Check as PlanCheck,
  type Plan,
  type PlanInputs,
} from "@/lib/planner/model";
import {
  formatCount,
  formatShort,
  formatFraction,
  formatInt,
  formatLog2,
  formatMicrograms,
  formatUsd,
} from "@/lib/planner/format";
import { cn } from "@/lib/utils";

import { DenseTable, FootNote, KpiStrip, KpiTile, Panel, Th } from "../ui";

export function PlanKpis({ plan, inputs }: { plan: Plan; inputs: PlanInputs }) {
  const t = plan.transduction;
  return (
    <KpiStrip
      title="What this design needs"
      count={`${plan.library.name}, ${formatInt(plan.library.guides)} guides`}
      className="shrink-0"
      footer={
        <FootNote>
          {formatInt(plan.library.guides)} guides x {formatInt(inputs.coverage)} cells per guide, MOI {inputs.moi}
        </FootNote>
      }
    >
      <KpiTile
        label="Guides"
        value={formatInt(plan.library.guides)}
        denominator="in the library"
        definition={`${formatInt(plan.library.targeting)} targeting over ${formatInt(plan.library.genes)} genes, plus ${formatInt(plan.library.controls)} controls.`}
      />
      <KpiTile
        label="Cells to transduce"
        value={formatShort(t.cellsToTransduce)}
        denominator={`${formatFraction(t.pInfected)} infected`}
        definition="Guides x coverage, divided by the fraction infected at this MOI."
      />
      <KpiTile
        label="Cells held per sample"
        value={formatShort(plan.samples.cellsPerSample)}
        denominator={`at ${formatInt(inputs.coverage)}x`}
        definition="Guides x cells per guide, kept at every passage."
      />
      <KpiTile
        label="Samples sequenced"
        value={formatInt(plan.samples.total)}
        denominator={`${plan.samples.flasks} flasks + day 0`}
        definition={`${plan.samples.arms} arm${plan.samples.arms === 1 ? "" : "s"} x ${inputs.replicates} replicates, plus a reference.`}
      />
      <KpiTile
        label="Reads in total"
        value={formatShort(plan.sequencing.totalReads)}
        denominator={`${formatFraction(plan.sequencing.runFraction)} of a run`}
        definition={`${formatInt(inputs.readsPerGuide)} per guide per sample, ${formatInt(inputs.runReadsM)} million per run.`}
        tone={plan.sequencing.runFraction > 1 ? "orange" : "ink"}
      />
      <KpiTile
        label="gDNA per sample"
        value={formatMicrograms(plan.sequencing.gdnaPerSampleUg)}
        denominator={`${plan.sequencing.pcrPerSample} PCRs`}
        definition={`${inputs.gdnaPgPerCell} pg per cell, ${inputs.gdnaUgPerPcr} µg per reaction.`}
      />
      <KpiTile
        label="Time"
        value={`${plan.timeline.totalWeeks} weeks`}
        denominator={`${plan.timeline.totalDays} days`}
        definition="Sum of the phases below, rounded up."
        tone="cyan"
      />
      <KpiTile
        label="Consumables"
        value={formatUsd(plan.costs.total)}
        denominator="estimate"
        definition="Unit costs you can edit. Not a quote and not a service price."
      />
    </KpiStrip>
  );
}

const CHECK_ICON: Record<PlanCheck["level"], ReactNode> = {
  ok: <Check className="h-3.5 w-3.5 text-cyan-600" aria-hidden="true" />,
  warn: <AlertTriangle className="h-3.5 w-3.5 text-orange-600" aria-hidden="true" />,
  info: <Info className="h-3.5 w-3.5 text-muted" aria-hidden="true" />,
};
const CHECK_WORD: Record<PlanCheck["level"], string> = { ok: "Fine", warn: "Attention", info: "Note" };

export function ChecksPanel({ plan }: { plan: Plan }) {
  const warnings = plan.checks.filter((check) => check.level === "warn").length;
  // Warnings first: the reader has one question, "what should I change".
  const order = { warn: 0, info: 1, ok: 2 } as const;
  const sorted = [...plan.checks].sort((a, b) => order[a.level] - order[b.level]);
  return (
    <Panel
      title="Checks"
      count={warnings === 0 ? "nothing needs attention" : `${warnings} need${warnings === 1 ? "s" : ""} attention`}
      bodyClassName="py-1"
      caveat="Rules of thumb from the literature and the arithmetic below, not a guarantee that a screen will work."
    >
      <ul className="divide-y divide-line">
        {sorted.map((check) => (
          <li key={check.id} className="flex gap-2.5 py-2">
            <span className="mt-0.5 shrink-0">{CHECK_ICON[check.level]}</span>
            <div className="min-w-0">
              <div className={cn("text-[12.5px] font-medium", check.level === "warn" ? "text-orange-700" : "text-ink")}>
                <span className="sr-only">{CHECK_WORD[check.level]}: </span>
                {check.title}
              </div>
              <p className="mt-0.5 text-[12px] leading-snug text-body">{check.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function RepresentationPanel({ plan, inputs }: { plan: Plan; inputs: PlanInputs }) {
  const r = plan.representation;
  return (
    <Panel
      title="Library representation"
      count={`skew ${inputs.skew}, sigma ${r.sigma.toFixed(2)}`}
      body="flush"
      footer={
        <FootNote>
          Guide abundance is lognormal with the skew you entered; cells and reads per guide are Poisson
        </FootNote>
      }
    >
      <DenseTable minWidth={520} compact>
        <caption className="sr-only">
          How evenly the library is expected to be represented at transduction and at sequencing
        </caption>
        <thead>
          <tr>
            <Th>Stage</Th>
            <Th align="right">Mean per guide</Th>
            <Th align="right">10th percentile guide</Th>
            <Th align="right">Under the floor</Th>
            <Th align="right">Mean for 99% over the floor</Th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Cells, at transduction</td>
            <td className="num-col">{formatInt(inputs.coverage)}</td>
            <td className="num-col">{formatInt(r.p10Cells)}</td>
            <td className="num-col" title={`Guides holding fewer than ${inputs.cellFloor} cells`}>
              {formatFraction(r.cellsBelowFloor)} <span className="text-muted">&lt; {inputs.cellFloor}</span>
            </td>
            <td className="num-col">{r.coverageFor99 === null ? "Not reachable" : formatInt(r.coverageFor99)}</td>
          </tr>
          <tr>
            <td>Reads, at sequencing</td>
            <td className="num-col">{formatInt(inputs.readsPerGuide)}</td>
            <td className="num-col">{formatInt(r.p10Reads)}</td>
            <td className="num-col" title={`Guides with fewer than ${inputs.readFloor} reads`}>
              {formatFraction(r.readsBelowFloor)} <span className="text-muted">&lt; {inputs.readFloor}</span>
            </td>
            <td className="num-col">{r.depthFor99 === null ? "Not reachable" : formatInt(r.depthFor99)}</td>
          </tr>
        </tbody>
      </DenseTable>
    </Panel>
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

export function SequencingPanel({ plan, inputs }: { plan: Plan; inputs: PlanInputs }) {
  const s = plan.sequencing;
  return (
    <Panel title="Sequencing and PCR" bodyClassName="py-1">
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
    </Panel>
  );
}

export function NoisePanel({ plan, inputs }: { plan: Plan; inputs: PlanInputs }) {
  const n = plan.noise;
  return (
    <Panel
      title="Sampling noise floor"
      caveat="A lower bound. Real screens add biological variation and a shared bottleneck."
      bodyClassName="py-1"
      footer={<FootNote>SE = sqrt(2 (1/cells + 1/reads) / replicates / guides) / ln 2</FootNote>}
    >
      <dl>
        <Fact
          term="One guide, log2 fold change"
          value={`±${formatLog2(n.guideSeLog2)}`}
          note={`From picking ${formatInt(inputs.coverage)} cells and reading ${formatInt(inputs.readsPerGuide)} reads, over ${inputs.replicates} replicate${inputs.replicates === 1 ? "" : "s"}`}
        />
        <Fact
          term="One gene, log2 fold change"
          value={`±${formatLog2(n.geneSeLog2)}`}
          note={`Averaging ${plan.library.guidesPerGene.toFixed(1)} independent guides`}
        />
        <Fact
          term="95% interval on a gene"
          value={`±${formatLog2(n.geneHalfWidth95)}`}
          note="From sampling alone. This is not statistical power"
        />
      </dl>
    </Panel>
  );
}

const PHASE_TONE = ["bg-teal-800", "bg-cyan-600", "bg-cyan-500", "bg-orange-500", "bg-teal-700", "bg-cyan-700", "bg-orange-400", "bg-teal-600"];

export function TimelinePanel({ plan }: { plan: Plan }) {
  const { phases, totalDays, totalWeeks } = plan.timeline;
  const shown = phases.filter((phase) => phase.days > 0);
  return (
    <Panel
      title="Timeline"
      count={`${totalWeeks} weeks, ${totalDays} days`}
      footer={
        <FootNote>
          Published range for a service screen: {PUBLISHED_REFERENCE.weeksLow} to {PUBLISHED_REFERENCE.weeksHigh} weeks
        </FootNote>
      }
      bodyClassName="py-3"
    >
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-mist-soft" aria-hidden="true">
        {shown.map((phase, index) => (
          <div
            key={phase.id}
            title={`${phase.label}: ${phase.days} days`}
            className={cn("h-full border-r border-white last:border-r-0", PHASE_TONE[index % PHASE_TONE.length])}
            style={{ width: `${(phase.days / Math.max(1, totalDays)) * 100}%` }}
          />
        ))}
      </div>
      <table className="mt-3 w-full text-[12px]">
        <caption className="sr-only">Phases of the screen and their duration in days</caption>
        <thead className="sr-only">
          <tr>
            <th>Phase</th>
            <th>Days</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((phase, index) => (
            <tr key={phase.id} className="border-b border-line last:border-0">
              <td className="py-1.5">
                <span className={cn("mr-2 inline-block h-2 w-2 rounded-sm align-middle", PHASE_TONE[index % PHASE_TONE.length])} aria-hidden="true" />
                {phase.label}
                {phase.computed && <span className="ml-1.5 text-[11px] text-muted">from your doubling time</span>}
              </td>
              <td className="num whitespace-nowrap py-1.5 text-right text-ink">
                {phase.days} days
                <span className="ml-1.5 text-[11px] text-muted">{(phase.days / 7).toFixed(phase.days % 7 === 0 ? 0 : 1)} wk</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

export function CostPanel({ plan }: { plan: Plan }) {
  return (
    <Panel
      title="Consumables and sequencing"
      count={formatUsd(plan.costs.total)}
      caveat="Placeholder unit costs. Replace them with your own quotes."
      body="flush"
      footer={
        <FootNote>Excludes labour, equipment time and analysis, which a service price includes</FootNote>
      }
    >
      <DenseTable minWidth={420} compact>
        <caption className="sr-only">Estimated cost by line, from the driver and the unit cost you set</caption>
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
      <p className="border-t border-line px-[var(--panel-gutter)] py-2 text-[11.5px] leading-snug text-body">
        For scale: {PUBLISHED_REFERENCE.label} is listed at{" "}
        <span className="num">${formatInt(PUBLISHED_REFERENCE.usd)}</span>, taking {PUBLISHED_REFERENCE.weeksLow} to{" "}
        {PUBLISHED_REFERENCE.weeksHigh} weeks.{" "}
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
    </Panel>
  );
}

export function MethodPanel() {
  const rows: [string, string][] = [
    ["Fraction infected", "1 − exp(−MOI). Cells carry a Poisson number of integrations."],
    ["Cells to transduce", "guides × coverage ÷ fraction infected, so that coverage is held after selection."],
    ["Two or more guides", "1 − MOI · exp(−MOI) ÷ (1 − exp(−MOI)), among infected cells."],
    ["Representation", "Guide abundance is lognormal with mean 1 and a 90th/10th percentile ratio equal to your skew. Cells or reads per guide are Poisson. The fraction under a floor is that mixture, integrated numerically."],
    ["Noise floor", "Picking cells adds 1/coverage to the variance of each log abundance and reading reads adds 1/depth. A comparison has two samples; replicates and guides average it down."],
    ["gDNA", "cells × pg per cell. A diploid human cell holds about 6.6 pg."],
  ];
  return (
    <Panel
      title="How this is calculated"
      caveat="Design arithmetic. There is no statistical power figure here, because none can be honest before the screen."
      bodyClassName="py-1"
    >
      <dl>
        {rows.map(([term, text]) => (
          <div key={term} className="grid gap-x-4 border-b border-line py-2 last:border-0 sm:grid-cols-[10rem_1fr]">
            <dt className="text-[12px] font-medium text-ink">{term}</dt>
            <dd className="text-[12px] leading-snug text-body">{text}</dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-line pt-2 text-[11.5px] leading-snug text-muted">
        Working ranges follow Joung et al., Nature Protocols 12:828 (2017),{" "}
        <a
          href="https://doi.org/10.1038/nprot.2017.016"
          target="_blank"
          rel="noreferrer"
          className="text-cyan-600 underline decoration-line-strong underline-offset-2"
        >
          doi 10.1038/nprot.2017.016<span className="sr-only"> (opens in a new tab)</span>
        </a>
        : more than 500 cells per guide, an MOI below 0.3, more than 500 reads per guide for screening, and a
        skew ratio under 10. Their worked example divides by the MOI (100,000 guides at 500 cells and MOI 0.3
        is 1.67 x 10^8 cells); the Poisson form used here divides by the fraction infected, 25.9% at that MOI,
        and gives 1.93 x 10^8. A power estimate needs the dispersion of guide counts in your cells, the effect
        sizes you expect, your multiple-testing correction and guide efficacy. None of those is known before
        the screen.
      </p>
    </Panel>
  );
}
