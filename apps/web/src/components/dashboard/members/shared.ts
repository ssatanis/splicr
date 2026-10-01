/**
 * View models and copy shared by the lab members page and its controls.
 *
 * Nothing here is server only, so the Server Component page and the Client
 * Components under it import the same shapes and the same sentences. Reads live
 * in `@/lib/data/org` and mutations in `@/lib/data/actions`.
 *
 * Dates arrive already formatted. Anything derived from the current clock is
 * computed once on the server and passed down as a string, so the first client
 * render matches the server render and hydration stays quiet.
 */
import { ROLE_RANK, type OrgRole } from "@/lib/data/types";

// ---------------------------------------------------------------------------
// View models
// ---------------------------------------------------------------------------

/** One row of the members table. */
export interface MemberView {
  id: string;
  name: string;
  email: string;
  role: OrgRole;
  /** Preformatted join date, for example "Mar 4, 2026". */
  joinedLabel: string;
  /** True for the signed-in viewer's own row. */
  isSelf: boolean;
}

/** One pending invite, with its expiry already put into words. */
export interface InviteView {
  id: string;
  email: string;
  role: OrgRole;
  /**
   * The invite token, which is what `/invite/<token>` and
   * `public.accept_org_invite()` expect. Only admins and owners can read the
   * `org_invites` row, and only they are shown this panel, so the token reaches
   * the browser of somebody who is allowed to pass it on.
   */
  token: string;
  expiresLabel: string;
  expired: boolean;
  deliveryState: "pending" | "sent" | "existing_user" | "failed" | "revoked";
  deliveryError: string | null;
}

/** Everything the controls need in order to decide what is allowed. */
export interface MembersPermissions {
  /** True for admins and owners: the role and remove controls are theirs. */
  canManage: boolean;
  /** The viewer's own role, which is the ceiling on any role they may grant. */
  callerRole: OrgRole;
  /** Owners left in the workspace. One means the last owner is protected. */
  ownerCount: number;
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

/**
 * What each role can actually do, taken from the Row Level Security policies
 * rather than from wishful thinking: members create and update screens and
 * trigger runs, admins additionally manage membership, settings, API keys and
 * screen deletion, owners additionally delete the workspace, and viewers hold
 * select rights alone.
 */
export const ROLE_SUMMARY: Record<OrgRole, string> = {
  owner: "Everything an admin can do, and can rename, re-plan or delete the workspace.",
  admin: "Invites people, sets roles, edits workspace settings and manages API keys.",
  member: "Uploads runs, calls hits, flags artifacts and logs validation outcomes.",
  viewer: "Reads screens, hits and reports. Cannot start a run or change anything.",
};

const LAST_OWNER_ROLE =
  "This is the only owner of the workspace. Make somebody else an owner first, then this role can change.";
const LAST_OWNER_REMOVE =
  "This is the only owner of the workspace. Make somebody else an owner before removing them.";
const LAST_OWNER_LEAVE =
  "You are the only owner of the workspace. Make somebody else an owner before you leave.";
const OWNER_OUTRANKS_ROLE = "Only an owner can change the role of an owner.";
const OWNER_OUTRANKS_REMOVE = "Only an owner can remove an owner.";

// ---------------------------------------------------------------------------
// Permission rules
// ---------------------------------------------------------------------------

/**
 * Why this member's role cannot be changed, or null when it can.
 *
 * These are the same rules `changeMemberRole` enforces on the server. Stating
 * them here turns them into a disabled control with an explanation, instead of
 * an error message after the click. The server remains the authority: it
 * re-reads the caller's role inside the action, and Row Level Security checks
 * it again on the statement.
 *
 */
export function roleLockReason(member: MemberView, perms: MembersPermissions): string | null {
  if (member.role === "owner" && perms.ownerCount <= 1) return LAST_OWNER_ROLE;
  if (ROLE_RANK[member.role] > ROLE_RANK[perms.callerRole]) return OWNER_OUTRANKS_ROLE;
  return null;
}

/** Why this member cannot be removed, or null when they can. Mirrors `removeMember`. */
export function removeLockReason(member: MemberView, perms: MembersPermissions): string | null {
  if (member.role === "owner" && perms.ownerCount <= 1) {
    return member.isSelf ? LAST_OWNER_LEAVE : LAST_OWNER_REMOVE;
  }
  if (member.isSelf) return null;
  if (!perms.canManage) return "You need the admin or owner role to remove somebody else.";
  if (ROLE_RANK[member.role] > ROLE_RANK[perms.callerRole]) return OWNER_OUTRANKS_REMOVE;
  return null;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/**
 * An invite expiry in words, for example "Expires in 12 days" or
 * "Expired 3 days ago". Call it on the server and pass the string down.
 */
export function expiryLabel(expiresAt: string, now: number = Date.now()): string {
  const parsed = Date.parse(expiresAt);
  if (Number.isNaN(parsed)) return "No expiry on record";

  const remaining = parsed - now;
  const days = Math.round(Math.abs(remaining) / DAY_MS);

  if (remaining <= 0) {
    if (days === 0) return "Expired today";
    if (days === 1) return "Expired yesterday";
    return `Expired ${days} days ago`;
  }
  if (days === 0) return "Expires within a day";
  if (days === 1) return "Expires tomorrow";
  return `Expires in ${days} days`;
}

/** Role chip colors, all from the SplicR tokens in globals.css. */
export const ROLE_CHIP: Record<OrgRole, string> = {
  owner: "bg-teal-50 text-teal-800",
  admin: "bg-cyan-50 text-cyan-700",
  member: "bg-mist-soft text-ink",
  viewer: "bg-mist-soft text-muted",
};

/** The link an invited person opens. Built in the browser, where the origin is known. */
export function inviteUrl(token: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/invite/${encodeURIComponent(token)}`;
}
