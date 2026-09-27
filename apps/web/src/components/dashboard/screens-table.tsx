"use client";

/**
 * The all-screens page: one table, everything else beside it.
 *
 * A researcher lands here with one of two questions, and the layout answers them
 * in that order. "Which screen do I open" is the table, so the table is the page
 * and the whole row is the link rather than the few characters of its name.
 * "Did a run break" is the first panel under it, because a postdoc who does not
 * see that scr_005 died in QC spends a morning reading a table that is about to
 * be recomputed.
 *
 * WHAT CHANGED AND WHY
 *
 * Filter and sort state used to live in `useState`, which meant the one thing a
 * postdoc does at the end of a filtering session, send their PI the exact view,
 * was impossible. It is in the query string now. The rows went from 47px to the
 * 32px of `--row-h`, which is what makes every screen, its provenance and its
 * exports fit a 1280x800 window at once instead of running 240px past the fold.
 *
 * Provenance is on the page rather than two clicks into a Report tab: the tool
 * versions and the two thresholds every figure in the table depends on are read
 * from the same run record the exports are built from.
 *
 * The containers are the console's one `Panel` and one `DenseTable` from ui.tsx.
 * This file used to carry its own, which is how a console becomes two consoles.
 */

import Link from "next/link";
import { useMemo } from "react";

import {
  FDR_THRESHOLD,
  libraries,
  LIKELY_REAL_THRESHOLD,
  screens,
  stagesForScreen,
  testsForScreen,
  type Screen,
} from "@/lib/mock/data";
import { cn, formatDate, formatNumber } from "@/lib/utils";

import { ABOVE_ROW_LINK, DefRow, ROW_LINK, SampleNote } from "./console";
import { FilterBar, FilterField, useUrlSort, useUrlState, type Cell } from "./console-controls";
import {
  DenseTable,
  FootNote,
  PageHeader,
  Panel,
  PANEL_GRID,
  PanelSelect,
  ROW_HIT,
  SortTh,
  StatusChip,
  statusTone,
  Th,
} from "./ui";

const STATUSES = ["Any", "complete", "running", "queued", "failed"] as const;

/**
 * The height of the three panels under the table. Fixed, and the same for all
 * three, so they are equal weight on the grid and the one with eight libraries
 * in it scrolls itself rather than pushing the table off the screen.
 */
const SIDE_PANEL_H = "h-[160px]";

/** Day and month in a column; the full date stays on the cell as its title. */
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** One cell reader, so a column sorts on exactly the value it prints. */
const cellOf = (screen: Screen, key: string): Cell => {
  switch (key) {
    case "name":
      return screen.name;
    case "phenotype":
      return screen.phenotype;
    case "model":
      return screen.cellLine;
    case "library":
      return screen.library;
    case "status":
      return screen.status;
    case "qc":
      return screen.qc;
    case "hits":
      // An unfinished screen has not called hits, so it sorts as unknown rather
      // than as zero hits found.
      return screen.status === "complete" ? screen.realHits : null;
    case "owner":
      return screen.owner;
    case "created":
      return Date.parse(screen.createdAt);
    default:
      return null;
  }
};

/** A run that stopped, or one still moving. Both are things to look at today. */
const needsAttention = (screen: Screen) =>
  screen.status === "failed" || screen.qc === "fail" || screen.status === "running";

export function ScreensTable() {
  const { get, set } = useUrlState();
  const query = get("q");
  const status = get("status", "Any");

  const matches = useMemo(
    () =>
      screens.filter(
        (screen) =>
          (status === "Any" || screen.status === status) &&
          (query === "" ||
            `${screen.name} ${screen.id} ${screen.cellLine} ${screen.library} ${screen.phenotype} ${screen.owner}`
              .toLowerCase()
              .includes(query.toLowerCase())),
      ),
    [query, status],
  );

  const { sorted, sortProps } = useUrlSort(matches, { key: "created", dir: "desc" }, cellOf);

  const attention = screens.filter(needsAttention);
  // The tool versions every figure in the table came out of, read from the run
  // record rather than typed in beside it.
  const stages = stagesForScreen(screens[0]);
  const toolFor = (stageKey: string) => stages.find((s) => s.key === stageKey)?.tool ?? "not recorded";
  const inUse = libraries.filter((library) => screens.some((s) => s.library === library.name));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <PageHeader
        dense
        title="Screens"
        body={`${formatNumber(screens.length)} in this workspace. Select a row to open it.`}
      />
      <SampleNote>
        Sample data. These {formatNumber(screens.length)} screens, their owners and their hit counts
        are invented to show the layout. None of it is a measurement.
      </SampleNote>

      {/* The page's one full-height panel. It takes whatever the fixed shell has
          left after the title, the label and the three panels below, so the rows
          a reader is comparing are on screen rather than a scroll apart. */}
      <Panel
        className="min-h-0 flex-1"
        title="All screens"
        count={`${formatNumber(sorted.length)} of ${formatNumber(screens.length)} screens`}
        control={
          <PanelSelect
            label="Status"
            value={status}
            onChange={(event) => set({ status: event.target.value === "Any" ? null : event.target.value })}
          >
            {STATUSES.map((option) => (
              <option key={option} value={option}>
                {option === "Any" ? "Status: any" : option}
              </option>
            ))}
          </PanelSelect>
        }
        body="flush"
        footer={
          <>
            {/* One line, because the footer is one line. The long-hand version of
                this sentence lived under the table and cost 77px of rows. */}
            <FootNote>
              Hits: chance real {LIKELY_REAL_THRESHOLD.toFixed(2)} or above, over candidates past BH
              FDR {FDR_THRESHOLD.toFixed(2)}
            </FootNote>
            <span aria-live="polite" className="num shrink-0">
              {sorted.length === screens.length
                ? "No filter applied"
                : `${formatNumber(screens.length - sorted.length)} hidden by this filter`}
            </span>
          </>
        }
      >
        <FilterBar>
          <FilterField
            label="Filter screens"
            value={query}
            onChange={(value) => set({ q: value })}
            placeholder="Name, id, cell line, library, phenotype or owner"
            className="max-w-[320px] flex-1"
          />
          <span className="ml-auto hidden shrink-0 text-[11px] text-muted lg:block">
            Every column sorts. The sort and the filter are in this page&apos;s address.
          </span>
        </FilterBar>

        <DenseTable minWidth={920}>
          <caption className="sr-only">
            Sample screens, sortable by any column heading. Select a row to open that screen.
          </caption>
          <thead>
            <tr>
              <SortTh label="Screen" {...sortProps("name")} />
              <SortTh label="Phenotype" {...sortProps("phenotype")} />
              <SortTh label="Model" {...sortProps("model")} />
              <SortTh label="Library" {...sortProps("library")} />
              <SortTh label="Status" {...sortProps("status")} />
              <SortTh label="QC" {...sortProps("qc")} />
              <SortTh
                label="Hits"
                align="right"
                title="Likely real over candidates called, both counted from this screen's own hit table"
                {...sortProps("hits", "desc")}
              />
              <SortTh label="Owner" {...sortProps("owner")} />
              <SortTh label="Created" {...sortProps("created", "desc")} />
              <Th>Export</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((screen) => (
              <tr key={screen.id} className={ROW_HIT}>
                <td>
                  {/* The id is the join key an export carries, so it stays
                      reachable, but as the link's title rather than 55px of
                      every row. */}
                  <Link
                    href={`/dashboard/screens/${screen.id}`}
                    title={screen.id}
                    className={cn("font-medium text-ink hover:text-orange-600", ROW_LINK)}
                  >
                    {screen.name}
                    <span className="sr-only">, {screen.id}, open this screen</span>
                  </Link>
                </td>
                <td>{screen.phenotype}</td>
                <td>
                  {screen.cellLine}
                  <span className="ml-1.5 text-[11px] text-muted">
                    {screen.organism} · {screen.modality}
                  </span>
                </td>
                <td>{screen.library}</td>
                <td>
                  <StatusChip tone={statusTone(screen.status)} spinning={screen.status === "running"}>
                    {screen.status}
                    {screen.status !== "complete" && screen.status !== "draft" && (
                      <span className="num">· {screen.stage}/9</span>
                    )}
                  </StatusChip>
                </td>
                <td>
                  <StatusChip tone={statusTone(screen.qc)}>{screen.qc}</StatusChip>
                </td>
                <td className="num-col">
                  {screen.status === "complete" ? (
                    `${formatNumber(screen.realHits)} / ${formatNumber(screen.hits)}`
                  ) : (
                    <span className="text-muted">Not called yet</span>
                  )}
                </td>
                <td>{screen.owner}</td>
                <td title={formatDate(screen.createdAt)}>{shortDate(screen.createdAt)}</td>
                <td>
                  {/* CSV here because that is the file that opens in R, Excel
                      and Prism. JSON and the PDF are one click further, on the
                      screen's own Report tab, rather than 60px of every row. */}
                  {screen.status === "complete" ? (
                    <a
                      href={`/api/report/${screen.id}?format=csv`}
                      className={cn(
                        "rounded-sm text-[11px] uppercase text-cyan-600 underline decoration-line-strong underline-offset-2 hover:decoration-cyan-600",
                        ABOVE_ROW_LINK,
                      )}
                    >
                      csv
                      <span className="sr-only"> export for {screen.name}</span>
                    </a>
                  ) : (
                    <span className="text-[11px] text-muted">None yet</span>
                  )}
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-muted">
                  No screen matches this filter. Clear the text filter or set the status back to
                  any.
                </td>
              </tr>
            )}
          </tbody>
        </DenseTable>
      </Panel>

      {/* Three questions the table cannot answer in a row: what broke, what the
          figures were computed by, and what the correction was run over. */}
      <div className={cn(PANEL_GRID, "shrink-0")}>
        <Panel
          span={4}
          className={cn(SIDE_PANEL_H, "[animation-delay:40ms]")}
          title="Needs a look today"
          count={`${attention.length} of ${formatNumber(screens.length)} screens`}
        >
          <ul className="space-y-1.5">
            {attention.map((screen) => {
              const stage = stagesForScreen(screen).find(
                (s) => s.status === "failed" || s.status === "running",
              );
              return (
                <li key={screen.id} className="flex items-baseline gap-2 text-[12px] leading-snug">
                  <StatusChip tone={statusTone(screen.status)} className="shrink-0">
                    {screen.status}
                  </StatusChip>
                  <Link
                    href={`/dashboard/screens/${screen.id}`}
                    className="min-w-0 flex-1 truncate text-ink underline decoration-line-strong underline-offset-2 hover:decoration-orange-500"
                  >
                    {screen.name}
                  </Link>
                  <span className="num shrink-0 text-[11px] text-muted">
                    {stage ? `${stage.title}, stage ${screen.stage + 1} of 9` : `QC ${screen.qc}`}
                  </span>
                </li>
              );
            })}
            {attention.length === 0 && (
              <li className="text-[12px] text-muted">
                No run has stopped and none is in progress.
              </li>
            )}
          </ul>
        </Panel>

        <Panel
          span={4}
          className={cn(SIDE_PANEL_H, "[animation-delay:80ms]")}
          title="How these figures were computed"
        >
          <DefRow term="Counting" value={toolFor("count")} />
          <DefRow term="Hit calling" value={toolFor("hits")} />
          <DefRow term="Score" value={toolFor("score")} note="Calibration band ±0.06" />
          <DefRow
            term="Candidate cut"
            value={`BH FDR ${FDR_THRESHOLD.toFixed(2)}`}
            note={`Corrected over the genes in each screen's own library, ${formatNumber(testsForScreen(screens[0]))} for ${screens[0].library}, not over the rows that survived`}
          />
        </Panel>

        <Panel
          span={4}
          className={cn(SIDE_PANEL_H, "[animation-delay:120ms]")}
          title="Libraries in use"
          count={`${inUse.length} of ${libraries.length} registered`}
        >
          {inUse.map((library) => (
            <DefRow
              key={library.name}
              term={library.name}
              value={`${formatNumber(library.genes)} genes`}
              note={`${formatNumber(library.guides)} guides, ${library.perGene} per gene, ${library.cas}`}
            />
          ))}
        </Panel>
      </div>
    </div>
  );
}
