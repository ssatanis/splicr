/**
 * A workspace asking SplicR to analyse a public accession, and what came of it.
 *
 * The console does not plan, fetch or analyse anything: it records the request
 * and reads back whatever the ingest engine wrote. So the statuses here are the
 * engine's, the sentences beside them are the engine's, and nothing in this
 * module invents a stage or a percentage to fill the gap while a request is
 * queued.
 *
 * Reads and the write both go through the request-scoped Supabase client, so
 * Row Level Security decides what is visible and who may ask. The organization
 * comes from the session and never from the caller.
 */
import "server-only";

import { getCurrentContext } from "@/lib/data/org";
import { createClient } from "@/lib/supabase/server";

import type { ScreenRequest } from "./request-shape";

export type {
  ScreenRequest,
  ScreenRequestStatus,
} from "./request-shape";
export {
  REQUEST_COPY,
  isSupportedAccession,
  normaliseAccession,
} from "./request-shape";

export type ScreenRequestsResult =
  | { status: "found"; requests: ScreenRequest[] }
  | { status: "unavailable" };

/** This workspace's requests, newest first. */
export async function listScreenRequests(limit = 12): Promise<ScreenRequestsResult> {
  const context = await getCurrentContext();
  if (!context.user || !context.org) return { status: "found", requests: [] };
  try {
    const client = await createClient();
    const { data, error } = await client
      .from("screen_requests")
      .select("id, accession, resolved_accession, status, detail, created_at")
      .eq("org_id", context.org.id)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return { status: "found", requests: (data ?? []) as ScreenRequest[] };
  } catch (error) {
    console.error(`[data/screen-requests] ${error instanceof Error ? error.message : "read failed"}`);
    return { status: "unavailable" };
  }
}
