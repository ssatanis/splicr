"use client";

/**
 * The third question, and the only reason to believe the first answer: was the
 * score right last time?
 *
 * The panel sits directly under the candidate table on purpose. Chance real is
 * the column a reader is about to spend six weeks of bench time on, and the only
 * evidence that the column means anything is what happened the last few times it
 * was acted on. The predicted figure is the one the gene carried when it was
 * called, not a recomputed one, because a score that gets quietly updated after
 * the result is in cannot be checked against anything.
 */

import Link from "next/link";
import { useMemo } from "react";

import {
  DenseTable,
  Empty,
  FootNote,
  NotRecorded,
  Panel,
  PanelLink,
  ROW_HIT,
  SortTh,
  StatusChip,
  statusTone,
} from "@/components/dashboard/ui";
import { cn, formatNumber } from "@/lib/utils";

import type { OutcomeRow } from "./types";
import { usePanelSort, type Cell } from "./url-state";

/** Sorted by how well the call held up, so a wrong call cannot hide at the end. */
const RESULT_ORDER: Record<OutcomeRow["result"], number> = {
  failed: 0,
  inconclusive: 1,
  pending: 2,
  validated: 3,
};

/**
 * `grow basis-auto` rather than `flex-1`: this panel takes the space the runs
 * panel above it does not want, and when the column is a few pixels short of
 * both, the shortfall is shared in proportion to what each one asked for rather
 * than landing entirely on the neighbour. `flex-1` sets the basis to zero, which
 * makes a shrinking column collapse the runs panel and leave this one untouched.
 */
const FILL = "min-h-0 grow basis-auto";

const cellOf = (row: OutcomeRow, key: string): Cell => {
  switch (key) {
    case "gene":
      return row.gene;
    case "assay":
      return row.assay;
    case "predicted":
      return row.predicted;
    case "result":
      return RESULT_ORDER[row.result];
    default:
      return null;
  }
};

export function OutcomesPanel({
  outcomes,
  className,
}: {
  outcomes: OutcomeRow[];
  className?: string;
}) {
  const fallback = useMemo(() => ({ key: "predicted", dir: "desc" as const }), []);
  const { sorted, key, dir, toggle } = usePanelSort(outcomes, "o", fallback, cellOf);

  const resolved = outcomes.filter((row) => row.result !== "pending");
  const right = resolved.filter((row) => row.result === "validated").length;

  return (
    <Panel
      title="Bench outcomes"
      count={`${formatNumber(outcomes.length)} logged`}
      span={6}
      body="flush"
      className={cn(FILL, className)}
      control={<PanelLink href="/dashboard/validation">Truth Loop</PanelLink>}
      footer={
        <>
          <FootNote>
            Chance real as recorded when the gene was called, never recomputed after the result.
          </FootNote>
          <span className="num shrink-0">
            {resolved.length === 0
              ? "None resolved"
              : `${right} of ${resolved.length} held up`}
          </span>
        </>
      }
    >
      {sorted.length === 0 ? (
        <div className="px-[var(--panel-gutter)] py-3.5">
          <Empty
            title="No outcomes logged"
            body="When a candidate is re-tested at the bench, log what happened. That is what tells you whether the chance real column is worth anything."
            action={
              <Link href="/dashboard/validation" className="btn btn-teal btn-sm rounded-lg">
                Open Truth Loop
              </Link>
            }
          />
        </div>
      ) : (
        <DenseTable compact minWidth={400}>
          <thead>
            <tr>
              <SortTh
                label="Gene"
                active={key === "gene"}
                dir={dir}
                onToggle={() => toggle("gene", "asc")}
              />
              <SortTh
                label="Assay"
                active={key === "assay"}
                dir={dir}
                onToggle={() => toggle("assay", "asc")}
              />
              <SortTh
                label="Called at"
                align="right"
                active={key === "predicted"}
                dir={dir}
                onToggle={() => toggle("predicted", "desc")}
                title="Chance real the gene carried at the moment it was called, in percent."
              />
              <SortTh
                label="Result"
                active={key === "result"}
                dir={dir}
                onToggle={() => toggle("result", "asc")}
                title="What the bench found. Ascending puts the calls that did not hold up first."
              />
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.id} className={ROW_HIT}>
                <td>
                  {row.screenId ? (
                    <Link
                      href={`/dashboard/screens/${row.screenId}?tab=validation`}
                      className="truncate font-medium text-ink transition-colors duration-[var(--dur-1)] hover:text-orange-500 motion-reduce:transition-none"
                    >
                      {row.gene}
                      <span className="sr-only">, open the screen this outcome belongs to</span>
                    </Link>
                  ) : (
                    <span className="font-medium text-ink">{row.gene}</span>
                  )}
                </td>
                <td className="max-w-[9rem] truncate" title={row.assay ?? undefined}>
                  {row.assay ?? <NotRecorded />}
                </td>
                <td className="num-col">
                  {row.predicted !== null ? (
                    `${Math.round(row.predicted * 100)}%`
                  ) : (
                    <NotRecorded />
                  )}
                </td>
                <td>
                  <StatusChip tone={statusTone(row.result)}>{row.result}</StatusChip>
                </td>
              </tr>
            ))}
          </tbody>
        </DenseTable>
      )}
    </Panel>
  );
}
