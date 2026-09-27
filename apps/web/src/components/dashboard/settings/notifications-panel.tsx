"use client";

import { updateOrganization } from "@/lib/data/actions";
import type { WorkspaceSettings } from "@/lib/data/types";

import { ToggleField } from "./fields";
import { PanelForm } from "./panel";

export interface NotificationsPanelProps {
  settings: WorkspaceSettings;
  canEdit: boolean;
  lockedReason?: string;
  onDirtyChange?: (panelKey: string, dirty: boolean) => void;
}

/**
 * Who hears about a run, and when.
 *
 * These live on the workspace rather than on a profile, so a lab agrees once on
 * what is worth an email. The note says plainly that nothing is sent yet.
 */
export function NotificationsPanel({
  settings,
  canEdit,
  lockedReason,
  onDirtyChange,
}: NotificationsPanelProps) {
  const notifications = settings.notifications;

  return (
    <PanelForm
      panelKey="notifications"
      title="Notifications"
      description="Set for the whole workspace, and sent to the address on each member's profile."
      note="These are stored on the workspace. No mail sender is configured in this deployment yet, so nothing is sent today; this is what will be sent once one is."
      action={updateOrganization}
      canEdit={canEdit}
      lockedReason={lockedReason}
      saveLabel="Save notifications"
      onDirtyChange={onDirtyChange}
    >
      <div className="divide-y divide-line">
        <ToggleField
          name="notifications.email_on_complete"
          label="A run finishes"
          description="One email when the pipeline reaches the end of a screen, with the headline counts and a link to the hits."
          defaultChecked={notifications.email_on_complete}
        />
        <ToggleField
          name="notifications.email_on_qc_fail"
          label="A screen fails QC"
          description="Sent as soon as the QC stage writes a failing verdict, which is usually early enough to re-sequence rather than re-run everything."
          defaultChecked={notifications.email_on_qc_fail}
        />
        <ToggleField
          name="notifications.weekly_digest"
          label="Weekly digest"
          description="One summary a week: runs finished, hits called, and anything logged in the Truth Loop."
          defaultChecked={notifications.weekly_digest}
        />
      </div>
    </PanelForm>
  );
}
