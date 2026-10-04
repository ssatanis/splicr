/**
 * What a lab has used, and which of its people used it.
 *
 * WHO PAYS FOR WHAT, AND WHY THIS FILE EXISTS
 *
 * A plan is a column on `public.organizations`. It is on nothing else: a
 * profile has no plan, and there is no per-person meter anywhere in the schema.
 * An invited researcher gets membership of the inviting lab and no workspace of
 * their own, because `private.handle_new_user()` only creates an organization
 * for somebody whose allowlist row says `create_workspace`, which the invite
 * path sets to false. So every screen they upload and every run they start is
 * written with the lab's `org_id`, and there is no second plan for it to land
 * on. That is the arrangement; this module reports it rather than arranging it.
 *
 * ONE CALL, NOT ONE PER PERSON
 *
 * `public.org_usage` returns the whole page as a single jsonb document. The
 * alternative is a count per member per metric, which is a dozen round trips
 * for a lab of three and runs into the 1000-row PostgREST cap on the metrics
 * that matter most. The function checks membership once at the top, so a
 * failed read here means the caller is not in that workspace, not that the
 * workspace is empty.
 *
 * A FAILED READ IS NOT AN EMPTY LAB
 *
 * `status` distinguishes them, like every other workspace read in this console.
 * A lab that has done nothing yet reports zeros with `ready`; a lab whose usage
 * could not be read says so and shows no numbers at all.
 */
import "server-only";

import { createClient } from "@/lib/supabase/server";
import { isPlanTier, isOrgRole, type OrgRole, type PlanTier } from "@/lib/data/types";

/** One person in the lab, and what the lab's plan has carried on their behalf. */
export interface MemberUsage {
  userId: string;
  name: string;
  email: string;
  role: OrgRole;
  screens: number;
  runs: number;
  /** Runs started in the last 30 days, which is the number that moves. */
  runs30d: number;
  outcomes: number;
  /** Live keys only. A revoked key is not usage, it is history. */
  apiKeys: number;
  /** ISO timestamp of their most recent screen, run, outcome or key use. */
  lastActiveAt: string | null;
  joinedAt: string;
}

export interface UsageTotals {
  screens: number;
  runs: number;
  runs30d: number;
  outcomes: number;
  apiKeys: number;
  members: number;
  pendingInvites: number;
}

/** Work nobody currently in the lab can be credited with. */
export interface UnattributedUsage {
  screens: number;
  runs: number;
  outcomes: number;
  apiKeys: number;
}

export type UsageView =
  | {
      status: "ready";
      plan: PlanTier;
      people: MemberUsage[];
      totals: UsageTotals;
      unattributed: UnattributedUsage;
    }
  | { status: "unavailable" }
  | { status: "no-workspace" };

function int(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stamp(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toMember(row: unknown): MemberUsage | null {
  if (row === null || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const userId = text(r.user_id);
  if (userId === "") return null;
  const role = r.role;
  return {
    userId,
    name: text(r.name) || text(r.email) || "Unknown",
    email: text(r.email),
    // The database enum is the authority. An unrecognised value is read as the
    // least privileged role rather than guessed at.
    role: isOrgRole(role) ? role : "viewer",
    screens: int(r.screens),
    runs: int(r.runs),
    runs30d: int(r.runs_30d),
    outcomes: int(r.outcomes),
    apiKeys: int(r.api_keys),
    lastActiveAt: stamp(r.last_active_at),
    joinedAt: text(r.joined_at),
  };
}

/**
 * Everything one workspace has used.
 *
 * `orgId` is the caller's own workspace as resolved by `getCurrentContext`.
 * Passing somebody else's is refused by the function, not by this code.
 */
export async function getOrgUsage(orgId: string | null): Promise<UsageView> {
  if (!orgId) return { status: "no-workspace" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("org_usage", { p_org: orgId });

  if (error) {
    console.error(`[data/usage] org_usage: ${error.message}`);
    return { status: "unavailable" };
  }
  if (data === null || typeof data !== "object") return { status: "unavailable" };

  const doc = data as Record<string, unknown>;
  const rawPeople = Array.isArray(doc.people) ? doc.people : [];
  const totals = (doc.totals ?? {}) as Record<string, unknown>;
  const spare = (doc.unattributed ?? {}) as Record<string, unknown>;
  const plan = doc.plan;

  return {
    status: "ready",
    plan: isPlanTier(plan) ? plan : "free",
    people: rawPeople.map(toMember).filter((person): person is MemberUsage => person !== null),
    totals: {
      screens: int(totals.screens),
      runs: int(totals.runs),
      runs30d: int(totals.runs_30d),
      outcomes: int(totals.outcomes),
      apiKeys: int(totals.api_keys),
      members: int(totals.members),
      pendingInvites: int(totals.pending_invites),
    },
    unattributed: {
      screens: int(spare.screens),
      runs: int(spare.runs),
      outcomes: int(spare.outcomes),
      apiKeys: int(spare.api_keys),
    },
  };
}
