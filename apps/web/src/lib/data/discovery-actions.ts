"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getCurrentContext, getOrgRole } from "./org";
import { isUuid, ROLE_RANK } from "./types";
import { getDiscoveryBatch, getDiscoverySelection, readDiscoveryHits } from "./discovery";
import { parseDiscoveryDocument, batchDesignSchema, discoveryResultSchema, discoveryDocumentSchema } from "@/lib/discovery/schema";
import { buildWorklist, selectBatch } from "@/lib/discovery/model";
import { canonicalJson, sha256, type DiscoveryReceipt } from "@/lib/discovery/receipt";
import { decideEndpoint, endpointByKey, type EndpointDefinition } from "@/lib/validation/endpoint";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
async function authorize() {
  const context = await getCurrentContext();
  if (!context.user || !context.org) throw new Error("Sign in to a SplicR workspace.");
  const role = await getOrgRole(context.org.id, context.user.id);
  if (role === null || ROLE_RANK[role] < ROLE_RANK.member) throw new Error("The member role is required to record discovery evidence or experiments.");
  return { userId: context.user.id, orgId: context.org.id };
}
function failure(error: unknown): { ok: false; error: string } {
  return { ok: false, error: error instanceof Error ? error.message : "The database refused this discovery change. Reload and retry." };
}
function refresh() { revalidatePath("/dashboard", "layout"); }

export async function saveDiscoveryEvidence(input: { screenId: string; comparisonId: string; runId: string; document: string }): Promise<Result<{ inputId: string }>> {
  try {
    const auth = await authorize();
    const document = parseDiscoveryDocument(input.document);
    const scope = await getDiscoverySelection(input.screenId, input.comparisonId);
    if (scope.runId !== input.runId) throw new Error("This screen has a newer run. Reload before importing evidence.");
    if (document.context.model_id === "Model identity required" || document.context.biological_unit === "Patient or biological unit required") throw new Error("Record the model and independent patient or biological unit identity before saving evidence.");
    if (scope.screen.cell_line && document.context.model_id !== scope.screen.cell_line) throw new Error("The evidence model identity must match the screen's recorded model.");
    const expected = scope.comparison.kind === "treatment_vs_control" ? "drug_modifier" : scope.screen.modality === "crispri" ? "crispri" : ["knockout", "knockout_cas12a"].includes(scope.screen.modality) ? "knockout" : "other";
    if (document.context.modality !== expected || document.context.effect_metric !== "log2_fold_change") throw new Error("The evidence context must use this comparison's recorded modality and log2 fold-change scale. Chronos and other scales may be stored on references but are not pooled with local LFCs.");
    const r = await scope.client.from("discovery_inputs").insert({ org_id: auth.orgId, screen_id: scope.screen.id, run_id: scope.runId, comparison_id: scope.comparison.id, document, canonical_document: canonicalJson(document), document_sha256: sha256(document), created_by: auth.userId }).select("id").single();
    if (r.error) throw r.error;
    refresh(); return { ok: true, inputId: r.data.id };
  } catch (error) { return failure(error); }
}

export async function freezeDiscoveryBatch(input: { inputId: string; design: unknown }): Promise<Result<{ batchId: string }>> {
  try {
    const auth = await authorize();
    if (!isUuid(input.inputId)) throw new Error("Save an evidence snapshot before freezing the worklist.");
    const design = batchDesignSchema.parse(input.design);
    const context = await getCurrentContext();
    const { createClient } = await import("@/lib/supabase/server");
    const client = await createClient();
    const r = await client.from("discovery_inputs").select("id, screen_id, run_id, comparison_id, document, document_sha256").eq("id", input.inputId).eq("org_id", auth.orgId).maybeSingle();
    if (r.error || !r.data || !context.org) throw new Error("That evidence snapshot is unavailable in this workspace.");
    const row = r.data;
    const scope = await getDiscoverySelection(row.screen_id, row.comparison_id);
    if (scope.runId !== row.run_id) throw new Error("This snapshot belongs to an earlier run. Import the evidence against the current run.");
    const document = discoveryDocumentSchema.parse(row.document);
    if (sha256(row.document) !== row.document_sha256) throw new Error("Stored evidence integrity verification failed.");
    const endpoint = endpointByKey(design.endpoint_key);
    if (!endpoint) throw new Error("Choose a registered validation endpoint.");
    if (endpoint.threshold_owner === "laboratory" && design.laboratory_threshold === null) throw new Error("Prespecify the laboratory's effect threshold before freezing.");
    // Verify the database registry is synchronized with the engine-generated definition.
    const ep = await client.from("validation_endpoints").select("definition_sha256").eq("endpoint_id", endpoint.endpoint_id).eq("version", endpoint.version).maybeSingle();
    if (ep.error || ep.data?.definition_sha256 !== endpoint.definition_sha256) throw new Error("The database endpoint registry differs from the application. Synchronize it before freezing.");
    const worklist = buildWorklist(await readDiscoveryHits(row.screen_id, row.run_id, row.comparison_id), document);
    const plan = selectBatch(worklist, design);
    if (plan.experiments.length > 500) throw new Error("A batch supports at most 500 distinct experiments. Reduce the batch budget.");
    const receipt: DiscoveryReceipt = { screen_id: row.screen_id, run_id: row.run_id, comparison_id: row.comparison_id, input_id: row.id, input_sha256: row.document_sha256, evidence: row.document,
      endpoint: { ...endpoint }, plan, blind_ids: Object.fromEntries(plan.experiments.map((e) => [e.id, randomUUID()])) };
    const insert = await client.from("discovery_batches").insert({ org_id: auth.orgId, input_id: row.id, screen_id: row.screen_id, run_id: row.run_id, comparison_id: row.comparison_id,
      name: design.name, receipt, canonical_receipt: canonicalJson(receipt), receipt_sha256: sha256(receipt), frozen_by: auth.userId }).select("id").single();
    if (insert.error) throw insert.error;
    refresh(); return { ok: true, batchId: insert.data.id };
  } catch (error) { return failure(error); }
}

export async function recordDiscoveryResult(input: { batchId: string; experimentId: string; measurement: unknown }): Promise<Result> {
  try {
    await authorize();
    const measurement = discoveryResultSchema.parse(input.measurement);
    if (measurement.result === "pending") throw new Error("Keep unfinished experiments outstanding. Record a result when the assay has finished.");
    const view = await getDiscoveryBatch(input.batchId);
    if (!view) throw new Error("That batch is not in this workspace.");
    const { batch, results } = view;
    const experiment = batch.receipt.plan.experiments.find((e) => e.id === input.experimentId);
    if (!experiment) throw new Error("Choose an experiment from the frozen worklist.");
    if (results.some((r) => r.experiment_id === experiment.id)) throw new Error("This experiment already has an immutable recorded result. A new independent assay belongs in a new batch.");
    if (measurement.model_id !== experiment.model_id) throw new Error("The outcome model must match the frozen experiment.");
    const validationType = experiment.kind === "orthogonal_confirmation" ? "independent_guide" : experiment.kind === "pharmacologic_confirmation" ? "small_molecule" : experiment.kind === "partial_suppression" ? "crispri" : "other";
    const endpoint = batch.receipt.endpoint as unknown as EndpointDefinition;
    const compatible = validationType !== "other" && endpoint.validation_types.includes(validationType);
    const decision = compatible ? decideEndpoint(endpoint, measurement, { laboratoryThreshold: batch.receipt.plan.design.laboratory_threshold }) : { decision: "reported_only", because: "This assay is recorded without a compatible prespecified endpoint; it does not count as an independently confirmed vulnerability." };
    const { createClient } = await import("@/lib/supabase/server");
    const client = await createClient();
    const m = { ...measurement, compound: experiment.compound, concentration_um: experiment.dose_um, partner: experiment.partner, time_hours: experiment.time_hours };
    const r = await client.rpc("record_discovery_result", { p_batch_id: batch.id, p_experiment_id: experiment.id, p_measurement: m, p_decision: decision.decision, p_because: decision.because, p_endpoint_key: compatible ? endpoint.key : null, p_validation_type: validationType });
    if (r.error) throw r.error;
    refresh(); return { ok: true };
  } catch (error) { return failure(error); }
}
