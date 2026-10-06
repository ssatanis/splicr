import { exportRequestSchema } from "@/lib/report/export-options";
import { ExportError, getScreensExport } from "@/lib/data/screens-export";
import { serializeScreensExport } from "@/lib/report/screens-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Export requests must originate from this application." }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > 32_768) return Response.json({ error: "Export options are too large." }, { status: 413 });
  let parsed;
  try { parsed = exportRequestSchema.safeParse(await request.json()); }
  catch { return Response.json({ error: "Provide valid export options." }, { status: 400 }); }
  if (!parsed.success) return Response.json({ error: "Select valid screens, columns, sections and row filters." }, { status: 400 });
  try {
    const screens = await getScreensExport(parsed.data);
    const output = await serializeScreensExport(screens, parsed.data);
    return new Response(output.bytes as BodyInit, { headers: {
      "Content-Type": output.contentType,
      "Content-Disposition": `attachment; filename="${output.filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    if (error instanceof ExportError) return Response.json({ error: error.message }, { status: error.status });
    console.error("[screens/export] Export could not be generated.");
    return Response.json({ error: "The export could not be generated safely. Try JSON, fewer screens, or fewer evidence sections." }, { status: 503 });
  }
}
