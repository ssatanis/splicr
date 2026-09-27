"use client";

import { updateOrganization } from "@/lib/data/actions";
import {
  ORG_KINDS,
  ORG_KIND_LABEL,
  PLAN_LABEL,
  type Organization,
  type WorkspaceSettings,
} from "@/lib/data/types";

import { FieldGrid, ReadOnlyField, SelectField, TextField } from "./fields";
import { PanelForm } from "./panel";

export interface LabPanelProps {
  org: Organization | null;
  settings: WorkspaceSettings;
  /** Preformatted on the server, so the date does not depend on the viewer. */
  createdLabel: string;
  canEdit: boolean;
  lockedReason?: string;
  onDirtyChange?: (panelKey: string, dirty: boolean) => void;
}

const kindOptions = ORG_KINDS.map((kind) => ({ value: kind, label: ORG_KIND_LABEL[kind] }));

/**
 * The lab itself: the name everyone sees, who it belongs to, and how a reader
 * of a report gets in touch. Admins and owners only, which `updateOrganization`
 * re-checks on the server.
 */
export function LabPanel({
  org,
  settings,
  createdLabel,
  canEdit,
  lockedReason,
  onDirtyChange,
}: LabPanelProps) {
  const branding = settings.branding;

  return (
    <PanelForm
      panelKey="lab"
      title="Lab"
      description="The workspace every screen, run and API key belongs to."
      action={updateOrganization}
      canEdit={canEdit}
      lockedReason={lockedReason}
      saveLabel="Save lab details"
      onDirtyChange={onDirtyChange}
    >
      <FieldGrid>
        <TextField
          name="name"
          label="Lab display name"
          defaultValue={org?.name ?? ""}
          placeholder="Franklin Lab"
          maxLength={120}
          required
          hint="Shown in the sidebar, on the screens list and wherever the workspace is named."
        />
        <TextField
          name="branding.institution"
          label="Institution"
          defaultValue={branding.institution}
          placeholder="King's College London"
          maxLength={160}
          hint="The university, company or centre the lab sits in."
        />
        <TextField
          name="branding.contact_email"
          label="Contact email"
          type="email"
          defaultValue={branding.contact_email}
          placeholder="screens@lab.example"
          maxLength={200}
          hint="Printed on reports so a reader can reach the lab. Leave it empty to keep it off the page. This is not a login, and it receives nothing on its own."
        />
        <SelectField
          name="kind"
          label="Organization kind"
          defaultValue={org?.kind ?? "academic"}
          options={kindOptions}
          hint="Used for the Atlas comparisons a new screen is offered, and for nothing else."
        />
        <TextField
          name="branding.display_name"
          label="Name on reports"
          defaultValue={branding.display_name}
          placeholder="Leave empty to use the lab display name"
          maxLength={120}
          hint="Some labs publish under a longer name than the one they use day to day."
        />
        <ReadOnlyField
          label="Workspace slug"
          value={org?.slug ?? "unknown"}
          hint="Fixed when the workspace was created. It appears in links, and it is the phrase the delete confirmation asks you to type."
        />
        <ReadOnlyField label="Plan" value={org ? PLAN_LABEL[org.plan] : "Free"} />
        <ReadOnlyField label="Created" value={createdLabel} />
      </FieldGrid>
    </PanelForm>
  );
}
