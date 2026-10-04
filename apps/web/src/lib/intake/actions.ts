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

import { inspectStoredFile, objectExists, type FileShape, type LibraryCandidate } from "./inspect";
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

const KINDS: readonly IntakeKind[] = ["counts", "fastq", "library"];
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
    .select("id, org_id, status, created_by")
    .eq("id", screenId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false as const, error: "That screen does not exist, or you cannot see it." };
  }
  const row = data as { id: string; org_id: string; status: string; created_by: string | null };
  if (row.org_id !== member.orgId) {
    return { ok: false as const, error: "That screen belongs to a different workspace." };
  }
  if (row.status !== "draft" && row.status !== "failed") {
    return { ok: false as const, error: `This screen is already ${row.status}, so it cannot be changed here.` };
  }
  return { ok: true as const, userId: member.userId, orgId: member.orgId, screenId: row.id };
}

function note(scope: string, detail: unknown): void {
  console.error(`[intake] ${scope}: ${detail instanceof Error ? detail.message : String(detail)}`);
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
        kind: input.kind,
        storage_key: key,
        original_name: input.name.slice(0, 300),
        byte_size: input.bytes,
        checksum_sha256: input.checksum,
        status: "complete",
        metadata: { compressed: input.compressed, stored_bytes: stored, uploaded_by: draft.userId },
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
    const { data } = await supabase
      .from("screen_files")
      .select("storage_key")
      .eq("id", fileId)
      .eq("screen_id", draft.screenId)
      .maybeSingle();

    await supabase.from("screen_files").delete().eq("id", fileId).eq("screen_id", draft.screenId);

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
      metadata: { compressed?: boolean } | null;
    }[];

    const files: InspectedFile[] = [];
    const libraries = new Map<string, LibraryCandidate>();

    for (const row of rows) {
      const result = await inspectStoredFile(
        row.storage_key,
        row.kind,
        Boolean(row.metadata?.compressed),
      );
      if (result.ok) {
        const shape: FileShape =
          result.kind === "counts"
            ? {
                kind: "counts",
                delimiter: result.delimiter,
                columns: result.columns,
                guide_column: result.guide_column,
                gene_column: result.gene_column,
                sequence_column: result.sequence_column,
                sample_columns: result.sample_columns,
                rows_seen: result.rows_seen,
                preview: result.preview,
                libraries: result.libraries,
              }
            : {
                kind: "fastq",
                reads_seen: result.reads_seen,
                read_length: result.read_length,
                first_read: result.first_read,
              };
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
  screenId: string;
  design: IntakeDesign;
  settings: {
    normalization: Normalization;
    hit_callers: HitCaller[];
    fdr_threshold: number;
    cn_correction: boolean;
  };
}

export async function startScreenAnalysis(
  input: StartInput,
): Promise<ActionResultWith<{ runId: string; screenId: string }>> {
  const draft = await requireDraft(input.screenId);
  if (!draft.ok) return actionFailed(draft.error);

  const design = input.design;
  if (!MODALITIES.includes(design.modality as (typeof MODALITIES)[number])) {
    return actionFailed("That is not a modality SplicR analyses.");
  }
  for (const sample of design.samples) {
    if (!ROLES.includes(sample.role)) return actionFailed("A sample has a role SplicR does not recognise.");
  }
  if (!NORMALIZATIONS.includes(input.settings.normalization)) {
    return actionFailed("That normalization is not available.");
  }
  const callers = input.settings.hit_callers.filter((caller) => HIT_CALLERS.includes(caller));
  if (callers.length === 0) return actionFailed("Choose at least one hit caller.");
  const fdr = input.settings.fdr_threshold;
  if (!Number.isFinite(fdr) || fdr <= 0 || fdr >= 1) {
    return actionFailed("The FDR threshold has to be between 0 and 1.");
  }

  const supabase = await createClient();

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

  const treatment = design.samples.filter((s) => s.role === "treatment");
  const control = design.samples.filter((s) => CONTROL_ROLES.includes(s.role));

  try {
    // Samples are rewritten wholesale: a draft's design is edited until it is
    // right, and a partial update would leave a sample from an earlier attempt
    // standing in a contrast nobody asked for.
    await supabase.from("comparisons").delete().eq("screen_id", draft.screenId);
    await supabase.from("samples").delete().eq("screen_id", draft.screenId);

    const { data: sampleRows, error: sampleError } = await supabase
      .from("samples")
      .insert(
        design.samples.map((sample, position) => ({
          screen_id: draft.screenId,
          label: sample.label.slice(0, 120),
          condition: sample.role === "treatment" ? "treated" : sample.role,
          replicate: Number.isFinite(sample.replicate) ? Math.max(1, Math.trunc(sample.replicate)) : 1,
          role: sample.role,
          position,
          metadata: sample.file_id ? { file_id: sample.file_id } : {},
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
        organism_taxid: 9606,
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
