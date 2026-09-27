"use server";

/**
 * Accepting an invite link.
 *
 * This lives next to `@/lib/data/actions` rather than inside it so that the two
 * files stay independent. The work itself belongs to the database:
 * `public.accept_org_invite(token)` is SECURITY DEFINER, checks that the invite
 * is open and unexpired, checks that the signed-in address matches the invited
 * one, and inserts the `org_members` row. A caller cannot join a workspace by
 * guessing an org id, because no org id crosses the wire.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { getCurrentContext } from "./org";
import { DASHBOARD_PATH } from "./types";

/** Query values the invite page turns back into a sentence. */
type Failure = "gone" | "email" | "failed";

function invitePath(token: string, failure?: Failure): string {
  const base = `/invite/${encodeURIComponent(token)}`;
  return failure ? `${base}?error=${failure}` : base;
}

/**
 * Join the workspace an invite was issued for, then land on the members page.
 *
 * Errors come back as a query string on the invite page rather than as a thrown
 * exception, so a person who follows a stale link reads a sentence instead of
 * meeting an error screen. Note that `redirect()` throws by design, so none of
 * these calls sit inside a try block.
 */
export async function acceptInvite(formData: FormData): Promise<void> {
  const raw = formData.get("token");
  const token = typeof raw === "string" ? raw.trim() : "";
  if (!token) redirect(DASHBOARD_PATH);

  const { user } = await getCurrentContext();
  if (!user) redirect(`/login?next=${encodeURIComponent(invitePath(token))}`);

  const supabase = await createClient();

  let failure: Failure | null = null;
  let orgId: string | null = null;

  try {
    const { data, error } = await supabase.rpc("accept_org_invite", { invite_token: token });
    if (error) {
      console.error(`[data/accept-invite] rpc: ${error.code ?? ""} ${error.message}`);
      // P0002 is raised for an invite that is missing, used or expired, and
      // 42501 for one issued to a different address. Both are in the function.
      failure = error.code === "P0002" ? "gone" : error.code === "42501" ? "email" : "failed";
    } else if (typeof data === "string") {
      orgId = data;
    }
  } catch (error) {
    console.error(`[data/accept-invite] rpc threw: ${String(error)}`);
    failure = "failed";
  }

  if (failure) redirect(invitePath(token, failure));

  // Land in the workspace that was just joined. Without this the context
  // resolver would keep using the profile's existing default organization,
  // which for a fresh account is the personal one created at signup, and the
  // new member would wonder where the lab went. A failure here is not worth
  // blocking the redirect: the membership itself is already in place.
  if (orgId) {
    const { error } = await supabase
      .from("profiles")
      .update({ default_org_id: orgId })
      .eq("id", user.id);
    if (error) {
      console.error(`[data/accept-invite] default org: ${error.code ?? ""} ${error.message}`);
    }
  }

  revalidatePath(DASHBOARD_PATH, "layout");
  redirect("/dashboard/settings/members?joined=1");
}
