"use client";

/**
 * The all-screens table.
 *
 * A researcher lands here to find one screen and open it, so the whole row is
 * the link rather than the few characters of its name, and every column a row
 * could be compared on sorts. The progress bar is gone: status, QC and a stage
 * count already said the same thing four ways, and the bar was the one that
 * carried no number.
 *
 * The sorting and row-target primitives are shared with the overview tables so
 * a column behaves the same in both places.
 */

import { Filter, Info } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState } from "react";

import { FDR_THRESHOLD, LIKELY_REAL_THRESHOLD, screens, type ScreenStatus } from "@/lib/mock/data";
import { cn, formatDate, formatNumber } from "@/lib/utils";

import { ROW, ROW_TARGET, SortHeader, useSorted, type Cell } from "./overview-tables";
import { StatusBadge } from "./ui";

type Row = (typeof screens)[number];

const STATUSES: ("all" | ScreenStatus)[] = ["all", "complete", "running", "queued", "failed"];

const cellOf = (screen: Row, key: string): Cell => {
  switch (key) {
    case "name":
      return screen.name;
    case "model":
      return screen.cellLine;
    case "library":
      return screen.library;
    case "phenotype":
      return screen.phenotype;
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

export function ScreensTable() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("all");
  const filterId = useId();
  const statusName = useId();

  const matches = useMemo(
    () =>
      screens.filter(
        (screen) =>
          (status === "all" || screen.status === status) &&
          (query === "" ||
            `${screen.name} ${screen.cellLine} ${screen.library} ${screen.phenotype} ${screen.owner}`
              .toLowerCase()
              .includes(query.toLowerCase())),
      ),
    [query, status],
  );

  const { sorted, sort, toggle } = useSorted<Row>(
    matches,
    { key: "created", dir: "desc" },
    cellOf,
  );

  return (
    <div className="rounded-3xl border border-line bg-white">
      <p className="flex items-start gap-2 rounded-t-3xl border-b border-orange-100 bg-orange-50 px-4 py-3 text-sm text-orange-700 md:px-5">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          Sample data. These {formatNumber(screens.length)} screens, their owners and their hit
          counts are invented to show the layout. None of it is a measurement.
        </span>
      </p>

      <div className="flex flex-col justify-between gap-3 border-b border-line p-4 md:flex-row md:items-end md:p-5">
        <div>
          <label htmlFor={filterId} className="block text-xs uppercase tracking-[0.06em] text-muted">
            Filter screens
          </label>
          <input
            id={filterId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, cell line, library, phenotype or owner"
            className="mt-1.5 w-full rounded-full border border-line px-4 py-2 text-sm outline-none focus:border-cyan-500 md:w-96"
          />
        </div>

        {/* Radio inputs rather than buttons: the five filters are mutually
            exclusive, and a radio group already carries that meaning, one tab
            stop and arrow-key movement without any of it being reimplemented. */}
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="sr-only">Filter by pipeline status</legend>
          <Filter className="h-4 w-4 text-muted" aria-hidden="true" />
          {STATUSES.map((option) => (
            <label
              key={option}
              className={cn(
                "chip cursor-pointer px-3.5 py-2 text-xs capitalize",
                "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-teal-950",
                status === option && "bg-teal-800 text-white",
              )}
            >
              <input
                type="radio"
                name={statusName}
                className="sr-only"
                checked={status === option}
                onChange={() => setStatus(option)}
              />
              {option}
            </label>
          ))}
        </fieldset>
      </div>

      <div className="overflow-x-auto thin-scroll">
        <table className="table-base min-w-[980px]">
          <caption className="sr-only">
            Sample screens, sortable by any column heading. Select a row to open that screen.
          </caption>
          <thead>
            <tr>
              <SortHeader label="Screen" sortKey="name" sort={sort} toggle={toggle} />
              <SortHeader label="Model" sortKey="model" sort={sort} toggle={toggle} />
              <SortHeader label="Library" sortKey="library" sort={sort} toggle={toggle} />
              <SortHeader label="Phenotype" sortKey="phenotype" sort={sort} toggle={toggle} />
              <SortHeader label="Status" sortKey="status" sort={sort} toggle={toggle} />
              <SortHeader label="QC" sortKey="qc" sort={sort} toggle={toggle} />
              <SortHeader
                label="Hits (real / called)"
                sortKey="hits"
                sort={sort}
                toggle={toggle}
                preferred="desc"
              />
              <SortHeader label="Owner" sortKey="owner" sort={sort} toggle={toggle} />
              <SortHeader
                label="Created"
                sortKey="created"
                sort={sort}
                toggle={toggle}
                preferred="desc"
              />
            </tr>
          </thead>
          <tbody>
            {sorted.map((screen) => (
              <tr key={screen.id} className={ROW}>
                <td>
                  <Link
                    href={`/dashboard/screens/${screen.id}`}
                    className={cn("font-medium text-ink hover:text-orange-500", ROW_TARGET)}
                  >
                    {screen.name}
                    <span className="sr-only">, open this screen</span>
                  </Link>
                  <div className="text-xs text-muted">{screen.id}</div>
                </td>
                <td>
                  {screen.cellLine}
                  <div className="text-xs text-muted">
                    {screen.organism} · {screen.modality}
                  </div>
                </td>
                <td>{screen.library}</td>
                <td className="text-sm">{screen.phenotype}</td>
                <td>
                  <StatusBadge status={screen.status} />
                  {screen.status !== "complete" && (
                    <div className="mt-1 whitespace-nowrap text-xs text-muted">
                      {screen.stage} of 9 stages
                    </div>
                  )}
                </td>
                <td>
                  <StatusBadge status={screen.qc} />
                </td>
                <td className="whitespace-nowrap tabular-nums">
                  {screen.status === "complete" ? (
                    `${formatNumber(screen.realHits)} / ${formatNumber(screen.hits)}`
                  ) : (
                    <span className="text-muted">Not called yet</span>
                  )}
                </td>
                <td className="text-sm">{screen.owner}</td>
                <td className="whitespace-nowrap text-sm text-muted">
                  {formatDate(screen.createdAt)}
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={9} className="py-10 text-center text-muted">
                  No screens match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Said out loud, because a filtered table that quietly drops rows is how
          somebody concludes a screen was never uploaded. */}
      <p aria-live="polite" className="border-t border-line px-4 py-3 text-xs text-muted md:px-5">
        Showing {formatNumber(sorted.length)} of {formatNumber(screens.length)} screens. The hits
        column is candidates at a calibrated chance real of{" "}
        {LIKELY_REAL_THRESHOLD.toFixed(2)} or above, over every candidate that cleared
        Benjamini-Hochberg FDR {FDR_THRESHOLD.toFixed(2)}. Both are counted from the screen&apos;s own
        hit table, which is the table its exports carry.
      </p>
    </div>
  );
}
