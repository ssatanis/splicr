/**
 * GET /api/report/<screen id>?format=csv|json|pdf
 *
 * The Hit Report, as a file. One handler for all three formats because all three
 * are the same document: `buildReport` assembles it once and the three
 * serialisers render it, so a CSV can never disagree with the PDF or with the
 * Report tab that linked to it.
 *
 *   csv   the ranked hit table as a supplementary table, one row per gene
 *   json  the same rows plus the full provenance record, for a pipeline
 *   pdf   a printable report, generated in process with no native dependency
 *
 * What it refuses, and why it refuses rather than serving something empty. A
 * screen that has not finished gets a 409 and a sentence saying which stage it
 * stopped at. An unknown screen gets a 404. A bad format gets a 400 naming the
 * three that exist. None of them return a zero-row file, because a researcher who
 * downloads a table with no rows in it has no way to tell a screen with no hits
 * from a pipeline that never ran.
 *
 * Sample exports require an explicit demo session, and only they load the sample
 * builders. A signed-in workspace member gets the recorded results of the
 * screen's current run as CSV or JSON, read with their own session and scoped to
 * their organization (see lib/data/screen-report.ts); a screen from another
 * workspace is a 404, indistinguishable from one that does not exist. PDF is not
 * built for workspace runs and says so with a 501 rather than serving a sample.
 * Anonymous non-demo requests receive 401.
 *
 * Every sample response keeps the label in its body, headers and filename, and
 * a workspace file never carries one.
 */
import { NextResponse } from "next/server";

import { getCurrentContext } from "@/lib/data/org";

/** node:zlib in the PDF writer, and the body depends on the clock. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FORMATS = ["csv", "json", "pdf"] as const;
type Format = (typeof FORMATS)[number];

const MEDIA_TYPES: Record<Format, string> = {
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
  pdf: "application/pdf",
};

/** The recorded run of one workspace screen, as a file. Never touches a sample. */
async function workspaceReport(request: Request, ctx: RouteContext<"/api/report/[id]">): Promise<NextResponse> {
  const { id } = await ctx.params;
  const requested = new URL(request.url).searchParams.get("format");
  if (requested === null || !(FORMATS as readonly string[]).includes(requested)) {
    return fail(400, "bad_request", `format must be one of ${FORMATS.join(", ")}. For example /api/report/${id}?format=csv.`);
  }
  if (requested === "pdf") {
    return fail(501, "workspace_pdf_unavailable", "A PDF is not built for workspace runs. Export CSV or JSON, or use the Connect hits API.");
  }

  const [{ getScreenReportData }, { workspaceCsv, workspaceFilename, workspaceJson }] = await Promise.all([
    import("@/lib/data/screen-report"),
    import("@/lib/report/workspace"),
  ]);
  const result = await getScreenReportData(id);
  if (result.status === "not_found") return fail(404, "not_found", `No screen ${id} in your workspace.`);
  if (result.status === "workspace_required") return fail(403, "workspace_required", "You are not a member of a workspace.");
  if (result.status === "unavailable") return fail(503, "unavailable", "The screen's results could not be read. Try again.");

  const { data } = result;
  if (!data.run) {
    return fail(409, "not_ready", `${data.screen.name} has no recorded run yet, so there is no hit table to export.`);
  }

  const now = new Date();
  const format = requested as "csv" | "json";
  const body = format === "csv" ? workspaceCsv(data, now) : workspaceJson(data, now);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": MEDIA_TYPES[format],
      "Content-Disposition": `attachment; filename="${workspaceFilename(data, format, now)}"`,
      "Cache-Control": "no-store",
      "X-SplicR-Data-Source": "workspace",
      ...(data.truncated ? { "X-SplicR-Truncated": "true" } : {}),
    },
  });
}

function fail(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request, ctx: RouteContext<"/api/report/[id]">): Promise<NextResponse> {
  const context = await getCurrentContext();
  if (!context.user) {
    return fail(401, "authentication_required", "Sign in to access workspace results.");
  }
  return workspaceReport(request, ctx);
}
