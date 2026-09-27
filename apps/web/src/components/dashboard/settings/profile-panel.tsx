"use client";

import { updateProfile } from "@/lib/data/actions";
import type { Profile, SessionUser } from "@/lib/data/types";

import { FieldGrid, ReadOnlyField, TextField } from "./fields";
import { PanelForm } from "./panel";

export interface ProfilePanelProps {
  profile: Profile | null;
  user: SessionUser | null;
  canEdit: boolean;
  lockedReason?: string;
  onDirtyChange?: (panelKey: string, dirty: boolean) => void;
}

/**
 * Your own profile, not the workspace's.
 *
 * `updateProfile` writes `public.profiles` for the signed-in user only, so this
 * panel is editable for anyone with a session, whatever their role in the
 * workspace.
 */
export function ProfilePanel({
  profile,
  user,
  canEdit,
  lockedReason,
  onDirtyChange,
}: ProfilePanelProps) {
  const email = profile?.email || user?.email || "";

  return (
    <PanelForm
      panelKey="profile"
      title="Profile"
      description="How you appear to the rest of the lab, and on any report you sign."
      action={updateProfile}
      canEdit={canEdit}
      lockedReason={lockedReason}
      saveLabel="Save profile"
      onDirtyChange={onDirtyChange}
    >
      <FieldGrid>
        <TextField
          name="name"
          label="Full name"
          defaultValue={profile?.full_name ?? ""}
          placeholder="Rosalind Franklin"
          maxLength={120}
          required
          autoComplete="name"
          hint="Shown on the team list and beside anything you log in the Truth Loop."
        />
        <ReadOnlyField
          label="Email"
          value={email || "Not signed in"}
          hint="This comes from your sign-in. Changing it means changing the account, so it cannot be edited here."
        />
        <TextField
          name="orcid"
          label="ORCID"
          defaultValue={profile?.orcid ?? ""}
          placeholder="0000-0002-1825-0097"
          pattern="[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9Xx]"
          title="An ORCID looks like 0000-0002-1825-0097."
          maxLength={19}
          className="sm:col-span-2"
          hint="Sixteen digits in four groups, where the last character may be an X. Clear the field to remove it. The same format the profiles_orcid_format check constraint enforces in the database."
        />
      </FieldGrid>
    </PanelForm>
  );
}
