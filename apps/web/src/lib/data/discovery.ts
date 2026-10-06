import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "./org";
import { isUuid } from "./types";
import { blankDocument, buildWorklist, type DiscoveryHit, type Experiment } from "@/lib/discovery/model";
import { discoveryDocumentSchema, type DiscoveryDocument } from "@/lib/discovery/schema";
import { sha256, type DiscoveryReceipt } from "@/lib/discovery/receipt";

export interface DiscoveryScreen { id: string; name: string; current_run_id: string | null; cell_line: string | null; modality: string; taxid: number | null }
export interface DiscoveryComparison { id: string; name: string; kind: string; is_primary: boolean }
export interface DiscoveryBatch { id: string; name: string; frozen_at: string; receipt_sha256: string; receipt: DiscoveryReceipt; screen_id: string; run_id: string; comparison_id: string; input_id: string }
export interface DiscoveryResultRow { id: string; experiment_id: string; decision: string; because: string; measurement: Record<string, unknown>; logged_at: string; outcome_id: string | null }

export async function readDiscoveryHits(screenId: string, runId: string, comparisonId: string): Promise<DiscoveryHit[]> {
  const client = await createClient();
  const hits: DiscoveryHit[] = [];
  const size = 1000;
  const page = (offset: number, count = false) => client.from("hits").select("gene_symbol, lfc, fdr, guide_lfcs, hit_flags(flag)", count ? { count: "exact" } : undefined)
      .eq("screen_id", screenId).eq("run_id", runId).eq("comparison_id", comparisonId)
      .order("gene_symbol").range(offset, offset + size - 1);
  const first = await page(0, true);
  if (first.error || first.count === null) throw new Error("The comparison's recorded hits could not be read.");
  if (first.count > 30_000) throw new Error("This comparison exceeds the supported 30,000-gene import size; no partial worklist was produced.");
  const append = (r: Awaited<ReturnType<typeof page>>) => {
    if (r.error) throw new Error("The comparison's recorded hits could not be read.");
    const rows = r.data ?? [];
    const finite = (v: unknown) => v === null || v === undefined || v === "" || typeof v === "boolean" || !Number.isFinite(Number(v)) ? null : Number(v);
    for (const row of rows) hits.push({ gene: row.gene_symbol, lfc: finite(row.lfc), fdr: finite(row.fdr), guide_lfcs: Array.isArray(row.guide_lfcs) ? row.guide_lfcs : null, flags: (row.hit_flags ?? []).map((f: { flag: string }) => f.flag) });
  };
  append(first);
  // Bounded parallel pages reduce full-screen latency without partial results.
  for (let offset = size; offset < first.count; offset += size * 4) {
    const offsets = [offset, offset + size, offset + size * 2, offset + size * 3].filter((n) => n < first.count!);
    const pages = await Promise.all(offsets.map((n) => page(n)));
    pages.forEach(append);
  }
  if (hits.length !== first.count) throw new Error("The comparison changed while it was being read; reload before building a worklist.");
  return hits;
}

export async function getDiscoverySelection(screenId: string, comparisonId?: string) {
  const context = await getCurrentContext();
  if (!context.user || !context.org) throw new Error("Sign in to a SplicR workspace.");
  if (!isUuid(screenId) || (comparisonId && !isUuid(comparisonId))) throw new Error("Choose a workspace screen and comparison.");
  const client = await createClient();
  const [s, c] = await Promise.all([
    client.from("screens").select("id, name, current_run_id, cell_line, modality, taxid").eq("id", screenId).eq("org_id", context.org.id).maybeSingle(),
    client.from("comparisons").select("id, name, kind, is_primary").eq("screen_id", screenId).order("name"),
  ]);
  if (s.error || c.error) throw new Error("Screen context could not be read.");
  const screen = s.data as DiscoveryScreen | null;
  const comparisons = (c.data ?? []) as DiscoveryComparison[];
  if (!screen) throw new Error("That screen is not in this workspace.");
  const comparison = comparisonId ? comparisons.find((v) => v.id === comparisonId) : comparisons.find((v) => v.is_primary) ?? comparisons[0];
  if (!comparison || !screen.current_run_id) throw new Error("This screen needs a completed run and a recorded comparison.");
  const run = await client.from("runs").select("status").eq("id", screen.current_run_id).eq("screen_id", screenId).eq("org_id", context.org.id).maybeSingle();
  if (run.error || run.data?.status !== "complete") throw new Error("Discovery uses completed runs only.");
  return { context, client, screen, comparisons, comparison, runId: screen.current_run_id };
}

export type DiscoveryView = { status: "ready"; screens: DiscoveryScreen[]; selected: {
  screen: DiscoveryScreen; comparisons: DiscoveryComparison[]; comparison: DiscoveryComparison;
  runId: string; document: DiscoveryDocument; inputId: string | null; inputHash: string | null; experiments: Experiment[]; batches: Omit<DiscoveryBatch, "receipt">[];
} | null; canWrite: boolean; error: string | null } | { status: "workspace_required" | "unavailable" };

export async function getDiscoveryView(screenId?: string, comparisonId?: string): Promise<DiscoveryView> {
  const context = await getCurrentContext();
  if (!context.user || !context.org) return { status: "workspace_required" };
  const client = await createClient();
  const screensResult = await client.from("screens").select("id, name, current_run_id, cell_line, modality, taxid").eq("org_id", context.org.id).eq("status", "complete").order("created_at", { ascending: false }).limit(200);
  if (screensResult.error) return { status: "unavailable" };
  const base = { status: "ready" as const, screens: (screensResult.data ?? []) as DiscoveryScreen[], canWrite: context.role !== null && context.role !== "viewer", error: null };
  if (!screenId) return { ...base, selected: null };
  try {
    const { screen, comparison, comparisons, runId } = await getDiscoverySelection(screenId, comparisonId);
    const [input, batches, hits] = await Promise.all([
      client.from("discovery_inputs").select("id, document, document_sha256").eq("org_id", context.org.id).eq("screen_id", screen.id).eq("run_id", runId).eq("comparison_id", comparison.id).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle(),
      client.from("discovery_batches").select("id, name, frozen_at, receipt_sha256, screen_id, run_id, comparison_id, input_id").eq("org_id", context.org.id).eq("screen_id", screen.id).eq("comparison_id", comparison.id).order("frozen_at", { ascending: false }).limit(30),
      readDiscoveryHits(screen.id, runId, comparison.id),
    ]);
    if (input.error || batches.error) throw new Error("Discovery evidence or frozen batches could not be read. Check the discovery database migration.");
    const document = input.data ? discoveryDocumentSchema.parse(input.data.document) : blankDocument({
      model_id: screen.cell_line ?? "Model identity required", biological_unit: "Patient or biological unit required", lineage: null, subtype: null, culture: "unknown",
      medium: null, matrix: null, library: null, modality: comparison.kind === "treatment_vs_control" ? "drug_modifier" : screen.modality === "crispri" ? "crispri" : ["knockout", "knockout_cas12a"].includes(screen.modality) ? "knockout" : "other", endpoint: null, time_hours: null, effect_metric: "log2_fold_change",
    });
    if (input.data && sha256(input.data.document) !== input.data.document_sha256) throw new Error("Stored evidence integrity verification failed.");
    return { ...base, selected: { screen, comparisons, comparison, runId, document, inputId: input.data?.id ?? null, inputHash: input.data?.document_sha256 ?? null, experiments: buildWorklist(hits, document), batches: (batches.data ?? []) as Omit<DiscoveryBatch, "receipt">[] } };
  } catch (error) {
    return { ...base, selected: null, error: error instanceof Error ? error.message : "Discovery records could not be read." };
  }
}

export async function getDiscoveryBatch(id: string) {
  const context = await getCurrentContext();
  if (!context.user || !context.org || !isUuid(id)) return null;
  const client = await createClient();
  const [b, r] = await Promise.all([
    client.from("discovery_batches").select("id, name, frozen_at, receipt_sha256, receipt, screen_id, run_id, comparison_id, input_id").eq("id", id).eq("org_id", context.org.id).maybeSingle(),
    client.from("discovery_results").select("id, experiment_id, decision, because, measurement, logged_at, outcome_id").eq("batch_id", id).eq("org_id", context.org.id).order("logged_at"),
  ]);
  if (b.error || r.error) throw new Error("Frozen discovery records could not be read.");
  if (!b.data) return null;
  const batch = b.data as DiscoveryBatch;
  if (sha256(batch.receipt) !== batch.receipt_sha256) throw new Error("Frozen receipt integrity verification failed.");
  return { batch, results: (r.data ?? []) as DiscoveryResultRow[], canWrite: context.role !== null && context.role !== "viewer" };
}
