"use server";

/**
 * Bringing a lab's own screen into the workspace, one committed step at a time.
 *
 * The browser writes the bytes to storage directly, because nothing else can
 * carry a lane of sequencing. Everything that decides anything happens here:
 * the draft is created server side with the caller's organization, every file
 * is only recorded once this code has confirmed the object is in storage and
 * reads as what it claims to be, and the run is queued by
 * `public.start_screen_analysis`, which re-checks the role and the design in
 * the database.
 *
 * Nothing in this file reports progress it has not observed. A file is
 * 'complete' when the uploaded object reports its size, and an analysis is
 * started only when a job row exists for it.
 */

import { createHash } from "node:crypto";
import { kickPrivateScreenQueue } from "@/lib/ingest/modal";
import { suggestGuideAliases } from "./tables";
import { revalidatePath } from "next/cache";

import { getCurrentContext, getOrgRole } from "@/lib/data/org";
import {
  actionFailed,
  isUuid,
  HIT_CALLERS,
  MODALITIES,
  NORMALIZATIONS,
  ROLE_RANK,
  type ActionResult,
  type ActionResultWith,
  type HitCaller,
  type Normalization,
} from "@/lib/data/types";
import { createClient } from "@/lib/supabase/server";
import { MODEL_TYPES } from "@/lib/validation/model";
import { DEFAULT_LIBRARY, validateLibrary, validateMle, validateDrugz, type LibraryImportOptions, type MleDesign, type DrugzOptions, type Profile } from "./analysis-plan";
import type { TableMapping } from "./mapping";

import { inspectStoredFile, objectExists, readLibraryTable, type FileShape, type LibraryCandidate } from "./inspect";
import { deleteR2, parseR2Uri } from "./r2.server";
import {
  CONTROL_ROLES,
  MAX_FILE_BYTES,
  MAX_FILES,
  checkDesign,
  contrastName,
  storageKey,
  type IntakeDesign,
  type IntakeKind,
  type SampleRole,
} from "./shape";

const PATH = "/dashboard/new";

const KINDS: readonly IntakeKind[] = ["counts", "fastq", "library", "context"];
const ROLES: readonly SampleRole[] = ["plasmid", "reference", "control", "treatment"];

/** The caller's workspace and their right to spend its compute, or a reason. */
async function requireMember() {
  const context = await getCurrentContext();
  if (!context.user || !context.org) {
    return { ok: false as const, error: "Sign in to a workspace to start an analysis." };
  }
  const role = await getOrgRole(context.org.id, context.user.id);
  if (!role || ROLE_RANK[role] < ROLE_RANK.member) {
    return {
      ok: false as const,
      error: "Your role in this workspace is read-only, so you cannot start an analysis.",
    };
  }
  return { ok: true as const, userId: context.user.id, orgId: context.org.id };
}

/** A screen the caller may still edit, or a reason they may not. */
async function requireDraft(screenId: string) {
  const member = await requireMember();
  if (!member.ok) return member;
  if (!isUuid(screenId)) return { ok: false as const, error: "That screen does not exist." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("screens")
    .select("id, org_id, status, created_by, archived_at")
    .eq("id", screenId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false as const, error: "That screen does not exist, or you cannot see it." };
  }
  const row = data as { id: string; org_id: string; status: string; created_by: string | null; archived_at: string | null };
  if (row.org_id !== member.orgId) {
    return { ok: false as const, error: "That screen belongs to a different workspace." };
  }
  if (row.archived_at) return { ok: false as const, error: "This experiment has already been submitted." };
  if (row.status !== "draft" && row.status !== "failed") {
    return { ok: false as const, error: `This screen is already ${row.status}, so it cannot be changed here.` };
  }
  return { ok: true as const, userId: member.userId, orgId: member.orgId, screenId: row.id };
}

function note(scope: string, detail: unknown): void {
  console.error(`[intake] ${scope}: ${detail instanceof Error ? detail.message : detail && typeof detail === "object" && "message" in detail ? String(detail.message) : String(detail)}`);
}

// ---------------------------------------------------------------------------
// 1 · A draft to hang the files off
// ---------------------------------------------------------------------------

export async function createDraftScreen(
  name: string,
): Promise<ActionResultWith<{ screenId: string; orgId: string }>> {
  const member = await requireMember();
  if (!member.ok) return actionFailed(member.error);

  const trimmed = name.trim().slice(0, 200) || "Untitled screen";

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("screens")
      .insert({
        org_id: member.orgId,
        created_by: member.userId,
        name: trimmed,
        source: "upload",
        status: "draft",
        visibility: "private",
      })
      .select("id")
      .single();

    if (error) throw error;
    return { ok: true, screenId: (data as { id: string }).id, orgId: member.orgId };
  } catch (error) {
    note("createDraftScreen", error);
    return actionFailed("The screen could not be created. Nothing was uploaded.");
  }
}

// ---------------------------------------------------------------------------
// 2 · Recording a file, once it is demonstrably in storage
// ---------------------------------------------------------------------------

export interface RegisterInput {
  screenId: string;
  name: string;
  bytes: number;
  kind: IntakeKind;
  compressed: boolean;
  checksum: string | null;
  storageKey: string;
}

export async function registerUploadedFile(
  input: RegisterInput,
): Promise<ActionResultWith<{ fileId: string; storedBytes: number }>> {
  const draft = await requireDraft(input.screenId);
  if (!draft.ok) return actionFailed(draft.error);

  if (!KINDS.includes(input.kind)) return actionFailed("That is not a kind of file SplicR reads.");
  if (!Number.isFinite(input.bytes) || input.bytes <= 0) return actionFailed("That file is empty.");
  if (input.bytes > MAX_FILE_BYTES) return actionFailed("That file is larger than SplicR accepts.");

  const expectedPlainKey = storageKey(draft.orgId, draft.screenId, input.name);
  const key = input.storageKey;
  const parsed = parseR2Uri(key);
  if (!parsed) return actionFailed("The upload has to finish before it can be recorded.");
  if (parsed.key !== expectedPlainKey) {
    return actionFailed("That upload does not belong to this screen.");
  }

  // The upload is only finished when the object store says so. A browser that reported
  // success and a prefix that holds nothing is exactly the failure this
  // check exists to catch.
  const stored = await objectExists(key);
  if (stored === null) {
    return actionFailed("That file could not be read back. The upload did not finish.");
  }
  if (stored !== input.bytes) {
    return actionFailed("That file reached SplicR, but its size changed in transit. Add it again.");
  }
  if (!input.checksum || !/^[a-f0-9]{64}$/i.test(input.checksum)) {
    return actionFailed("The file reached SplicR, but its SHA-256 checksum could not be recorded. Add it again.");
  }

  try {
    const supabase = await createClient();
    const { count } = await supabase
      .from("screen_files")
      .select("id", { count: "exact", head: true })
      .eq("screen_id", draft.screenId);
    if ((count ?? 0) >= MAX_FILES) {
      return actionFailed(`A screen takes at most ${MAX_FILES} files.`);
    }

    // Re-dropping the same name replaces the row rather than adding a second
    // one beside it, because storage was written with upsert and now holds one
    // object under that name.
    await supabase
      .from("screen_files")
      .delete()
      .eq("screen_id", draft.screenId)
      .eq("storage_key", key);

    const { data, error } = await supabase
      .from("screen_files")
      .insert({
        screen_id: draft.screenId,
        kind: input.kind === "context" ? "other" : input.kind,
        storage_key: key,
        original_name: input.name.slice(0, 300),
        byte_size: input.bytes,
        checksum_sha256: input.checksum,
        status: "complete",
        metadata: { intake_kind: input.kind, compressed: input.compressed, stored_bytes: stored, uploaded_by: draft.userId },
      })
      .select("id")
      .single();

    if (error) throw error;
    revalidatePath(PATH);
    return { ok: true, fileId: (data as { id: string }).id, storedBytes: stored };
  } catch (error) {
    note("registerUploadedFile", error);
    return actionFailed("The file reached SplicR but could not be recorded. Try adding it again.");
  }
}

export async function removeUploadedFile(
  screenId: string,
  fileId: string,
): Promise<ActionResult> {
  const draft = await requireDraft(screenId);
  if (!draft.ok) return actionFailed(draft.error);

  try {
    const supabase = await createClient();
    const { data, error: readError } = await supabase
      .from("screen_files")
      .select("storage_key")
      .eq("id", fileId)
      .eq("screen_id", draft.screenId)
      .maybeSingle();

    if (readError) throw readError;
    const { error: deleteError } = await supabase.from("screen_files").delete().eq("id", fileId).eq("screen_id", draft.screenId);
    if (deleteError) throw deleteError;

    const key = (data as { storage_key: string } | null)?.storage_key;
    if (key) {
      // Only an admin may delete a stored object, so for a member the row goes
      // and the bytes stay until retention sweeps them. Saying nothing here is
      // right: the file is gone from the screen either way.
      if (parseR2Uri(key)) {
        await deleteR2(key).catch((error) => note("removeUploadedFile R2", error));
      } else {
        const { error } = await supabase.storage.from("uploads").remove([key]);
        if (error) note("removeUploadedFile storage", error);
      }
    }

    revalidatePath(PATH);
    return { ok: true };
  } catch (error) {
    note("removeUploadedFile", error);
    return actionFailed("That file could not be removed from the screen.");
  }
}

// ---------------------------------------------------------------------------
// 3 · What the uploaded bytes actually are
// ---------------------------------------------------------------------------

export interface InspectedFile {
  fileId: string;
  name: string;
  kind: IntakeKind;
  shape: FileShape | null;
  error: string | null;
}

export async function setUploadedFilePurpose(screenId: string, fileId: string, kind: IntakeKind): Promise<ActionResult> {
  const draft = await requireDraft(screenId);
  if (!draft.ok) return actionFailed(draft.error);
  if (!KINDS.includes(kind) || !isUuid(fileId)) return actionFailed("Choose a valid uploaded file and purpose.");
  const supabase = await createClient();
  const { data, error } = await supabase.from("screen_files").select("metadata").eq("screen_id", screenId).eq("id", fileId).single();
  if (error || !data) return actionFailed("This file is not available in the draft.");
  const updated = await supabase.from("screen_files").update({ kind: kind === "context" ? "other" : kind, metadata: { ...data.metadata, intake_kind: kind } }).eq("screen_id", screenId).eq("id", fileId);
  return updated.error ? actionFailed("The file purpose could not be saved.") : { ok: true };
}

export async function setFileTableMapping(screenId: string, fileId: string, sheet: string, mapping: TableMapping): Promise<ActionResult> {
  const draft = await requireDraft(screenId);
  if (!draft.ok) return actionFailed(draft.error);
  if (!isUuid(fileId) || !["counts", "library", "metadata", "context"].includes(mapping.kind) || !["wide", "long", "transposed"].includes(mapping.layout)) return actionFailed("Choose a valid file interpretation.");
  const supabase = await createClient();
  const { data, error } = await supabase.from("screen_files").select("metadata,storage_key,original_name").eq("screen_id", screenId).eq("id", fileId).eq("status", "complete").single();
  if (error || !data) return actionFailed("The uploaded file is missing.");
  const mappings = { ...data.metadata?.table_mappings, [sheet]: mapping };
  const result = await inspectStoredFile(data.storage_key, "counts", Boolean(data.metadata?.compressed), data.original_name, mappings);
  if (!result.ok) return actionFailed(result.error);
  const table = result.kind === "tables" ? result.tables.find((table) => table.sheet === sheet) : null;
  if (!table) return actionFailed("The selected worksheet is missing.");
  if (!table.mapping) return actionFailed(table.warnings.join(" ") || "The columns do not exist or are invalid.");
  const updated = await supabase.from("screen_files").update({ metadata: { ...data.metadata, table_mappings: mappings } }).eq("screen_id", screenId).eq("id", fileId);
  return updated.error ? actionFailed("The file interpretation could not be saved.") : { ok: true };
}

export async function inspectScreenFiles(
  screenId: string,
): Promise<ActionResultWith<{ files: InspectedFile[]; libraries: LibraryCandidate[] }>> {
  const draft = await requireDraft(screenId);
  if (!draft.ok) return actionFailed(draft.error);

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("screen_files")
      .select("id, original_name, kind, storage_key, metadata")
      .eq("screen_id", draft.screenId)
      .order("created_at", { ascending: true });
    if (error) throw error;

    const rows = (Array.isArray(data) ? data : []) as {
      id: string;
      original_name: string;
      kind: IntakeKind;
      storage_key: string;
      metadata: { compressed?: boolean; intake_kind?: IntakeKind; table_mappings?: Record<string, TableMapping> } | null;
    }[];

    const files: InspectedFile[] = [];
    const libraries = new Map<string, LibraryCandidate>();

    for (const row of rows) {
      if (row.metadata?.intake_kind === "context") row.kind = "context";
      const result = await inspectStoredFile(
        row.storage_key,
        row.kind,
        Boolean(row.metadata?.compressed),
        row.original_name,
        row.metadata?.table_mappings,
      );
      if (result.ok) {
        const { ok: _ok, ...shape } = result;
        void _ok;
        const contentKind: IntakeKind = shape.kind === "counts" ? "counts" : shape.kind === "fastq" ? "fastq" : shape.kind === "tables" ? shape.tables.some((table) => table.kind === "counts") ? "counts" : shape.tables.some((table) => table.kind === "library") ? "library" : "context" : "context";
        if (contentKind !== row.kind) {
          const updated = await supabase.from("screen_files").update({ kind: contentKind === "context" ? "other" : contentKind, metadata: { ...row.metadata, intake_kind: contentKind } }).eq("screen_id", screenId).eq("id", row.id);
          if (updated.error) throw updated.error;
          row.kind = contentKind;
        }
        if (shape.kind === "context") {
          const updated = await supabase.from("screen_files").update({ metadata: { ...row.metadata, intake_kind: "context", content_inspection: shape } }).eq("screen_id", screenId).eq("id", row.id);
          if (updated.error) throw updated.error;
        }
        files.push({ fileId: row.id, name: row.original_name, kind: row.kind, shape, error: null });
        if (shape.kind === "counts") {
          for (const candidate of shape.libraries) {
            const held = libraries.get(candidate.library_id);
            if (!held || candidate.coverage > held.coverage) libraries.set(candidate.library_id, candidate);
          }
        }
      } else {
        files.push({ fileId: row.id, name: row.original_name, kind: row.kind, shape: null, error: result.error });
      }
    }

    return {
      ok: true,
      files,
      libraries: [...libraries.values()].sort((a, b) => b.coverage - a.coverage).slice(0, 4),
    };
  } catch (error) {
    note("inspectScreenFiles", error);
    return actionFailed("The uploaded files could not be read back. Nothing has been started.");
  }
}

// ---------------------------------------------------------------------------
// 4 · The design, and the one call that queues compute
// ---------------------------------------------------------------------------

export interface StartInput {
  reviewed: boolean;
  screenId: string;
  design: IntakeDesign;
  source?: { fileId: string; sheet: string; mapping?: TableMapping };
  settings: {
    profile?: Profile;
    organism_taxid?: number;
    modality?: (typeof MODALITIES)[number];
    fitness_assay?: boolean;
    mle_design?: MleDesign;
    drugz_options?: DrugzOptions;
    normalization: Normalization;
    hit_callers: HitCaller[];
    fdr_threshold: number;
    cn_correction: boolean;
    drugz_paired?: boolean;
    guide_aliases?: Record<string, string>;
    model_type?: import("@/lib/validation/model").ModelType;
  };
}

export async function startScreenAnalysis(
  input: StartInput,
): Promise<ActionResultWith<{ runId: string; screenId: string }>> {
  const draft = await requireDraft(input.screenId);
  if (!draft.ok) return actionFailed(draft.error);

  if (!input.reviewed) return actionFailed("Review and confirm the analysis plan first.");
  const design = input.design;
  if (!["knockout", "crispri", "crispra"].includes(design.modality)) {
    return actionFailed("That is not a modality SplicR analyses.");
  }
  for (const sample of design.samples) {
    if (!ROLES.includes(sample.role)) return actionFailed("A sample has a role SplicR does not recognise.");
  }
  if (!NORMALIZATIONS.includes(input.settings.normalization)) {
    return actionFailed("That normalization is not available.");
  }
  const callers = input.settings.hit_callers.filter((caller) => HIT_CALLERS.includes(caller));
  if (input.settings.profile && input.settings.profile !== "pooled_abundance") return actionFailed("This readout needs a dedicated analysis adapter. The pooled abundance pipeline cannot analyze it.");
  if (input.settings.mle_design) { const problem = validateMle(input.settings.mle_design, design.samples.filter((sample) => sample.included !== false).map((sample) => sample.label)); if (problem) return actionFailed(problem); }
  if (input.settings.drugz_options) { const problem = validateDrugz(input.settings.drugz_options); if (problem) return actionFailed(problem); }
  if (callers.length === 0) return actionFailed("Choose at least one hit caller.");
  const fdr = input.settings.fdr_threshold;
  if (!Number.isFinite(fdr) || fdr <= 0 || fdr >= 1) {
    return actionFailed("The FDR threshold has to be between 0 and 1.");
  }

  if (callers.includes("chronos")) return actionFailed("Chronos needs a pDNA batch map and collection times. This upload workflow does not yet support those inputs.");
  if (!callers.includes("mageck_rra")) return actionFailed("Select MAGeCK RRA as the primary caller. Additional methods can be compared alongside it.");
  if (input.settings.cn_correction) return actionFailed("Copy-number correction needs a matched copy-number profile. This workflow currently reports copy-number warnings only.");
  if (input.settings.model_type && !MODEL_TYPES.includes(input.settings.model_type)) return actionFailed("Choose a supported model type.");
  const supabase = await createClient();
  const selectedLibrary = design.library_id ? await supabase.from("library_catalog").select("id,name,taxid,modality,cas,n_guides,n_genes").eq("id", design.library_id).maybeSingle() : null;
  if (selectedLibrary && (selectedLibrary.error || !selectedLibrary.data)) return actionFailed("The selected library is not available to this workspace.");
  if (selectedLibrary?.data) {
    const problem = validateLibrary({ organism_taxid: selectedLibrary.data.taxid, modality: selectedLibrary.data.modality, cas: selectedLibrary.data.cas });
    if (problem) return actionFailed(problem);
    if (selectedLibrary.data.n_guides < 1) return actionFailed("The library import is incomplete. Retry it before starting.");
    if (selectedLibrary.data.modality !== design.modality) return actionFailed("The declared screen modality differs from the confirmed library.");
  }


  // The design check runs here over the files the database holds, not the ones
  // the browser believes it uploaded.
  const { data: fileRows, error: fileError } = await supabase
    .from("screen_files")
    .select("id, original_name, kind, byte_size, checksum_sha256, status, storage_key")
    .eq("screen_id", draft.screenId);
  if (fileError) {
    note("startScreenAnalysis files", fileError);
    return actionFailed("The screen's files could not be read. Nothing was started.");
  }

  const files = (Array.isArray(fileRows) ? fileRows : []).map((row) => {
    const file = row as {
      id: string; original_name: string; kind: IntakeKind; byte_size: number | null;
      checksum_sha256: string | null; status: string; storage_key: string;
    };
    return {
      id: file.id,
      name: file.original_name,
      bytes: file.byte_size ?? 0,
      kind: file.kind,
      compressed: /\.gz$/i.test(file.original_name),
      storage_key: file.storage_key,
      checksum_sha256: file.checksum_sha256,
      status: file.status as "pending" | "uploading" | "complete" | "failed",
    };
  });

  const problems = checkDesign(design, files);
  if (problems.length > 0) return actionFailed(problems[0].message);
  const assignedFiles = design.samples.filter((sample) => sample.included !== false).flatMap((sample) => sample.file_ids ?? (sample.file_id ? [sample.file_id] : []));
  if (new Set(assignedFiles).size !== assignedFiles.length || assignedFiles.some((id) => !files.some((file) => file.id === id && file.kind === "fastq" && file.status === "complete"))) return actionFailed("Each selected FASTQ file must belong to one sample in this upload.");

  const treatment = design.samples.filter((s) => s.included !== false && s.role === "treatment");
  const control = design.samples.filter((s) => s.included !== false && CONTROL_ROLES.includes(s.role));
  if (input.settings.drugz_paired) { treatment.sort((a, b) => a.replicate - b.replicate); control.sort((a, b) => a.replicate - b.replicate); }
  if (callers.includes("bagel2") && control.some((sample) => !["reference", "plasmid"].includes(sample.role))) return actionFailed("BAGEL2 needs a fitness comparison against start-of-screen or plasmid samples.");
  if (input.settings.drugz_paired && callers.includes("drugz")) {
    const a = treatment.map((sample) => sample.replicate), b = control.map((sample) => sample.replicate);
    if (a.length !== b.length || new Set(a).size !== a.length || new Set(b).size !== b.length || a.some((value) => !Number.isInteger(value) || value < 1 || !b.includes(value))) return actionFailed("Paired DrugZ needs unique matching replicate numbers in both arms.");
  }

  try {
    // Samples are rewritten wholesale: a draft's design is edited until it is
    // right, and a partial update would leave a sample from an earlier attempt
    // standing in a contrast nobody asked for.
    await supabase.from("comparisons").delete().eq("screen_id", draft.screenId);
    await supabase.from("samples").delete().eq("screen_id", draft.screenId);

    const { data: sampleRows, error: sampleError } = await supabase
      .from("samples")
      .insert(
        design.samples.filter((sample) => sample.included !== false).map((sample, position) => ({
          screen_id: draft.screenId,
          label: sample.label.slice(0, 120),
          condition: sample.role === "treatment" ? "treated" : sample.role,
          replicate: Number.isFinite(sample.replicate) ? Math.max(1, Math.trunc(sample.replicate)) : 1,
          role: sample.role,
          position,
        metadata: { factors: sample.factors ?? {}, ...(sample.file_id ? { file_id: sample.file_id, file_ids: sample.file_ids ?? [sample.file_id] } : {}) },
        })),
      )
      .select("id, label");
    if (sampleError) throw sampleError;

    const ids = new Map(
      (Array.isArray(sampleRows) ? sampleRows : []).map((row) => {
        const sample = row as { id: string; label: string };
        return [sample.label, sample.id] as const;
      }),
    );

    const { error: comparisonError } = await supabase.from("comparisons").insert({
      screen_id: draft.screenId,
      name: contrastName(design).slice(0, 180),
      kind: "treatment_vs_control",
      treatment_ids: treatment.map((s) => ids.get(s.label)).filter(Boolean),
      control_ids: control.map((s) => ids.get(s.label)).filter(Boolean),
      is_primary: true,
    });
    if (comparisonError) throw comparisonError;

    const { error: screenError } = await supabase
      .from("screens")
      .update({
        name: design.name.trim().slice(0, 200),
        cell_line: design.cell_line.trim().slice(0, 120) || null,
        phenotype: design.phenotype.trim().slice(0, 200) || null,
        modality: design.modality,
        library_id: design.library_id,
      })
      .eq("id", draft.screenId);
    if (screenError) throw screenError;

    const { data: runId, error: startError } = await supabase.rpc("start_screen_analysis", {
      p_screen_id: draft.screenId,
      p_settings: {
        normalization: input.settings.normalization,
        hit_callers: callers,
        fdr_threshold: fdr,
        cn_correction: input.settings.cn_correction,
        drugz_paired: Boolean(input.settings.drugz_paired),
        model_type: input.settings.model_type ?? "other",
        profile: "pooled_abundance",
        fitness_assay: input.settings.fitness_assay,
        mle_design: input.settings.mle_design ?? null,
        drugz_options: input.settings.drugz_options ?? { pseudocount: 5, half_window_size: 500 },
        guide_aliases: input.settings.guide_aliases ?? {},
        source: input.source ?? null,
        organism_taxid: selectedLibrary?.data?.taxid ?? input.settings.organism_taxid ?? null,
        library_snapshot: selectedLibrary?.data ?? null,
        review_confirmed: true,
        plan_version: "guide-abundance-v2",
        sample_factors: Object.fromEntries(design.samples.filter((sample) => sample.included !== false).map((sample) => [sample.label, sample.factors ?? {}])),
        // The manifest travels with the run, so a result can always be traced
        // back to the exact bytes it was computed from.
        manifest: files.map((file) => ({
          name: file.name,
          kind: file.kind,
          bytes: file.bytes,
          storage_key: file.storage_key,
          sha256: file.checksum_sha256,
        })),
      },
    });

    if (startError) {
      // The function raises a sentence written for a researcher. Pass it on
      // rather than replacing it with a generic failure.
      return actionFailed(startError.message.replace(/^.*?:\s*/, "") || "The analysis could not be started.");
    }

    await kickPrivateScreenQueue().catch((error) => note("private queue dispatch", error));
    revalidatePath(PATH);
    revalidatePath("/dashboard/screens");
    return { ok: true, runId: String(runId), screenId: draft.screenId };
  } catch (error) {
    note("startScreenAnalysis", error);
    return actionFailed("The design could not be saved, so the analysis was not started. Try again.");
  }
}

export async function discardDraftScreen(screenId: string): Promise<ActionResult> {
  const draft = await requireDraft(screenId);
  if (!draft.ok) return actionFailed(draft.error);

  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("screen_files")
      .select("storage_key")
      .eq("screen_id", draft.screenId);
    const keys = (Array.isArray(data) ? data : []).map((row) => (row as { storage_key: string }).storage_key);
    if (keys.length > 0) {
      const r2 = keys.filter((key) => parseR2Uri(key));
      const local = keys.filter((key) => !parseR2Uri(key));
      for (const key of r2) await deleteR2(key).catch((error) => note("discardDraftScreen R2", error));
      if (local.length > 0) {
        const { error } = await supabase.storage.from("uploads").remove(local);
        if (error) note("discardDraftScreen storage", error);
      }
    }
    const { error } = await supabase.from("screens").delete().eq("id", draft.screenId);
    if (error) throw error;
    revalidatePath(PATH);
    return { ok: true };
  } catch (error) {
    note("discardDraftScreen", error);
    return actionFailed("The draft could not be discarded.");
  }
}

export async function retryScreenAnalysis(screenId: string): Promise<ActionResult> {
  if (!isUuid(screenId)) return actionFailed("Choose a workspace screen.");
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("retry_screen_analysis", { p_screen_id: screenId });
    if (error) return actionFailed(error.message);
    await kickPrivateScreenQueue().catch((error) => note("retry dispatch", error));
    revalidatePath(`/dashboard/screens/${screenId}`);
    revalidatePath("/dashboard/screens");
    return { ok: true };
  } catch (error) { note("retryScreenAnalysis", error); return actionFailed("The saved analysis could not be queued. Try again."); }
}

export async function importCustomLibrary(input: { screenId: string; fileId: string; sheet: string; name: string; sources?: { fileId: string; sheet: string }[]; options?: LibraryImportOptions }): Promise<ActionResultWith<{ libraryId: string; name: string; nGuides: number; nGenes: number; nControls: number; aliases: { source: string; target: string }[] }>> {
  const draft = await requireDraft(input.screenId);
  if (!draft.ok) return actionFailed(draft.error);
  const options = input.options ?? DEFAULT_LIBRARY;
  const problem = validateLibrary(options); if (problem) return actionFailed(problem);
  try {
    const supabase = await createClient();
    const sources = input.sources ?? [{ fileId: input.fileId, sheet: input.sheet }];
    if (!sources.length || sources.length > 16) return actionFailed("Choose 1 to 16 library tables.");
    const guides = new Map<string, import("./tables").GuideRow>();
    const provenance: Record<string, unknown>[] = []; const warnings: string[] = [];
    for (const source of sources) {
      const { data, error } = await supabase.from("screen_files").select("storage_key,original_name,checksum_sha256,metadata").eq("screen_id", input.screenId).eq("id", source.fileId).eq("status", "complete").single();
      if (error || !data || !data.checksum_sha256) return actionFailed("An uploaded library is missing its checksum.");
      const table = await readLibraryTable(data.storage_key, data.original_name, source.sheet, data.metadata?.table_mappings);
      for (const guide of table.guides) { const previous = guides.get(guide.guide_id); if (previous && (previous.sequence !== guide.sequence || previous.gene !== guide.gene || previous.is_control !== guide.is_control)) return actionFailed(`Guide ${guide.guide_id} differs between library tables. Resolve the conflicting records.`); guides.set(guide.guide_id, guide); }
      warnings.push(...table.warnings); provenance.push({ file_id: source.fileId, sheet: source.sheet, sha256: data.checksum_sha256, mapping: table.mapping ?? null });
    }
    const table = { guides: [...guides.values()].sort((a, b) => a.guide_id < b.guide_id ? -1 : a.guide_id > b.guide_id ? 1 : 0) };
    if (table.guides.some((guide) => /[\t\r\n]/.test(guide.guide_id))) return actionFailed("Guide IDs cannot contain tabs or line breaks.");
    const sourceManifest = { sources: provenance, warnings, ...options, guide_sha256: createHash("sha256").update(JSON.stringify(table.guides)).digest("hex") };
    let libraryId: string;
    if (table.guides.length > 8000) {
      const begun = await supabase.rpc("begin_workspace_library_import", { p_screen_id: input.screenId, p_name: input.name.trim() || "Custom guide library", p_n_guides: table.guides.length, p_source: sourceManifest });
      if (begun.error) throw new Error(begun.error.message);
      libraryId = String(begun.data);
      for (let offset = 0; offset < table.guides.length; offset += 2000) {
        const batch = await supabase.rpc("stage_workspace_library_guides", { p_screen_id: input.screenId, p_library_id: libraryId, p_guides: table.guides.slice(offset, offset + 2000) });
        if (batch.error) throw new Error(`Library batch ${Math.floor(offset / 2000) + 1} could not be saved. Retry to resume. ${batch.error.message}`);
      }
      const finished = await supabase.rpc("finish_workspace_library_import", { p_screen_id: input.screenId, p_library_id: libraryId });
      if (finished.error) throw new Error(finished.error.message);
    } else {
      const imported = await supabase.rpc("import_workspace_library", { p_screen_id: input.screenId, p_name: input.name.trim() || "Custom guide library", p_guides: table.guides, p_source: sourceManifest });
      if (imported.error) throw new Error(imported.error.message);
      libraryId = String(imported.data);
    }
    const inspected = await inspectScreenFiles(input.screenId);
    const countIds = inspected.ok ? inspected.files.flatMap((file) => file.shape?.kind === "tables" ? file.shape.tables.filter((table) => table.kind === "counts").flatMap((table) => table.guide_ids) : file.shape?.kind === "counts" ? file.shape.guide_ids ?? [] : []) : [];
    return { ok: true, aliases: suggestGuideAliases(countIds, table.guides), libraryId: String(libraryId), name: input.name.trim() || "Custom guide library", nGuides: table.guides.length, nGenes: new Set(table.guides.map((g) => g.gene).filter(Boolean)).size, nControls: table.guides.filter((g) => g.is_control).length };
  } catch (error) { note("importCustomLibrary", error); return actionFailed(error instanceof Error ? error.message : "The guide library could not be imported."); }
}

export async function startExperimentAnalysis(input: { reviewed: boolean; screenId: string; libraryId: string | null; comparisons: { name: string; model: string; phenotype: string; source: { fileId: string; sheet: string; mapping?: TableMapping }; treatment: string[]; control: string[]; samples: import("./shape").IntakeSample[]; settings: StartInput["settings"] }[] }): Promise<ActionResultWith<{ screens: { screenId: string; runId: string; name: string }[] }>> {
  const draft = await requireDraft(input.screenId);
  if (!draft.ok) return actionFailed(draft.error);
  if (!input.reviewed) return actionFailed("Review and confirm the analysis plan first.");
  if (!input.comparisons.length || input.comparisons.length > 64) return actionFailed("Choose 1 to 64 comparisons.");
  const inspected = await inspectScreenFiles(input.screenId);
  if (!inspected.ok) return actionFailed(inspected.error);
  const client = await createClient();
  const libraryResult = await client.from("library_catalog").select("id,name,taxid,modality,cas,n_guides,n_genes").eq("id", input.libraryId).maybeSingle();
  if (libraryResult.error || !libraryResult.data) return actionFailed("Confirm a library available to this workspace.");
  const library = libraryResult.data;
  const libraryProblem = validateLibrary({ organism_taxid: library.taxid, modality: library.modality, cas: library.cas });
  if (libraryProblem) return actionFailed(libraryProblem);
  if (library.n_guides < 1) return actionFailed("The library import is incomplete. Retry it before starting.");
  for (const comparison of input.comparisons) {
    const file = inspected.files.find((file) => file.fileId === comparison.source.fileId);
    const table = file?.shape?.kind === "tables" ? file.shape.tables.find((table) => table.sheet === comparison.source.sheet && table.kind === "counts") : null;
    const labels = table?.sample_columns ?? (file?.shape?.kind === "counts" ? file.shape.sample_columns : []);
    const selected = [...comparison.treatment, ...comparison.control];
    comparison.source.mapping = table?.mapping;
    const source = await client.from("screen_files").select("checksum_sha256").eq("id", comparison.source.fileId).eq("screen_id", input.screenId).single();
    if (source.error || !source.data?.checksum_sha256) return actionFailed("The count source checksum is missing.");
    Object.assign(comparison.settings, { source_checksum_sha256: source.data.checksum_sha256 });
    if (!comparison.name.trim() || !comparison.treatment.length || !comparison.control.length || new Set(selected).size !== selected.length || selected.some((label) => !labels.includes(label))) return actionFailed(`${comparison.name || "Comparison"}: choose distinct samples from its count table for both arms.`);
    if (comparison.samples.length !== selected.length || comparison.samples.some((sample) => !selected.includes(sample.label) || !ROLES.includes(sample.role) || !Number.isInteger(sample.replicate) || sample.replicate < 1) || new Set(comparison.samples.map((sample) => sample.label)).size !== selected.length) return actionFailed("The comparison sample sheet is incomplete.");
    const settings = comparison.settings;
    if (settings.profile && settings.profile !== "pooled_abundance") return actionFailed("This readout requires a dedicated analysis adapter. It cannot use guide-abundance hit calling.");
    if (settings.modality && settings.modality !== library.modality) return actionFailed("The declared screen modality differs from the confirmed library.");
    settings.modality = library.modality;
    settings.organism_taxid = library.taxid;
    Object.assign(settings, { review_confirmed: true, plan_version: "guide-abundance-v2", library_snapshot: library, sample_factors: Object.fromEntries(comparison.samples.map((sample) => [sample.label, sample.factors ?? {}])) });
    if (settings.mle_design) { const problem = validateMle(settings.mle_design, selected); if (problem) return actionFailed(problem); }
    if (settings.drugz_options) { const problem = validateDrugz(settings.drugz_options); if (problem) return actionFailed(problem); }
    if (comparison.samples.some((sample) => /[\t\r\n,]/.test(sample.label) || Object.entries(sample.factors ?? {}).some(([key, value]) => key.length > 100 || typeof value !== "string" || value.length > 400))) return actionFailed("Use short factor labels and sample names without commas, tabs or line breaks.");
    if (settings.model_type && !MODEL_TYPES.includes(settings.model_type)) return actionFailed("Choose a supported model type.");
    if (!NORMALIZATIONS.includes(settings.normalization) || !Number.isFinite(settings.fdr_threshold) || settings.fdr_threshold <= 0 || settings.fdr_threshold >= 1) return actionFailed("Check the normalization and FDR settings.");
    if (!settings.hit_callers.includes("mageck_rra") || settings.hit_callers.some((caller) => !HIT_CALLERS.includes(caller) || caller === "chronos") || settings.cn_correction) return actionFailed("Use MAGeCK RRA with optional MLE, BAGEL2 or DrugZ. Chronos and copy-number correction need additional inputs.");
    if (settings.drugz_paired && settings.hit_callers.includes("drugz")) {
      const reps = (labels: string[]) => labels.map((label) => comparison.samples.find((sample) => sample.label === label)!.replicate);
      const a = reps(comparison.treatment), b = reps(comparison.control);
      if (new Set(a).size !== a.length || new Set(b).size !== b.length || a.some((value) => !b.includes(value))) return actionFailed("Paired DrugZ needs unique matching replicate numbers in both arms.");
    }
    if (settings.drugz_paired && comparison.treatment.length !== comparison.control.length) return actionFailed("Paired DrugZ needs the same number of treatment and control replicates.");
    if (settings.hit_callers.includes("bagel2") && comparison.control.some((label) => !["reference", "plasmid"].includes(comparison.samples.find((sample) => sample.label === label)?.role ?? ""))) return actionFailed("BAGEL2 needs a fitness comparison against start-of-screen or plasmid samples.");
  }
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("start_experiment_analysis", { p_screen_id: input.screenId, p_library_id: input.libraryId, p_comparisons: input.comparisons });
    if (error) throw error;
    revalidatePath("/dashboard/screens");
    await kickPrivateScreenQueue(input.comparisons.length).catch((error) => note("experiment queue dispatch", error));
    return { ok: true, screens: data as { screenId: string; runId: string; name: string }[] };
  } catch (error) { note("startExperimentAnalysis", error); return actionFailed("The experiment could not be queued. No comparisons were started."); }
}
