/**
 * Server side reads for the lab workspace.
 *
 * Everything here runs with the caller's own Supabase session, so Row Level
 * Security is what actually decides which rows come back. The functions add
 * shape and resilience on top of that: they never throw at a page, and they
 * return empty results for anonymous or demo visitors instead of crashing.
 *
 * Values such as ROLE_LABEL and DEFAULT_WORKSPACE_SETTINGS live in
 * `@/lib/data/types`, which has no server-only guard, so Client Components can
 * import them. Mutations live in `@/lib/data/actions`.
 */
import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { supabaseConfigured } from "@/lib/supabase/env";
import { DEMO_COOKIE } from "@/lib/supabase/proxy";
import { createClient } from "@/lib/supabase/server";

import {
  DEFAULT_WORKSPACE_SETTINGS,
  DEMO_ORG,
  DEMO_ORG_ID,
  ROLE_RANK,
  isOrgKind,
  isOrgRole,
  isPlanTier,
  isUuid,
  type ApiKey,
  type ApiKeyStatus,
  type OrgInvite,
  type OrgMember,
  type OrgRole,
  type Organization,
  type Profile,
  type SessionUser,
  type WorkspaceContext,
  type WorkspaceSettings,
  type WorkspaceStats,
} from "./types";

import { parseWorkspaceSettings } from "./schemas";

export type {
  ApiKey,
  ApiKeyStatus,
  OrgInvite,
  OrgMember,
  OrgRole,
  Organization,
  Profile,
  SessionUser,
  WorkspaceContext,
  WorkspaceSettings,
  WorkspaceStats,
} from "./types";

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * The Supabase client is untyped in this repo (there is no generated Database
 * type yet), so query results arrive loosely typed. These row shapes are the
 * contract between the select strings below and the mappers underneath them.
 */
interface ProfileRow {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  orcid?: string | null;
  default_org_id?: string | null;
}

interface OrganizationRow {
  id: string;
  slug: string;
  name: string;
  kind: string;
  plan: string;
  created_at: string;
  updated_at: string;
}

interface MembershipRow {
  role: string;
  created_at: string;
  organizations: OrganizationRow | OrganizationRow[] | null;
}

interface MemberRow {
  user_id: string;
  role: string;
  created_at: string;
}

interface InviteRow {
  id: string;
  email: string;
  role: string;
  token: string;
  invited_by: string | null;
  expires_at: string;
  created_at: string;
}

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[] | null;
  created_by: string | null;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

const PROFILE_COLUMNS = "id, email, full_name, avatar_url, orcid, default_org_id";
const ORGANIZATION_COLUMNS = "id, slug, name, kind, plan, created_at, updated_at";
const INVITE_COLUMNS = "id, email, role, token, invited_by, expires_at, created_at";
const API_KEY_COLUMNS =
  "id, name, key_prefix, scopes, created_by, created_at, last_used_at, expires_at, revoked_at";

function asRows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

function asRow<T>(data: unknown): T | null {
  if (data === null || data === undefined) return null;
  if (Array.isArray(data)) return (data[0] as T | undefined) ?? null;
  return data as T;
}

/** One place to notice a failed read without taking the page down with it. */
function noteFailure(scope: string, detail: unknown): void {
  const message =
    detail instanceof Error
      ? detail.message
      : typeof detail === "object" && detail !== null && "message" in detail
        ? String((detail as { message: unknown }).message)
        : String(detail);
  console.error(`[data/org] ${scope}: ${message}`);
}

/** A real organization id, as opposed to the demo placeholder. */
function isQueryableOrgId(orgId: string | null | undefined): orgId is string {
  return isUuid(orgId) && orgId !== DEMO_ORG_ID && supabaseConfigured;
}

function toOrganization(row: OrganizationRow | null): Organization | null {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    kind: isOrgKind(row.kind) ? row.kind : "personal",
    plan: isPlanTier(row.plan) ? row.plan : "free",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toProfile(row: ProfileRow | null): Profile | null {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email ?? "",
    full_name: row.full_name ?? null,
    avatar_url: row.avatar_url ?? null,
    orcid: row.orcid ?? null,
    default_org_id: row.default_org_id ?? null,
  };
}

/** Fall back to the local part of the address when a profile has no name. */
function displayName(profile: ProfileRow | undefined, fallback: string): string {
  const named = profile?.full_name?.trim();
  if (named) return named;
  const email = profile?.email?.trim();
  if (email) return email.split("@")[0];
  return fallback;
}

function apiKeyStatus(row: ApiKeyRow, now: number): ApiKeyStatus {
  if (row.revoked_at) return "revoked";
  if (row.expires_at && Date.parse(row.expires_at) <= now) return "expired";
  return "active";
}

function anonymousContext(isDemo: boolean): WorkspaceContext {
  // A demo visitor gets the lowest role so that any role gated control is
  // already closed before the mutation refuses as well.
  return {
    user: null,
    profile: null,
    org: isDemo ? DEMO_ORG : null,
    role: isDemo ? "viewer" : null,
    isDemo,
  };
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/**
 * Resolve who is asking, which workspace they are in and what they may do.
 *
 * The user comes from `auth.getClaims()`, which verifies the JWT signature
 * locally against the project JWKS, so the identity is trustworthy without a
 * round trip to the auth server. The organization is the profile's
 * `default_org_id` when that membership still exists, otherwise the oldest
 * membership.
 *
 * Wrapped in React `cache()` so a layout and the page beneath it share one
 * lookup per request. Never throws: an anonymous visitor with the demo cookie
 * gets a read-only demo context, and anyone else gets nulls.
 */
export const getCurrentContext = cache(async (): Promise<WorkspaceContext> => {
  const cookieStore = await cookies();
  const isDemoCookie = cookieStore.get(DEMO_COOKIE)?.value === "1";

  if (!supabaseConfigured) return anonymousContext(isDemoCookie);

  try {
    const supabase = await createClient();
    const { data: claimsData } = await supabase.auth.getClaims();
    const claims = claimsData?.claims;
    const userId = typeof claims?.sub === "string" ? claims.sub : null;

    if (!userId) return anonymousContext(isDemoCookie);

    const metadata = (claims?.user_metadata ?? null) as { preferred_title?: unknown } | null;
    const user: SessionUser = {
      id: userId,
      email: typeof claims?.email === "string" ? claims.email : null,
      preferredTitle:
        typeof metadata?.preferred_title === "string" && metadata.preferred_title.trim()
          ? metadata.preferred_title.trim()
          : null,
    };

    const [profileResult, membershipResult] = await Promise.all([
      supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", userId).maybeSingle(),
      supabase
        .from("org_members")
        .select(`role, created_at, organizations!inner(${ORGANIZATION_COLUMNS})`)
        .eq("user_id", userId)
        .order("created_at", { ascending: true }),
    ]);

    if (profileResult.error) noteFailure("getCurrentContext profile", profileResult.error);
    if (membershipResult.error) {
      noteFailure("getCurrentContext memberships", membershipResult.error);
    }

    const profile = toProfile(asRow<ProfileRow>(profileResult.data));
    const memberships = asRows<MembershipRow>(membershipResult.data);

    const preferred =
      memberships.find((row) => {
        const org = asRow<OrganizationRow>(row.organizations);
        return org !== null && org.id === profile?.default_org_id;
      }) ?? memberships[0];

    const org = toOrganization(asRow<OrganizationRow>(preferred?.organizations ?? null));
    const roleValue = preferred?.role;
    const role = isOrgRole(roleValue) ? roleValue : null;

    return { user, profile, org, role: org ? role : null, isDemo: false };
  } catch (error) {
    noteFailure("getCurrentContext", error);
    return anonymousContext(isDemoCookie);
  }
});

/**
 * The caller's role in one organization, read fresh from the database.
 *
 * `private.has_org_role()` itself is not reachable over the Data API: the
 * `private` schema has no USAGE grant for the `authenticated` role, on purpose.
 * This reads `org_members` instead, which is guarded by the
 * "members read membership of their organizations" policy, and compares ranks
 * with the same ordering as `private.role_rank()`. RLS still enforces the rule
 * a second time on every write.
 */
export async function getOrgRole(orgId: string, userId: string): Promise<OrgRole | null> {
  if (!isQueryableOrgId(orgId) || !isUuid(userId)) return null;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("org_members")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      noteFailure("getOrgRole", error);
      return null;
    }

    const roleValue = asRow<{ role: string }>(data)?.role;
    return isOrgRole(roleValue) ? roleValue : null;
  } catch (error) {
    noteFailure("getOrgRole", error);
    return null;
  }
}

/** Server side mirror of `private.has_org_role(org, min_role)`. */
export async function hasOrgRole(
  orgId: string,
  userId: string,
  minRole: OrgRole,
): Promise<boolean> {
  const role = await getOrgRole(orgId, userId);
  return role !== null && ROLE_RANK[role] >= ROLE_RANK[minRole];
}

/** How many owners an organization has. Used to protect the last owner. */
export async function countOrgOwners(orgId: string): Promise<number> {
  if (!isQueryableOrgId(orgId)) return 0;

  try {
    const supabase = await createClient();
    const { count, error } = await supabase
      .from("org_members")
      .select("user_id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("role", "owner");

    if (error) {
      noteFailure("countOrgOwners", error);
      return 0;
    }
    return count ?? 0;
  } catch (error) {
    noteFailure("countOrgOwners", error);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Members and invites
// ---------------------------------------------------------------------------

/**
 * Everyone in an organization, with their profile joined on.
 *
 * `org_members.user_id` and `profiles.id` both point at `auth.users`, and there
 * is no foreign key between the two tables, so PostgREST cannot embed one in
 * the other. The join happens here over two queries instead. Owners come first,
 * then admins, then members, then viewers, each group sorted by name.
 */
export async function listMembers(orgId: string): Promise<OrgMember[]> {
  if (!isQueryableOrgId(orgId)) return [];

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("org_members")
      .select("user_id, role, created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: true });

    if (error) {
      noteFailure("listMembers", error);
      return [];
    }

    const memberRows = asRows<MemberRow>(data);
    if (memberRows.length === 0) return [];

    const { data: profileData, error: profileError } = await supabase
      .from("profiles")
      .select("id, email, full_name, avatar_url")
      .in(
        "id",
        memberRows.map((row) => row.user_id),
      );

    if (profileError) noteFailure("listMembers profiles", profileError);

    const profiles = new Map(
      asRows<ProfileRow>(profileData).map((row) => [row.id, row] as const),
    );

    const members: OrgMember[] = memberRows.map((row) => {
      const profile = profiles.get(row.user_id);
      return {
        id: row.user_id,
        name: displayName(profile, "Pending member"),
        email: profile?.email ?? "",
        role: isOrgRole(row.role) ? row.role : "viewer",
        avatar: profile?.avatar_url ?? null,
        joined_at: row.created_at,
      };
    });

    return members.sort((a, b) => {
      const byRole = ROLE_RANK[b.role] - ROLE_RANK[a.role];
      return byRole !== 0 ? byRole : a.name.localeCompare(b.name);
    });
  } catch (error) {
    noteFailure("listMembers", error);
    return [];
  }
}

/**
 * Invites that nobody has accepted yet, newest first.
 *
 * Invites past `expires_at` are kept and marked `expired` so the team page can
 * show a stale link and offer to revoke it, rather than losing track of it.
 * Only admins and owners can read this table.
 */
export async function listInvites(orgId: string): Promise<OrgInvite[]> {
  if (!isQueryableOrgId(orgId)) return [];

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("org_invites")
      .select(INVITE_COLUMNS)
      .eq("org_id", orgId)
      .is("accepted_at", null)
      .order("created_at", { ascending: false });

    if (error) {
      noteFailure("listInvites", error);
      return [];
    }

    const now = Date.now();
    return asRows<InviteRow>(data).map((row) => ({
      id: row.id,
      email: row.email,
      role: isOrgRole(row.role) ? row.role : "member",
      token: row.token,
      invited_by: row.invited_by,
      expires_at: row.expires_at,
      created_at: row.created_at,
      expired: Date.parse(row.expires_at) <= now,
    }));
  } catch (error) {
    noteFailure("listInvites", error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * The workspace settings document, always complete.
 *
 * Missing or malformed sections of `organizations.settings` fall back to
 * DEFAULT_WORKSPACE_SETTINGS, so a page can read `settings.qc.max_gini` without
 * guarding every level.
 */
export async function getOrgSettings(orgId: string): Promise<WorkspaceSettings> {
  if (!isQueryableOrgId(orgId)) return DEFAULT_WORKSPACE_SETTINGS;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("organizations")
      .select("settings")
      .eq("id", orgId)
      .maybeSingle();

    if (error) {
      noteFailure("getOrgSettings", error);
      return DEFAULT_WORKSPACE_SETTINGS;
    }

    const row = asRow<{ settings: unknown }>(data);
    return parseWorkspaceSettings(row?.settings);
  } catch (error) {
    noteFailure("getOrgSettings", error);
    return DEFAULT_WORKSPACE_SETTINGS;
  }
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

/**
 * API keys for an organization, newest first, never including `key_hash`.
 *
 * The hash is the only copy of the key the database holds, and nothing in the
 * web app needs it, so it is not even selected. Readable by admins and owners.
 */
export async function listApiKeys(orgId: string): Promise<ApiKey[]> {
  if (!isQueryableOrgId(orgId)) return [];

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("api_keys")
      .select(API_KEY_COLUMNS)
      .eq("org_id", orgId)
      .order("created_at", { ascending: false });

    if (error) {
      noteFailure("listApiKeys", error);
      return [];
    }

    const now = Date.now();
    return asRows<ApiKeyRow>(data).map((row) => ({
      id: row.id,
      name: row.name,
      key_prefix: row.key_prefix,
      scopes: row.scopes ?? [],
      created_by: row.created_by,
      created_at: row.created_at,
      last_used_at: row.last_used_at,
      expires_at: row.expires_at,
      revoked_at: row.revoked_at,
      status: apiKeyStatus(row, now),
    }));
  } catch (error) {
    noteFailure("listApiKeys", error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Headline counts
// ---------------------------------------------------------------------------

const EMPTY_STATS: WorkspaceStats = {
  screens: 0,
  runs: 0,
  hits: 0,
  outcomes: 0,
  members: 0,
};

/** PostgREST serves at most 1000 rows per request, so the sum below pages. */
const SCREEN_PAGE_SIZE = 1000;
/** Safety stop. Twenty pages is 20,000 screens, well past any real workspace. */
const MAX_SCREEN_PAGES = 20;

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Total hits in a workspace, summed from `screens.n_hits`.
 *
 * Counting `public.hits` directly is the obvious implementation and it does not
 * work here. The "read hits" policy is
 * `private.can_read_screen(hits.screen_id)`, which takes the row's own column,
 * so Postgres cannot hoist it out of the scan and runs it once per candidate
 * row. Measured against this project's database, one screen with 19,115 hits
 * costs 3.5s of server time and 76,000 buffer hits, and the same request over
 * PostgREST returns 500 with 57014, statement timeout. The `authenticated` role
 * has `statement_timeout=8s`, so the count starts failing outright at roughly
 * twice today's data, and it can never be a blocking dashboard read.
 *
 * `screens.n_hits` is the same number by construction: the engine sets it in
 * the same statement that finishes a run, from
 * `count(*) from hits where run_id = <run>` (engine/splicr/db.py). Reading it
 * touches one row per screen instead of one function call per hit. Where a
 * screen has been re-run, this is also the more truthful figure, because it
 * counts the current hits rather than every superseded run as well.
 */
async function sumScreenHits(supabase: ServerClient, orgId: string): Promise<number> {
  let total = 0;

  for (let page = 0; page < MAX_SCREEN_PAGES; page += 1) {
    const from = page * SCREEN_PAGE_SIZE;
    const { data, error } = await supabase
      .from("screens")
      .select("n_hits")
      .eq("org_id", orgId)
      .order("id", { ascending: true })
      .range(from, from + SCREEN_PAGE_SIZE - 1);

    if (error) {
      noteFailure("getWorkspaceStats hits", error);
      return total;
    }

    const rows = asRows<{ n_hits: number | null }>(data);
    for (const row of rows) total += row.n_hits ?? 0;
    if (rows.length < SCREEN_PAGE_SIZE) break;
  }

  return total;
}

/**
 * Counts for the workspace header, gathered in parallel.
 *
 * Four of the five are `head: true` counts, so no rows travel over the wire.
 * Hits are summed from `screens.n_hits` instead of counted, for the reason
 * documented on `sumScreenHits`.
 *
 * Every figure is scoped to `org_id`. That matters for more than tidiness: the
 * screens policy also exposes public screens belonging to other organizations,
 * and these numbers must only ever be the workspace's own.
 */
export async function getWorkspaceStats(orgId: string): Promise<WorkspaceStats> {
  if (!isQueryableOrgId(orgId)) return EMPTY_STATS;

  try {
    const supabase = await createClient();
    const [screens, runs, hits, outcomes, members] = await Promise.all([
      supabase
        .from("screens")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId),
      supabase.from("runs").select("id", { count: "exact", head: true }).eq("org_id", orgId),
      sumScreenHits(supabase, orgId),
      supabase
        .from("validation_outcomes")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId),
      supabase
        .from("org_members")
        .select("user_id", { count: "exact", head: true })
        .eq("org_id", orgId),
    ]);

    for (const [scope, result] of [
      ["screens", screens],
      ["runs", runs],
      ["outcomes", outcomes],
      ["members", members],
    ] as const) {
      if (result.error) noteFailure(`getWorkspaceStats ${scope}`, result.error);
    }

    return {
      screens: screens.count ?? 0,
      runs: runs.count ?? 0,
      hits,
      outcomes: outcomes.count ?? 0,
      members: members.count ?? 0,
    };
  } catch (error) {
    noteFailure("getWorkspaceStats", error);
    return EMPTY_STATS;
  }
}
