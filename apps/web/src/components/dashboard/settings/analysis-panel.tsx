"use client";

import { updateOrganization } from "@/lib/data/actions";
import type { LibraryOption } from "@/lib/data/libraries";
import {
  HIT_CALLERS,
  HIT_CALLER_LABEL,
  MODALITIES,
  NORMALIZATIONS,
  NORMALIZATION_LABEL,
  type WorkspaceSettings,
} from "@/lib/data/types";
import { formatNumber } from "@/lib/utils";

import { CheckField, FieldGrid, NumberField, Provenance, SelectField, ToggleField } from "./fields";
import { HIT_CALLER_NOTE, MODALITY_LABEL, MODALITY_SHORT, TAXA } from "./meta";
import { PanelForm } from "./panel";

export interface AnalysisPanelProps {
  settings: WorkspaceSettings;
  libraries: LibraryOption[];
  /** True when the catalogue read failed, so the list is not the whole truth. */
  librariesUnavailable: boolean;
  canEdit: boolean;
  lockedReason?: string;
  onDirtyChange?: (panelKey: string, dirty: boolean) => void;
}

function organism(taxid: number): string {
  if (taxid === 9606) return "human";
  if (taxid === 10090) return "mouse";
  return `taxid ${taxid}`;
}

/**
 * What a new run assumes before anybody touches it.
 *
 * The library list is the real `atlas.libraries` catalogue, read through
 * `public.library_catalog`. A slug that is stored but missing from the
 * catalogue is still offered, so saving this panel cannot quietly change which
 * library the workspace defaults to.
 */
export function AnalysisPanel({
  settings,
  libraries,
  librariesUnavailable,
  canEdit,
  lockedReason,
  onDirtyChange,
}: AnalysisPanelProps) {
  const defaults = settings.defaults;
  const storedSlug = defaults.library_slug ?? "";

  const libraryOptions = [
    { value: "", label: "Detect from the reads" },
    ...libraries.map((library) => ({
      value: library.slug,
      label: `${library.name}, ${organism(library.taxid)} ${MODALITY_SHORT[library.modality]}, ${formatNumber(library.n_guides)} guides${library.custom ? ", this workspace" : ""}`,
    })),
  ];

  if (storedSlug && !libraries.some((library) => library.slug === storedSlug)) {
    libraryOptions.push({ value: storedSlug, label: `${storedSlug}, saved but not in the catalogue` });
  }

  const taxonOptions = TAXA.map((taxon) => ({
    value: String(taxon.value),
    label: taxon.label,
  }));

  if (!TAXA.some((taxon) => taxon.value === defaults.organism_taxid)) {
    taxonOptions.push({
      value: String(defaults.organism_taxid),
      label: `Taxid ${defaults.organism_taxid}`,
    });
  }

  const catalogueNote = librariesUnavailable
    ? "The Atlas library catalogue could not be read just now, so this list holds only what is already saved. Reload the page to try again."
    : libraries.length === 0
      ? "No libraries are in the Atlas catalogue yet, so every run detects its library from the reads."
      : `${libraries.length} ${libraries.length === 1 ? "library" : "libraries"} in the Atlas catalogue. Leaving this on detection lets the count stage call the library from the reads themselves, which is the safer choice when the lab runs several.`;

  return (
    <PanelForm
      panelKey="analysis"
      title="Analysis defaults"
      description="Applied to every new run in this workspace. A run can override any of them, and changing a default never re-analyses a screen that has already finished."
      action={updateOrganization}
      canEdit={canEdit}
      lockedReason={lockedReason}
      saveLabel="Save analysis defaults"
      onDirtyChange={onDirtyChange}
    >
      <FieldGrid>
        <SelectField
          name="defaults.library_slug"
          label="Default library"
          defaultValue={storedSlug}
          options={libraryOptions}
          hint={catalogueNote}
          className="sm:col-span-2"
        />
        <SelectField
          name="defaults.modality"
          label="Modality"
          defaultValue={defaults.modality}
          options={MODALITIES.map((modality) => ({
            value: modality,
            label: MODALITY_LABEL[modality],
          }))}
          hint="Decides which direction counts as a hit, and which control set the callers compare against."
        />
        <SelectField
          name="defaults.organism_taxid"
          label="Organism"
          defaultValue={String(defaults.organism_taxid)}
          options={taxonOptions}
          hint="Used to resolve gene symbols against the Atlas, which carries human and mouse."
        />
        <NumberField
          name="defaults.fdr_threshold"
          label="FDR threshold"
          defaultValue={defaults.fdr_threshold}
          min={0.001}
          max={0.5}
          step="any"
          hint="Applied to the gene-level FDR each caller reports. 0.1 is the usual screen-level line, 0.05 is stricter, and 0.25 is exploratory. Greater than 0 and at most 0.5."
        />
        <SelectField
          name="defaults.normalization"
          label="Normalisation"
          defaultValue={defaults.normalization}
          options={NORMALIZATIONS.map((method) => ({
            value: method,
            label: NORMALIZATION_LABEL[method],
          }))}
          hint="Control guides are the most robust option when the library has enough of them, and median ratio is the MAGeCK default otherwise."
        />
      </FieldGrid>

      <div className="mt-7">
        <h3 className="text-sm font-medium text-ink">Hit callers</h3>
        <p className="mt-1 text-xs text-muted">
          Each caller selected here runs on every new screen. Running more than one is the point:
          a gene that only one caller likes is the gene worth looking at twice.
        </p>

        {/* Makes an empty selection a real, refused submission rather than a
            field the action never sees. */}
        <input type="hidden" name="defaults.hit_callers" value="" />

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {HIT_CALLERS.map((caller) => (
            <CheckField
              key={caller}
              name="defaults.hit_callers"
              value={caller}
              label={HIT_CALLER_LABEL[caller]}
              description={HIT_CALLER_NOTE[caller]}
              defaultChecked={defaults.hit_callers.includes(caller)}
            />
          ))}
        </div>
        <Provenance>At least one caller has to stay selected.</Provenance>
      </div>

      <div className="mt-6 border-t border-line pt-1">
        <ToggleField
          name="defaults.cn_correction"
          label="Copy-number correction"
          description="CRISPRcleanR style. Removes the depletion that tracks an amplified region rather than the gene inside it, which is the most common way a cancer line produces a convincing false hit."
          defaultChecked={defaults.cn_correction}
        />
      </div>
    </PanelForm>
  );
}
