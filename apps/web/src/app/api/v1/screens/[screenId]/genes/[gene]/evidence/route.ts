import { getLabEvidence } from "@/lib/data/lab-evidence";
import { labEvidenceFiles, labEvidenceBundle } from "@/lib/report/lab-evidence-export";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ screenId: string; gene: string }> }) {
  const { screenId, gene } = await context.params;
  const params = new URL(request.url).searchParams;
  const result = await getLabEvidence(screenId, gene, params.get("run"), params.get("comparison"));
  const headers = { "cache-control": "private, no-store" };
  if (result.status === "ready" || result.status === "not_recorded") {
    if (params.has("receipt") && result.status === "ready") {
      const record = result.records.find(r => r.sha256 === params.get("receipt"));
      if (!record) return Response.json({ error: "No recorded receipt matches this selection." }, { status: 404, headers });
      const format = params.get("format") ?? "receipt";
      const figure = params.get("figure") ?? "1";
      if (!["receipt", "canonical", "svg", "pdf", "spec"].includes(format) || !/^[1-9][0-9]?$/.test(figure))
        return Response.json({ error: "Choose a recorded figure and a supported download format." }, { status: 400, headers });
      const files = labEvidenceFiles([record], { screen_id: screenId, run_id: result.run_id });
      const suffix = format === "receipt" ? "/receipt.json" : format === "canonical" ? "/receipt.canonical.json" : `/figure-${figure}.${format === "spec" ? "spec.json" : format}`;
      const entry = Object.entries(files).find(([name]) => name.endsWith(suffix));
      if (!entry) return Response.json({ error: "This receipt has no such recorded figure." }, { status: 404, headers });
      if (entry[1].byteLength > 4_000_000) return Response.json({ error: "This individual figure exceeds the response size limit." }, { status: 413, headers });
      return new Response(new Uint8Array(entry[1]), { headers: { ...headers,
        "content-type": format === "pdf" ? "application/pdf" : format === "svg" ? "image/svg+xml" : "application/json",
        "content-disposition": `attachment; filename="${record.gene}-${record.kind}-${record.sha256.slice(0,12)}-${entry[0].split("/").at(-1)}"` } });
    }
    if (params.get("download") === "zip" && result.status === "ready") {
      const bytes = labEvidenceBundle(result.records, { screen_id: screenId, run_id: result.run_id, gene, settings: result.settings });
      if (bytes.byteLength > 4_000_000) return Response.json({ error: "This bundle exceeds the response size limit. Download individual receipts and figures instead; no partial ZIP was returned." }, { status: 413, headers });
      return new Response(new Uint8Array(bytes), { headers: { ...headers, "content-type": "application/zip", "content-disposition": 'attachment; filename="SplicR-gene-evidence.zip"' } });
    }
    return Response.json(result, { headers });
  }
  return Response.json(result, { status: result.status === "workspace_required" ? 401 : result.status === "not_found" ? 404 : 503, headers });
}
