"use client";

import { updateOrganization } from "@/lib/data/actions";
import type { WorkspaceSettings } from "@/lib/data/types";

import { NumberField, ToggleField } from "./fields";
import { RETENTION_PRESETS } from "./meta";
import { PanelForm, usePanelForm } from "./panel";

export interface RetentionPanelProps {
  settings: WorkspaceSettings;
  canEdit: boolean;
  lockedReason?: string;
  onDirtyChange?: (panelKey: string, dirty: boolean) => void;
}

const DAYS_FIELD = "retention.raw_reads_days";

/** Preset windows. They write the number field, then re-measure the form. */
function DayPresets() {
  const { recheck } = usePanelForm();

  function apply(event: React.MouseEvent<HTMLButtonElement>, days: number) {
    const form = event.currentTarget.form;
    const element = form?.elements.namedItem(DAYS_FIELD);
    if (!(element instanceof HTMLInputElement)) return;
    element.value = String(days);
    recheck();
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="label-sm">Set to</span>
      {RETENTION_PRESETS.map((preset) => (
        <button
          key={preset.days}
          type="button"
          onClick={(event) => apply(event, preset.days)}
          className="chip bg-mist-soft text-xs hover:bg-cyan-50 disabled:opacity-50 disabled:hover:bg-mist-soft"
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}

/**
 * How long the workspace keeps what a run consumed and produced.
 *
 * Uploaded reads are the expensive part: a single screen is tens of gigabytes of
 * FASTQ, and once counting is done the count table is what the rest of the
 * pipeline reads. Artifacts are cheap and regenerate from the counts.
 */
export function RetentionPanel({
  settings,
  canEdit,
  lockedReason,
  onDirtyChange,
}: RetentionPanelProps) {
  const retention = settings.retention;

  return (
    <PanelForm
      panelKey="retention"
      title="Data retention"
      description="What the workspace keeps after a run finishes, and for how long."
      note="These are stored on the workspace. No cleanup job is wired up in this deployment yet, so nothing is deleted on a timer today; this is the rule a sweep will follow."
      action={updateOrganization}
      canEdit={canEdit}
      lockedReason={lockedReason}
      saveLabel="Save retention"
      onDirtyChange={onDirtyChange}
    >
      <NumberField
        name={DAYS_FIELD}
        label="Keep raw reads for"
        defaultValue={retention.raw_reads_days}
        min={0}
        max={3650}
        step={1}
        suffix="days"
        hint="Counted from the day the upload finishes. 0 means the FASTQ goes as soon as counting is done, which is safe for a screen you can re-download from the sequencer. The maximum is 3650, ten years. Count tables are never covered by this, they are what every later stage reads."
      />
      <DayPresets />

      <div className="mt-6 border-t border-line pt-1">
        <ToggleField
          name="retention.keep_artifacts"
          label="Keep pipeline artifacts"
          description="Count tables, per-caller output, Parquet and the plots behind a report. Turning this off saves storage, at the cost of re-running a screen to look at it again."
          defaultChecked={retention.keep_artifacts}
        />
      </div>
    </PanelForm>
  );
}
