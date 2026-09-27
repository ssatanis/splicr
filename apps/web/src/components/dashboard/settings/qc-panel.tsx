"use client";

import { RotateCcw } from "lucide-react";

import { updateOrganization } from "@/lib/data/actions";
import { DEFAULT_WORKSPACE_SETTINGS, type WorkspaceSettings } from "@/lib/data/types";

import { FieldGrid, NumberField } from "./fields";
import { QC_FIELDS } from "./meta";
import { PanelForm, usePanelForm } from "./panel";

export interface QcPanelProps {
  settings: WorkspaceSettings;
  canEdit: boolean;
  lockedReason?: string;
  onDirtyChange?: (panelKey: string, dirty: boolean) => void;
}

/**
 * Puts the engine's own numbers back into the fields.
 *
 * Setting `input.value` fires no event, so the panel would not notice the
 * change. `recheck()` re-measures the form instead, which keeps the dirty state
 * and the Save button honest.
 */
function RestoreDefaults() {
  const { recheck } = usePanelForm();

  function handleClick(event: React.MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.form;
    if (!form) return;

    for (const field of QC_FIELDS) {
      const element = form.elements.namedItem(field.name);
      if (element instanceof HTMLInputElement) element.value = String(field.fallback);
    }
    recheck();
  }

  return (
    <button type="button" onClick={handleClick} className="btn btn-ghost btn-sm">
      <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.8} />
      Restore engine defaults
    </button>
  );
}

/**
 * The lines a screen has to clear.
 *
 * These are the workspace's copy of `QcThresholds` in engine/splicr/config.py.
 * The engine writes the QC verdict this dashboard reads back, so every field
 * states its default and where the number comes from: several of these are
 * widely quoted and just as widely misattributed.
 */
export function QcPanel({ settings, canEdit, lockedReason, onDirtyChange }: QcPanelProps) {
  const qc = settings.qc;
  const engineDefaults = DEFAULT_WORKSPACE_SETTINGS.qc;
  const changed = QC_FIELDS.filter((field) => {
    const column = field.name.split(".")[1] as keyof typeof qc;
    return qc[column] !== engineDefaults[column];
  });

  return (
    <PanelForm
      panelKey="qc"
      title="QC thresholds"
      description="Applied when a run finishes, to decide whether a sample and a screen pass. A screen that fails is still analysed and still readable, it is marked."
      note={
        changed.length === 0
          ? "Every threshold is at the engine default from engine/splicr/config.py."
          : `${changed.length} of ${QC_FIELDS.length} thresholds differ from the engine default. Each field says what that default is.`
      }
      action={updateOrganization}
      canEdit={canEdit}
      lockedReason={lockedReason}
      saveLabel="Save thresholds"
      onDirtyChange={onDirtyChange}
    >
      <FieldGrid>
        {QC_FIELDS.map((field) => {
          const column = field.name.split(".")[1] as keyof typeof qc;
          return (
            <NumberField
              key={field.name}
              name={field.name}
              label={field.label}
              defaultValue={qc[column]}
              min={field.min}
              max={field.max}
              step={field.step}
              suffix={field.suffix}
              hint={field.provenance}
            />
          );
        })}
      </FieldGrid>

      <div className="mt-6">
        <RestoreDefaults />
      </div>
    </PanelForm>
  );
}
