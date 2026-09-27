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
 * Data source, and why this route has no authentication on it. The workspace
 * database is unreachable, so the only source wired up is the sample dataset the
 * console ships with. Nothing here is anybody's data: every response says so in
 * its own body, with a preamble line in the CSV, `sample_data: true` in the JSON,
 * a banner on page 1 and a footer on every page of the PDF, and `_SAMPLE` in the
 * filename. That is what makes an unauthenticated handler acceptable today and
 * only today.
 *
 * `SERVED_SOURCE` is the guard rather than a comment. The moment a workspace
 * query is wired up, this route serves rows that belong to somebody, and it
 * needs the bearer-key check /api/v1/hits already implements. Changing the
 * constant without adding that check fails the assertion below rather than
 * quietly publishing a lab's hit table.
 */
import { NextResponse } from "next/server";

import { screens } from "@/lib/mock/data";
import { toCsv } from "@/lib/report/csv";
import { buildReport, reportFilename, type ReportSource } from "@/lib/report/document";
import { toJson } from "@/lib/report/json";
import { toPdf } from "@/lib/report/pdf";

/** node:zlib in the PDF writer, and the body depends on the clock. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The only source this handler is allowed to serve while it is unauthenticated.
 * See the note above before widening it.
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
    // pointing this route at a workspace without adding the bearer-key check
    // returns a 501 instead of a lab's hit table to an anonymous caller.
    return fail(
      501,
      "not_implemented",
      "This route serves the sample dataset only. Serving a workspace report needs the Connect bearer-key check that /api/v1/hits implements.",
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
