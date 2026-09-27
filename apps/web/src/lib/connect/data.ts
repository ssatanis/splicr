/**
 * Server side reads the Connect page needs and the shared data layer does not
 * provide. Kept here rather than added to lib/data/org.ts so two agents editing
 * the workspace at once cannot collide.
 */
import "server-only";

import { headers } from "next/headers";

import { DEMO_ORG_ID, isUuid } from "@/lib/data/types";
import { supabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export interface ConnectScreen {
  id: string;
  name: string;
  n_hits: number;
  status: string;
}

interface ScreenRow {
  id: string;
  name: string;
  n_hits: number | null;
  status: string | null;
}

/**
 * A few of the workspace's own screens, newest first, for the endpoint examples.
 *
 * Reads run as the signed-in user, so Row Level Security decides what comes
 * back. `org_id` is filtered explicitly as well, because the screens policy also
 * exposes public screens from other workspaces and an example URL has to point
 * at a screen this key would actually be allowed to read.
 */
export async function listConnectScreens(orgId: string, limit = 8): Promise<ConnectScreen[]> {
  if (!isUuid(orgId) || orgId === DEMO_ORG_ID || !supabaseConfigured) return [];

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("screens")
      .select("id, name, n_hits, status")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error(`[connect/data] listConnectScreens: ${error.message}`);
      return [];
    }

    const rows: ScreenRow[] = Array.isArray(data) ? (data as ScreenRow[]) : [];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      n_hits: row.n_hits ?? 0,
      status: row.status ?? "draft",
    }));
  } catch (error) {
    console.error(
      `[connect/data] listConnectScreens: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}

/**
 * The scheme and host this page was requested on, with no trailing slash.
 *
 * Snippets are built from this rather than from a constant, so a key copied out
 * of a preview deployment or out of localhost calls the instance it came from.
 * `x-forwarded-*` wins when a proxy set it, which is the case behind Vercel.
 */
export async function requestOrigin(): Promise<string> {
  const headerList = await headers();

  const forwardedHost = headerList.get("x-forwarded-host");
  const host = forwardedHost ?? headerList.get("host");

  if (!host) return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ?? "https://splicr.org";

  const forwardedProto = headerList.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto =
    forwardedProto ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");

  return `${proto}://${host}`;
}
