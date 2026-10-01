"use client";

import { useCallback, useState } from "react";

import type { LibraryOption } from "@/lib/data/libraries";
import {
  ROLE_LABEL,
  type Organization,
  type OrgRole,
  type Profile,
  type SessionUser,
  type WorkspaceSettings,
  type WorkspaceStats,
} from "@/lib/data/types";
import { cn } from "@/lib/utils";

import { AnalysisPanel } from "./analysis-panel";
import { DangerPanel } from "./danger-panel";
import { LabPanel } from "./lab-panel";
import { NotificationsPanel } from "./notifications-panel";
import { DirtyDot } from "./panel";
import { SETTINGS_PANELS as PANELS, type PanelKey } from "./panels";
import { ProfilePanel } from "./profile-panel";
import { QcPanel } from "./qc-panel";
import { RetentionPanel } from "./retention-panel";

export interface SettingsWorkspaceProps {
  initialPanel: PanelKey;
  user: SessionUser | null;
  profile: Profile | null;
  org: Organization | null;
  role: OrgRole | null;
  isDemo: boolean;
  settings: WorkspaceSettings;
  stats: WorkspaceStats;
  libraries: LibraryOption[];
  librariesUnavailable: boolean;
  /** org.created_at, formatted on the server so the markup is stable. */
  createdLabel: string;
  canEditProfile: boolean;
  canEditOrg: boolean;
  canDelete: boolean;
  /** Why the organization panels are read only, when they are. */
  orgLockedReason?: string;
  profileLockedReason?: string;
  deleteLockedReason?: string;
}

/**
 * The settings page, panel by panel.
 *
 * Every panel stays mounted and the inactive ones are hidden, so moving between
 * sections never discards half-typed changes. The strip marks any panel holding
 * unsaved work, and the line under it names them, because the change a lab cares
 * about most here is the one it forgot to save.
 */
export function SettingsWorkspace({
  initialPanel,
  user,
  profile,
  org,
  role,
  isDemo,
  settings,
  stats,
  libraries,
  librariesUnavailable,
  createdLabel,
  canEditProfile,
  canEditOrg,
  canDelete,
  orgLockedReason,
  profileLockedReason,
  deleteLockedReason,
}: SettingsWorkspaceProps) {
  const [active, setActive] = useState<PanelKey>(initialPanel);
  const [dirtyPanels, setDirtyPanels] = useState<Record<string, boolean>>({});

  const markDirty = useCallback((panelKey: string, dirty: boolean) => {
    setDirtyPanels((previous) =>
      previous[panelKey] === dirty ? previous : { ...previous, [panelKey]: dirty },
    );
  }, []);

  function select(panelKey: PanelKey) {
    setActive(panelKey);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("panel", panelKey);
    window.history.replaceState(null, "", url);
  }

  const unsavedElsewhere = PANELS.filter(
    (panel) => panel.key !== active && dirtyPanels[panel.key],
  );

  return (
    <div className="space-y-5">
      <nav
        aria-label="Settings sections"
        className="thin-scroll flex gap-1 overflow-x-auto border-b border-line"
      >
        {PANELS.map((panel) => {
          const isActive = panel.key === active;
          return (
            <button
              key={panel.key}
              type="button"
              onClick={() => select(panel.key)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "-mb-px flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm transition-colors",
                isActive
                  ? "border-navy font-medium text-ink"
                  : "border-transparent text-muted hover:text-ink",
                panel.key === "danger" && !isActive && "hover:text-red-700",
              )}
            >
              {panel.label}
              {dirtyPanels[panel.key] && <DirtyDot />}
            </button>
          );
        })}
      </nav>

      {unsavedElsewhere.length > 0 && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-orange-700">
          <DirtyDot />
          Unsaved changes in{" "}
          {unsavedElsewhere.map((panel, index) => (
            <span key={panel.key}>
              <button
                type="button"
                onClick={() => select(panel.key)}
                className="underline decoration-line-strong underline-offset-2 hover:decoration-navy"
              >
                {panel.label}
              </button>
              {index < unsavedElsewhere.length - 1 ? "," : "."}
            </span>
          ))}
        </p>
      )}

      <div hidden={active !== "profile"}>
        <ProfilePanel
          profile={profile}
          user={user}
          canEdit={canEditProfile}
          lockedReason={profileLockedReason}
          onDirtyChange={markDirty}
        />
      </div>

      <div hidden={active !== "lab"}>
        <LabPanel
          org={org}
          settings={settings}
          createdLabel={createdLabel}
          canEdit={canEditOrg}
          lockedReason={orgLockedReason}
          onDirtyChange={markDirty}
        />
      </div>

      <div hidden={active !== "analysis"}>
        <AnalysisPanel
          settings={settings}
          libraries={libraries}
          librariesUnavailable={librariesUnavailable}
          canEdit={canEditOrg}
          lockedReason={orgLockedReason}
          onDirtyChange={markDirty}
        />
      </div>

      <div hidden={active !== "qc"}>
        <QcPanel
          settings={settings}
          canEdit={canEditOrg}
          lockedReason={orgLockedReason}
          onDirtyChange={markDirty}
        />
      </div>

      <div hidden={active !== "retention"}>
        <RetentionPanel
          settings={settings}
          canEdit={canEditOrg}
          lockedReason={orgLockedReason}
          onDirtyChange={markDirty}
        />
      </div>

      <div hidden={active !== "notifications"}>
        <NotificationsPanel
          settings={settings}
          canEdit={canEditOrg}
          lockedReason={orgLockedReason}
          onDirtyChange={markDirty}
        />
      </div>

      <div hidden={active !== "danger"}>
        <DangerPanel
          org={org}
          stats={stats}
          canDelete={canDelete}
          lockedReason={deleteLockedReason}
        />
      </div>

      {role !== null && !isDemo && (
        <p className="text-xs text-muted">
          Your role in this workspace is {ROLE_LABEL[role].toLowerCase()}. Role decides what you may
          change here, and the database checks it again on every save.
        </p>
      )}
    </div>
  );
}
