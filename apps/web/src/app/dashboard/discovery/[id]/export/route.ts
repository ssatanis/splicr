import { getDiscoveryBatch } from "@/lib/data/discovery";
import { canonicalJson } from "@/lib/discovery/receipt";
import { blindedWorksheet } from "@/lib/discovery/export";

export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const view = await getDiscoveryBatch(id);
    if (!view) return new Response("Batch not found", { status: 404 });
    const format = new URL(request.url).searchParams.get("format") ?? "json";
    if (format !== "json" && format !== "blind") return new Response("Choose json or blind", { status: 400 });
    const csv = format === "blind";
    const body = csv ? blindedWorksheet(view.batch.receipt) : canonicalJson({ receipt: view.batch.receipt, sha256: view.batch.receipt_sha256, outcomes: view.results });
    return new Response(body, { headers: { "Content-Type": csv ? "text/csv; charset=utf-8" : "application/json", "Content-Disposition": `attachment; filename="discovery-${id}.${csv ? "csv" : "json"}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { return new Response("Discovery export unavailable", { status: 503 }); }
}
