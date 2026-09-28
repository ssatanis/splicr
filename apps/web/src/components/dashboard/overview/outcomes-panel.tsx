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
  PANEL_CHROME,
  PanelLink,
  ROW_HIT,
  SortTh,
  StatusChip,
  statusTone,
} from "@/components/dashboard/ui";
import { cn, formatNumber } from "@/lib/utils";

import { useFitRows } from "./fit-rows";
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
 * This panel no longer grows.
 *
 * It used to carry `grow basis-auto` and take the slack in the right-hand column,
 * which put a measured 282px of empty white inside it at 1728 wide, 168px at 1440
 * and 68px at 1280, directly beside a table that was hiding fifty-four rows. The
 * slack belongs to the round panel under it, which gets longer as a reader picks.
 * So this one is as tall as its rows and no taller, and `min-h-0` is what lets it
 * give height back when the column is short rather than pushing a neighbour out.
 */
const FILL = "min-h-0 shrink";

/** Below this the table scrolls sideways rather than dropping a digit off a percentage. */
const MIN_WIDTH = 400;

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

  // Whole rows only. The rows are compact now: this panel stopped being the one
  // that absorbs the column's slack, so the argument for taller rows went with it.
  const { ref, maxRows } = useFitRows({ rowPx: PANEL_CHROME.rowCompact, footer: true });

  return (
    <Panel
      id="panel-outcomes"
      sectionRef={ref}
      title="Bench outcomes"
      count={`${formatNumber(outcomes.length)} logged`}
      span={6}
      body="flush"
      className={cn(FILL, className)}
      control={<PanelLink href="/dashboard/validation">Truth Loop</PanelLink>}
      footer={
        <>
          <FootNote>Model score recorded at the call; calibration is not established.</FootNote>
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
            body="No independent validation records are available in this workspace. Outcomes are needed to evaluate model scores."
            action={
              <Link href="/dashboard/validation" className="btn btn-teal btn-sm rounded-lg">
                Open Truth Loop
              </Link>
            }
          />
        </div>
      ) : (
        <DenseTable compact maxRows={maxRows} minWidth={MIN_WIDTH}>
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
                title="Recorded model score at the call, not a calibrated probability."
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
                      /* orange-600, not 500: on the row's mist-soft hover tint
                         orange-500 measures 4.11:1, under the 4.5 the house
                         rules require. This pair measures 5.26:1. */
                      className="truncate font-medium text-ink transition-colors duration-[var(--dur-1)] hover:text-orange-600 motion-reduce:transition-none"
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
                    row.predicted.toFixed(3)
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
