"use server";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  clearExecutiveVerification,
  executiveByEmail,
  getExecutiveIdentity,
  markExecutiveVerified,
} from "@/lib/executive/access";
import { site } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";
import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { isValidTimeZone } from "@/lib/time";

type Result = { ok: true; message: string } | { ok: false; error: string };

const emailSchema = z.string().trim().toLowerCase().email();
const codeSchema = z.string().trim().regex(/^\d{6}$/);

function publicAuthClient() {
  return createSupabaseClient(supabaseUrl, supabasePublishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function requestExecutiveCode(email: string): Promise<Result> {
  const parsed = emailSchema.safeParse(email);
  const executive = parsed.success ? executiveByEmail(parsed.data) : null;
  if (!executive) return { ok: false, error: "This console is restricted to the SplicR executive team." };

  const { error } = await publicAuthClient().auth.signInWithOtp({
    email: executive.email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${site.url}/executive/access`,
    },
  });
  if (error && /rate|too many/i.test(error.message)) {
    return { ok: false, error: "A code was requested recently. Wait a moment before requesting another." };
  }
  if (error) return { ok: false, error: "The executive access code could not be sent." };
  return { ok: true, message: `A fresh six-digit code was sent to ${executive.email}.` };
}

export async function verifyExecutiveCode(email: string, token: string): Promise<Result> {
  const parsedEmail = emailSchema.safeParse(email);
  const parsedCode = codeSchema.safeParse(token);
  const executive = parsedEmail.success ? executiveByEmail(parsedEmail.data) : null;
  if (!executive || !parsedCode.success) {
    return { ok: false, error: "Enter an authorized email and its six-digit code." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({
    email: executive.email,
    token: parsedCode.data,
    type: "email",
  });
  if (error || !data.user || data.user.email?.toLowerCase() !== executive.email) {
    return { ok: false, error: "That code is incorrect, expired, or has already been used." };
  }

  await markExecutiveVerified(data.user.id, executive.email);
  redirect("/executive");
}

export async function endExecutiveSession() {
  await clearExecutiveVerification();
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/executive/access");
}

const inviteSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email(),
  labName: z.string().trim().min(1).max(120),
  institution: z.string().trim().min(1).max(160),
  preferredTitle: z.string().trim().max(32).optional().default(""),
  professionalRole: z.string().trim().max(120).optional().default(""),
  labLocation: z.string().trim().max(160).optional().default(""),
  timeZone: z.string().trim().optional().default(""),
  workspaceId: z.union([z.literal("new"), z.string().uuid()]).default("new"),
  memberRole: z.enum(["admin", "member", "viewer"]).default("member"),
});

export type ExecutiveInviteInput = z.input<typeof inviteSchema>;

export async function sendExecutiveInvitation(input: ExecutiveInviteInput): Promise<Result> {
  const executive = await getExecutiveIdentity();
  if (!executive) return { ok: false, error: "Your executive session expired. Request a fresh code." };

  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the invitation details." };
  }
  const values = parsed.data;
  if (values.timeZone && !isValidTimeZone(values.timeZone)) {
    return { ok: false, error: "Use a valid IANA time zone, such as America/New_York." };
  }

  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Trusted invitation delivery is not configured." };

  const account = await admin.from("profiles").select("id").ilike("email", values.email).maybeSingle();
  if (account.error) return { ok: false, error: "The account directory could not be checked." };
  if (account.data) {
    return {
      ok: false,
      error: "That email already has a SplicR account. Use password reset for account access or invite it from the laboratory's member settings.",
    };
  }

  let orgId: string | null = null;
  let createWorkspace = true;
  let role: "owner" | "admin" | "member" | "viewer" = "owner";
  let workspaceName: string | null = values.labName;

  if (values.workspaceId !== "new") {
    const org = await admin.from("organizations").select("id, name").eq("id", values.workspaceId).maybeSingle();
    if (org.error || !org.data) return { ok: false, error: "Choose an existing laboratory or create a new one." };
    orgId = org.data.id;
    createWorkspace = false;
    role = values.memberRole;
    workspaceName = null;
  }

  const authorization = {
    email: values.email,
    org_id: orgId,
    role,
    status: "pending",
    create_workspace: createWorkspace,
    workspace_name: workspaceName,
    expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    consumed_at: null,
    accepted_at: null,
    full_name: values.fullName,
    institution: values.institution,
    preferred_title: values.preferredTitle || null,
    professional_role: values.professionalRole || null,
    lab_location: values.labLocation || null,
    time_zone: values.timeZone || null,
    prepared_by_email: executive.email,
  };

  const existing = await admin
    .from("splicr_access_allowlist")
    .select("id")
    .ilike("email", values.email)
    .maybeSingle();
  if (existing.error) return { ok: false, error: "Invitation authorization could not be prepared." };

  const write = existing.data
    ? await admin.from("splicr_access_allowlist").update(authorization).eq("id", existing.data.id)
    : await admin.from("splicr_access_allowlist").insert(authorization);
  if (write.error) return { ok: false, error: "Invitation authorization could not be saved." };

  const { error } = await admin.auth.admin.inviteUserByEmail(values.email, {
    redirectTo: `${site.url}/verify?flow=invite`,
    data: {
      full_name: values.fullName,
      organization_name: values.labName,
      institution: values.institution,
      preferred_title: values.preferredTitle || undefined,
      professional_role: values.professionalRole || undefined,
      time_zone: values.timeZone || undefined,
    },
  });
  if (error) {
    console.error(`[executive/invite] ${error.code ?? ""} ${error.message}`);
    return { ok: false, error: "The invitation was prepared, but its email could not be delivered." };
  }

  await admin
    .from("splicr_access_allowlist")
    .update({ invited_at: new Date().toISOString() })
    .ilike("email", values.email);

  revalidatePath("/executive");
  return {
    ok: true,
    message: `${values.fullName}'s personalized invitation code was sent to ${values.email}.`,
  };
}
