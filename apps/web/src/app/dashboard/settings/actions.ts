"use server";

/**
 * Settings actions that the shared data layer does not provide.
 *
 * `src/lib/data/actions.ts` covers profile, organization, members, invites and
 * API keys. Deleting a workspace is only ever reachable from this page, so it
 * lives here rather than being bolted onto that file.
 *
 * The contract is the same as the rest of the data layer: permission is
 * re-checked on the server, nothing throws at the UI, and demo visitors are
 * refused with a message instead of a silent no-op.
 */

import { revalidatePath } from "next/cache";

import { getCurrentContext, getOrgRole } from "@/lib/data/org";
import {
  DASHBOARD_PATH,
  actionFailed,
  type ActionResult,
} from "@/lib/data/types";
import { createClient } from "@/lib/supabase/server";

/**
 * Delete the caller's workspace, with everything that hangs off it.
 *
 * Owners only. The form must carry `confirm` holding the workspace slug exactly,
 * which is the typed confirmation, so a stray click cannot do this.
 *
 * Every foreign key pointing at `organizations` is `on delete cascade` except
 * `profiles.default_org_id`, which is `set null`. One statement therefore takes
 * the screens, runs, hits, QC, outcomes, reports, jobs, invites, memberships,
 * API keys and any custom library with it. The "owners delete their
 * organization" policy enforces the role a second time inside Postgres.
 */
export async function deleteWorkspace(formData: FormData): Promise<ActionResult> {
  const context = await getCurrentContext();

  if (!context.user) return actionFailed("Your session has ended. Sign in again and retry.");
  if (!context.org) return actionFailed("You are not a member of a SplicR workspace yet.");

  const org = context.org;

  const role = await getOrgRole(org.id, context.user.id);
  if (!role) return actionFailed("You are no longer a member of this workspace.");
  if (role !== "owner") {
    return actionFailed("Only an owner can delete a workspace. Ask an owner to do it.");
  }

  const typed = formData.get("confirm");
  const confirmation = typeof typed === "string" ? typed.trim() : "";

  if (confirmation !== org.slug) {
    return actionFailed(`Type ${org.slug} exactly to confirm. Nothing has been deleted.`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .delete()
    .eq("id", org.id)
    .select("id");

  if (error) {
    console.error(`[settings/actions] deleteWorkspace: ${error.code ?? ""} ${error.message}`);
    return actionFailed("The workspace could not be deleted. Nothing has changed.");
  }

  if (!Array.isArray(data) || data.length === 0) {
    return actionFailed(
      "The workspace could not be deleted. Your role may have changed, so nothing was removed.",
    );
  }

  revalidatePath(DASHBOARD_PATH, "layout");
  return { ok: true };
}
