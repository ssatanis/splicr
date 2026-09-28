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
 * Sample exports require an explicit demo session. Workspace export is not
 * connected; signed-in non-demo sessions receive 501 instead of sample results.
 * Anonymous non-demo requests receive 401. Report builders and their sample
 * dependencies are loaded only after the demo check passes.
 *
 * Every sample response keeps the label in its body, headers and filename.
 * Before adding workspace export, replace the sample-only builder with a real
 * run-backed document and retain session/RLS authorization on the requested run.
 */
import { NextResponse } from "next/server";

import { getCurrentContext } from "@/lib/data/org";
import type { ReportSource } from "@/lib/report/document";

/** node:zlib in the PDF writer, and the body depends on the clock. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Only explicit demo sessions can reach the sample renderer.
 * Workspace reports need a separate run-backed document and authorization.
 */
const SERVED_SOURCE: ReportSource = "sample";

const FORMATS = ["csv", "json", "pdf"] as const;
type Format = (typeof FORMATS)[number];

const MEDIA_TYPES: Record<Format, string> = {
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
  pdf: "application/pdf",
};

function fail(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request, ctx: RouteContext<"/api/report/[id]">): Promise<NextResponse> {
  const context = await getCurrentContext();
  if (!context.isDemo) {
    return context.user
      ? fail(501, "workspace_report_unavailable", "Workspace report exports are not connected. Use the scoped Connect hits API for recorded results.")
      : fail(401, "authentication_required", "Sign in to access workspace results. Sample reports require an explicit demo session.");
  }
  const { id } = await ctx.params;
  const requested = new URL(request.url).searchParams.get("format");

  if (requested === null || !(FORMATS as readonly string[]).includes(requested)) {
    return fail(
      400,
      "bad_request",
      `format must be one of ${FORMATS.join(", ")}. For example /api/report/${id}?format=csv.`,
    );
  }
  const format = requested as Format;

  const [{ screens }, { buildReport, reportFilename }, { toCsv }, { toJson }, { toPdf }] = await Promise.all([
    import("@/lib/mock/data"), import("@/lib/report/document"), import("@/lib/report/csv"),
    import("@/lib/report/json"), import("@/lib/report/pdf"),
  ]);
  const screen = screens.find((s) => s.id === id);
  if (!screen) {
    return fail(404, "not_found", `No screen ${id}.`);
  }

  if (screen.status !== "complete") {
    return fail(
      409,
      "not_ready",
      screen.status === "failed"
        ? `${screen.name} failed at stage ${screen.stage + 1} of 9, so it has no hit table to export. Fix the flagged sample and re-run.`
        : `${screen.name} is ${screen.status} at stage ${screen.stage + 1} of 9. A report is only exported once hit calling and scoring have run.`,
    );
  }

  if (SERVED_SOURCE !== "sample") {
    // Unreachable while the constant above is "sample". It is here so that
    // Widening this renderer to workspace data requires a separate authorized
    // data adapter; demo permission cannot authorize workspace records.
    return fail(
      501,
      "not_implemented",
      "This renderer serves explicit demo sessions only. Workspace reports need an authorized run-backed data adapter.",
    );
  }

  const doc = buildReport(screen, SERVED_SOURCE);
  const now = new Date();
  const filename = reportFilename(doc, format, now);

  const headers = new Headers({
    "Content-Type": MEDIA_TYPES[format],
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
    // Named in the response as well as in the file, so a script that pipes the
    // body somewhere still has the label available.
    "X-SplicR-Report-Id": doc.reportId,
    "X-SplicR-Data-Source": doc.source === "sample" ? "sample-dataset" : "workspace",
  });

  if (format === "pdf") {
    const pdf = toPdf(doc, now);
    headers.set("Content-Length", String(pdf.byteLength));
    return new NextResponse(new Uint8Array(pdf), { status: 200, headers });
  }

  const body = format === "csv" ? toCsv(doc, now) : toJson(doc, now);
  return new NextResponse(body, { status: 200, headers });
}
