/**
 * The Atlas corpus as one dense table.
 *
 * A Server Component: the address is the state, so a sort is a link and a page
 * is a link, both of which work without JavaScript, open in a new tab and can
 * be sent to a colleague. Only the filter bar above it is a client component.
 */
import { ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-react";
import Link from "next/link";

import { defaultDirection, hrefWith } from "@/lib/atlas/params";
import { atlasScreenHref, conditionLabel, modalityLabel, publicationLabel } from "@/lib/atlas/links";
import type { AtlasScreen, ScreenQuery, ScreenSortKey } from "@/lib/atlas/types";
import { cn, formatNumber } from "@/lib/utils";

import { ABOVE_ROW_LINK, ROW_LINK } from "../console";
import { DenseTable, ROW_HIT } from "../ui";

const COLUMNS: {
  key: ScreenSortKey;
  label: string;
  align?: "right";
  title?: string;
}[] = [
  { key: "author", label: "Publication" },
  { key: "cellLine", label: "Cell line" },
  { key: "phenotype", label: "Phenotype" },
  { key: "modality", label: "Modality" },
  { key: "library", label: "Library" },
  { key: "nGenes", label: "Genes", align: "right", title: "Genes with a score in the record. For a hit-list-only screen, the genes listed." },
  { key: "nHits", label: "Called", align: "right", title: "Genes the original authors called a hit, by their own rule" },
  { key: "year", label: "Year", align: "right" },
];

function SortLinkTh({
  column,
  query,
  basePath,
}: {
  column: (typeof COLUMNS)[number];
  query: ScreenQuery;
  basePath: string;
}) {
  const active = query.sort === column.key;
  const nextDir = active ? (query.dir === "asc" ? "desc" : "asc") : defaultDirection(column.key);
  const Icon = !active ? ChevronsUpDown : query.dir === "asc" ? ChevronUp : ChevronDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (query.dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn(column.align === "right" && "num-col")}
    >
      <Link
        href={hrefWith(basePath, query, { sort: column.key, dir: nextDir })}
        replace
        scroll={false}
        title={column.title}
        className={cn(
          "inline-flex h-7 w-full items-center gap-1 rounded-sm uppercase tracking-[0.06em]",
          column.align === "right" ? "justify-end" : "justify-start",
          active ? "text-ink" : "text-muted hover:text-ink",
        )}
      >
        {column.label}
        <Icon className={cn("h-3 w-3 shrink-0", active ? "opacity-100" : "opacity-45")} aria-hidden="true" />
        <span className="sr-only">
          {active ? `, sorted ${query.dir === "asc" ? "ascending" : "descending"}, select to reverse` : ", select to sort"}
        </span>
      </Link>
    </th>
  );
}

function Clip({ children, width, title }: { children: React.ReactNode; width: string; title?: string }) {
  return (
    <span className={cn("block truncate", width)} title={title}>
      {children}
    </span>
  );
}

export function AtlasScreensTable({
  rows,
  query,
  basePath,
}: {
  rows: AtlasScreen[];
  query: ScreenQuery;
  basePath: string;
}) {
  return (
    <DenseTable minWidth={900}>
      <caption className="sr-only">
        BioGRID ORCS screens, sortable by column heading. Select a row to open the screen&apos;s record.
      </caption>
      <thead>
        <tr>
          {COLUMNS.map((column) => (
            <SortLinkTh key={column.key} column={column} query={query} basePath={basePath} />
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((screen) => {
          const condition = conditionLabel(screen);
          return (
            <tr key={screen.id} className={ROW_HIT}>
              <td>
                <Link
                  href={atlasScreenHref(screen.id)}
                  title={`${publicationLabel(screen)}, screen ${screen.id}`}
                  className={cn("block max-w-[190px] truncate font-medium text-ink hover:text-orange-600", ROW_LINK)}
                >
                  {publicationLabel(screen)}
                  <span className="ml-1.5 text-[11px] font-normal text-muted">#{screen.id}</span>
                  <span className="sr-only">, open this screen&apos;s record</span>
                </Link>
              </td>
              <td>
                <Link
                  href={hrefWith(basePath, query, { cell: screen.cellLine })}
                  replace
                  scroll={false}
                  title={`${screen.cellLine ?? "Not recorded"}${screen.cellType ? `, ${screen.cellType}` : ""}. Filter to this cell line.`}
                  className={cn("block max-w-[110px] truncate text-body hover:text-orange-600", ABOVE_ROW_LINK)}
                >
                  {screen.cellLine ?? "Not recorded"}
                </Link>
              </td>
              <td>
                <Clip width="max-w-[200px]" title={[screen.phenotype, condition, screen.setup].filter(Boolean).join(" · ")}>
                  {screen.phenotype ?? "Not recorded"}
                  {condition && <span className="ml-1.5 text-[11px] text-muted">{condition}</span>}
                </Clip>
              </td>
              <td>
                <Clip width="max-w-[84px]" title={screen.enzyme ? `${modalityLabel(screen.modality)}, ${screen.enzyme}` : modalityLabel(screen.modality)}>
                  {modalityLabel(screen.modality)}
                </Clip>
              </td>
              <td>
                <Clip width="max-w-[160px]" title={screen.library ?? undefined}>
                  {screen.library ?? "Not recorded"}
                </Clip>
              </td>
              <td className="num-col">{screen.nGenes === null ? "Not recorded" : formatNumber(screen.nGenes)}</td>
              <td className="num-col">
                {screen.nHits === null ? "Not recorded" : formatNumber(screen.nHits)}
              </td>
              <td className="num-col">{screen.year ?? "Not recorded"}</td>
            </tr>
          );
        })}
        {rows.length === 0 && (
          <tr>
            <td colSpan={COLUMNS.length} className="px-4 py-10 text-center text-muted">
              No screen matches these filters.{" "}
              <Link
                href={hrefWith(basePath, query, {
                  q: null, modality: null, phenotype: null, screenType: null, setup: null,
                  cell: null, from: null, to: null, hits: null,
                })}
                replace
                className="text-cyan-600 underline decoration-line-strong underline-offset-2"
              >
                Clear the filters
              </Link>
            </td>
          </tr>
        )}
      </tbody>
    </DenseTable>
  );
}

/** Previous, next and where the reader is. Links, so they work anywhere a link does. */
export function AtlasPager({
  page,
  pages,
  total,
  pageSize,
  query,
  basePath,
}: {
  page: number;
  pages: number;
  total: number;
  pageSize: number;
  query: ScreenQuery;
  basePath: string;
}) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  const link = "rounded px-1.5 py-0.5 text-cyan-600 hover:bg-cyan-50";
  const off = "rounded px-1.5 py-0.5 text-muted/60";
  return (
    <nav aria-label="Pages" className="flex shrink-0 items-center gap-2 text-[11px] text-muted">
      <span className="num" aria-live="polite">
        {first === 0 ? "No rows" : `${formatNumber(first)}–${formatNumber(last)} of ${formatNumber(total)}`}
      </span>
      {page > 1 ? (
        <Link className={link} href={hrefWith(basePath, query, { page: page - 1 })} replace scroll={false} rel="prev">
          Previous
        </Link>
      ) : (
        <span className={off} aria-disabled="true">Previous</span>
      )}
      <span className="num">
        Page {page} of {pages}
      </span>
      {page < pages ? (
        <Link className={link} href={hrefWith(basePath, query, { page: page + 1 })} replace scroll={false} rel="next">
          Next
        </Link>
      ) : (
        <span className={off} aria-disabled="true">Next</span>
      )}
    </nav>
  );
}
