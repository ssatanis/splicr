"use server";

/**
 * Server Actions for the lab workspace.
 *
 * Contract for every action in this file:
 *
 *  - Permission is re-checked on the server against `org_members`, the same
 *    check `private.has_org_role()` performs, and never taken from the client.
 *    Row Level Security enforces it a second time on the statement itself, so a
 *    forged POST straight at the action id still cannot write another
 *    organization's rows.
 *  - The organization is resolved from the session, not from the request, so
 *    there is no org id for a caller to tamper with.
 *  - The last owner of an organization can never be demoted or removed.
 *  - Input is validated with zod before it reaches the database.
 *  - Nothing throws at the UI. Every path resolves to
 *    `{ ok: true }` or `{ ok: false, error }`.
 *  - Demo visitors are refused with a friendly message instead of a silent
 *    no-op.
 *  - Successful writes revalidate the dashboard so the page shows the new state.
 */

import { createHash, randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { deliverWorkspaceInvite } from "@/lib/auth/invitations";

import { countOrgOwners, getCurrentContext, getOrgRole, getOrgSettings, listMembers } from "./org";
import {
  API_KEY_PREFIX,
  API_KEY_PREFIX_LENGTH,
  API_SCOPES,
  DASHBOARD_PATH,
  DEFAULT_API_SCOPES,
  ORG_KINDS,
  ORG_ROLES,
  ROLE_LABEL,
  ROLE_RANK,
  actionFailed,
  applySettingsPatch,
  type ActionFailure,
  type ActionResult,
  type ActionResultWith,
  type ApiKey,
  type ApiScope,
  type OrgRole,
  type Organization,
  type SessionUser,
  type WorkspaceSettingsPatch,
  type WorkspaceSettingsSection,
} from "./types";

import { workspaceSettingsPatchSchema } from "./schemas";
import { isValidTimeZone } from "@/lib/time";

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

const SESSION_ENDED = "Your session has ended. Sign in again and retry.";
const NO_WORKSPACE = "You are not a member of a SplicR workspace yet.";
const NOT_A_MEMBER = "You are no longer a member of this workspace.";
const LAST_OWNER =
  "A workspace needs at least one owner. Make somebody else an owner first, then try again.";

interface Caller {
  user: SessionUser;
  org: Organization;
  role: OrgRole;
}

type Authorization = { ok: true; caller: Caller } | ActionFailure;

/**
 * Establish who is calling and confirm they hold at least `minRole` in their
 * own workspace.
 *
 * The role is read back from the database inside the action, rather than reused
 * from anything the browser sent or from a role rendered into the page earlier,
 * so a role that changed in the meantime takes effect immediately.
 */
async function authorize(minRole: OrgRole | null = null): Promise<Authorization> {
  const context = await getCurrentContext();

  if (!context.user) return actionFailed(SESSION_ENDED);
  if (!context.org) return actionFailed(NO_WORKSPACE);

  const role = await getOrgRole(context.org.id, context.user.id);
  if (!role) return actionFailed(NOT_A_MEMBER);

  if (minRole && ROLE_RANK[role] < ROLE_RANK[minRole]) {
    return actionFailed(
      `You need the ${ROLE_LABEL[minRole].toLowerCase()} role to do that. Your role is ${ROLE_LABEL[role].toLowerCase()}.`,
    );
  }

  return { ok: true, caller: { user: context.user, org: context.org, role } };
}

/**
 * Every workspace page renders inside app/dashboard/layout.tsx, so revalidating
 * that layout refreshes the affected route and the shell around it in one call.
 */
function revalidateWorkspace(): void {
  revalidatePath(DASHBOARD_PATH, "layout");
}

interface IssueBag {
  issues: readonly { path: readonly PropertyKey[]; message: string }[];
}

/** Turn a zod failure into one line a form can render. */
function firstIssue(error: IssueBag, fallback = "That input is not valid."): string {
  const issue = error.issues[0];
  if (!issue) return fallback;
  const path = issue.path
    .filter((part): part is string | number => typeof part === "string" || typeof part === "number")
    .join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

/**
 * Keep raw Postgres text out of the UI while still saying something useful.
 * The original is logged for whoever is watching the server.
 */
function dbFailure(scope: string, error: unknown, fallback: string): ActionFailure {
  const record =
    typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  const code = typeof record.code === "string" ? record.code : "";
  console.error(`[data/actions] ${scope}: ${code} ${String(record.message ?? error)}`);

  if (code === "23505") return actionFailed("That already exists.");
  if (code === "23514") return actionFailed("One of those values is out of range.");
  if (code === "42501" || code === "PGRST301") {
    return actionFailed("The database refused that change for your role.");
  }
  return actionFailed(fallback);
}

function rowCount(data: unknown): number {
  return Array.isArray(data) ? data.length : data ? 1 : 0;
}

/**
 * The last value submitted under `key`, trimmed, or null when the field was not
 * submitted at all.
 *
 * Last value wins so that the usual checkbox pattern works: a hidden input with
 * value "false" placed before the checkbox means an unchecked box submits false
 * and a checked box submits true.
 */
function lastValue(formData: FormData, key: string): string | null {
  const values = formData.getAll(key).filter((value): value is string => typeof value === "string");
  return values.length > 0 ? values[values.length - 1].trim() : null;
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

const nameSchema = z
  .string()
  .trim()
  .min(1, "Enter a name.")
  .max(120, "A name can be at most 120 characters.");

/** Matches the profiles_orcid_format check constraint. */
const orcidSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/, "An ORCID looks like 0000-0002-1825-0097.");

/**
 * Update the signed-in user's own profile.
 *
 * Fields: `name`, `orcid`. A field that is not submitted keeps its stored value,
 * so a form may edit one of them alone. An empty `orcid` clears it.
 */
export async function updateProfile(formData: FormData): Promise<ActionResult> {
  const context = await getCurrentContext();
  if (!context.user) return actionFailed(SESSION_ENDED);

  const patch: {
    full_name?: string;
    orcid?: string | null;
    preferred_title?: string | null;
    professional_role?: string | null;
    institution?: string | null;
    time_zone?: string | null;
  } = {};

  const name = lastValue(formData, "name");
  if (name !== null) {
    const parsed = nameSchema.safeParse(name);
    if (!parsed.success) return actionFailed(firstIssue(parsed.error));
    patch.full_name = parsed.data;
  }

  const orcid = lastValue(formData, "orcid");
  if (orcid !== null) {
    if (orcid === "") {
      patch.orcid = null;
    } else {
      const parsed = orcidSchema.safeParse(orcid);
      if (!parsed.success) return actionFailed(firstIssue(parsed.error));
      patch.orcid = parsed.data;
    }
  }

  for (const [field, max] of [
    ["preferred_title", 32],
    ["professional_role", 120],
    ["institution", 160],
  ] as const) {
    const value = lastValue(formData, field);
    if (value === null) continue;
    if (value.length > max) return actionFailed(`${field.replaceAll("_", " ")} is too long.`);
    patch[field] = value || null;
  }

  const timeZone = lastValue(formData, "time_zone");
  if (timeZone !== null) {
    if (timeZone && !isValidTimeZone(timeZone)) return actionFailed("Choose a valid IANA time zone.");
    patch.time_zone = timeZone || null;
  }

  if (Object.keys(patch).length === 0) {
    return actionFailed("Nothing to save. Change a field and try again.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", context.user.id)
    .select("id");

  if (error) return dbFailure("updateProfile", error, "Your profile could not be saved.");
  if (rowCount(data) === 0) {
    return actionFailed("Your profile could not be found. Sign out and sign in again.");
  }

  revalidateWorkspace();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Organization and settings
// ---------------------------------------------------------------------------

const orgNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a workspace name.")
  .max(120, "A workspace name can be at most 120 characters.");

const orgKindSchema = z.enum(ORG_KINDS);

type FieldKind = "number" | "boolean" | "text" | "nullable-text" | "list";

/**
 * Which flat form field names map into organizations.settings, and how each
 * string is read back into JSON. Field names are dotted, for example
 * `qc.max_gini` or `defaults.hit_callers`.
 */
const SETTINGS_FIELDS: Record<WorkspaceSettingsSection, Record<string, FieldKind>> = {
  defaults: {
    library_slug: "nullable-text",
    modality: "text",
    organism_taxid: "number",
    fdr_threshold: "number",
    normalization: "text",
    hit_callers: "list",
    cn_correction: "boolean",
  },
  qc: {
    min_mapping_rate: "number",
    max_zero_fraction: "number",
    max_gini: "number",
    min_reads_per_guide: "number",
    nnmd_threshold: "number",
  },
  retention: {
    raw_reads_days: "number",
    keep_artifacts: "boolean",
  },
  notifications: {
    email_on_complete: "boolean",
    email_on_qc_fail: "boolean",
    weekly_digest: "boolean",
  },
  branding: {
    display_name: "text",
    contact_email: "text",
    institution: "text",
  },
};

const TRUE_VALUES = new Set(["true", "on", "1", "yes"]);
const FALSE_VALUES = new Set(["false", "off", "0", "no", ""]);

function coerceSettingsField(
  formData: FormData,
  key: string,
  kind: FieldKind,
): { ok: true; value: unknown } | ActionFailure {
  if (kind === "list") {
    const raw = formData
      .getAll(key)
      .filter((value): value is string => typeof value === "string")
      .flatMap((value) => value.split(","))
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    return { ok: true, value: Array.from(new Set(raw)) };
  }

  const value = lastValue(formData, key);
  if (value === null) return { ok: true, value: undefined };

  if (kind === "boolean") {
    const normalized = value.toLowerCase();
    if (TRUE_VALUES.has(normalized)) return { ok: true, value: true };
    if (FALSE_VALUES.has(normalized)) return { ok: true, value: false };
    return actionFailed(`${key} must be true or false.`);
  }

  if (kind === "number") {
    if (value === "") return actionFailed(`${key} must be a number.`);
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return actionFailed(`${key} must be a number.`);
    return { ok: true, value: parsed };
  }

  if (kind === "nullable-text") return { ok: true, value: value === "" ? null : value };

  return { ok: true, value };
}

/**
 * Read a settings patch out of a submitted form.
 *
 * Two shapes are accepted. A single `settings` field holding JSON wins when it
 * is present, which suits a client component that builds the document itself.
 * Otherwise flat dotted fields are collected, which suits a plain HTML form.
 * Returns a null patch when the form carries no settings at all.
 */
function readSettingsPatch(
  formData: FormData,
): { ok: true; patch: WorkspaceSettingsPatch | null } | ActionFailure {
  const json = lastValue(formData, "settings");

  if (json !== null && json !== "") {
    let decoded: unknown;
    try {
      decoded = JSON.parse(json);
    } catch {
      return actionFailed("The settings payload was not valid JSON.");
    }
    const parsed = workspaceSettingsPatchSchema.safeParse(decoded);
    if (!parsed.success) return actionFailed(firstIssue(parsed.error));
    return { ok: true, patch: parsed.data };
  }

  const draft: Record<string, Record<string, unknown>> = {};

  for (const [section, fields] of Object.entries(SETTINGS_FIELDS)) {
    for (const [field, kind] of Object.entries(fields)) {
      const key = `${section}.${field}`;
      if (!formData.has(key)) continue;

      const coerced = coerceSettingsField(formData, key, kind);
      if (!coerced.ok) return coerced;
      if (coerced.value === undefined) continue;

      draft[section] ??= {};
      draft[section][field] = coerced.value;
    }
  }

  if (Object.keys(draft).length === 0) return { ok: true, patch: null };

  const parsed = workspaceSettingsPatchSchema.safeParse(draft);
  if (!parsed.success) return actionFailed(firstIssue(parsed.error));
  return { ok: true, patch: parsed.data };
}

/**
 * Update the workspace: `name`, `kind`, and the settings document.
 *
 * Admins and owners only. Fields that are not submitted keep their stored
 * values, and settings are merged section by section rather than replaced, so a
 * form that only edits QC thresholds cannot wipe the notification preferences.
 */
export async function updateOrganization(formData: FormData): Promise<ActionResult> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;
  const { org } = auth.caller;

  const update: Record<string, unknown> = {};

  const name = lastValue(formData, "name");
  if (name !== null) {
    const parsed = orgNameSchema.safeParse(name);
    if (!parsed.success) return actionFailed(firstIssue(parsed.error));
    update.name = parsed.data;
  }

  const kind = lastValue(formData, "kind");
  if (kind !== null && kind !== "") {
    const parsed = orgKindSchema.safeParse(kind);
    if (!parsed.success) {
      return actionFailed(`"${kind}" is not a workspace kind.`);
    }
    update.kind = parsed.data;
  }

  // `logo_url` is deliberately not here. It names a file this application
  // stores, so it is written only by `uploadLabLogo` and `removeLabLogo`,
  // which keep the column and the object in step. A second writer would let
  // the column point somewhere else while the object stayed behind.
  for (const [field, max] of [["location", 160]] as const) {
    const value = lastValue(formData, field);
    if (value === null) continue;
    if (value.length > max) return actionFailed(`${field.replaceAll("_", " ")} is too long.`);
    update[field] = value || null;
  }

  const timeZone = lastValue(formData, "time_zone");
  if (timeZone !== null) {
    if (timeZone && !isValidTimeZone(timeZone)) return actionFailed("Choose a valid IANA time zone.");
    update.time_zone = timeZone || null;
  }

  const patch = readSettingsPatch(formData);
  if (!patch.ok) return patch;

  if (patch.patch !== null) {
    const current = await getOrgSettings(org.id);
    update.settings = applySettingsPatch(current, patch.patch);
  }

  if (Object.keys(update).length === 0) {
    return actionFailed("Nothing to save. Change a field and try again.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .update(update)
    .eq("id", org.id)
    .select("id");

  if (error) return dbFailure("updateOrganization", error, "The workspace could not be saved.");
  if (rowCount(data) === 0) {
    return actionFailed("The workspace could not be saved. Your role may have changed.");
  }

  revalidateWorkspace();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The lab logo
// ---------------------------------------------------------------------------

const LOGO_BUCKET = "lab-logos";

/**
 * The formats a lab logo may be in, and the magic bytes that prove it.
 *
 * The bucket is world readable, so the declared content type is not evidence:
 * anything can claim to be a PNG. SVG is absent on purpose, because an SVG is
 * a script container and a logo is a raster job. `storage.buckets` carries the
 * same three types, so a file that gets past this check still meets a second
 * refusal in the database.
 */
const LOGO_FORMATS: { type: string; extension: string; magic: (bytes: Uint8Array) => boolean }[] = [
  {
    type: "image/png",
    extension: "png",
    magic: (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    type: "image/jpeg",
    extension: "jpg",
    magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    type: "image/webp",
    extension: "webp",
    magic: (b) =>
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
];

/** Matches `storage.buckets.file_size_limit` for this bucket. */
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

type StorageClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Drop every stored logo for this lab except `keep`.
 *
 * Uploading writes a new object rather than overwriting the old one, so that a
 * reader holding the previous URL never sees a half-written file and so a
 * cached copy is never the wrong image under the right name. The old object
 * has to go somewhere, and it goes here. A failure is logged and swallowed:
 * the lab's logo is already correct at that point, and an orphaned 40 KB file
 * is not worth failing a save over.
 */
async function pruneLogos(
  supabase: StorageClient,
  orgId: string,
  keep: string | null,
): Promise<void> {
  const { data, error } = await supabase.storage.from(LOGO_BUCKET).list(orgId, { limit: 100 });
  if (error) {
    console.error(`[data/actions] pruneLogos list: ${error.message}`);
    return;
  }
  const stale = (data ?? [])
    .map((entry) => `${orgId}/${entry.name}`)
    .filter((path) => path !== keep);
  if (stale.length === 0) return;
  const { error: removeError } = await supabase.storage.from(LOGO_BUCKET).remove(stale);
  if (removeError) console.error(`[data/actions] pruneLogos remove: ${removeError.message}`);
}

/**
 * Put the lab's own logo on the workspace.
 *
 * Admins and owners only, re-checked here and again by the storage policy,
 * which reads the organization id out of the object path. The object is
 * written first and the column second, because a column pointing at nothing is
 * a broken image on every report while an object nothing points at is
 * invisible; if the column write fails the object is removed again.
 */
export async function uploadLabLogo(formData: FormData): Promise<ActionResult> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;
  const { org } = auth.caller;

  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) {
    return actionFailed("Choose an image file to upload.");
  }
  if (file.size > LOGO_MAX_BYTES) {
    return actionFailed("That image is larger than 2 MB. Export it smaller and try again.");
  }

  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const format = LOGO_FORMATS.find((candidate) => candidate.magic(head));
  if (!format || format.type !== file.type) {
    return actionFailed("A lab logo has to be a PNG, JPEG or WebP image.");
  }

  const supabase = await createClient();
  const path = `${org.id}/logo-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}.${format.extension}`;

  const { error: uploadError } = await supabase.storage
    .from(LOGO_BUCKET)
    .upload(path, file, { contentType: format.type, cacheControl: "3600", upsert: false });
  if (uploadError) {
    console.error(`[data/actions] uploadLabLogo: ${uploadError.message}`);
    return actionFailed("The logo could not be stored. Try again.");
  }

  const publicUrl = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl;
  if (!publicUrl) {
    await supabase.storage.from(LOGO_BUCKET).remove([path]);
    return actionFailed("The logo was stored but has no address. Try again.");
  }

  const { data, error } = await supabase
    .from("organizations")
    .update({ logo_url: publicUrl })
    .eq("id", org.id)
    .select("id");

  if (error || rowCount(data) === 0) {
    await supabase.storage.from(LOGO_BUCKET).remove([path]);
    if (error) return dbFailure("uploadLabLogo", error, "The logo could not be saved.");
    return actionFailed("The logo could not be saved. Your role may have changed.");
  }

  await pruneLogos(supabase, org.id, path);
  revalidateWorkspace();
  return { ok: true };
}

/** Take the logo off the workspace and delete the file behind it. */
export async function removeLabLogo(): Promise<ActionResult> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;
  const { org } = auth.caller;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .update({ logo_url: null })
    .eq("id", org.id)
    .select("id");

  if (error) return dbFailure("removeLabLogo", error, "The logo could not be removed.");
  if (rowCount(data) === 0) {
    return actionFailed("The logo could not be removed. Your role may have changed.");
  }

  await pruneLogos(supabase, org.id, null);
  revalidateWorkspace();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Members and invites
// ---------------------------------------------------------------------------

const emailSchema = z.email("Enter a valid email address.").max(200);
const roleSchema = z.enum(ORG_ROLES);
const uuidSchema = z.uuid("That record id is not valid.");

/**
 * Invite somebody to the workspace and hand back the invite token.
 *
 * Admins and owners only, and nobody can invite at a role above their own. The
 * token is what `public.accept_org_invite(token)` expects; it is returned once
 * here so the caller can build the link to send. Invites expire after 14 days,
 * which is the column default.
 */
export async function inviteMember(
  email: string,
  role: OrgRole,
): Promise<ActionResultWith<{ token: string; inviteId: string; expiresAt: string; deliveryState: string }>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;
  const { org, user, role: callerRole } = auth.caller;

  const parsedEmail = emailSchema.safeParse(email);
  if (!parsedEmail.success) return actionFailed(firstIssue(parsedEmail.error));

  const parsedRole = roleSchema.safeParse(role);
  if (!parsedRole.success) return actionFailed("Pick one of owner, admin, researcher or viewer.");

  if (ROLE_RANK[parsedRole.data] > ROLE_RANK[callerRole]) {
    return actionFailed(
      `You cannot invite somebody as ${ROLE_LABEL[parsedRole.data].toLowerCase()} because your own role is ${ROLE_LABEL[callerRole].toLowerCase()}.`,
    );
  }

  const address = parsedEmail.data.toLowerCase();

  const members = await listMembers(org.id);
  if (members.some((member) => member.email.toLowerCase() === address)) {
    return actionFailed(`${address} is already a member of this workspace.`);
  }

  const supabase = await createClient();

  const { data: existing, error: existingError } = await supabase
    .from("org_invites")
    .select("id, expires_at")
    .eq("org_id", org.id)
    .eq("email", address)
    .is("accepted_at", null);

  if (existingError) {
    return dbFailure("inviteMember lookup", existingError, "The invite could not be created.");
  }

  const live = (Array.isArray(existing) ? existing : []).filter((row) => {
    const expires = (row as { expires_at?: string }).expires_at;
    return typeof expires === "string" && Date.parse(expires) > Date.now();
  });

  if (live.length > 0) {
    return actionFailed(
      `An invite for ${address} is already pending. Revoke it first to issue a new link.`,
    );
  }

  // Expired rows remain visible in history until a replacement is requested.
  // Remove them now so one address has one active invitation path.
  await supabase
    .from("org_invites")
    .delete()
    .eq("org_id", org.id)
    .eq("email", address)
    .is("accepted_at", null)
    .lte("expires_at", new Date().toISOString());

  await supabase
    .from("splicr_access_allowlist")
    .delete()
    .eq("org_id", org.id)
    .eq("email", address);

  const { error: allowError } = await supabase.from("splicr_access_allowlist").insert({
    email: address,
    org_id: org.id,
    role: parsedRole.data,
    status: "pending",
    create_workspace: false,
    invited_by: user.id,
  });
  if (allowError) {
    return dbFailure("inviteMember allowlist", allowError, "Access could not be authorized for that address.");
  }

  const { data, error } = await supabase
    .from("org_invites")
    .insert({ org_id: org.id, email: address, role: parsedRole.data, invited_by: user.id })
    .select("id, token, expires_at")
    .single();

  if (error) return dbFailure("inviteMember", error, "The invite could not be created.");

  const row = data as { id?: string; token?: string; expires_at?: string } | null;
  if (!row?.id || !row.token || !row.expires_at) {
    return actionFailed("The invite was created but could not be read back.");
  }

  const delivery = await deliverWorkspaceInvite({
    email: address,
    orgName: org.name,
    orgId: org.id,
    role: parsedRole.data,
    invitedBy: user.id,
  });
  const now = new Date().toISOString();
  const { error: deliveryError } = await supabase
    .from("org_invites")
    .update({
      delivery_state: delivery.state,
      delivered_at: delivery.state === "failed" ? null : now,
      delivery_error: delivery.error,
      ...(delivery.state === "existing_user" ? { accepted_at: now } : {}),
    })
    .eq("id", row.id)
    .eq("org_id", org.id);
  if (deliveryError) console.error(`[data/actions] invite delivery state: ${deliveryError.message}`);
  await supabase
    .from("splicr_access_allowlist")
    .update({
      status: delivery.state === "failed" ? "pending" : delivery.state === "existing_user" ? "active" : "invited",
      invited_at: delivery.state === "failed" ? null : now,
    })
    .eq("org_id", org.id)
    .eq("email", address);

  revalidateWorkspace();
  return {
    ok: true,
    token: row.token,
    inviteId: row.id,
    expiresAt: row.expires_at,
    deliveryState: delivery.state,
  };
}

/** Retry delivery without issuing a second token or a second database invite. */
export async function retryInvite(inviteId: string): Promise<ActionResult> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;
  const { org, user } = auth.caller;
  const parsed = uuidSchema.safeParse(inviteId);
  if (!parsed.success) return actionFailed("That invite id is not valid.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("org_invites")
    .select("email, role, expires_at, accepted_at")
    .eq("id", parsed.data)
    .eq("org_id", org.id)
    .maybeSingle();
  if (error || !data || data.accepted_at) return actionFailed("That invite is no longer pending.");
  if (Date.parse(data.expires_at) <= Date.now()) return actionFailed("That invite has expired. Issue a new one.");

  const delivery = await deliverWorkspaceInvite({
    email: data.email,
    orgName: org.name,
    orgId: org.id,
    role: data.role,
    invitedBy: user.id,
  });
  await supabase
    .from("org_invites")
    .update({
      delivery_state: delivery.state,
      delivered_at: delivery.state === "failed" ? null : new Date().toISOString(),
      delivery_error: delivery.error,
      ...(delivery.state === "existing_user" ? { accepted_at: new Date().toISOString() } : {}),
    })
    .eq("id", parsed.data)
    .eq("org_id", org.id);
  await supabase
    .from("splicr_access_allowlist")
    .update({
      status: delivery.state === "failed" ? "pending" : delivery.state === "existing_user" ? "active" : "invited",
      invited_at: delivery.state === "failed" ? null : new Date().toISOString(),
    })
    .eq("org_id", org.id)
    .eq("email", data.email);
  revalidateWorkspace();
  return delivery.state === "failed" ? actionFailed(delivery.error) : { ok: true };
}

/** Withdraw a pending invite. Admins and owners only. */
export async function revokeInvite(inviteId: string): Promise<ActionResult> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;
  const { org } = auth.caller;

  const parsed = uuidSchema.safeParse(inviteId);
  if (!parsed.success) return actionFailed("That invite id is not valid.");

  const supabase = await createClient();
  const invite = await supabase
    .from("org_invites")
    .select("email")
    .eq("id", parsed.data)
    .eq("org_id", org.id)
    .maybeSingle();
  if (invite.data?.email) {
    await supabase
      .from("splicr_access_allowlist")
      .delete()
      .eq("org_id", org.id)
      .eq("email", invite.data.email);
  }
  const { data, error } = await supabase
    .from("org_invites")
    .delete()
    .eq("id", parsed.data)
    .eq("org_id", org.id)
    .select("id");

  if (error) return dbFailure("revokeInvite", error, "The invite could not be revoked.");
  if (rowCount(data) === 0) {
    return actionFailed("That invite no longer exists.");
  }

  revalidateWorkspace();
  return { ok: true };
}

/**
 * Change a member's role.
 *
 * Admins and owners only. Nobody can hand out a role above their own or change
 * the role of somebody who outranks them, which keeps an admin from taking an
 * owner's seat. The last owner cannot be demoted.
 */
export async function changeMemberRole(userId: string, role: OrgRole): Promise<ActionResult> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;
  const { org, role: callerRole } = auth.caller;

  const parsedUser = uuidSchema.safeParse(userId);
  if (!parsedUser.success) return actionFailed("That member id is not valid.");

  const parsedRole = roleSchema.safeParse(role);
  if (!parsedRole.success) return actionFailed("Pick one of owner, admin, researcher or viewer.");

  const target = await getOrgRole(org.id, parsedUser.data);
  if (!target) return actionFailed("That person is not a member of this workspace.");

  if (ROLE_RANK[parsedRole.data] > ROLE_RANK[callerRole]) {
    return actionFailed(
      `You cannot grant the ${ROLE_LABEL[parsedRole.data].toLowerCase()} role because your own role is ${ROLE_LABEL[callerRole].toLowerCase()}.`,
    );
  }

  if (ROLE_RANK[target] > ROLE_RANK[callerRole]) {
    return actionFailed(
      `Only an owner can change the role of an ${ROLE_LABEL[target].toLowerCase()}.`,
    );
  }

  if (target === parsedRole.data) {
    return actionFailed(`That member is already ${ROLE_LABEL[target].toLowerCase()}.`);
  }

  if (target === "owner" && (await countOrgOwners(org.id)) <= 1) {
    return actionFailed(LAST_OWNER);
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("org_members")
    .update({ role: parsedRole.data })
    .eq("org_id", org.id)
    .eq("user_id", parsedUser.data)
    .select("user_id");

  if (error) return dbFailure("changeMemberRole", error, "That role could not be changed.");
  if (rowCount(data) === 0) {
    return actionFailed("That role could not be changed. Your role may have changed.");
  }

  revalidateWorkspace();
  return { ok: true };
}

/**
 * Remove somebody from the workspace.
 *
 * Admins and owners can remove others, and anybody can remove themself, which
 * matches the "admins remove members or members leave" policy. An admin cannot
 * remove an owner, and the last owner cannot leave.
 */
export async function removeMember(userId: string): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth;
  const { org, user, role: callerRole } = auth.caller;

  const parsed = uuidSchema.safeParse(userId);
  if (!parsed.success) return actionFailed("That member id is not valid.");

  const isSelf = parsed.data === user.id;

  if (!isSelf && ROLE_RANK[callerRole] < ROLE_RANK.admin) {
    return actionFailed("You need the admin role to remove somebody else.");
  }

  const target = await getOrgRole(org.id, parsed.data);
  if (!target) return actionFailed("That person is not a member of this workspace.");

  if (!isSelf && ROLE_RANK[target] > ROLE_RANK[callerRole]) {
    return actionFailed(`Only an owner can remove an ${ROLE_LABEL[target].toLowerCase()}.`);
  }

  if (target === "owner" && (await countOrgOwners(org.id)) <= 1) {
    return actionFailed(LAST_OWNER);
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("org_members")
    .delete()
    .eq("org_id", org.id)
    .eq("user_id", parsed.data)
    .select("user_id");

  if (error) return dbFailure("removeMember", error, "That member could not be removed.");
  if (rowCount(data) === 0) {
    return actionFailed("That member could not be removed. Your role may have changed.");
  }

  revalidateWorkspace();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

const apiKeyNameSchema = z
  .string()
  .trim()
  .min(1, "Give the key a name.")
  .max(80, "A key name can be at most 80 characters.");

const scopesSchema = z
  .array(z.enum(API_SCOPES), { error: "Pick at least one scope." })
  .min(1, "Pick at least one scope.");

/**
 * A fresh plaintext key plus the two values the database keeps.
 *
 * 24 random bytes in base64url give exactly 32 url-safe characters, so the key
 * is `spk_live_` plus 32 characters. Only the sha-256 hex digest of the whole
 * key is stored, alongside the first 12 characters for display.
 */
function generateApiKey(): { key: string; prefix: string; hash: string } {
  const key = `${API_KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
  return {
    key,
    prefix: key.slice(0, API_KEY_PREFIX_LENGTH),
    hash: createHash("sha256").update(key).digest("hex"),
  };
}

/**
 * Mint a SplicR Connect key. Admins and owners only.
 *
 * The plaintext is returned exactly once, in this response, and is not
 * recoverable afterwards. Scopes default to the column default, atlas read and
 * hits read.
 */
export async function createApiKey(
  name: string,
  scopes: ApiScope[] = DEFAULT_API_SCOPES,
): Promise<ActionResultWith<{ key: string; apiKey: ApiKey }>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;
  const { org, user } = auth.caller;

  const parsedName = apiKeyNameSchema.safeParse(name);
  if (!parsedName.success) return actionFailed(firstIssue(parsedName.error));

  const requested = Array.isArray(scopes) && scopes.length > 0 ? scopes : DEFAULT_API_SCOPES;
  const parsedScopes = scopesSchema.safeParse(Array.from(new Set(requested)));
  if (!parsedScopes.success) {
    return actionFailed(
      `Scopes must be chosen from ${API_SCOPES.join(", ")}.`,
    );
  }

  const secret = generateApiKey();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("api_keys")
    .insert({
      org_id: org.id,
      name: parsedName.data,
      key_prefix: secret.prefix,
      key_hash: secret.hash,
      scopes: parsedScopes.data,
      created_by: user.id,
    })
    .select("id, name, key_prefix, scopes, created_by, created_at, last_used_at, expires_at, revoked_at")
    .single();

  if (error) return dbFailure("createApiKey", error, "The key could not be created.");

  const row = data as Partial<ApiKey> | null;
  if (!row?.id) return actionFailed("The key was created but could not be read back.");

  const apiKey: ApiKey = {
    id: row.id,
    name: row.name ?? parsedName.data,
    key_prefix: row.key_prefix ?? secret.prefix,
    scopes: row.scopes ?? parsedScopes.data,
    created_by: row.created_by ?? user.id,
    created_at: row.created_at ?? new Date().toISOString(),
    last_used_at: row.last_used_at ?? null,
    expires_at: row.expires_at ?? null,
    revoked_at: row.revoked_at ?? null,
    status: "active",
  };

  revalidateWorkspace();
  return { ok: true, key: secret.key, apiKey };
}

/**
 * Revoke a key. Admins and owners only.
 *
 * The row is kept with `revoked_at` set, so the audit trail and `last_used_at`
 * survive. A key that is already revoked reports that rather than pretending to
 * succeed.
 */
export async function revokeApiKey(keyId: string): Promise<ActionResult> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;
  const { org } = auth.caller;

  const parsed = uuidSchema.safeParse(keyId);
  if (!parsed.success) return actionFailed("That key id is not valid.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", parsed.data)
    .eq("org_id", org.id)
    .is("revoked_at", null)
    .select("id");

  if (error) return dbFailure("revokeApiKey", error, "The key could not be revoked.");
  if (rowCount(data) === 0) {
    return actionFailed("That key is already revoked, or it no longer exists.");
  }

  revalidateWorkspace();
  return { ok: true };
}
