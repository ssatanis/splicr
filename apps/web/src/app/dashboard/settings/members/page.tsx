/**
 * Lab members: who can open this workspace, and what each of them may change.
 *
 * Three states, and none of them throws:
 *
 *  - A signed-in member sees `public.org_members` joined to `public.profiles`,
 *    which is real data even for a lab of one. Admins and owners also see the
 *    pending `public.org_invites`, which nobody below admin can read.
 *  - A demo visitor has no session and therefore no membership, so there is no
 *    organization to read. The page shows sample people with every control
 *    disabled and says exactly that, once, at the top.
 *  - A signed-in visitor with no membership at all gets an explanation rather
 *    than an empty table.
 */
import Link from "next/link";

import { InvitePanel } from "@/components/dashboard/members/invite-panel";
import { MembersTable } from "@/components/dashboard/members/members-table";
import { RoleLegend } from "@/components/dashboard/members/role-legend";
import {
  DEMO_NOTICE,
  expiryLabel,
  type InviteView,
  type MemberView,
  type MembersPermissions,
} from "@/components/dashboard/members/shared";
import { Card, Empty, PageHeader } from "@/components/dashboard/ui";
import {
  getCurrentContext,
  listInvites,
  listMembers,
  type OrgInvite,
  type OrgMember,
} from "@/lib/data/org";
import { DEMO_ORG, roleAtLeast, type OrgRole } from "@/lib/data/types";
import { demoInvites, demoMembers } from "@/lib/mock/members";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Lab members" };

const DAY_MS = 86_400_000;

interface MembersViewProps {
  orgName: string;
  members: MemberView[];
  invites: InviteView[];
  perms: MembersPermissions;
  /** The demo line, shown once above everything else. */
  notice: string | null;
  /** Set after `/invite/<token>` sent somebody here, having just joined. */
  joined?: boolean;
}

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ user, org, role, isDemo }, query] = await Promise.all([
    getCurrentContext(),
    searchParams,
  ]);
  const joined = query.joined === "1";

  // No session means read-only browsing. The proxy only lets that happen with
  // the demo cookie, but falling back on a missing user as well means this page
  // cannot crash on an expired session either.
  if (isDemo || user === null) {
    return <MembersView {...demoView()} />;
  }

  if (org === null) {
    return (
      <div className="space-y-5">
        <Header />
        <Card>
          <Empty
            title="You are not in a workspace yet"
            body="A workspace holds the screens, runs and validation outcomes your lab shares. Create one, or open the invite link somebody sent you."
            action={
              <Link href="/dashboard/settings" className="btn btn-teal btn-sm">
                Workspace settings
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  const canManage = roleAtLeast(role, "admin");

  // Invites are readable by admins and owners only, so there is no point asking
  // for them as a member or a viewer. Row Level Security would return nothing.
  const [memberRows, inviteRows] = await Promise.all([
    listMembers(org.id),
    canManage ? listInvites(org.id) : Promise.resolve([]),
  ]);

  const members = toMemberViews(memberRows, user.id);
  const invites = toInviteViews(inviteRows);

  return (
    <MembersView
      orgName={org.name}
      members={members}
      invites={invites}
      notice={null}
      joined={joined}
      perms={{
        demo: false,
        canManage,
        // A viewer or a member never reaches a control, so the ceiling only
        // matters for admins and owners. Default to viewer rather than to
        // something permissive if the role somehow failed to resolve.
        callerRole: role ?? "viewer",
        ownerCount: members.filter((member) => member.role === "owner").length,
      }}
    />
  );
}

/**
 * Row mappers. These read the clock, which a component may not do during
 * render, so the labels are built here and handed down as finished strings.
 */
function toMemberViews(rows: OrgMember[], selfId: string): MemberView[] {
  return rows.map((member) => ({
    id: member.id,
    name: member.name,
    email: member.email,
    role: member.role,
    joinedLabel: formatDate(member.joined_at),
    isSelf: member.id === selfId,
  }));
}

function toInviteViews(rows: OrgInvite[]): InviteView[] {
  const now = Date.now();
  return rows.map((invite) => ({
    id: invite.id,
    email: invite.email,
    role: invite.role,
    token: invite.token,
    expiresLabel: expiryLabel(invite.expires_at, now),
    expired: invite.expired,
  }));
}

/** Sample content for demo mode, with every control shown and disabled. */
function demoView(): MembersViewProps {
  const now = Date.now();

  return {
    orgName: DEMO_ORG.name,
    notice: DEMO_NOTICE,
    members: demoMembers.map((member) => ({
      id: member.id,
      name: member.name,
      email: member.email,
      role: member.role,
      joinedLabel: formatDate(new Date(now - member.joinedDaysAgo * DAY_MS).toISOString()),
      isSelf: false,
    })),
    invites: demoInvites.map((invite) => ({
      id: invite.id,
      email: invite.email,
      role: invite.role,
      token: invite.token,
      expiresLabel: expiryLabel(
        new Date(now + invite.expiresInDays * DAY_MS).toISOString(),
        now,
      ),
      expired: invite.expiresInDays <= 0,
    })),
    perms: {
      demo: true,
      // An owner's view, so the demo shows the whole page rather than the
      // stripped down one a viewer would get. Nothing here can be submitted:
      // the controls are disabled, and every action refuses demo callers.
      canManage: true,
      callerRole: "owner",
      ownerCount: demoMembers.filter((member) => member.role === "owner").length,
    },
  };
}

function Header() {
  return (
    <PageHeader
      eyebrow="Settings"
      title="Lab members"
      body="Everyone who can open this workspace, and what each of them is allowed to change."
      actions={
        <Link href="/dashboard/settings" className="btn btn-ghost btn-sm">
          Workspace settings
        </Link>
      }
    />
  );
}

function MembersView({ orgName, members, invites, perms, notice, joined }: MembersViewProps) {
  const count = members.length;
  const callerRole: OrgRole | null = perms.demo ? null : perms.callerRole;

  return (
    <div className="space-y-5">
      <Header />

      {notice && (
        <p className="rounded-2xl border border-orange-100 bg-orange-50 px-4 py-3 text-sm text-orange-700">
          {notice}
        </p>
      )}

      {joined && (
        <p className="rounded-2xl border border-cyan-100 bg-cyan-50 px-4 py-3 text-sm text-cyan-700">
          You have joined {orgName}. Its screens, runs and outcomes are yours to work with now.
        </p>
      )}

      {/*
        The side column only splits off at xl. Below that the table keeps the
        full width, which it needs once the email and joined columns appear, and
        the invite panel sits underneath it.

        min-w-0 on both columns: a grid item will not shrink below the widest
        thing inside it unless it is told it may.
      */}
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          <Card
            title="People"
            subtitle={`${count} ${count === 1 ? "person" : "people"} in ${orgName}`}
          >
            <MembersTable
              members={members}
              perms={perms}
              orgName={orgName}
              inviteAnchor={perms.canManage ? "#invite-email" : undefined}
            />

            {!perms.canManage && (
              <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
                Only an owner or an admin of this workspace can invite people or change roles. You
                can leave it yourself at any time.
              </p>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          {perms.canManage && (
            <InvitePanel invites={invites} callerRole={perms.callerRole} demo={perms.demo} />
          )}
          <RoleLegend callerRole={callerRole} />
        </div>
      </div>
    </div>
  );
}
