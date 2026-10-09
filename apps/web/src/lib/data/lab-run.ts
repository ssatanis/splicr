import "server-only";
import { getCurrentContext } from "./org";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "./types";
import { normaliseSymbol } from "./disagreement";
import { getLabEvidence } from "./lab-evidence";
export async function getLabRun(runId: string, gene: string, comparison?: string) {
  if (!isUuid(runId) || (comparison && !isUuid(comparison))) return { status: "not_found" as const };
  const context = await getCurrentContext();
  if (!context.user || !context.org) return { status: "workspace_required" as const };
  try {
    const client = await createClient();
    const run = await client.from("runs").select("id,screen_id,status,settings,created_at,finished_at,engine_version,image_digest").eq("id", runId).eq("org_id", context.org.id).maybeSingle();
    if (run.error) throw run.error;
    if (!run.data) return { status: "not_found" as const };
    const screen = await client.from("screens").select("id,name,cell_line,phenotype,current_run_id").eq("id", run.data.screen_id).eq("org_id", context.org.id).maybeSingle();
    if (screen.error) throw screen.error;
    if (!screen.data) return { status: "not_found" as const };
    let hitQuery = client.from("hits").select("*,hit_flags(flag,severity,message)").eq("run_id", runId).eq("screen_id", screen.data.id).eq("gene_symbol", normaliseSymbol(gene));
    if (comparison) hitQuery = hitQuery.eq("comparison_id", comparison);
    const [hits, qc, stages, evidence] = await Promise.all([
      hitQuery.limit(501), client.from("run_qc").select("*").eq("run_id", runId).maybeSingle(),
      client.from("run_stages").select("stage,status,detail,metrics,tool").eq("run_id", runId).order("position"),
      getLabEvidence(screen.data.id, gene, runId, comparison),
    ]);
    if (hits.error || qc.error || stages.error || !hits.data || hits.data.length > 500) throw new Error("Run evidence could not be read completely");
    return { status: "ready" as const, screen: screen.data, run: run.data, hits: hits.data, qc: qc.data, stages: stages.data, evidence };
  } catch (error) {
    console.error(`[lab-run] ${error instanceof Error ? error.message : "read failed"}`);
    return { status: "unavailable" as const };
  }
}
