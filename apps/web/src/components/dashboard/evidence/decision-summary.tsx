/**
 * What a researcher opening a screen needs before they read a gene.
 *
 * Four facts and one action. It deliberately does not restate the run's size:
 * "20,916 records" is true and is not a decision, and it sat in the largest
 * type on the page while the eleven genes anybody came for were below the
 * fold. The size of the run is still on the page, under the table that holds
 * it.
 *
 * Each fact links to the rows behind it, so none of them is a number a reader
 * has to take on trust.
 */
import Link from "next/link";

import type { OutcomeResult } from "@/lib/outcomes/model";
import type { Diagnosis } from "@/lib/report/screen-doctor";
import { cn, formatNumber } from "@/lib/utils";

function Fact({ label, value, note, href, tone = "ink" }: {
  label: string;
  value: string;
  note: string;
  href?: string;
  tone?: "ink" | "orange";
}) {
  const figure = (
    <span className={cn("num text-[19px] font-medium leading-none tracking-[-0.02em]",
      tone === "orange" ? "text-orange-600" : "text-ink")}>
      {value}
    </span>
  );
  return (
    <div className="flex min-w-0 flex-col gap-1.5 border-l border-t border-line px-[var(--panel-gutter)] py-2.5">
      {href ? (
        <Link href={href} scroll={false} className="rounded-sm hover:opacity-80">{figure}</Link>
      ) : figure}
      <span className="truncate text-[11px] leading-none text-muted">{label}</span>
      <span className="text-[11px] leading-[1.35] text-muted">{note}</span>
    </div>
  );
}

const QC_WORD: Record<Diagnosis["verdict"], { value: string; note: string; tone: "ink" | "orange" }> = {
  fail: { value: "Failed", note: "Read the health panel before any gene result.", tone: "orange" },
  warn: { value: "Warning", note: "Passed with something worth checking.", tone: "orange" },
  pass: { value: "Passed", note: "Every check the engine ran passed.", tone: "ink" },
  pending: { value: "Not recorded", note: "The run recorded no QC. That is not a pass.", tone: "orange" },
};

export function DecisionSummary({
  diagnosis,
  significant,
  significantFdr,
  significantFlagged,
  outcomes,
  candidatesHref,
}: {
  diagnosis: Diagnosis;
  significant: number;
  significantFdr: number;
  significantFlagged: number;
  /** Recorded validation outcomes for genes of this screen. */
  outcomes: Map<string, { id: string; result: OutcomeResult }> | null;
  candidatesHref: string;
}) {
  const qc = QC_WORD[diagnosis.verdict];
  const recorded = outcomes === null ? null : outcomes.size;
  const validated = outcomes === null
    ? null
    : [...outcomes.values()].filter((outcome) => outcome.result === "validated").length;

  return (
    <div className="-ml-px -mt-px grid grid-cols-2 lg:grid-cols-4">
      <Fact label="Quality control" value={qc.value} note={qc.note} tone={qc.tone} />
      <Fact
        label="Candidates"
        value={formatNumber(significant)}
        note={`At or below FDR ${significantFdr}. A record with no recorded FDR is not counted.`}
        href={candidatesHref}
      />
      <Fact
        label="With artifact flags"
        value={`${formatNumber(significantFlagged)} of ${formatNumber(significant)}`}
        note="A flag is a reason to check a candidate, not a verdict on it."
        tone={significantFlagged > 0 ? "orange" : "ink"}
      />
      <Fact
        label="Validation"
        value={recorded === null ? "Not looked up" : recorded === 0 ? "None" : formatNumber(recorded)}
        note={
          recorded === null
            ? "The outcome records could not be read."
            : recorded === 0
              ? "No gene from this screen has been taken to the bench yet."
              : `${formatNumber(validated ?? 0)} validated at the bench so far.`
        }
      />
    </div>
  );
}
