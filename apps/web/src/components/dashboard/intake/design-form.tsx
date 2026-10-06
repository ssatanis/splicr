"use client";

/**
 * What the experiment was, once the files are up.
 *
 * Decision first: the one thing SplicR cannot work out on its own is which
 * samples are the treated arm. That table is the top of this form and the
 * primary action sits under it. Everything the workspace already knows — the
 * library, the modality, the callers, the FDR — is prefilled from the
 * workspace's own defaults and from what the uploaded guides actually matched,
 * and the pipeline settings are folded away because a researcher who wants the
 * default never has to see them.
 */
import { ChevronDown, Info } from "lucide-react";
import { useId, useState } from "react";

import {
  HIT_CALLERS,
  HIT_CALLER_LABEL,
  MODALITIES,
  NORMALIZATIONS,
  NORMALIZATION_LABEL,
  type HitCaller,
  type Modality,
  type Normalization,
} from "@/lib/data/types";
import { MODALITY_LABEL } from "@/components/dashboard/settings/meta";
import { ROLE_HINT, ROLE_LABEL, type IntakeSample, type SampleRole } from "@/lib/intake/shape";
import { cn } from "@/lib/utils";
import { MleDesignEditor } from "./mle-design";
import { MODEL_TYPES, type ModelType } from "@/lib/validation/model";

export interface LibraryChoice {
  id: string;
  name: string;
  n_guides: number;
}

export interface DetectedLibrary {
  library_id: string;
  name: string;
  coverage: number;
  match_rate: number;
}

export interface AnalysisSettings {
  profile?: import("@/lib/intake/analysis-plan").Profile;
  organism_taxid?: number;
  modality?: Modality;
  fitness_assay?: boolean;
  mle_design?: import("@/lib/intake/analysis-plan").MleDesign;
  drugz_options?: import("@/lib/intake/analysis-plan").DrugzOptions;
  normalization: Normalization;
  hit_callers: HitCaller[];
  fdr_threshold: number;
  cn_correction: boolean;
  drugz_paired?: boolean;
  guide_aliases?: Record<string, string>;
  model_type?: ModelType;
}

const ROLES: readonly SampleRole[] = ["plasmid", "reference", "control", "treatment"];

const FIELD =
  "h-8 w-full rounded-md border border-line bg-white px-2.5 text-[12.5px] text-ink outline-none transition-colors duration-[var(--dur-1)] focus:border-cyan-500 motion-reduce:transition-none";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-snug text-muted">{hint}</span>}
    </label>
  );
}

export function DesignForm({
  name,
  cellLine,
  phenotype,
  modality,
  libraryId,
  samples,
  settings,
  libraries,
  detected,
  defaultsFromWorkspace,
  disabled,
  onChange,
}: {
  name: string;
  cellLine: string;
  phenotype: string;
  modality: Modality;
  libraryId: string | null;
  samples: IntakeSample[];
  settings: AnalysisSettings;
  libraries: LibraryChoice[];
  detected: DetectedLibrary[];
  defaultsFromWorkspace: boolean;
  disabled: boolean;
  onChange: (patch: {
    name?: string;
    cellLine?: string;
    phenotype?: string;
    modality?: Modality;
    libraryId?: string | null;
    samples?: IntakeSample[];
    settings?: AnalysisSettings;
  }) => void;
}) {
  const [advanced, setAdvanced] = useState(false);
  const advancedId = useId();

  const top = detected[0];
  const setSample = (index: number, patch: Partial<IntakeSample>) => {
    onChange({ samples: samples.map((sample, i) => (i === index ? { ...sample, ...patch } : sample)) });
  };

  const treated = samples.filter((s) => s.role === "treatment").length;
  const controls = samples.filter((sample) => sample.included !== false && sample.role !== "treatment").length;

  return (
    <div className="space-y-5">
      {/* --- the one thing only the researcher knows ------------------------ */}
      <section>
        <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line pb-1">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
            Which arm is which
          </h3>
          <span className="num text-[11px] text-muted">
            {treated} treated, {controls} control
          </span>
        </div>
        <p className="mb-2 text-[12px] leading-snug text-body">
          SplicR read these sample names from your files and guessed the arms. Correct any it got wrong.
        </p>

        <div className="overflow-hidden rounded-lg border border-line">
          <table className="dense-table dense-table-compact">
            <thead>
              <tr>
                <th scope="col">Sample</th>
                <th scope="col">Arm</th>
                <th scope="col">Use</th>
                <th scope="col" className="num-col">Replicate</th>
              </tr>
            </thead>
            <tbody>
              {samples.map((sample, index) => (
                <tr key={sample.label}>
                  <td className="max-w-[1px] truncate" title={sample.label}>{sample.label}
                    {sample.file_ids && <span className="block text-[10px] text-muted">{sample.file_ids.length} read files merged</span>}
                    {Boolean(sample.read1_file_ids?.length && sample.read2_file_ids?.length) && <select aria-label={`Guide read for ${sample.label}`} value={sample.file_ids?.[0] === sample.read2_file_ids?.[0] ? "R2" : "R1"} disabled={disabled} className="mt-1 h-6 rounded border border-line text-[11px]" onChange={(event) => { const file_ids = event.target.value === "R1" ? sample.read1_file_ids! : sample.read2_file_ids!; setSample(index, { file_ids, file_id: file_ids[0] }); }}><option value="R1">Count R1</option><option value="R2">Count R2</option></select>}
                  </td>
                  <td>
                    <select
                      value={sample.role}
                      disabled={disabled}
                      aria-label={`Arm for ${sample.label}`}
                      onChange={(event) => setSample(index, { role: event.target.value as SampleRole })}
                      className={cn(
                        "h-6 w-full max-w-[13rem] rounded border bg-white px-1.5 text-[12px] text-ink outline-none focus:border-cyan-500",
                        sample.role === "treatment" ? "border-orange-300" : "border-line",
                      )}
                      title={ROLE_HINT[sample.role]}
                    >
                      {ROLES.map((role) => (
                        <option key={role} value={role}>{ROLE_LABEL[role]}</option>
                      ))}
                    </select>
                  </td>
                  <td><input type="checkbox" aria-label={`Use ${sample.label} in this comparison`} checked={sample.included !== false} disabled={disabled} onChange={(event) => setSample(index, { included: event.target.checked })}/></td>
                  <td className="num-col">
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={sample.replicate}
                      disabled={disabled}
                      aria-label={`Replicate number for ${sample.label}`}
                      onChange={(event) => setSample(index, { replicate: Number(event.target.value) || 1 })}
                      className="num h-6 w-14 rounded border border-line bg-white px-1.5 text-right text-[12px] text-ink outline-none focus:border-cyan-500"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* --- what the screen was -------------------------------------------- */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Screen name">
          <input
            value={name}
            disabled={disabled}
            onChange={(event) => onChange({ name: event.target.value })}
            placeholder="Olaparib resistance, HAP1"
            className={FIELD}
          />
        </Field>
        <Field label="Cell line or model">
          <input
            value={cellLine}
            disabled={disabled}
            onChange={(event) => onChange({ cellLine: event.target.value })}
            placeholder="HAP1"
            className={FIELD}
          />
        </Field>
        <Field label="What was measured">
          <input
            value={phenotype}
            disabled={disabled}
            onChange={(event) => onChange({ phenotype: event.target.value })}
            placeholder="Survival under olaparib"
            className={FIELD}
          />
        </Field>
        <Field label="Perturbation">
          <select
            value={modality}
            disabled={disabled}
            onChange={(event) => onChange({ modality: event.target.value as Modality })}
            className={FIELD}
          >
            {MODALITIES.map((item) => (
              <option key={item} value={item} disabled={!["knockout", "crispri", "crispra"].includes(item)}>{MODALITY_LABEL[item]}</option>
            ))}
          </select>
        </Field>

        <div className="sm:col-span-2">
          <Field label="Guide library">
            <select
              aria-label="Guide library"
              value={libraryId ?? ""}
              disabled={disabled}
              onChange={(event) => onChange({ libraryId: event.target.value || null })}
              className={FIELD}
            >
              <option value="">Let the engine identify it from the guides</option>
              {libraries.map((library) => (
                <option key={library.id} value={library.id} disabled={library.n_guides < 1}>
                  {library.name}, {library.n_guides.toLocaleString()} guides
                </option>
              ))}
            </select>
          </Field>
          {top && (top.match_rate >= 0.25 || top.coverage >= 0.25) ? (
            <p className="mt-1.5 flex items-start gap-1.5 text-[11.5px] leading-snug text-cyan-700">
              <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              <span>
                Your guides matched <span className="font-medium">{top.name}</span>:{" "}
                <span className="num">{Math.round(top.coverage * 100)}%</span> of that library is present,
                and <span className="num">{Math.round(top.match_rate * 100)}%</span> of the guides checked
                are in it.
              </span>
            </p>
          ) : libraryId === null || libraryId === "" ? (
            <p className="mt-1.5 flex items-start gap-1.5 text-[11.5px] leading-snug text-muted">
              No existing library was a strong match. You can import a custom library or select one from the list.
            </p>
          ) : null}
        </div>
      </section>

      {/* --- everything the workspace already decided ------------------------ */}
      <section>
        <button
          type="button"
          onClick={() => setAdvanced((open) => !open)}
          aria-expanded={advanced}
          aria-controls={advancedId}
          className="inline-flex items-center gap-1 rounded-sm text-[12px] text-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-cyan-500"
        >
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform duration-[var(--dur-2)] motion-reduce:transition-none", advanced && "rotate-180")}
            aria-hidden="true"
          />
          Pipeline settings
          {defaultsFromWorkspace && !advanced && (
            <span className="text-[11px] text-muted">, using this workspace&rsquo;s defaults</span>
          )}
        </button>

        {advanced && (
          <div id={advancedId} className="mt-3 grid grid-cols-1 gap-3 rounded-lg bg-mist-soft/60 p-3 sm:grid-cols-2">
            <Field label="Model type"><select aria-label="Analysis model type" value={settings.model_type ?? "other"} disabled={disabled} onChange={(event) => onChange({ settings: { ...settings, model_type: event.target.value as ModelType } })} className={FIELD}>{MODEL_TYPES.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></Field>
            <Field label="Normalization" hint="How counts are put on a common scale before the contrast.">
              <select
                value={settings.normalization}
                disabled={disabled}
                onChange={(event) =>
                  onChange({ settings: { ...settings, normalization: event.target.value as Normalization } })
                }
                className={FIELD}
              >
                {NORMALIZATIONS.map((item) => (
                  <option key={item} value={item}>{NORMALIZATION_LABEL[item]}</option>
                ))}
              </select>
            </Field>

            <Field
              label="FDR threshold"
              hint="How many of the genes called at this cut-off are expected to be false discoveries."
            >
              <input
                type="number"
                step={0.01}
                min={0.01}
                max={0.5}
                value={settings.fdr_threshold}
                disabled={disabled}
                onChange={(event) =>
                  onChange({ settings: { ...settings, fdr_threshold: Number(event.target.value) } })
                }
                className={cn(FIELD, "num")}
              />
            </Field>

            <fieldset className="sm:col-span-2">
              <legend className="mb-1 text-[12px] text-ink">Hit callers</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {HIT_CALLERS.map((caller) => (
                  <label key={caller} className="inline-flex items-center gap-1.5 text-[12px] text-body">
                    <input
                      type="checkbox"
                      checked={settings.hit_callers.includes(caller)}
                      disabled={disabled || caller === "chronos" || caller === "mageck_rra"}
                      onChange={(event) =>
                        onChange({
                          settings: {
                            ...settings,
                            hit_callers: event.target.checked
                              ? [...settings.hit_callers, caller]
                              : settings.hit_callers.filter((item) => item !== caller),
                          },
                        })
                      }
                      className="h-3.5 w-3.5 accent-cyan-600"
                    />
                    {HIT_CALLER_LABEL[caller]}{caller === "chronos" ? " (requires pDNA batch metadata)" : ""}
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="inline-flex items-start gap-2 text-[12px] text-body sm:col-span-2">
              <input
                type="checkbox"
                checked={false}
                disabled={true}
                onChange={(event) =>
                  onChange({ settings: { ...settings, cn_correction: event.target.checked } })
                }
                className="mt-0.5 h-3.5 w-3.5 accent-cyan-600"
              />
              <span>
                Correct for copy number
                <span className="mt-0.5 flex items-start gap-1 text-[11px] leading-snug text-muted">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                  Requires a matched copy-number profile. Not available for this upload workflow.
                </span>
              </span>
            </label>
          </div>
        )}
      </section>
      {settings.hit_callers.includes("mageck_mle") && <MleDesignEditor table={{ fileId: "", name, sheet: "Samples", model: cellLine, rows: 0, preview: [], warnings: [], samples: samples.filter((sample) => sample.included !== false) }} comparison={{ id: "primary", table: 0, name: name || "Primary comparison", model: cellLine, phenotype, enabled: true, drug: settings.hit_callers.includes("drugz"), treatment: samples.filter((sample) => sample.included !== false && sample.role === "treatment").map((sample) => sample.label), control: samples.filter((sample) => sample.included !== false && sample.role !== "treatment").map((sample) => sample.label), mle_design: settings.mle_design }} disabled={disabled} onChange={(mle_design) => onChange({ settings: { ...settings, mle_design } })}/>}
      {settings.hit_callers.includes("drugz") && <details className="rounded-lg border border-line p-3"><summary className="cursor-pointer text-[12px] text-ink">DrugZ settings</summary><div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="DrugZ pseudocount"><input aria-label="DrugZ pseudocount" className={FIELD} type="number" step={1} min={1} max={1000} value={settings.drugz_options?.pseudocount ?? 5} disabled={disabled} onChange={(event) => onChange({ settings: { ...settings, drugz_options: { pseudocount: Number(event.target.value), half_window_size: settings.drugz_options?.half_window_size ?? 500 } } })}/></Field><Field label="DrugZ smoothing half-window"><input aria-label="DrugZ smoothing half-window" className={FIELD} type="number" min={2} max={10000} value={settings.drugz_options?.half_window_size ?? 500} disabled={disabled} onChange={(event) => onChange({ settings: { ...settings, drugz_options: { pseudocount: settings.drugz_options?.pseudocount ?? 5, half_window_size: Number(event.target.value) } } })}/></Field><label className="flex items-center gap-2 text-[12px] text-ink"><input aria-label="Paired DrugZ" type="checkbox" disabled={disabled} checked={Boolean(settings.drugz_paired)} onChange={(event) => onChange({ settings: { ...settings, drugz_paired: event.target.checked } })}/>Paired biological replicates</label></div></details>}
    </div>
  );
}
