import "server-only";

import { sendAuthCode } from "@/lib/email/auth-codes";
import { emailConfigured } from "@/lib/email/send";
import { site } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OrgRole } from "@/lib/data/types";

/**
 * Getting a one-time code into an invited researcher's inbox.
 *
 * The product is invitation only, so this path is the whole front door: if it
 * fails, the person cannot reach the laboratory at all. It used to ask Supabase
 * Auth to compose and send the message, which meant the send happened inside
 * the authentication service, under that service's own per-hour email
 * allowance, through whichever SMTP sender the project was configured with. A
 * refusal anywhere in there came back as one opaque error, nothing was queued,
 * and the members page could only say "delivery failed".
 *
 * Now SplicR does both halves itself:
 *
 *  1. `auth.admin.generateLink()` mints the six-digit code and sends nothing.
 *     For an address with no account it is an `invite`, which creates the
 *     identity; `private.handle_new_user()` then reads the access allowlist and
 *     puts the new member straight into the inviting laboratory, so the code in
 *     the message is all they need. For an address that already has an account
 *     it is a `magiclink`, and the membership row is written here first.
 *  2. `@/lib/email/auth-codes` posts the message through the product's own
 *     sender and reports the provider's message id, or the reason it refused.
 *
 * `inviteUserByEmail` remains as the fallback for a deployment with no mail
 * credentials of its own — a local stack, or a preview — so nothing regresses
 * where Supabase's own sender is the only one there is.
 *
 * Every path resolves. Nothing here throws at a Server Action.
 */

export type InviteDelivery = {
  /**
   * `sent` — an identity was created and its invitation code is on its way.
   * `existing_user` — the account already existed, is now a member, and has a
   * sign-in code on its way. `failed` — nothing reached the inbox.
   */
  state: "sent" | "existing_user" | "failed";
  /** The reason, for the members page and for `org_invites.delivery_error`. */
  error: string | null;
  /** The provider's id for the message, which is the proof that it went out. */
  messageId: string | null;
  /**
   * True once an Auth identity exists for this address and its authorization
   * has been consumed.
   *
   * It matters on failure: the identity and its membership survive a message
   * that did not go out, so the caller must not roll the authorization back to
   * `pending`, which would describe a state that no longer exists and make the
   * next sign-in look unauthorized.
   *
   * It is not "this call created it". `generateLink` with `invite` succeeds for
   * an address that already has an unconfirmed identity, which is the ordinary
   * case when an administrator sends a second code to somebody who never
   * arrived. The flag is about what is true afterwards, not about who did it.
   */
  identityCreated: boolean;
  /** Which sender carried it, for the server log. */
  channel: "splicr" | "supabase" | null;
};

export interface WorkspaceInvite {
  email: string;
  orgName: string;
  orgId: string;
  role: OrgRole;
  invitedBy: string;
  fullName?: string;
}

type Admin = NonNullable<ReturnType<typeof createAdminClient>>;

/**
 * What a missing trusted client actually means, said so it can be acted on.
 *
 * `createAdminClient()` returns null when `SUPABASE_SECRET_KEY` is absent, and
 * every invitation then fails before a single network call. Naming the variable
 * is the difference between a lab administrator reading a dead end and an
 * engineer reading an instruction. This is not hypothetical: every invitation
 * sent from a local console failed this way, because `apps/web/.env.local` was
 * missing the key while the repository root `.env`, which Next.js never reads,
 * had it.
 */
const NOT_CONFIGURED =
  "SplicR cannot reach the authentication service: SUPABASE_SECRET_KEY is not set on this deployment. No message was attempted.";

/** `org_invites.delivery_error` holds 500 characters, and a column constraint
 *  that rejects a row would lose the reason it was trying to record. */
const CEILING = 480;
const trim = (text: string) => (text.length > CEILING ? `${text.slice(0, CEILING - 1)}…` : text);

const failed = (error: string, identityCreated = false): InviteDelivery => ({
  state: "failed",
  error: trim(error),
  messageId: null,
  identityCreated,
  channel: null,
});

/**
 * Is this "that address already has an account"?
 *
 * Getting this wrong is expensive in one direction only. Read as a refusal, it
 * strands a colleague who has used SplicR before on a dead invitation; read as
 * an existing account when it was something else, the next step looks the
 * address up in `profiles`, finds nothing, and says so. So the named error codes
 * are trusted outright, and the wording is accepted on any of the statuses
 * GoTrue has used for it rather than on 422 alone.
 */
function alreadyRegistered(error: { code?: string; message?: string; status?: number }): boolean {
  const code = (error.code ?? "").toLowerCase();
  if (code === "email_exists" || code === "user_already_exists") return true;
  const text = `${code} ${error.message ?? ""}`.toLowerCase();
  if (![400, 409, 422].includes(error.status ?? 0)) return false;
  return /already (been )?(registered|exists)|already a registered|(email|user).{0,12}exists/.test(text);
}

/** Whatever Auth said, as one line worth storing. */
function authReason(error: { code?: string; message?: string; status?: number } | null): string {
  if (!error) return "The authentication service refused the request.";
  const code = error.code ? `${error.code}: ` : "";
  return `${code}${error.message ?? "the authentication service refused the request"}`;
}

function siteBase(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL?.trim() || site.url).replace(/\/$/, "");
}

/**
 * Put an address that already has an account into the workspace.
 *
 * This runs before the sign-in code is minted, so a code that does arrive always
 * opens a laboratory the person is actually a member of. Returns a sentence on
 * failure and null on success.
 */
async function attachExistingAccount(admin: Admin, input: WorkspaceInvite): Promise<string | null> {
  const profile = await admin.from("profiles").select("id").ilike("email", input.email).maybeSingle();
  if (profile.error || !profile.data) {
    console.error(`[auth/invitations] existing profile lookup failed for ${input.email}`);
    return "That address has an account the workspace directory cannot find.";
  }

  const membership = await admin.from("org_members").upsert(
    {
      org_id: input.orgId,
      user_id: profile.data.id,
      role: input.role,
      invited_by: input.invitedBy,
    },
    { onConflict: "org_id,user_id" },
  );
  if (membership.error) {
    console.error(`[auth/invitations] membership assignment failed: ${membership.error.message}`);
    return `The workspace membership could not be written: ${membership.error.message}`;
  }

  // The laboratory that invited them becomes the one the code opens.
  //
  // Without this the invitation is only half honoured: the membership row
  // exists, and the researcher signs in to whichever workspace their profile
  // already pointed at, with the inviting laboratory nowhere on screen. It was
  // measured: an address invited to "SplicR Operations" signed in and landed in
  // "Satan Lab". `public.accept_org_invite()` has always done this for the
  // token path, so this is the same decision taken in the same place, not a new
  // one. The rail's workspace menu is how somebody goes back.
  const landing = await admin
    .from("profiles")
    .update({ default_org_id: input.orgId })
    .eq("id", profile.data.id);
  if (landing.error) {
    console.error(`[auth/invitations] default workspace not set: ${landing.error.message}`);
    return `The workspace was added but could not be made the one that opens: ${landing.error.message}`;
  }

  await admin
    .from("splicr_access_allowlist")
    .update({
      status: "active",
      consumed_at: new Date().toISOString(),
      accepted_at: new Date().toISOString(),
      expires_at: null,
    })
    .eq("org_id", input.orgId)
    .ilike("email", input.email);

  return null;
}

/**
 * Create an Auth identity for a new researcher, or attach an existing account,
 * and email it a one-time code. No invitation path sends a token-bearing link.
 */
export async function deliverWorkspaceInvite(input: WorkspaceInvite): Promise<InviteDelivery> {
  const admin = createAdminClient();
  if (!admin) {
    return failed(NOT_CONFIGURED);
  }

  // The strategy is chosen before anything is minted. `generateLink` creates the
  // identity as a side effect, which would make a later fall back to
  // `inviteUserByEmail` fail on an address that now exists.
  if (!emailConfigured()) return viaSupabaseSender(admin, input);

  const base = siteBase();
  const metadata = {
    organization_name: input.orgName,
    ...(input.fullName ? { full_name: input.fullName } : {}),
  };

  let kind: "invite" | "magiclink" = "invite";
  let link = await admin.auth.admin.generateLink({
    type: "invite",
    email: input.email,
    options: { redirectTo: `${base}/verify?flow=invite`, data: metadata },
  });

  if (link.error && alreadyRegistered(link.error)) {
    kind = "magiclink";
    const problem = await attachExistingAccount(admin, input);
    if (problem) return failed(problem);
    link = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: input.email,
      options: { redirectTo: `${base}/verify?flow=magiclink`, data: metadata },
    });
  }

  const identityCreated = kind === "invite" && !link.error;

  if (link.error) {
    console.error(`[auth/invitations] generateLink ${kind}: ${authReason(link.error)}`);
    return failed(`The one-time code could not be issued. ${authReason(link.error)}`);
  }

  const token = link.data?.properties?.email_otp ?? "";
  if (!/^\d{4,10}$/.test(token)) {
    console.error(`[auth/invitations] generateLink ${kind} returned no usable code`);
    return failed("The authentication service issued no one-time code.", identityCreated);
  }

  const message = await sendAuthCode({
    to: input.email,
    key: kind === "invite" ? "invite" : "magic_link",
    values: { token, email: input.email, orgName: input.orgName },
  });

  if (message.error) {
    return failed(`The code could not be emailed. ${message.error}`, identityCreated);
  }

  console.info(
    `[auth/invitations] ${kind} code delivered to ${input.email} for ${input.orgId} (${message.id ?? "no id"})`,
  );

  return {
    state: kind === "invite" ? "sent" : "existing_user",
    error: null,
    messageId: message.id,
    identityCreated,
    channel: "splicr",
  };
}

/**
 * Invite an address that is known not to have an account yet.
 *
 * The executive console prepares a personalized authorization — the
 * researcher's name, institution and the laboratory it is creating for them —
 * and refuses any address that already has a SplicR account, so there is no
 * existing-member branch to take here. What it needs is the same reliable
 * delivery: mint the code, send it from the product's own sender, and say
 * precisely what went wrong when it cannot.
 */
export async function deliverNewIdentityInvite(input: {
  email: string;
  orgName: string;
  /** Written to `auth.users.user_metadata`, which onboarding reads back. */
  metadata: Record<string, string | undefined>;
}): Promise<InviteDelivery> {
  const admin = createAdminClient();
  if (!admin) return failed(NOT_CONFIGURED);

  const base = siteBase();
  const options = { redirectTo: `${base}/verify?flow=invite`, data: input.metadata };

  if (!emailConfigured()) {
    const { error } = await admin.auth.admin.inviteUserByEmail(input.email, options);
    if (error) {
      console.error(`[auth/invitations] executive invite failed: ${authReason(error)}`);
      return failed(`The invitation could not be delivered. ${authReason(error)}`);
    }
    return { state: "sent", error: null, messageId: null, identityCreated: true, channel: "supabase" };
  }

  const link = await admin.auth.admin.generateLink({ type: "invite", email: input.email, options });
  if (link.error) {
    console.error(`[auth/invitations] executive generateLink: ${authReason(link.error)}`);
    return failed(`The one-time code could not be issued. ${authReason(link.error)}`);
  }

  const token = link.data?.properties?.email_otp ?? "";
  if (!/^\d{4,10}$/.test(token)) {
    return failed("The authentication service issued no one-time code.", true);
  }

  const message = await sendAuthCode({
    to: input.email,
    key: "invite",
    values: { token, email: input.email, orgName: input.orgName },
  });
  if (message.error) {
    return failed(`The code could not be emailed. ${message.error}`, true);
  }

  return {
    state: "sent",
    error: null,
    messageId: message.id,
    identityCreated: true,
    channel: "splicr",
  };
}

/**
 * The fallback: let Supabase compose and send.
 *
 * Reached only where the deployment has no sender of its own, which is a local
 * stack or a preview. It is the path this module used for every invitation
 * before, kept intact so those environments keep working.
 */
async function viaSupabaseSender(admin: Admin, input: WorkspaceInvite): Promise<InviteDelivery> {
  const base = siteBase();
  const { error } = await admin.auth.admin.inviteUserByEmail(input.email, {
    redirectTo: `${base}/verify?flow=invite`,
    data: {
      organization_name: input.orgName,
      ...(input.fullName ? { full_name: input.fullName } : {}),
    },
  });

  if (!error) {
    return { state: "sent", error: null, messageId: null, identityCreated: true, channel: "supabase" };
  }

  if (!alreadyRegistered(error)) {
    console.error(`[auth/invitations] auth invite failed: ${authReason(error)}`);
    return failed(`The account invitation could not be delivered. ${authReason(error)}`);
  }

  const problem = await attachExistingAccount(admin, input);
  if (problem) return failed(problem);

  const code = await admin.auth.signInWithOtp({
    email: input.email,
    options: { shouldCreateUser: false, emailRedirectTo: `${base}/verify?flow=magiclink` },
  });
  if (code.error) {
    console.error(`[auth/invitations] existing-account code failed: ${code.error.message}`);
    return failed(
      `The workspace was added, but its sign-in code could not be delivered. ${code.error.message}`,
    );
  }

  return {
    state: "existing_user",
    error: null,
    messageId: null,
    identityCreated: false,
    channel: "supabase",
  };
}
