import { Info } from "lucide-react";

import { DEFAULT_PANEL, isPanelKey } from "@/components/dashboard/settings/panels";
import { SettingsWorkspace } from "@/components/dashboard/settings/settings-workspace";
import { PageHeader } from "@/components/dashboard/ui";
import { listLibraries } from "@/lib/data/libraries";
import { StartLab } from "@/components/dashboard/start-lab";
import { getCurrentContext, getOrgSettings, getWorkspaceStats } from "@/lib/data/org";
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
  const { user, profile, org, role, isDemo } = context;

  const [settings, stats, catalog] = await Promise.all([
    org ? getOrgSettings(org.id) : Promise.resolve(DEFAULT_WORKSPACE_SETTINGS),
    org ? getWorkspaceStats(org.id) : Promise.resolve(EMPTY_STATS),
    listLibraries(),
  ]);

  const requested = params.panel;
  const panel = isPanelKey(requested) ? requested : DEFAULT_PANEL;

  const signedIn = user !== null && !isDemo;
  const canEditProfile = signedIn;
  const canEditOrg = signedIn && org !== null && roleAtLeast(role, "admin");
  const canDelete = signedIn && org !== null && role === "owner";

  const profileLockedReason = isDemo
    ? "The demo has no account behind it, so there is no profile to edit."
    : !signedIn
      ? "Sign in to edit your profile."
      : undefined;

  const orgLockedReason = isDemo
    ? "The demo workspace is read only. These are the values a new SplicR workspace starts with."
    : !signedIn
      ? "Sign in to change the workspace."
      : org === null
        ? "You are not in a workspace yet, so there is nothing here to change. Accept an invite, or create a workspace, and these panels open up."
        : !roleAtLeast(role, "admin")
          ? `Changing how screens are analysed needs the admin role. Yours is ${role ? ROLE_LABEL[role].toLowerCase() : "unknown"}, so this panel is read only.`
          : undefined;

  const deleteLockedReason = isDemo
    ? "Nothing can be deleted from the demo."
    : !signedIn
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
  if (role && !isDemo) chips.push(`You are ${ROLE_LABEL[role].toLowerCase()}`);

  return (
    <div>
      <PageHeader
        eyebrow="Settings"
        title="Lab workspace"
        body="Your profile, the lab it belongs to, and the defaults every new run starts from. Analysis defaults and QC thresholds change how the next screen is called, so each panel saves on its own."
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

      {isDemo && (
        <p className="mb-5 flex items-start gap-2.5 rounded-2xl border border-orange-100 bg-orange-50 px-4 py-3 text-sm text-orange-800">
          <Info className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
          <span>
            You are browsing the SplicR demo, so there is no workspace to write to. Every value
            below is the default a new workspace starts with, taken from the engine configuration
            rather than from a saved workspace. The guide library list is real, read from the Atlas.
            Saving is refused, with a message, on every panel.
          </span>
        </p>
      )}

      {!isDemo && org === null && (
        <div className="mb-5 space-y-4">
          <p className="flex items-start gap-2.5 rounded-2xl border border-line bg-white px-4 py-3 text-sm text-body">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-cyan-600" strokeWidth={1.8} />
            <span>
              You are signed in but not in a workspace yet. Your profile is still yours to edit. The
              workspace panels below show the defaults a new workspace starts with, and cannot be
              saved until you belong to one.
            </span>
          </p>
          {/* Creating a lab needs an account to own it, so a signed-out
              visitor gets the notice above and not the form. */}
          {signedIn && <StartLab className="max-w-xl" />}
        </div>
      )}

      <SettingsWorkspace
        initialPanel={panel}
        user={user}
        profile={profile}
        org={org}
        role={role}
        isDemo={isDemo}
        settings={settings}
        stats={stats}
        libraries={catalog.libraries}
        librariesUnavailable={catalog.unavailable}
        createdLabel={org ? formatDate(org.created_at) : "Not created yet"}
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
