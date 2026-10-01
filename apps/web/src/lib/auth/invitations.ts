import "server-only";

import { site } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OrgRole } from "@/lib/data/types";

export type InviteDelivery =
  | { state: "sent" | "existing_user"; error: null }
  | { state: "failed"; error: string };

function alreadyRegistered(error: { code?: string; message?: string; status?: number }): boolean {
  const text = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  return error.status === 422 && /already|registered|exists/.test(text);
}

/**
 * Create an Auth identity for a new researcher, or attach an existing account
 * and send it a one-time sign-in code. No invitation path sends a token link.
 */
export async function deliverWorkspaceInvite(input: {
  email: string;
  orgName: string;
  orgId: string;
  role: OrgRole;
  invitedBy: string;
  fullName?: string;
}): Promise<InviteDelivery> {
  const admin = createAdminClient();
  if (!admin) {
    return { state: "failed", error: "Trusted Supabase invitation delivery is not configured." };
  }

  const base = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || site.url).replace(/\/$/, "");
  const { error } = await admin.auth.admin.inviteUserByEmail(input.email, {
    redirectTo: `${base}/verify?flow=invite`,
    data: {
      organization_name: input.orgName,
      ...(input.fullName ? { full_name: input.fullName } : {}),
    },
  });

  if (!error) return { state: "sent", error: null };
  if (!alreadyRegistered(error)) {
    console.error(`[auth/invitations] auth invite failed: ${error.code ?? ""} ${error.message}`);
    return { state: "failed", error: "The account invitation could not be delivered." };
  }

  const profile = await admin.from("profiles").select("id").ilike("email", input.email).maybeSingle();
  if (profile.error || !profile.data) {
    console.error(`[auth/invitations] existing profile lookup failed for ${input.email}`);
    return { state: "failed", error: "The workspace invitation could not be delivered." };
  }

  const membership = await admin.from("org_members").upsert({
    org_id: input.orgId,
    user_id: profile.data.id,
    role: input.role,
    invited_by: input.invitedBy,
  }, { onConflict: "org_id,user_id" });
  if (membership.error) {
    console.error(`[auth/invitations] membership assignment failed: ${membership.error.message}`);
    return { state: "failed", error: "The workspace invitation could not be completed." };
  }

  const code = await admin.auth.signInWithOtp({
    email: input.email,
    options: { shouldCreateUser: false, emailRedirectTo: `${base}/verify?flow=magiclink` },
  });
  if (code.error) {
    console.error(`[auth/invitations] existing-account code failed: ${code.error.message}`);
    return { state: "failed", error: "The workspace was added, but its sign-in code could not be delivered." };
  }

  await admin.from("splicr_access_allowlist").update({
    status: "active",
    consumed_at: new Date().toISOString(),
    accepted_at: new Date().toISOString(),
    expires_at: null,
  }).eq("org_id", input.orgId).ilike("email", input.email);

  return { state: "existing_user", error: null };
}
