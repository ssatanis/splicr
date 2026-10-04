/**
 * The Validation Network, for a signed-in workspace.
 *
 * A failed read is `unavailable` and never an empty state: "no model is fitted"
 * and "the database did not answer" are different statements and only one of
 * them is good news. The secondary reads degrade to an empty list, because a
 * missing coverage table is a thinner page rather than a wrong one.
 */
import { PageHeader } from "@/components/dashboard/ui";
import { NetworkPanels } from "@/components/dashboard/validation/network-view";
import type { SetupScreen } from "@/components/dashboard/validation/round-setup";
import { WorkspaceReadNotice } from "@/components/dashboard/workspace-records";
import { getCurrentContext } from "@/lib/data/org";
import { createClient } from "@/lib/supabase/server";
import {
  getCoverage,
  getEndpoints,
  getNetworkView,
  getRoundResults,
  getRounds,
} from "@/lib/data/validation-network";

export const metadata = { title: "Validation Network" };
export const dynamic = "force-dynamic";

/**
 * Screens a round can be drawn from: a completed run with recorded candidates.
 *
 * One query. `screen_overview` already carries the run's candidate count, so
 * counting per screen would be a query per row for a figure the database has
 * already computed — and this page runs five reads before it can render, so a
 * read that scales with the workspace is a page that stops arriving.
 *
 * A screen with nothing to rank is left out rather than offered and refused.
 */
async function roundableScreens(): Promise<SetupScreen[]> {
  const context = await getCurrentContext();
  if (!context.org) return [];
  try {
    const client = await createClient();
    const result = await client
      .from("screen_overview")
      .select("id, name, n_hits, run_id, run_status")
      .eq("org_id", context.org.id)
      .not("run_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(50);
    if (result.error) throw result.error;
    const rows = (result.data ?? []) as {
      id: string;
      name: string;
      n_hits: number | string | null;
      run_status: string | null;
    }[];
    return rows
      .map((row) => ({
        id: row.id,
        name: row.name,
        nHits: Number(row.n_hits ?? 0),
        complete: row.run_status === "complete",
      }))
      .filter((screen) => screen.complete && Number.isFinite(screen.nHits) && screen.nHits > 0)
      .map(({ id, name, nHits }) => ({ id, name, nHits }));
  } catch (error) {
    console.error("[validation/network] screen list failed", error);
    return [];
  }
}

const ID = /^[0-9a-fA-F-]{36}$/;

export default async function ValidationNetworkPage(
  props: PageProps<"/dashboard/validation/network">,
) {
  const search = await props.searchParams;
  // `?round=<id>` shows that round's results above everything else, so a result
  // is a link somebody can send rather than a view only the clicker can reach.
  const selected = ((Array.isArray(search.round) ? search.round[0] : search.round) ?? "").trim();

  const [view, strata, endpoints, rounds, screens, results] = await Promise.all([
    getNetworkView(),
    getCoverage(),
    getEndpoints(),
    getRounds(),
    roundableScreens(),
    ID.test(selected) ? getRoundResults(selected) : Promise.resolve(null),
  ]);

  if (view.status !== "ready") {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          dense
          title="Validation Network"
          body="Whether a calibrated probability can be stated, per experiment"
        />
        <WorkspaceReadNotice status={view.status} />
      </div>
    );
  }

  return (
    <NetworkPanels
      view={view}
      strata={strata}
      endpoints={endpoints}
      rounds={rounds}
      screens={screens}
      results={results}
    />
  );
}
