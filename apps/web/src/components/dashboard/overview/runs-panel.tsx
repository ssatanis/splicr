"use client";

/**
 * The second question this page answers: did a run break, and is anything still
 * moving?
 *
 * A postdoc who does not see that a screen died in QC spends a morning reading a
 * table that is about to be recomputed, so the panel opens on the runs that want
 * a look and says how many of the rest are fine. Library and created date used to
 * be columns here and neither one answers anything on this page; both are one
 * click away on the all-screens table, which is what the header link is for.
 *
 * The row expands in place rather than navigating. Deciding whether a failed run
 * needs your morning takes one more line, not a page load.
 */

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";

import {
  DenseTable,
  Empty,
  Panel,
  PANEL_CHROME,
  PanelLink,
  ROW_HIT,
  Segmented,
  SortTh,
  StatusChip,
  statusTone,
} from "@/components/dashboard/ui";
import { cn, formatNumber } from "@/lib/utils";

import { useFitRows } from "./fit-rows";
import type { RunRow } from "./types";
import { usePanelSort, usePanelUrl, type Cell } from "./url-state";

type View = "attention" | "all";

const cellOf = (run: RunRow, key: string): Cell => {
  switch (key) {
    case "name":
      return run.name;
    case "status":
      return run.status;
    case "qc":
      return run.qc;
    case "hits":
      // A run that has not finished has not called hits, so it sorts as unknown
      // rather than as having found none.
      return run.status === "complete" ? run.realHits : null;
    default:
      return null;
  }
};

export function RunsPanel({
  runs,
  /** Hits at or above the likely-real cut, spelled out for the column's title. */
  realCut,
  className,
}: {
  runs: RunRow[];
  realCut: string;
  className?: string;
}) {
  const { get, set } = usePanelUrl("r");
  const flagged = runs.filter((run) => run.attention !== null);

  // Personalised by the workspace's own state rather than by a name: when
  // something is wrong the panel opens on what is wrong, and when nothing is it
  // opens on the runs themselves and does not invent an alarm.
  const fallbackView: View = flagged.length > 0 ? "attention" : "all";
  const view: View = (get("view", fallbackView) === "all" ? "all" : "attention") as View;
  const shown = view === "attention" && flagged.length > 0 ? flagged : runs;

  const { sorted, key, dir, toggle } = usePanelSort(
    shown,
    "r",
    { key: "status", dir: "asc" },
    cellOf,
  );

  const [openId, setOpenId] = useState<string | null>(null);
  const expand = useCallback(
    (id: string) => setOpenId((current) => (current === id ? null : id)),
    [],
  );

  // Whole rows only, so the cut never lands through the middle of a status chip.
  const { ref, maxRows } = useFitRows({ rowPx: PANEL_CHROME.rowCompact });

  return (
    <Panel
      id="panel-runs"
      sectionRef={ref}
      title={flagged.length > 0 ? "Runs needing a look" : "Runs"}
      count={
        <span className="hidden sm:inline">
          {flagged.length > 0
            ? `${formatNumber(flagged.length)} of ${formatNumber(runs.length)} screens`
            : `${formatNumber(runs.length)} screens`}
        </span>
      }
      span={6}
      body="flush"
      className={className}
      control={
        flagged.length > 0 && flagged.length < runs.length ? (
          <Segmented
            label="Which runs to list"
            value={view}
            options={[
              { value: "attention", label: "Needs a look" },
              { value: "all", label: "All" },
            ]}
            onChange={(next) => set({ view: next === fallbackView ? null : next })}
          />
        ) : (
          <PanelLink href="/dashboard/screens">All screens</PanelLink>
        )
      }
    >
      {sorted.length === 0 ? (
        <div className="px-[var(--panel-gutter)] py-3.5">
          <Empty
            title="No screens came back"
            body="That is either an empty workspace or a read that did not complete, so nothing here is being reported as zero."
            action={
              <Link href="/dashboard/upload" className="btn btn-teal btn-sm rounded-lg">
                Start a run
              </Link>
            }
          />
        </div>
      ) : (
        <DenseTable compact maxRows={maxRows} minWidth={400}>
          <thead>
            <tr>
              <SortTh
                label="Screen"
                active={key === "name"}
                dir={dir}
                onToggle={() => toggle("name", "asc")}
              />
              <SortTh
                label="Run"
                active={key === "status"}
                dir={dir}
                onToggle={() => toggle("status", "asc")}
                title="Pipeline status, and how many of the nine stages have finished."
              />
              <SortTh
                label="QC"
                active={key === "qc"}
                dir={dir}
                onToggle={() => toggle("qc", "asc")}
                title="Verdict from the QC stage across every sample in the run."
              />
              <SortTh
                label="Hits"
                align="right"
                active={key === "hits"}
                dir={dir}
                onToggle={() => toggle("hits", "desc")}
                title={`Likely real of called, where likely real is ${realCut}.`}
              />
            </tr>
          </thead>
          <tbody>
            {sorted.map((run) => {
              const on = openId === run.id;
              return [
                <tr key={run.id} className={ROW_HIT}>
                  <td>
                    <span className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => expand(run.id)}
                        aria-expanded={on}
                        aria-controls={`run-${run.id}`}
                        className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted transition-colors duration-[var(--dur-1)] hover:text-ink motion-reduce:transition-none"
                      >
                        <ChevronRight
                          className={cn(
                            "h-3 w-3 transition-transform duration-[var(--dur-3)] ease-out-soft motion-reduce:transition-none",
                            on && "rotate-90",
                          )}
                          aria-hidden="true"
                        />
                        <span className="sr-only">
                          {on ? `Hide details for ${run.name}` : `Show details for ${run.name}`}
                        </span>
                      </button>
                      <Link
                        href={`/dashboard/screens/${run.id}`}
                        /* orange-600, not 500: the row tints to mist-soft on
                           hover, where orange-500 measures 4.11:1 at this size
                           and weight, under the 4.5 the house rules require.
                           This pair measures 5.26:1. */
                        className="truncate font-medium text-ink transition-colors duration-[var(--dur-1)] hover:text-orange-600 motion-reduce:transition-none"
                      >
                        {run.name}
                        <span className="sr-only">, open this screen</span>
                      </Link>
                    </span>
                  </td>
                  <td>
                    <span className="flex items-center gap-1.5">
                      <StatusChip
                        tone={statusTone(run.status)}
                        spinning={run.status === "running"}
                      >
                        {run.status}
                      </StatusChip>
                      {run.status !== "complete" && run.stage !== null && (
                        <span className="num shrink-0 text-[11px] text-muted">
                          {run.stage}/9
                        </span>
                      )}
                    </span>
                  </td>
                  <td>
                    <StatusChip tone={statusTone(run.qc)}>{run.qc}</StatusChip>
                  </td>
                  <td className="num-col">
                    {run.status === "complete" && run.realHits !== null && run.hits !== null ? (
                      `${formatNumber(run.realHits)} / ${formatNumber(run.hits)}`
                    ) : (
                      <span className="text-muted">Not called</span>
                    )}
                  </td>
                </tr>,
                on ? (
                  <tr key={`${run.id}-detail`} id={`run-${run.id}`}>
                    {/* The whole row, because the detail is a sentence about the
                        run and not a value in any one of the four columns. */}
                    <td colSpan={4} className="h-auto whitespace-normal bg-mist-soft/60 py-1.5">
                      <span className="panel-in block text-[11px] leading-snug text-body">
                        {run.attention !== null && (
                          <span className="text-orange-700">{run.attention} </span>
                        )}
                        {run.detail}
                      </span>
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </DenseTable>
      )}
    </Panel>
  );
}
