/**
 * GET /dashboard/atlas/export
 *
 *   ?<the Atlas page's own filters>            every screen matching them, as CSV
 *   ?kind=hits&screen=<id>                     the genes one screen's authors called
 *
 * The export is exactly the view the reader is looking at, with no page limit:
 * the address that produced the table produces the file. The proxy gates the
 * route like every other /dashboard path, and the Atlas is public reference
 * data, so it reads no workspace row.
 *
 * An empty result is still a file with a header and a preamble, never a 404:
 * "no screen matches" is a finding, and a script has to be able to tell it from
 * a broken link.
 */
import { NextResponse } from "next/server";

import { hitsCsv, screensCsv } from "@/lib/atlas/csv";
import { parseScreenQuery } from "@/lib/atlas/params";
import { allScreenHits, queryScreens } from "@/lib/atlas/query";
import { getAtlasGenes, getAtlasManifest, getAtlasScreenMap, getAtlasScreens } from "@/lib/atlas/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, message: string): NextResponse {
  return NextResponse.json({ error: { message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const manifest = getAtlasManifest();
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const headers = (name: string) =>
    new Headers({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    });

  if (url.searchParams.get("kind") === "hits") {
    const raw = url.searchParams.get("screen") ?? "";
    if (!/^\d{1,7}$/.test(raw)) return fail(400, "screen must be a screen id, for example ?kind=hits&screen=1.");
    const screen = getAtlasScreenMap().get(Number(raw));
    if (!screen) return fail(404, `No Atlas screen ${raw}.`);
    const symbols = allScreenHits(getAtlasGenes(), screen.id);
    return new NextResponse(hitsCsv(screen, symbols, manifest, now), {
      status: 200,
      headers: headers(`splicr-atlas-screen-${screen.id}-genes_orcs-${manifest.release}_${day}.csv`),
    });
  }

  const query = parseScreenQuery(Object.fromEntries(url.searchParams.entries()));
  const genes = query.gene !== null ? getAtlasGenes() : null;
  const everything = queryScreens(getAtlasScreens(), genes, query, Number.MAX_SAFE_INTEGER);
  return new NextResponse(screensCsv(everything.rows, manifest, query, now), {
    status: 200,
    headers: headers(`splicr-atlas-screens_orcs-${manifest.release}_${day}.csv`),
  });
}
