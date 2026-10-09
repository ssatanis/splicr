"use client";

import { useState } from "react";
import type { AnalysisSettings, LibraryChoice } from "./design-form";
import type { ExperimentTable, ExperimentComparison } from "@/lib/intake/experiment";
import {
  defaultMle,
  validateMle,
  validateDrugz,
  DEFAULT_LIBRARY,
  PROFILES,
  type LibraryImportOptions,
} from "@/lib/intake/analysis-plan";
import { suggestComparisons } from "@/lib/intake/experiment";
import { LabEvidenceSettings } from "./lab-evidence-settings";
import { validateLabOptions } from "@/lib/lab/options";
import { MleDesignEditor } from "./mle-design";
import type { IntakeSample } from "@/lib/intake/shape";
import { MODEL_TYPES, type ModelType } from "@/lib/validation/model";

export interface LibraryUpload {
  sources?: { fileId: string; sheet: string }[];
  fileId: string;
  name: string;
  sheet: string;
  rows: number;
  preview: string[][];
  warnings: string[];
}
const FIELD =
  "h-8 rounded-md border border-stone-200 bg-white px-2 text-[12px] text-ink outline-none focus:border-cyan-500";

export function ExperimentReview({
  step,
  planContext,
  tables,
  onTables,
  comparisons,
  onChange,
  libraryId,
  settings,
  expressionFiles = [],
  onSettings,
  disabled,
  mappingReady,
  onStart,
}: {
  tables: ExperimentTable[];
  onTables: (tables: ExperimentTable[]) => void;
  comparisons: ExperimentComparison[];
  onChange: (rows: ExperimentComparison[]) => void;
  libraryUploads: LibraryUpload[];
  libraries: LibraryChoice[];
  libraryId: string | null;
  onLibrary: (id: string | null) => void;
  onImport: (
    upload: LibraryUpload,
    name: string,
    options: LibraryImportOptions,
  ) => Promise<void>;
  onFiles?: (files: File[]) => void;
  settings: AnalysisSettings;
  expressionFiles?: { id: string; name: string }[];
  onSettings: (settings: AnalysisSettings) => void;
  planContext?: Record<string, unknown>;
  step: 3 | 4;
  mappingReady: boolean;
  disabled: boolean;
  onStart: () => void;
}) {
  const [confirmedPlan, setConfirmedPlan] = useState<string | null>(null);
  const planSignature = JSON.stringify([settings, comparisons, libraryId, tables]);
  const confirmed = confirmedPlan === planSignature;
  const [factor, setFactor] = useState("");
  const sequencing = tables.length === 1 && !tables[0].fileId;
  const selected = comparisons.filter((row) => row.enabled);
  const problems = selected.flatMap((row) =>
    settings.hit_callers.includes("mageck_mle")
      ? [
          validateMle(
            row.mle_design ??
              defaultMle(tables[row.table].samples, row.treatment, row.control),
            [...row.control, ...row.treatment],
          ),
        ].filter(Boolean)
      : [],
  );
  if (settings.drugz_options) {
    const problem = validateDrugz(settings.drugz_options);
    if (problem) problems.push(problem);
  }
  if (
    !Number.isFinite(settings.fdr_threshold) ||
    settings.fdr_threshold <= 0 ||
    settings.fdr_threshold >= 1
  )
    problems.push("FDR must be greater than zero and less than one.");
  for (const row of selected) {
    const evidenceProblem = validateLabOptions(row.lab_evidence ?? settings.lab_evidence ?? {}, tables[row.table].samples.filter(s => s.included !== false).map(s => s.label));
    if (evidenceProblem) problems.push(`${row.name}: ${evidenceProblem}`);
    if (!row.name.trim()) problems.push("Every comparison needs a name.");
    if (settings.drugz_paired && row.drug) {
      const reps = (labels: string[]) =>
        labels.map(
          (label) =>
            tables[row.table].samples.find((sample) => sample.label === label)
              ?.replicate ?? 0,
        );
      const treatment = reps(row.treatment),
        control = reps(row.control);
      if (
        treatment.length !== control.length ||
        new Set(treatment).size !== treatment.length ||
        new Set(control).size !== control.length ||
        treatment.some((rep) => !control.includes(rep))
      )
        problems.push(
          `${row.name}: paired DrugZ needs unique matching replicate numbers in both arms.`,
        );
    }
  }
  const exportPlan = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            plan_version: "guide-abundance-v2",
            experiment: planContext,
            library_id: libraryId,
            tables,
            comparisons: selected,
            settings,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "splicr-analysis-plan.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  const patch = (id: string, next: Partial<ExperimentComparison>) =>
    onChange(
      comparisons.map((row) =>
        row.id === id
          ? { ...row, ...next }
          : sequencing && next.enabled
            ? { ...row, enabled: false }
            : row,
      ),
    );
  const sampleEdit = (tableIndex: number, label: string, next: Partial<IntakeSample>) =>
    onTables(
      tables.map((table, i) =>
        i === tableIndex
          ? {
              ...table,
              samples: table.samples.map((sample) =>
                sample.label === label ? { ...sample, ...next } : sample,
              ),
            }
          : table,
      ),
    );
  return (
    <div className="space-y-4">
      {step === 3 && (
        <section className="rounded-sm border border-stone-200 bg-white p-6">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-ink">Comparisons</h3>
            <button
              type="button"
              disabled={disabled || !tables.length}
              onClick={() =>
                onChange([
                  ...comparisons,
                  {
                    id: crypto.randomUUID(),
                    table: 0,
                    name: `Comparison ${comparisons.length + 1}`,
                    model: tables[0].model,
                    phenotype: "",
                    treatment: [],
                    control: [],
                    drug: false,
                    enabled: !sequencing || !comparisons.some((row) => row.enabled),
                  },
                ])
              }
              className="rounded-md border border-line px-3 py-1.5 text-[12px] text-ink"
            >
              Add comparison
            </button>
          </div>
          <p className="mt-2 text-[12px] text-muted">
            {comparisons.length
              ? "Review the suggested arms and edit them to match your experiment."
              : "Choose the numerator and baseline samples to build a comparison."}
            {sequencing ? " Select one comparison for this sequencing screen." : ""}
          </p>
          {tables.some((table) => table.study) && (
            <div className="mt-3 rounded-sm border border-line bg-stone-50 p-3 text-[12px] text-ink">
              <p>Ferrarone 2024: A549 cells, TKOv3 knockout library, day 21. EV is LKB1-null; WT restores LKB1. The two cultures are analyzed separately.</p>
              <p className="mt-1">EV and WT are each compared with the shared plasmid reference. WT versus EV tests relative guide enrichment under LKB1 restoration. This genetic comparison does not use DrugZ. Positive effects indicate relative guide enrichment, not a direct growth measurement.</p>
              <p className="mt-1">The original paper used MAGeCK MLE and excluded low-read guides. This reanalysis retains the deposited guide rows, adds RRA, and reports MLE separately. Culture-specific effects require an interaction analysis; significance in one culture alone does not establish an interaction.</p>
              <a className="mt-1 inline-block underline" href="https://doi.org/10.7910/DVN/8DEPIT" target="_blank" rel="noreferrer">Verified source dataset</a>
            </div>
          )}
          <details className="mt-4 rounded-sm border border-line p-3">
            <summary className="cursor-pointer text-[12px] text-ink">
              Edit sample details
            </summary>
            <p className="mt-2 text-[11.5px] text-muted">
              Sample labels identify the input columns. Roles, replicates and factors can
              be corrected here.
            </p>
            {tables.map((table, i) => (
              <div key={`${table.fileId}:${table.sheet}`} className="mt-3">
                <p className="text-[12px] font-medium text-ink">
                  {table.name} / {table.sheet}
                </p>
                <div className="mt-2 overflow-x-auto">
                  <table className="dense-table dense-table-compact">
                    <thead>
                      <tr>
                        <th>Sample</th>
                        <th>Role</th>
                        <th>Replicate</th>
                        {[
                          ...new Set([
                            "model",
                            "condition",
                            "timepoint",
                            "dose",
                            "batch",
                            "donor",
                            ...table.samples.flatMap((sample) =>
                              Object.keys(sample.factors ?? {}),
                            ),
                          ]),
                        ].map((key) => (
                          <th key={key}>{key}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {table.samples.map((sample) => (
                        <tr key={sample.label}>
                          <td>{sample.label}</td>
                          <td>
                            <select
                              aria-label={`Role of ${sample.label}`}
                              disabled={disabled}
                              value={sample.role}
                              onChange={(event) =>
                                sampleEdit(i, sample.label, {
                                  role: event.target.value as IntakeSample["role"],
                                })
                              }
                              className={`${FIELD} h-7`}
                            >
                              <option value="reference">Start of screen</option>
                              <option value="plasmid">Plasmid</option>
                              <option value="control">Control</option>
                              <option value="treatment">Endpoint / treatment</option>
                            </select>
                          </td>
                          <td>
                            <input
                              aria-label={`Replicate of ${sample.label}`}
                              type="number"
                              min={1}
                              max={999}
                              value={sample.replicate}
                              disabled={disabled}
                              onChange={(event) =>
                                sampleEdit(i, sample.label, {
                                  replicate: Number(event.target.value),
                                })
                              }
                              className={`${FIELD} h-7 w-16`}
                            />
                          </td>
                          {[
                            ...new Set([
                              "model",
                              "condition",
                              "timepoint",
                              "dose",
                              "batch",
                              "donor",
                              ...table.samples.flatMap((sample) =>
                                Object.keys(sample.factors ?? {}),
                              ),
                            ]),
                          ].map((key) => (
                            <td key={key}>
                              <input
                                aria-label={`${key} of ${sample.label}`}
                                value={sample.factors?.[key] ?? ""}
                                disabled={disabled}
                                onChange={(event) =>
                                  sampleEdit(i, sample.label, {
                                    factors: {
                                      ...sample.factors,
                                      [key]: event.target.value,
                                    },
                                  })
                                }
                                className={`${FIELD} h-7 w-28`}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                aria-label="Additional sample factor"
                placeholder="Additional factor, e.g. passage"
                value={factor}
                onChange={(event) => setFactor(event.target.value)}
                className={`${FIELD} min-w-40 flex-1`}
              />
              <button
                type="button"
                disabled={disabled || !factor.trim() || factor.length > 100}
                onClick={() => {
                  onTables(
                    tables.map((table) => ({
                      ...table,
                      samples: table.samples.map((sample) => ({
                        ...sample,
                        factors: { ...sample.factors, [factor.trim()]: "" },
                      })),
                    })),
                  );
                  setFactor("");
                }}
                className="rounded-md border border-line px-3 text-[12px]"
              >
                Add factor
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  const suggested = suggestComparisons(tables);
                  onChange(
                    sequencing
                      ? suggested.map((row, i) => ({ ...row, enabled: i === 0 }))
                      : suggested,
                  );
                }}
                className="rounded-md border border-line px-3 text-[12px]"
              >
                Rebuild suggestions
              </button>
            </div>
          </details>
          {comparisons.map((comparison) => (
            <details
              key={comparison.id}
              className="mt-3 border-t border-stone-200 pt-2"
              open={comparisons.length === 1 || undefined}
            >
              <summary className="flex cursor-pointer items-center gap-2 text-[12px] text-ink">
                <input
                  aria-label={`Run ${comparison.name}`}
                  type="checkbox"
                  checked={comparison.enabled}
                  disabled={disabled}
                  onChange={(event) =>
                    patch(comparison.id, { enabled: event.target.checked })
                  }
                />
                <span className="flex-1 font-medium">{comparison.name}</span>
                <span className="text-[11px] text-muted">
                  {comparison.treatment.length} vs {comparison.control.length} samples,
                  RRA{settings.hit_callers.includes("mageck_mle") ? " + MLE" : ""}{comparison.drug ? " + DrugZ" : ""}
                </span>
              </summary>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="text-[11px] text-muted">
                  Comparison name
                  <input
                    aria-label={`Name for ${comparison.name}`}
                    value={comparison.name}
                    disabled={disabled}
                    onChange={(event) =>
                      patch(comparison.id, { name: event.target.value })
                    }
                    className={`${FIELD} mt-1 w-full`}
                  />
                </label>
                <label className="text-[11px] text-muted">
                  Model
                  <input
                    aria-label={`Model for ${comparison.name}`}
                    value={comparison.model}
                    disabled={disabled}
                    onChange={(event) =>
                      patch(comparison.id, { model: event.target.value })
                    }
                    className={`${FIELD} mt-1 w-full`}
                  />
                </label>
                <label className="text-[11px] text-muted">
                  {sequencing ? "Input" : "Count table"}
                  <select
                    aria-label={`Table for ${comparison.name}`}
                    value={comparison.table}
                    disabled={disabled}
                    onChange={(event) => {
                      const table = Number(event.target.value);
                      patch(comparison.id, {
                        table,
                        model: tables[table].model,
                        treatment: [],
                        control: [],
                        mle_design: undefined,
                      });
                    }}
                    className={`${FIELD} mt-1 w-full`}
                  >
                    {tables.map((table, i) => (
                      <option key={i} value={i}>
                        {table.sheet}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] text-muted">
                  Phenotype
                  <input
                    aria-label={`Phenotype for ${comparison.name}`}
                    value={comparison.phenotype}
                    disabled={disabled}
                    onChange={(event) =>
                      patch(comparison.id, { phenotype: event.target.value })
                    }
                    className={`${FIELD} mt-1 w-full`}
                  />
                </label>
              </div>
              <label className="mt-3 flex items-center gap-2 text-[12px] text-body">
                <input
                  type="checkbox"
                  aria-label={`DrugZ for ${comparison.name}`}
                  checked={comparison.drug}
                  disabled={disabled}
                  onChange={(event) =>
                    patch(comparison.id, { drug: event.target.checked })
                  }
                />
                Include DrugZ for a drug interaction comparison
              </label>
              <label className="mt-2 flex items-center gap-2 text-[12px] text-body">
                <input
                  aria-label={`Fitness endpoint for ${comparison.name}`}
                  type="checkbox"
                  checked={Boolean(comparison.fitness)}
                  disabled={disabled || comparison.drug}
                  onChange={(event) =>
                    patch(comparison.id, { fitness: event.target.checked })
                  }
                />
                Fitness endpoint against start-of-screen or plasmid
              </label>
              <div className="mt-2 overflow-x-auto">
                <table className="dense-table dense-table-compact">
                  <thead>
                    <tr>
                      <th>Sample</th>
                      <th>Use in comparison</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tables[comparison.table].samples.map((sample) => (
                      <tr key={sample.label}>
                        <td>{sample.label}</td>
                        <td>
                          <select
                            aria-label={`${sample.label} in ${comparison.name}`}
                            disabled={disabled}
                            value={
                              comparison.treatment.includes(sample.label)
                                ? "treatment"
                                : comparison.control.includes(sample.label)
                                  ? "control"
                                  : "unused"
                            }
                            onChange={(event) => {
                              const treatment = comparison.treatment.filter(
                                (label) => label !== sample.label,
                              );
                              const control = comparison.control.filter(
                                (label) => label !== sample.label,
                              );
                              patch(comparison.id, {
                                treatment:
                                  event.target.value === "treatment"
                                    ? [...treatment, sample.label]
                                    : treatment,
                                control:
                                  event.target.value === "control"
                                    ? [...control, sample.label]
                                    : control,
                                mle_design: undefined,
                              });
                            }}
                            className={`${FIELD} h-7`}
                          >
                            <option value="unused">Not in this comparison</option>
                            <option value="control">Denominator / baseline</option>
                            <option value="treatment">Numerator / endpoint</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  onChange(comparisons.filter((row) => row.id !== comparison.id))
                }
                className="mt-3 text-[12px] text-muted hover:text-ink"
              >
                Remove comparison
              </button>
              <div className="mt-4"><LabEvidenceSettings value={comparison.lab_evidence ?? settings.lab_evidence ?? {}}
                samples={tables[comparison.table].samples} expressionFiles={expressionFiles} deterministicOnly={settings.deterministic_only ?? true}
                onChange={lab_evidence => patch(comparison.id, { lab_evidence })}
                onDeterministic={deterministic_only => onSettings({ ...settings, deterministic_only })} /></div>
              {settings.hit_callers.includes("mageck_mle") && (
                <MleDesignEditor
                  table={tables[comparison.table]}
                  comparison={comparison}
                  disabled={disabled}
                  onChange={(mle_design) => patch(comparison.id, { mle_design })}
                />
              )}
            </details>
          ))}
        </section>
      )}
      {step === 4 && (
        <>
          <div className="rounded-sm border border-stone-200 bg-white p-6 mt-4">
            <h3 className="text-sm font-medium text-ink">Pipeline settings</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-[12px] text-ink">
                Readout
                <select
                  aria-label="Analysis readout"
                  value={settings.profile ?? "pooled_abundance"}
                  disabled={disabled}
                  onChange={(event) =>
                    onSettings({
                      ...settings,
                      profile: event.target.value as AnalysisSettings["profile"],
                    })
                  }
                  className={`${FIELD} mt-1 w-full`}
                >
                  {PROFILES.map((profile) => (
                    <option
                      key={profile.id}
                      value={profile.id}
                      disabled={!profile.available}
                    >
                      {profile.label}
                      {profile.available ? "" : ", adapter required"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[12px] text-ink">
                Model type
                <select
                  aria-label="Experiment model type"
                  value={settings.model_type ?? "other"}
                  disabled={disabled}
                  onChange={(event) =>
                    onSettings({
                      ...settings,
                      model_type: event.target.value as ModelType,
                    })
                  }
                  className={`${FIELD} mt-1 w-full`}
                >
                  {MODEL_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[12px] text-ink">
                FDR threshold
                <input
                  aria-label="Experiment FDR threshold"
                  type="number"
                  min={0.001}
                  max={0.99}
                  step={0.01}
                  value={settings.fdr_threshold}
                  disabled={disabled}
                  onChange={(event) =>
                    onSettings({ ...settings, fdr_threshold: Number(event.target.value) })
                  }
                  className={`${FIELD} mt-1 w-full`}
                />
              </label>
              <label className="text-[12px] text-ink">
                Normalization
                <select
                  aria-label="Experiment normalization"
                  value={settings.normalization}
                  disabled={disabled}
                  onChange={(event) =>
                    onSettings({
                      ...settings,
                      normalization: event.target
                        .value as AnalysisSettings["normalization"],
                    })
                  }
                  className={`${FIELD} mt-1 w-full`}
                >
                  <option value="median">Median ratio</option>
                  <option value="total">Total count</option>
                  <option value="control">Negative-control guides</option>
                </select>
              </label>
            </div>
            {problems.map((problem) => (
              <p key={problem} role="alert" className="mt-3 text-[12px] text-orange-700">
                {problem}
              </p>
            ))}
            <details className="mt-4">
              <summary className="cursor-pointer text-[12px] font-medium text-ink">
                Advanced settings
              </summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="flex items-center gap-2 text-[12px] text-body">
                  <input
                    type="checkbox"
                    checked={settings.hit_callers.includes("mageck_mle")}
                    disabled={disabled}
                    onChange={(event) =>
                      onSettings({
                        ...settings,
                        hit_callers: event.target.checked
                          ? [...settings.hit_callers, "mageck_mle"]
                          : settings.hit_callers.filter(
                              (caller) => caller !== "mageck_mle",
                            ),
                      })
                    }
                  />
                  Add MAGeCK MLE
                </label>
                <label className="flex items-center gap-2 text-[12px] text-body">
                  <input
                    type="checkbox"
                    checked={settings.hit_callers.includes("bagel2")}
                    disabled={disabled}
                    onChange={(event) =>
                      onSettings({
                        ...settings,
                        hit_callers: event.target.checked
                          ? [...settings.hit_callers, "bagel2"]
                          : settings.hit_callers.filter((caller) => caller !== "bagel2"),
                      })
                    }
                  />
                  Add BAGEL2 to fitness comparisons
                </label>
                <label className="flex items-center gap-2 text-[12px] text-body">
                  <input
                    aria-label="Paired DrugZ"
                    type="checkbox"
                    checked={Boolean(settings.drugz_paired)}
                    disabled={disabled}
                    onChange={(event) =>
                      onSettings({ ...settings, drugz_paired: event.target.checked })
                    }
                  />
                  Paired DrugZ, matching replicate numbers
                </label>
                <label className="text-[12px] text-ink">
                  DrugZ pseudocount
                  <input
                    aria-label="DrugZ pseudocount"
                    type="number"
                    step={1}
                    min={1}
                    max={1000}
                    value={settings.drugz_options?.pseudocount ?? 5}
                    disabled={disabled}
                    onChange={(event) =>
                      onSettings({
                        ...settings,
                        drugz_options: {
                          pseudocount: Number(event.target.value),
                          half_window_size:
                            settings.drugz_options?.half_window_size ?? 500,
                        },
                      })
                    }
                    className={`${FIELD} mt-1 w-full`}
                  />
                </label>
                <label className="text-[12px] text-ink">
                  DrugZ smoothing half-window
                  <input
                    aria-label="DrugZ smoothing half-window"
                    type="number"
                    min={2}
                    max={10000}
                    value={settings.drugz_options?.half_window_size ?? 500}
                    disabled={disabled}
                    onChange={(event) =>
                      onSettings({
                        ...settings,
                        drugz_options: {
                          pseudocount: settings.drugz_options?.pseudocount ?? 5,
                          half_window_size: Number(event.target.value),
                        },
                      })
                    }
                    className={`${FIELD} mt-1 w-full`}
                  />
                </label>
                <p className="text-[11px] text-muted sm:col-span-2">
                  Chronos requires pDNA batches and collection times. Copy-number
                  correction requires matched profiles. These methods are unavailable in
                  this intake.
                </p>
              </div>
            </details>
          </div>

          <section className="rounded-sm border border-stone-200 bg-white p-6">
            <h3 className="text-sm font-medium text-ink">Confirm analysis plan</h3>
            <p className="mt-1 text-[12px] text-muted">
              {selected.length} comparisons, {settings.normalization} normalization, FDR{" "}
              {settings.fdr_threshold}. Inputs and settings are saved with each run.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="dense-table dense-table-compact">
                <thead>
                  <tr>
                    <th>Comparison</th>
                    <th>Numerator / denominator</th>
                    <th>Methods</th>
                    <th>MLE coefficient</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.map((row) => (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td>
                        {row.treatment.length} / {row.control.length}
                      </td>
                      <td>
                        RRA{settings.hit_callers.includes("mageck_mle") ? ", MLE" : ""}
                        {row.drug
                          ? ", DrugZ"
                          : row.fitness && settings.hit_callers.includes("bagel2")
                            ? ", BAGEL2"
                            : ""}
                      </td>
                      <td>
                        {settings.hit_callers.includes("mageck_mle")
                          ? (row.mle_design?.coefficient ?? "treatment")
                          : "None"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <label className="mt-4 flex items-start gap-2 text-[12px] text-ink">
              <input
                aria-label="Confirm reviewed analysis plan"
                type="checkbox"
                disabled={disabled}
                checked={confirmed}
                onChange={(event) =>
                  setConfirmedPlan(event.target.checked ? planSignature : null)
                }
              />
              I reviewed the inputs, sample mapping and analysis plan
            </label>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={
                  disabled ||
                  !confirmed ||
                  !mappingReady ||
                  !libraryId ||
                  selected.length === 0 ||
                  selected.some((row) => !row.treatment.length || !row.control.length) ||
                  problems.length > 0
                }
                onClick={onStart}
                className="h-9 rounded-md bg-ink px-4 text-[12px] text-white disabled:bg-mist disabled:text-muted"
              >
                {disabled ? "Working..." : `Initialize ${selected.length} comparisons`}
              </button>
              <button
                type="button"
                onClick={exportPlan}
                className="rounded-md border border-stone-200 px-3 text-[12px] text-ink"
              >
                Export plan
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export function comparisonSamples(
  table: ExperimentTable,
  comparison: ExperimentComparison,
): IntakeSample[] {
  return table.samples
    .filter(
      (sample) =>
        comparison.treatment.includes(sample.label) ||
        comparison.control.includes(sample.label) ||
        comparison.lab_evidence?.time_course?.some(point => point.sample === sample.label),
    )
    .map((sample) => ({
      ...sample,
      role: comparison.treatment.includes(sample.label)
        ? "treatment"
        : !comparison.control.includes(sample.label) ? sample.role
        : sample.role === "reference" || sample.role === "plasmid"
          ? sample.role
          : "control",
    }));
}

export function UploadedLibraryImport({
  uploads,
  disabled,
  onImport,
}: {
  uploads: LibraryUpload[];
  disabled: boolean;
  onImport: (
    upload: LibraryUpload,
    name: string,
    options: LibraryImportOptions,
  ) => Promise<void>;
}) {
  const [libraryName, setLibraryName] = useState(
    uploads.length === 1 ? uploads[0].name.replace(/\.[^.]+$/, "") : "",
  );
  const [options, setOptions] = useState<LibraryImportOptions>(DEFAULT_LIBRARY);
  return (
    <>
      {uploads.length > 1 && (
        <button
          type="button"
          disabled={disabled}
          className="mt-3 rounded-md border border-stone-200 px-3 py-1.5 text-[12px] text-ink"
          onClick={() =>
            void onImport(
              {
                ...uploads[0],
                sources: uploads.map(({ fileId, sheet }) => ({ fileId, sheet })),
              },
              libraryName || "Combined guide library",
              options,
            )
          }
        >
          Import combined library
        </button>
      )}{" "}
      {uploads.map((upload) => (
        <div
          key={`${upload.fileId}:${upload.sheet}`}
          className="mt-3 border-t border-stone-200 pt-2"
        >
          <p className="text-[12px] text-ink">
            {upload.name}: {upload.rows.toLocaleString()} sequence records
          </p>
          {upload.warnings.map((warning) => (
            <p key={warning} className="mt-1 text-[11.5px] text-orange-700">
              {warning}
            </p>
          ))}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-[11.5px] text-muted">
              Species
              <select
                aria-label="Custom library species"
                disabled={disabled}
                value={options.organism_taxid}
                onChange={(event) =>
                  setOptions({ ...options, organism_taxid: Number(event.target.value) })
                }
                className={`${FIELD} mt-1 w-full`}
              >
                <option value={9606}>Human</option>
                <option value={10090}>Mouse</option>
              </select>
            </label>
            <label className="text-[11.5px] text-muted">
              Modality
              <select
                aria-label="Custom library modality"
                disabled={disabled}
                value={options.modality}
                onChange={(event) =>
                  setOptions({
                    ...options,
                    modality: event.target.value as LibraryImportOptions["modality"],
                    cas: event.target.value === "knockout" ? "SpCas9" : "dCas9",
                  })
                }
                className={`${FIELD} mt-1 w-full`}
              >
                <option value="knockout">Knockout</option>
                <option value="crispri">CRISPRi</option>
                <option value="crispra">CRISPRa</option>
              </select>
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              aria-label="Custom library name"
              placeholder="Custom library name"
              value={libraryName}
              onChange={(event) => setLibraryName(event.target.value)}
              className={`${FIELD} min-w-48 flex-1`}
              disabled={disabled}
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                void onImport(
                  upload,
                  libraryName || upload.name.replace(/\.[^.]+$/, ""),
                  options,
                )
              }
              className="rounded-md bg-ink px-3 text-[12px] font-medium text-white disabled:bg-mist disabled:text-muted disabled:opacity-50"
            >
              Confirm and import library
            </button>
          </div>
          <details className="mt-4 text-[11.5px] text-muted">
            <summary className="cursor-pointer font-medium hover:text-ink">
              Preview guide mapping
            </summary>
            <div className="mt-2 overflow-x-auto rounded-md border border-stone-200">
              <table className="dense-table dense-table-compact">
                <tbody>
                  {upload.preview.map((row, i) => (
                    <tr key={i}>
                      {row.map((value, j) => (
                        <td key={j}>{value}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      ))}
    </>
  );
}
