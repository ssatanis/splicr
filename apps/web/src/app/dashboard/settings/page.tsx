import { Info } from "lucide-react";

import { DEFAULT_PANEL, isPanelKey } from "@/components/dashboard/settings/panels";
import { SettingsWorkspace } from "@/components/dashboard/settings/settings-workspace";
import type { UsagePanelProps, UsageRow } from "@/components/dashboard/settings/usage-panel";
import { PageHeader } from "@/components/dashboard/ui";
import { listLibraries } from "@/lib/data/libraries";
import { getCurrentContext, getOrgSettings, getWorkspaceStats } from "@/lib/data/org";
import { getOrgUsage, type UsageView } from "@/lib/data/usage";
import {
  DEFAULT_WORKSPACE_SETTINGS,
  ORG_KIND_LABEL,
  PLAN_LABEL,
  ROLE_LABEL,
  roleAtLeast,
  type WorkspaceStats,
} from "@/lib/data/types";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Settings" };

const EMPTY_STATS: WorkspaceStats = { screens: 0, runs: 0, hits: 0, outcomes: 0, members: 0 };

/**
 * Lab workspace settings.
 *
 * Everything on this page is read with the caller's own session, so Row Level
 * Security decides what comes back, and every panel writes through a Server
 * Action that re-checks the caller's role before it touches a row.
 *
 * Three states have to work:
 *
 *  - A member of a workspace, at whatever role. Panels above their role are
 *    read only and say why.
 *  - A demo visitor with no session. The page renders the defaults a new
 *    workspace starts with, says so, and refuses every save.
 *  - Somebody signed in who is not in a workspace yet. Their profile is still
 *    theirs to edit; the workspace panels explain what is missing.
 */
export default async function SettingsPage(props: PageProps<"/dashboard/settings">) {
  const [context, params] = await Promise.all([getCurrentContext(), props.searchParams]);
  const { user, profile, org, role } = context;

  const [settings, stats, catalog, usage] = await Promise.all([
    org ? getOrgSettings(org.id) : Promise.resolve(DEFAULT_WORKSPACE_SETTINGS),
    org ? getWorkspaceStats(org.id) : Promise.resolve(EMPTY_STATS),
    listLibraries(),
    getOrgUsage(org?.id ?? null),
  ]);

  const requested = params.panel;
  const panel = isPanelKey(requested) ? requested : DEFAULT_PANEL;

  const signedIn = user !== null;
  const canEditProfile = signedIn;
  const canEditOrg = signedIn && org !== null && roleAtLeast(role, "admin");
  const canDelete = signedIn && org !== null && role === "owner";

  const profileLockedReason = !signedIn
      ? "Sign in to edit your profile."
      : undefined;

  const orgLockedReason = !signedIn
      ? "Sign in to change the workspace."
      : org === null
        ? "You are not in a workspace yet, so there is nothing here to change. Accept an invite, or create a workspace, and these panels open up."
        : !roleAtLeast(role, "admin")
          ? `Changing how screens are analysed needs the admin role. Yours is ${role ? ROLE_LABEL[role].toLowerCase() : "unknown"}, so this panel is read only.`
          : undefined;

  const deleteLockedReason = !signedIn
      ? "Sign in to manage the workspace."
      : org === null
        ? "You are not in a workspace yet, so there is nothing to delete."
        : role !== "owner"
          ? `Only an owner can delete a workspace. Your role is ${role ? ROLE_LABEL[role].toLowerCase() : "unknown"}, so ask an owner to do it.`
          : undefined;

  const chips: string[] = [];
  if (org) {
    chips.push(org.name, ORG_KIND_LABEL[org.kind], `${PLAN_LABEL[org.plan]} plan`);
  }
  if (role) chips.push(`You are ${ROLE_LABEL[role].toLowerCase()}`);

  return (
    <div>
      <PageHeader
        eyebrow="Settings"
        title="Lab workspace"
        body="Manage your profile, lab, and default settings for new runs. Each section saves separately."
      />

      {chips.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <span key={chip} className="chip bg-mist-soft text-xs">
              {chip}
            </span>
          ))}
        </div>
      )}

      {org === null && (
        <p className="mb-5 flex items-start gap-2.5 rounded-2xl border border-line bg-white px-4 py-3 text-sm text-body">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-cyan-600" strokeWidth={1.8} />
          <span>
            You are signed in but not in a workspace yet. Your profile is still yours to edit. The
            workspace panels below show the defaults a new workspace starts with, and cannot be
            saved until you belong to one.
          </span>
        </p>
      )}

      <SettingsWorkspace
        initialPanel={panel}
        user={user}
        profile={profile}
        org={org}
        role={role}
        settings={settings}
        stats={stats}
        libraries={catalog.libraries}
        librariesUnavailable={catalog.unavailable}
        createdLabel={org ? formatDate(org.created_at) : "Not created yet"}
        usage={toUsagePanel(usage, org?.name ?? null, canEditOrg, user?.id ?? null)}
        canEditProfile={canEditProfile}
        canEditOrg={canEditOrg}
        canDelete={canDelete}
        orgLockedReason={orgLockedReason}
        profileLockedReason={profileLockedReason}
        deleteLockedReason={deleteLockedReason}
      />
    </div>
  );
}

/**
 * The usage read, turned into something a client component can render.
 *
 * Every date becomes a string here, on the server, because formatting one
 * reads the clock and a render may not. A failed read and an empty lab are
 * kept apart: the first says so and shows no numbers, the second shows zeros,
 * and neither is allowed to look like the other.
 */
function toUsagePanel(
  usage: UsageView,
  orgName: string | null,
  canManage: boolean,
  selfId: string | null,
): UsagePanelProps {
  const empty = {
    orgName,
    plan: "free" as const,
    rows: [] as UsageRow[],
    totals: null,
    unattributed: null,
    canManage,
  };

  if (usage.status === "no-workspace") {
    return {
      ...empty,
      notice:
        "You are not in a workspace yet, so there is nothing to account for. Accept an invite, or create a workspace, and this fills in.",
    };
  }
  if (usage.status === "unavailable") {
    return {
      ...empty,
      notice: "Usage could not be read just now. Reload the page, or try again shortly.",
    };
  }

  return {
    orgName,
    plan: usage.plan,
    canManage,
    notice: null,
    totals: usage.totals,
    unattributed: usage.unattributed,
    rows: usage.people.map((person) => ({
      userId: person.userId,
      name: person.name,
      email: person.email,
      role: person.role,
      screens: person.screens,
      runs: person.runs,
      runs30d: person.runs30d,
      outcomes: person.outcomes,
      apiKeys: person.apiKeys,
      lastActiveLabel: person.lastActiveAt ? formatDate(person.lastActiveAt) : null,
      joinedLabel: person.joinedAt ? formatDate(person.joinedAt) : "recently",
      isSelf: selfId !== null && person.userId === selfId,
    })),
  };
}
