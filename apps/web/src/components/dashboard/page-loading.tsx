import { Panel, Skeleton, TableSkeleton } from "./ui";

/**
 * Shown while a page that reads the workspace database is being prepared.
 * Rows the size of the rows that are coming, so the panel does not change height
 * when the data lands and nothing below it jumps.
 *
 * It is attached only to the routes that query the workspace (screens, one
 * screen, the Truth Loop). The Atlas, Planner and Connect pages read no database
 * and answer at once, and a skeleton on them would be a flicker between two pages
 * that are both instant.
 */
export function PageLoading() {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Loading the page">
      <div className="flex items-center gap-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3 w-72" />
      </div>
      <Panel title={<Skeleton className="h-3 w-28" />} body="flush" className="min-h-[320px]">
        <TableSkeleton rows={8} cols={5} />
      </Panel>
    </div>
  );
}
