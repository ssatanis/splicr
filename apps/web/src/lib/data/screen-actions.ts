"use server";

import { revalidatePath } from "next/cache";
import { getCurrentContext } from "@/lib/data/org";
import { createClient } from "@/lib/supabase/server";
import { actionFailed, isUuid, type ActionResult } from "@/lib/data/types";
import { deleteR2 } from "@/lib/intake/r2.server";

export async function deleteScreen(screenId: string): Promise<ActionResult> {
  if (!isUuid(screenId)) return actionFailed("Invalid screen ID.");
  const context = await getCurrentContext();
  if (!context.org) return actionFailed("No active workspace.");
  if (context.role !== "admin" && context.role !== "owner") {
    return actionFailed("Only workspace admins can delete screens.");
  }

  const supabase = await createClient();

  // Fetch the screen first to ensure it exists and belongs to the org
  const { data: screen, error: screenError } = await supabase
    .from("screens")
    .select("id, org_id")
    .eq("id", screenId)
    .eq("org_id", context.org.id)
    .single();

  if (screenError || !screen) {
    return actionFailed("Screen not found or you do not have permission.");
  }

  // Get associated files to remove them from R2 storage
  const { data: files } = await supabase
    .from("screen_files")
    .select("storage_key")
    .eq("screen_id", screenId);

  const keys = (Array.isArray(files) ? files : []).map((row) => (row as { storage_key: string }).storage_key);

  if (keys.length > 0) {
    const local = keys.filter((key) => !key.startsWith("s3://"));
    const r2 = keys.filter((key) => key.startsWith("s3://"));
    for (const key of r2) {
      await deleteR2(key).catch((error) => console.error("deleteScreen R2 error", error));
    }
    if (local.length > 0) {
      await supabase.storage.from("uploads").remove(local).catch((error) => console.error("deleteScreen storage error", error));
    }
  }

  // Delete the screen (this cascades to samples, files, comparisons, runs, etc.)
  const { error: deleteError } = await supabase
    .from("screens")
    .delete()
    .eq("id", screenId)
    .eq("org_id", context.org.id);

  if (deleteError) {
    console.error("deleteScreen error", deleteError);
    return actionFailed("Failed to delete the screen.");
  }

  revalidatePath("/dashboard/screens");
  return { ok: true };
}
