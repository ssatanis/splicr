"use client";

/**
 * Screen Doctor, in three layers.
 *
 * The first is a sentence and, where there is one, the thing to look at first
 * and what to do about it. That is what a researcher opening a screen needs
 * before they read a single gene.
 *
 * The second is each check with the measurements behind it, folded away. The
 * third is every sample's recorded QC, folded away again. A reader can stop
 * after the first and act on it, or carry on and check the arithmetic; what
 * they cannot do is be handed fourteen plots and asked to work it out.
 *
 * Nothing here decides anything. The diagnosis comes from lib/report/screen-doctor,
 * which reads recorded values and compares them with published thresholds.
 */
import { AlertTriangle, Check, Info } from "lucide-react";

import type { Diagnosis, Finding, Level } from "@/lib/report/screen-doctor";
import { cn } from "@/lib/utils";

import { DenseTable, Th } from "../ui";

const ICON: Record<Level, React.ReactNode> = {
  fail: <AlertTriangle className="h-3.5 w-3.5 text-orange-600" aria-hidden="true" />,
  warn: <AlertTriangle className="h-3.5 w-3.5 text-orange-500" aria-hidden="true" />,
  ok: <Check className="h-3.5 w-3.5 text-cyan-600" aria-hidden="true" />,
};
const WORD: Record<Level, string> = { fail: "Failed", warn: "Needs attention", ok: "Passed" };

function FindingRow({ finding }: { finding: Finding }) {
  return (
    <li className="flex gap-2.5 py-2">
      <span className="mt-0.5 shrink-0">{ICON[finding.level]}</span>
      <div className="min-w-0 flex-1">
        <div className={cn("text-[12.5px] font-medium leading-snug",
          finding.level === "ok" ? "text-ink" : "text-orange-700")}>
          <span className="sr-only">{WORD[finding.level]}: </span>
          {finding.title}
        </div>
        <p className="mt-0.5 text-[12px] leading-snug text-body">{finding.detail}</p>
        {finding.evidence.length > 0 && (
          <dl className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1">
            {finding.evidence.map((item) => (
              <div key={`${finding.id}-${item.label}`} className="min-w-0">
                <dt className="text-[11px] leading-tight text-muted">{item.label}</dt>
                <dd className="num text-[12px] leading-tight text-ink">
                  {item.value}
                  {item.against && <span className="ml-1.5 text-[11px] text-muted">vs {item.against}</span>}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </li>
  );
}

export function ScreenDoctor({ diagnosis }: { diagnosis: Diagnosis }) {
  const { concern, action, findings, samples } = diagnosis;
  const attention = findings.filter((finding) => finding.level !== "ok");
  const passed = findings.filter((finding) => finding.level === "ok");

  return (
    <div className="divide-y divide-line">
      {/* Layer one: the decision. */}
      <div className="px-[var(--panel-gutter)] py-2.5">
        <p className="text-[13px] leading-snug text-ink">{diagnosis.headline}</p>
        {concern && (
          // Announced, not merely coloured: a reader on a screen reader has to
          // meet a failed QC before the gene results, the same as everyone else.
          <div role="alert" className="mt-2 rounded-md bg-orange-50 px-3 py-2">
            <div className="text-[11px] uppercase tracking-[0.08em] text-orange-700">
              {diagnosis.verdict === "fail" ? "QC failed. Look at this first" : "Look at this first"}
            </div>
            <p className="mt-0.5 text-[12.5px] font-medium leading-snug text-ink">{concern.title}</p>
            {action && <p className="mt-1 text-[12px] leading-snug text-body">{action}</p>}
          </div>
        )}
      </div>

      {/* Layer two: the measurements behind each check. */}
      {findings.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-baseline justify-between gap-3 px-[var(--panel-gutter)] py-2 text-[12px] text-ink [&::-webkit-details-marker]:hidden">
            <span className="flex items-baseline gap-1.5">
              <span aria-hidden="true" className="inline-block w-2.5 text-muted transition-transform duration-[var(--dur-1)] group-open:rotate-90 motion-reduce:transition-none">
                {"›"}
              </span>
              What was checked
            </span>
            <span className="num shrink-0 text-[11px] text-muted">
              {attention.length === 0
                ? `${passed.length} passed`
                : `${attention.length} of ${findings.length} need attention`}
            </span>
          </summary>
          <ul className="divide-y divide-line px-[var(--panel-gutter)] pb-2 pl-7">
            {findings.map((finding) => <FindingRow key={finding.id} finding={finding} />)}
          </ul>
        </details>
      )}

      {/* Layer three: every recorded value, for somebody checking the working. */}
      {samples.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-baseline justify-between gap-3 px-[var(--panel-gutter)] py-2 text-[12px] text-ink [&::-webkit-details-marker]:hidden">
            <span className="flex items-baseline gap-1.5">
              <span aria-hidden="true" className="inline-block w-2.5 text-muted transition-transform duration-[var(--dur-1)] group-open:rotate-90 motion-reduce:transition-none">
                {"›"}
              </span>
              Every sample&rsquo;s recorded QC
            </span>
            <span className="num shrink-0 text-[11px] text-muted">{samples.length} samples</span>
          </summary>
          <div className="pb-1">
            <DenseTable minWidth={620} compact>
              <caption className="sr-only">
                Recorded quality metrics for each sequenced sample of this run
              </caption>
              <thead>
                <tr>
                  <Th>Sample</Th>
                  <Th>Role</Th>
                  <Th align="right">Mapped</Th>
                  <Th align="right">No reads</Th>
                  <Th align="right">Skew</Th>
                  <Th align="right">Reads per guide</Th>
                  <Th align="right">Gini</Th>
                </tr>
              </thead>
              <tbody>
                {samples.map((sample) => (
                  <tr key={sample.label}>
                    <td className="font-medium text-ink">{sample.label}</td>
                    <td className="text-muted">{sample.role || "not recorded"}</td>
                    <td className="num-col">{sample.mapping_rate === null ? "—" : `${(sample.mapping_rate * 100).toFixed(1)}%`}</td>
                    <td className="num-col">{sample.zero_fraction === null ? "—" : `${(sample.zero_fraction * 100).toFixed(1)}%`}</td>
                    <td className="num-col">{sample.skew_ratio === null ? "—" : sample.skew_ratio.toFixed(1)}</td>
                    <td className="num-col">{sample.mean_reads_per_guide === null ? "—" : sample.mean_reads_per_guide.toFixed(0)}</td>
                    <td className="num-col">{sample.gini === null ? "—" : sample.gini.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </DenseTable>
            <p className="px-[var(--panel-gutter)] pb-1 pt-1.5 text-[11px] leading-snug text-muted">
              <Info className="mr-1 inline h-3 w-3 align-[-2px]" aria-hidden="true" />
              Recorded by the run. A dash is a value the run did not record, which is not a zero.
            </p>
          </div>
        </details>
      )}
    </div>
  );
}
