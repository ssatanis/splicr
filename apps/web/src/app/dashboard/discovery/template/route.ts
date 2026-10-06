import { getDiscoveryView } from "@/lib/data/discovery";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  const view = await getDiscoveryView(search.get("screen") ?? undefined, search.get("comparison") ?? undefined);
  if (view.status !== "ready" || !view.selected) return new Response("Screen evidence is unavailable in this workspace", { status: 404 });
  return new Response(JSON.stringify(view.selected.document, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="splicr-discovery-evidence.json"', "Cache-Control": "private, no-store" } });
}
