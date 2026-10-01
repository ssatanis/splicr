/**
 * GET /api/v1/screens/{screenId}/genes/{gene}/disagreement
 *
 * The recorded guide-disagreement report for one gene of one screen: how much
 * that gene's guides disagreed against the spread the same screen shows for genes
 * of the same size, whether its call survives dropping one guide, where each
 * guide cut, and the Fisher exact table between depletion and the curated protein
 * feature the depleting guides share.
 *
 * WHY GET AND NOT POST
 *
 * This is a read with no side effect. GET makes it cacheable, linkable and
 * bookmarkable, keeps it out of the CSRF surface, and lets the browser cancel a
 * stale request when the reader clicks a different gene. Nothing is computed
 * here or in the caller: the engine computed the report at analysis time against
 * a named reference release, and this route returns it.
 *
 * WHY IT DOES NOT PROXY THE ENGINE'S OWN API
 *
 * The engine holds the Postgres secret key and bypasses Row Level Security by
 * design (engine/splicr/db.py), so nothing a browser can reach may call it. This
 * route reads the same stored rows under the reader's own session, where RLS
 * applies and the organization comes from the session rather than the URL. The
 * engine's /v1/screens/{id}/genes/{gene}/disagreement route serves the same
 * document to service callers holding a Connect key.
 *
 * Status codes:
 *   200  the recorded report
 *   400  a screen id that is not a uuid, or an empty gene symbol
 *   401  no session
 *   404  a screen the session's organization does not own, or no such screen
 *   409  the run stored no reports, or this gene has none
 *   503  the workspace records could not be read
 */
import { NextResponse } from "next/server";

import { getGeneDisagreement, normaliseSymbol } from "@/lib/data/disagreement";
import { getCurrentContext } from "@/lib/data/org";
import { isUuid } from "@/lib/data/types";

/** A database round trip under the caller's session: never prerender or cache. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/v1/screens/[screenId]/genes/[gene]/disagreement">,
): Promise<NextResponse> {
  const { screenId, gene } = await ctx.params;
  const symbol = normaliseSymbol(decodeURIComponent(gene));
  if (!isUuid(screenId)) {
    return NextResponse.json(
      { error: "screenId must be a screen id, for example 0199f4c2-1f8b-7c31-9a0e-2f4f1d8c77aa." },
      { status: 400 },
    );
  }
  if (symbol.length === 0) {
    return NextResponse.json({ error: "gene must be a gene symbol." }, { status: 400 });
  }

  const context = await getCurrentContext();
  if (!context.user || !context.org) {
    return NextResponse.json({ error: "Sign in to read a workspace screen." }, { status: 401 });
  }

  const result = await getGeneDisagreement(screenId, symbol);
  switch (result.status) {
    case "found":
      return NextResponse.json(
        { report: result.report, recorded_at: result.recordedAt },
        // A stored report for a stored run does not change, so a reader clicking
        // back to a gene does not pay for it twice. Private: it is one
        // workspace's data and must never reach a shared cache.
        { status: 200, headers: { "cache-control": "private, max-age=300" } },
      );
    case "no_report":
      return NextResponse.json(
        {
          error: `${result.gene} has no recorded guide-disagreement report in this screen.`,
          reason: "A gene needs at least two guides with a recorded fold change to have one. "
            + "This says nothing about whether its guides agreed.",
        },
        { status: 409 },
      );
    case "not_analysed":
      return NextResponse.json(
        {
          error: "This screen has no recorded guide-disagreement reports.",
          reason: "They are written by runs analysed after per-guide effects were "
            + "recorded. Re-run the comparison to produce them.",
        },
        { status: 409 },
      );
    case "not_found":
      return NextResponse.json({ error: "No such screen." }, { status: 404 });
    default:
      return NextResponse.json(
        { error: "The workspace records could not be read. Reload to try again." },
        { status: 503 },
      );
  }
}
