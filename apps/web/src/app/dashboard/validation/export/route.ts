/**
 * GET /dashboard/validation/export?result=&screen=&q=
 *
 * Every outcome in the caller's workspace that matches the filters on the Truth
 * Loop page, as CSV. It is read with the caller's own session and scoped to the
 * organization that session resolves to, so it can only ever return rows the
 * page could show. The demonstration exports from the browser tab instead and
 * has no server rows to export.
 */
import { NextResponse } from "next/server";

import { getCurrentContext } from "@/lib/data/org";
import { getOutcomeExport } from "@/lib/data/outcomes";
import { outcomesCsv } from "@/lib/outcomes/csv";
import { parseOutcomeFilters } from "@/lib/outcomes/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request): Promise<NextResponse> {
  const context = await getCurrentContext();
  if (!context.user) return fail(401, "authentication_required", "Sign in to export your workspace's outcomes.");

  const filters = parseOutcomeFilters(Object.fromEntries(new URL(request.url).searchParams.entries()));
  const result = await getOutcomeExport(filters);
  if (result.status !== "ready") {
    return result.status === "workspace_required"
      ? fail(403, "workspace_required", "You are not a member of a workspace.")
      : fail(503, "unavailable", "Your outcomes could not be read. Try again.");
  }

  const now = new Date();
  const body = outcomesCsv(result.rows, { filters, generatedAt: now, sample: false, screenLabel: result.screenName });
  const note = result.truncated ? "# truncated: the export stopped at the row limit; narrow the filters to get the rest\r\n" : "";
  return new NextResponse(note ? body.replace("\r\n# read in R", `\r\n${note.trimEnd()}\r\n# read in R`) : body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="splicr-outcomes_${now.toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
