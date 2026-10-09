"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/data/org";
import { actionFailed, isUuid, roleAtLeast, type ActionResult } from "@/lib/data/types";
import { cancelPrivateScreenRun } from "@/lib/ingest/modal";

export async function cancelScreenAnalysis(screenId: string, runId: string): Promise<ActionResult> {
  if (!isUuid(screenId) || !isUuid(runId)) return actionFailed("Invalid analysis.");
  const context = await getCurrentContext();
  if (!context.user || !context.org || !roleAtLeast(context.role, "member")) return actionFailed("Only workspace researchers can cancel analyses.");
  const client = await createClient();
  // SQL rechecks membership, current run and terminal state under a lock.
  const result = await client.rpc("cancel_screen_analysis", { p_screen_id: screenId, p_run_id: runId });
  if (result.error) return actionFailed("The analysis could not be canceled. Refresh and try again.");
  if (!result.data) return actionFailed("This analysis has already finished. Refresh to view its results.");
  try { await cancelPrivateScreenRun(runId); }
  catch { console.error("[analysis/cancel] Modal cancellation queued for automatic retry"); }
  revalidatePath(`/dashboard/screens/${screenId}`);
  revalidatePath("/dashboard/screens");
  return { ok: true };
}
