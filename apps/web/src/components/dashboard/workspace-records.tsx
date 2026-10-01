/** Shared presentation for real records; no sample data or invented metrics. */
import Link from "next/link";

import { WORKSPACE_PAGE_SIZE, type WorkspaceListResult } from "@/lib/data/workspace-lists";

import { Card } from "./ui";

export function WorkspaceReadNotice({ status }: { status: Exclude<WorkspaceListResult<never>["status"], "ready"> }) {
  return <Card title={status === "unavailable" ? "Records unavailable" : status === "invalid_page" ? "Invalid page" : "Workspace required"}>
    <p className="text-sm">{status === "unavailable"
      ? "Your workspace records could not be read. Reload to try again."
      : status === "invalid_page"
        ? "Open the first page to view these records."
        : "Sign in to an account with an active workspace to view its records."}</p>
  </Card>;
}

export function RecordPages({ path, page, total }: { path: string; page: number; total: number }) {
  return <nav aria-label="Record pages" className="mt-4 flex gap-4 text-sm">
    {page > 1 && <Link className="underline" href={`${path}?page=${page - 1}`}>Previous</Link>}
    {page > 1 && <Link className="underline" href={path}>First page</Link>}
    <span>Page {page}, {WORKSPACE_PAGE_SIZE} records per page</span>
    {page * WORKSPACE_PAGE_SIZE < total && <Link className="underline" href={`${path}?page=${page + 1}`}>Next</Link>}
  </nav>;
}
