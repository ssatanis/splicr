/** Paginated workspace records. Errors remain distinct from successful empty reads. */
import "server-only";

import { getCurrentContext } from "@/lib/data/org";
import { createClient } from "@/lib/supabase/server";

export const WORKSPACE_PAGE_SIZE = 50;

export interface ScreenListRow {
  id: string;
  name: string;
  cell_line: string | null;
  phenotype: string | null;
  modality: string;
  status: string;
  qc: string;
  created_at: string;
}

export type WorkspaceListResult<T> =
  | { status: "ready"; rows: T[]; total: number; page: number }
  | { status: "workspace_required" | "unavailable" | "invalid_page" };

async function readList<T>(table: "screens", columns: string, date: string, page: number): Promise<WorkspaceListResult<T>> {
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) return { status: "invalid_page" };
  const context = await getCurrentContext();
  if (context.isDemo || !context.user || !context.org) return { status: "workspace_required" };
  try {
    const client = await createClient();
    const result = await client.from(table).select(columns, { count: "exact" })
      .eq("org_id", context.org.id).order(date, { ascending: false }).order("id")
      .range((page - 1) * WORKSPACE_PAGE_SIZE, page * WORKSPACE_PAGE_SIZE - 1);
    if (result.error) throw result.error;
    if (!Array.isArray(result.data) || result.count === null) return { status: "unavailable" };
    return { status: "ready", rows: result.data as T[], total: result.count, page };
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "read_error";
    console.error(`[data/workspace-lists] ${code}`);
    return { status: "unavailable" };
  }
}

export function getWorkspaceScreens(page = 1): Promise<WorkspaceListResult<ScreenListRow>> {
  return readList("screens", "id, name, cell_line, phenotype, modality, status, qc, created_at", "created_at", page);
}
