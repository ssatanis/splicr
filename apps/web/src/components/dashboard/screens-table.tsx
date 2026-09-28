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

import { DefRow, ROW_LINK, SampleNote } from "./console";
import {
  CsvFootLink,
  FilterBar,
  FilterField,
  useUrlSort,
  useUrlState,
  type Cell,
} from "./console-controls";
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
} from "./ui";

const STATUSES = ["Any", "complete", "running", "queued", "failed"] as const;

/** The export's header row. Every column the table shows, in the order it shows them. */
const SCREEN_COLUMNS = [
  "screen_id",
  "name",
  "phenotype",
  "cell_line",
  "organism",
  "modality",
  "library",
  "status",
  "qc",
  "likely_real_hits",
  "candidates_called",
  "owner",
  "created_at",
] as const;

/**
 * The height of the three panels under the table. Fixed, and the same for all
 * three, so they are equal weight on the grid and the one with eight libraries
 * in it scrolls itself rather than pushing the table off the screen.
 */
const SIDE_PANEL_H = "h-[160px]";

/**
 * The caps on the three prose columns. Without them the ten columns want
 * 1,175px, which is 181px more than the panel has at 1280 and puts the date and
 * the export beyond the right edge.
 */
const NAME_W = "max-w-[150px]";
const TEXT_W = "max-w-[116px]";
const LIB_W = "max-w-[100px]";

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
    <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1">
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
        className="min-h-[340px] flex-1"
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
              Demo hits: illustrative score {LIKELY_REAL_THRESHOLD.toFixed(2)} or above, over candidates past BH
              FDR {FDR_THRESHOLD.toFixed(2)}
            </FootNote>
            <span className="flex shrink-0 items-center gap-3">
              <span aria-live="polite" className="num">
                {sorted.length === screens.length
                  ? "No filter applied"
                  : `${formatNumber(screens.length - sorted.length)} hidden by this filter`}
              </span>
              {/* The export belongs to the panel, not to each row: a csv link in
                  every row cost 71px of a table that had none to spare, and the
                  file a reader actually wants is the filtered view they are
                  looking at. A screen's own report is on the screen's page. */}
              <CsvFootLink
                filename="splicr-sample-screens.csv"
                columns={SCREEN_COLUMNS}
                rows={sorted.map((screen) => [
                  screen.id,
                  screen.name,
                  screen.phenotype,
                  screen.cellLine,
                  screen.organism,
                  screen.modality,
                  screen.library,
                  screen.status,
                  screen.qc,
                  // An unfinished screen has not called hits, so the cell is
                  // empty rather than a zero somebody could plot.
                  screen.status === "complete" ? screen.realHits : "",
                  screen.status === "complete" ? screen.hits : "",
                  screen.owner,
                  screen.createdAt,
                ])}
              >
                Export CSV
              </CsvFootLink>
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
            </tr>
          </thead>
          <tbody>
            {sorted.map((screen) => (
              <tr key={screen.id} className={ROW_HIT}>
                <td>
                  {/* The id is the join key an export carries, so it stays
                      reachable, but as the link's title rather than 55px of
                      every row.

                      Capped and clipped, with the full string on the cell: ten
                      columns of nowrap text needed 1,175px at 1280, which put
                      Created and the export off the right edge of the panel.
                      A name a reader can hover for is a better trade than an
                      export they have to scroll sideways to find. Figures are
                      never capped, only prose. */}
                  <Link
                    href={`/dashboard/screens/${screen.id}`}
                    title={`${screen.name} (${screen.id})`}
                    className={cn("block truncate font-medium text-ink hover:text-orange-600", NAME_W, ROW_LINK)}
                  >
                    {screen.name}
                    <span className="sr-only">, {screen.id}, open this screen</span>
                  </Link>
                </td>
                <td>
                  <span className={cn("block truncate", TEXT_W)} title={screen.phenotype}>
                    {screen.phenotype}
                  </span>
                </td>
                <td>
                  <span
                    className={cn("block truncate", TEXT_W)}
                    title={`${screen.cellLine}, ${screen.organism}, ${screen.modality}`}
                  >
                    {screen.cellLine}
                    <span className="ml-1.5 text-[11px] text-muted">
                      {screen.organism} · {screen.modality}
                    </span>
                  </span>
                </td>
                <td>
                  <span className={cn("block truncate", LIB_W)} title={screen.library}>
                    {screen.library}
                  </span>
                </td>
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
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-muted">
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
          title="Illustrative analysis settings"
        >
          <DefRow term="Counting" value={toolFor("count")} />
          <DefRow term="Hit calling" value={toolFor("hits")} />
          <DefRow term="Score" value={toolFor("score")} note="Illustrative score; no fitted calibration or interval" />
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
