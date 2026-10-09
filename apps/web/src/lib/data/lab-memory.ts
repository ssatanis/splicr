import "server-only";
import { getAtlasGenes } from "@/lib/atlas/store";
import { resolveGene, isMemoryPayload } from "@/lib/lab/memory";
import { getCurrentContext } from "./org";
import { createClient } from "@/lib/supabase/server";

export async function getLabMemory(raw: string, history = false, page = 1, all = false) {
  const resolution = resolveGene(raw, getAtlasGenes());
  if (!resolution.symbol) return { status: "choose_gene" as const, resolution };
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) return { status: "invalid_page" as const, resolution };
  const context = await getCurrentContext();
  if (!context.user || !context.org) return { status: "workspace_required" as const, resolution };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc("lab_gene_memory", {
      p_org: context.org.id, p_gene: resolution.symbol, p_history: history, p_offset: all ? 0 : (page - 1) * 100, p_limit: all ? 50000 : 100,
    });
    if (error || !isMemoryPayload(data)) throw error ?? new Error("Invalid memory document");
    if (all && data.total !== data.rows.length) throw new Error("Memory export exceeds 50,000 entries; no partial master table was produced");
    return { status: "ready" as const, resolution, data, page, history };
  } catch (error) {
    console.error(`[lab-memory] ${error instanceof Error ? error.message : "read failed"}`);
    return { status: "unavailable" as const, resolution };
  }
}
