/**
 * Sample lab members and invites for demo mode.
 *
 * These are the only rows the members page ever invents. A signed-in visitor
 * always sees `public.org_members` and `public.org_invites`, even when the
 * workspace holds nobody but them. Demo mode has no session at all, so there is
 * no organization to read, and the page labels this content as sample data.
 *
 * Offsets rather than fixed timestamps, so the demo does not drift into talking
 * about invites that expired years ago. The addresses use example.org, which is
 * reserved for documentation and can never belong to a real lab.
 */
import type { OrgRole } from "@/lib/data/types";

export interface DemoMember {
  id: string;
  name: string;
  email: string;
  role: OrgRole;
  joinedDaysAgo: number;
}

export interface DemoInvite {
  id: string;
  email: string;
  role: OrgRole;
  token: string;
  /** Negative means the link has already expired. */
  expiresInDays: number;
}

export const demoMembers: DemoMember[] = [
  {
    id: "demo-member-1",
    name: "R. Alvarez",
    email: "r.alvarez@example.org",
    role: "owner",
    joinedDaysAgo: 412,
  },
  {
    id: "demo-member-2",
    name: "M. Chen",
    email: "m.chen@example.org",
    role: "admin",
    joinedDaysAgo: 286,
  },
  {
    id: "demo-member-3",
    name: "S. Okonkwo",
    email: "s.okonkwo@example.org",
    role: "member",
    joinedDaysAgo: 121,
  },
  {
    id: "demo-member-4",
    name: "J. Weber",
    email: "j.weber@example.org",
    role: "viewer",
    joinedDaysAgo: 34,
  },
];

export const demoInvites: DemoInvite[] = [
  {
    id: "demo-invite-1",
    email: "l.novak@example.org",
    role: "member",
    token: "demo-token-live",
    expiresInDays: 11,
  },
  {
    id: "demo-invite-2",
    email: "p.rao@example.org",
    role: "viewer",
    token: "demo-token-stale",
    expiresInDays: -3,
  },
];
