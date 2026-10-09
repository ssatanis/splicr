import "server-only";
import { getCurrentContext } from "./org";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "./types";
import { normaliseSymbol } from "./disagreement";
import { isLabReceipt, type LabReceipt } from "@/lib/lab/evidence";

export async function getLabEvidence(screenId: string, gene: string, requestedRun?: string | null, comparison?: string | null) {
  if (!isUuid(screenId) || (requestedRun && !isUuid(requestedRun)) || (comparison && !isUuid(comparison))) return { status: "not_found" as const };
  const symbol = normaliseSymbol(gene);
  if (!symbol) return { status: "not_found" as const };
  const context = await getCurrentContext();
  if (!context.user || !context.org) return { status: "workspace_required" as const };
  try {
    const client = await createClient();
    const screen = await client.from("screens").select("id,current_run_id").eq("id", screenId).eq("org_id", context.org.id).maybeSingle();
    if (screen.error) throw screen.error;
    if (!screen.data) return { status: "not_found" as const };
    const runId = requestedRun ?? screen.data.current_run_id;
    if (!runId) return { status: "not_recorded" as const, records: [] as LabReceipt[] };
    const run = await client.from("runs").select("id,status,settings").eq("id", runId).eq("screen_id", screenId).maybeSingle();
    if (run.error) throw run.error;
    if (!run.data) return { status: "not_found" as const };
    let query = client.from("lab_evidence").select("document,canonical,sha256,comparison_id,created_at")
      .eq("screen_id", screenId).eq("run_id", runId).in("gene_symbol", [symbol, "__SCREEN__"])
      .order("created_at", { ascending: false }).order("sha256");
    if (comparison) query = query.eq("comparison_id", comparison);
    const found = await query.limit(501);
    if (found.error) throw found.error;
    if (!found.data || found.data.length > 500) throw new Error("Evidence history exceeds the per-gene limit; narrow the comparison");
    const records = found.data.map(row => ({ ...row.document, canonical: row.canonical, sha256: row.sha256, comparison_id: row.comparison_id, recorded_at: row.created_at }));
    if (!records.every(isLabReceipt)) throw new Error("Recorded evidence has an unsupported schema");
    return { status: records.length ? "ready" as const : "not_recorded" as const, records: records as LabReceipt[], run_id: runId, settings: run.data.settings };
  } catch (error) {
    console.error(`[lab-evidence] ${error instanceof Error ? error.message : "read failed"}`);
    return { status: "unavailable" as const };
  }
}
