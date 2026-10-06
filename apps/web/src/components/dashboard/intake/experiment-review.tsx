"use client";

import { useState } from "react";
import type { AnalysisSettings, LibraryChoice } from "./design-form";
import type { ExperimentTable, ExperimentComparison } from "@/lib/intake/experiment";
import { defaultMle, validateMle, validateDrugz, DEFAULT_LIBRARY, PROFILES, type LibraryImportOptions } from "@/lib/intake/analysis-plan";
import { suggestComparisons } from "@/lib/intake/experiment";
import { MleDesignEditor } from "./mle-design";
import type { IntakeSample } from "@/lib/intake/shape";
import { MODEL_TYPES, type ModelType } from "@/lib/validation/model";

export interface LibraryUpload { sources?: { fileId: string; sheet: string }[]; fileId: string; name: string; sheet: string; rows: number; preview: string[][]; warnings: string[] }
const FIELD = "h-8 rounded-md border border-line bg-white px-2 text-[12px] text-ink outline-none focus:border-cyan-500";

export function ExperimentReview({ tables, onTables, comparisons, onChange, libraryUploads, libraries, libraryId, onLibrary, onImport, onFiles, settings, onSettings, disabled, mappingReady, onStart }: {
  tables: ExperimentTable[]; onTables: (tables: ExperimentTable[]) => void; comparisons: ExperimentComparison[]; onChange: (rows: ExperimentComparison[]) => void;
  libraryUploads: LibraryUpload[]; libraries: LibraryChoice[]; libraryId: string | null; onLibrary: (id: string | null) => void;
  onImport: (upload: LibraryUpload, name: string, options: LibraryImportOptions) => Promise<void>; onFiles?: (files: File[]) => void; settings: AnalysisSettings; onSettings: (settings: AnalysisSettings) => void;
  mappingReady: boolean; disabled: boolean; onStart: () => void;
}) {
  const [plan, setPlan] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [factor, setFactor] = useState("");
  const selected = comparisons.filter((row) => row.enabled);
  const problems = selected.flatMap((row) => settings.hit_callers.includes("mageck_mle") ? [validateMle(row.mle_design ?? defaultMle(tables[row.table].samples, row.treatment, row.control), [...row.control, ...row.treatment])].filter(Boolean) : []);
  if (settings.drugz_options) { const problem = validateDrugz(settings.drugz_options); if (problem) problems.push(problem); }
  const exportPlan = () => { const blob = new Blob([JSON.stringify({ plan_version: "guide-abundance-v2", library_id: libraryId, tables, comparisons: selected, settings }, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "splicr-analysis-plan.json"; link.click(); URL.revokeObjectURL(url); };
  if (plan) return <section className="rounded-xl border border-line bg-white p-4"><h3 className="text-sm font-medium text-ink">Confirm analysis plan</h3><p className="mt-1 text-[12px] text-muted">{selected.length} comparisons, {settings.normalization} normalization, FDR {settings.fdr_threshold}. Inputs and settings are saved with each run.</p><div className="mt-3 overflow-x-auto"><table className="dense-table dense-table-compact"><thead><tr><th>Comparison</th><th>Numerator / denominator</th><th>Methods</th><th>MLE coefficient</th></tr></thead><tbody>{selected.map((row) => <tr key={row.id}><td>{row.name}</td><td>{row.treatment.length} / {row.control.length}</td><td>RRA{settings.hit_callers.includes("mageck_mle") ? ", MLE" : ""}{row.drug ? ", DrugZ" : row.fitness && settings.hit_callers.includes("bagel2") ? ", BAGEL2" : ""}</td><td>{settings.hit_callers.includes("mageck_mle") ? row.mle_design?.coefficient ?? "treatment" : "None"}</td></tr>)}</tbody></table></div><label className="mt-4 flex items-start gap-2 text-[12px] text-ink"><input aria-label="Confirm reviewed analysis plan" type="checkbox" disabled={disabled} checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}/>I reviewed the inputs, sample mapping and analysis plan</label><div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={disabled || !confirmed} onClick={onStart} className="h-9 rounded-md bg-ink px-4 text-[12px] text-white disabled:bg-mist disabled:text-muted">{disabled ? "Working..." : `Run ${selected.length} comparisons`}</button><button type="button" disabled={disabled} onClick={() => { setPlan(false); setConfirmed(false); }} className="rounded-md border border-line px-3 text-[12px] text-ink">Edit plan</button><button type="button" onClick={exportPlan} className="rounded-md border border-line px-3 text-[12px] text-ink">Export plan</button></div></section>;
  const patch = (id: string, next: Partial<ExperimentComparison>) => onChange(comparisons.map((row) => row.id === id ? { ...row, ...next } : row));
  return <div className="space-y-4">
    <section className="rounded-xl border border-line bg-white p-4">
      <h3 className="text-sm font-medium text-ink">Review experiment</h3>
      <p className="mt-1 text-[12px] text-muted">{tables.length} count tables, {tables.reduce((sum, table) => sum + table.samples.length, 0)} samples. Confirm the models, replicates and comparisons.</p>
      {tables.map((table, index) => <details key={`${table.fileId}:${table.sheet}`} className="mt-3 border-t border-line pt-2">
        <summary className="cursor-pointer text-[12px] font-medium text-ink">{table.model || table.sheet}: {table.rows.toLocaleString()} guides, {table.samples.length} samples</summary>
        <p className="mt-1 text-[11px] text-muted">{table.name} / {table.sheet}</p>
        <div className="mt-2 overflow-x-auto"><table className="dense-table dense-table-compact"><thead><tr><th>Sample</th><th>Detected role</th><th>Replicate</th>{[...new Set(["model", "condition", ...table.samples.flatMap((sample) => Object.keys(sample.factors ?? {}))])].filter((key) => !/^(sample|sample_id|role|replicate)$/i.test(key)).map((key) => <th key={key}>{key}</th>)}</tr></thead><tbody>{table.samples.map((sample) => <tr key={sample.label}><td>{sample.label}</td><td><select aria-label={`Detected role for ${table.model} ${sample.label}`} value={sample.role} disabled={disabled} onChange={(event) => onTables(tables.map((row, i) => i === index ? { ...row, samples: row.samples.map((value) => value.label === sample.label ? { ...value, role: event.target.value as IntakeSample["role"] } : value) } : row))} className={`${FIELD} h-7`}><option value="reference">Start of screen</option><option value="plasmid">Plasmid</option><option value="control">Control</option><option value="treatment">Treatment</option></select></td><td><input aria-label={`Replicate for ${table.model} ${sample.label}`} type="number" min={1} max={99} value={sample.replicate} disabled={disabled} onChange={(event) => onTables(tables.map((row, i) => i === index ? { ...row, samples: row.samples.map((value) => value.label === sample.label ? { ...value, replicate: Number(event.target.value) } : value) } : row))} className={`${FIELD} h-7 w-14`}/></td>{[...new Set(["model", "condition", ...table.samples.flatMap((value) => Object.keys(value.factors ?? {}))])].filter((key) => !/^(sample|sample_id|role|replicate)$/i.test(key)).map((key) => <td key={key}><input aria-label={`${key} for ${table.sheet} ${sample.label}`} value={sample.factors?.[key] ?? (key === "model" ? table.model : "")} disabled={disabled} onChange={(event) => onTables(tables.map((row, i) => i === index ? { ...row, samples: row.samples.map((value) => value.label === sample.label ? { ...value, factors: { ...value.factors, [key]: event.target.value } } : value) } : row))} className={`${FIELD} h-7 w-32`}/></td>)}</tr>)}</tbody></table></div>
        <div className="mt-2 overflow-x-auto"><table aria-label={`Count preview ${index + 1}`} className="dense-table dense-table-compact"><tbody>{table.preview.map((row, i) => <tr key={i}>{row.map((value, j) => <td key={j}>{value}</td>)}</tr>)}</tbody></table></div>
        {table.warnings.map((warning) => <p key={warning} className="mt-1 text-[11px] text-orange-700">{warning}</p>)}
      </details>)}
      <div className="mt-3 flex flex-wrap gap-2"><input aria-label="New sample factor" placeholder="Timepoint, dose, batch..." value={factor} onChange={(event) => setFactor(event.target.value)} disabled={disabled} className={`${FIELD} w-44`}/><button type="button" className="rounded-md border border-line px-3 text-[12px] text-ink" disabled={disabled || !factor.trim()} onClick={() => { onTables(tables.map((table) => ({ ...table, samples: table.samples.map((sample) => ({ ...sample, factors: { ...sample.factors, [factor.trim()]: sample.factors?.[factor.trim()] ?? "" } })) }))); setFactor(""); }}>Add sample factor</button><button type="button" className="rounded-md border border-line px-3 text-[12px] text-ink" disabled={disabled} onClick={() => onChange(suggestComparisons(tables))}>Suggest comparisons from sample sheet</button></div>
    </section>

    <section className="rounded-xl border border-line bg-white p-4">
      <h3 className="text-sm font-medium text-ink">Guide library</h3>
      <div className="mt-2 flex items-center gap-2">
        <select aria-label="Experiment guide library" value={libraryId ?? ""} disabled={disabled} onChange={(event) => onLibrary(event.target.value || null)} className={`${FIELD} flex-1`}>
          <option value="">Choose a library or import your own</option>
          {libraries.map((library) => <option key={library.id} value={library.id} disabled={library.n_guides < 1}>{library.name}, {library.n_guides.toLocaleString()} guides</option>)}
        </select>
        <label className="flex h-8 cursor-pointer items-center justify-center rounded-md border border-line bg-mist-soft px-3 text-[12px] font-medium text-ink hover:bg-mist">
          Import...
          <input type="file" className="hidden" accept=".csv,.tsv,.xlsx" onChange={(e) => { if (e.target.files?.length && onFiles) onFiles(Array.from(e.target.files)); }} disabled={disabled} />
        </label>
      </div>
      <UploadedLibraryImport uploads={libraryUploads} disabled={disabled} onImport={onImport}/>
    </section>

    <section className="rounded-xl border border-line bg-white p-4">
      <div className="flex items-center justify-between"><h3 className="text-sm font-medium text-ink">Comparisons</h3><button type="button" disabled={disabled || !tables.length} onClick={() => onChange([...comparisons, { id: crypto.randomUUID(), table: 0, name: "New comparison", model: tables[0].model, phenotype: "Growth", treatment: [], control: [], drug: false, fitness: false, enabled: true }])} className="text-[12px] text-cyan-700">Add comparison</button></div>
      {comparisons.length === 0 && <p className="mt-2 text-[12px] text-muted">Add a comparison and select both arms.</p>}
      {comparisons.map((comparison) => <details key={comparison.id} className="mt-3 border-t border-line pt-2" open={comparisons.length === 1 || undefined}>
        <summary className="flex cursor-pointer items-center gap-2 text-[12px] text-ink"><input aria-label={`Run ${comparison.name}`} type="checkbox" checked={comparison.enabled} disabled={disabled} onChange={(event) => patch(comparison.id, { enabled: event.target.checked })}/><span className="flex-1 font-medium">{comparison.name}</span><span className="text-[11px] text-muted">{comparison.treatment.length} vs {comparison.control.length} replicates, RRA{comparison.drug ? " + DrugZ" : ""}</span></summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="text-[11px] text-muted">Comparison name<input aria-label={`Name for ${comparison.name}`} value={comparison.name} disabled={disabled} onChange={(event) => patch(comparison.id, { name: event.target.value })} className={`${FIELD} mt-1 w-full`}/></label>
          <label className="text-[11px] text-muted">Model<input aria-label={`Model for ${comparison.name}`} value={comparison.model} disabled={disabled} onChange={(event) => patch(comparison.id, { model: event.target.value })} className={`${FIELD} mt-1 w-full`}/></label>
          <label className="text-[11px] text-muted">Count table<select aria-label={`Table for ${comparison.name}`} value={comparison.table} disabled={disabled} onChange={(event) => { const table = Number(event.target.value); patch(comparison.id, { table, model: tables[table].model, treatment: [], control: [], mle_design: undefined }); }} className={`${FIELD} mt-1 w-full`}>{tables.map((table, i) => <option key={i} value={i}>{table.sheet}</option>)}</select></label>
          <label className="text-[11px] text-muted">Phenotype<input aria-label={`Phenotype for ${comparison.name}`} value={comparison.phenotype} disabled={disabled} onChange={(event) => patch(comparison.id, { phenotype: event.target.value })} className={`${FIELD} mt-1 w-full`}/></label>
        </div>
        <label className="mt-3 flex items-center gap-2 text-[12px] text-body"><input type="checkbox" aria-label={`DrugZ for ${comparison.name}`} checked={comparison.drug} disabled={disabled} onChange={(event) => patch(comparison.id, { drug: event.target.checked })}/>Include DrugZ for a drug interaction comparison</label>
        <label className="mt-2 flex items-center gap-2 text-[12px] text-body"><input aria-label={`Fitness endpoint for ${comparison.name}`} type="checkbox" checked={Boolean(comparison.fitness)} disabled={disabled || comparison.drug} onChange={(event) => patch(comparison.id, { fitness: event.target.checked })}/>Fitness endpoint against start-of-screen or plasmid</label><div className="mt-2 overflow-x-auto"><table className="dense-table dense-table-compact"><thead><tr><th>Sample</th><th>Use in comparison</th></tr></thead><tbody>{tables[comparison.table].samples.map((sample) => <tr key={sample.label}><td>{sample.label}</td><td><select aria-label={`${sample.label} in ${comparison.name}`} disabled={disabled} value={comparison.treatment.includes(sample.label) ? "treatment" : comparison.control.includes(sample.label) ? "control" : "unused"} onChange={(event) => { const treatment = comparison.treatment.filter((label) => label !== sample.label); const control = comparison.control.filter((label) => label !== sample.label); patch(comparison.id, { treatment: event.target.value === "treatment" ? [...treatment, sample.label] : treatment, control: event.target.value === "control" ? [...control, sample.label] : control, mle_design: undefined }); }} className={`${FIELD} h-7`}><option value="unused">Not in this comparison</option><option value="control">Denominator / baseline</option><option value="treatment">Numerator / endpoint</option></select></td></tr>)}</tbody></table></div>
        {settings.hit_callers.includes("mageck_mle") && <MleDesignEditor table={tables[comparison.table]} comparison={comparison} disabled={disabled} onChange={(mle_design) => patch(comparison.id, { mle_design })}/>}
      </details>)}
    </section>

    <details className="rounded-xl border border-line bg-white p-4"><summary className="cursor-pointer text-[12px] font-medium text-ink">Pipeline settings</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="text-[12px] text-ink">Readout<select aria-label="Analysis readout" value={settings.profile ?? "pooled_abundance"} disabled={disabled} onChange={(event) => onSettings({ ...settings, profile: event.target.value as AnalysisSettings["profile"] })} className={`${FIELD} mt-1 w-full`}>{PROFILES.map((profile) => <option key={profile.id} value={profile.id} disabled={!profile.available}>{profile.label}{profile.available ? "" : ", adapter required"}</option>)}</select></label><label className="text-[12px] text-ink">Model type<select aria-label="Experiment model type" value={settings.model_type ?? "other"} disabled={disabled} onChange={(event) => onSettings({ ...settings, model_type: event.target.value as ModelType })} className={`${FIELD} mt-1 w-full`}>{MODEL_TYPES.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></label>
      <label className="text-[12px] text-ink">FDR threshold<input aria-label="Experiment FDR threshold" type="number" min={0.001} max={0.99} step={0.01} value={settings.fdr_threshold} disabled={disabled} onChange={(event) => onSettings({ ...settings, fdr_threshold: Number(event.target.value) })} className={`${FIELD} mt-1 w-full`}/></label>
      <label className="text-[12px] text-ink">Normalization<select aria-label="Experiment normalization" value={settings.normalization} disabled={disabled} onChange={(event) => onSettings({ ...settings, normalization: event.target.value as AnalysisSettings["normalization"] })} className={`${FIELD} mt-1 w-full`}><option value="median">Median ratio</option><option value="total">Total count</option><option value="control">Negative-control guides</option></select></label>
      <label className="flex items-center gap-2 text-[12px] text-body"><input type="checkbox" checked={settings.hit_callers.includes("mageck_mle")} disabled={disabled} onChange={(event) => onSettings({ ...settings, hit_callers: event.target.checked ? [...settings.hit_callers, "mageck_mle"] : settings.hit_callers.filter((caller) => caller !== "mageck_mle") })}/>Add MAGeCK MLE</label>
      <label className="flex items-center gap-2 text-[12px] text-body"><input type="checkbox" checked={settings.hit_callers.includes("bagel2")} disabled={disabled} onChange={(event) => onSettings({ ...settings, hit_callers: event.target.checked ? [...settings.hit_callers, "bagel2"] : settings.hit_callers.filter((caller) => caller !== "bagel2") })}/>Add BAGEL2 to fitness comparisons</label>
      <label className="flex items-center gap-2 text-[12px] text-body"><input aria-label="Paired DrugZ" type="checkbox" checked={Boolean(settings.drugz_paired)} disabled={disabled} onChange={(event) => onSettings({ ...settings, drugz_paired: event.target.checked })}/>Paired DrugZ, matching replicate numbers</label>
      <label className="text-[12px] text-ink">DrugZ pseudocount<input aria-label="DrugZ pseudocount" type="number" step={1} min={1} max={1000} value={settings.drugz_options?.pseudocount ?? 5} disabled={disabled} onChange={(event) => onSettings({ ...settings, drugz_options: { pseudocount: Number(event.target.value), half_window_size: settings.drugz_options?.half_window_size ?? 500 } })} className={`${FIELD} mt-1 w-full`}/></label><label className="text-[12px] text-ink">DrugZ smoothing half-window<input aria-label="DrugZ smoothing half-window" type="number" min={2} max={10000} value={settings.drugz_options?.half_window_size ?? 500} disabled={disabled} onChange={(event) => onSettings({ ...settings, drugz_options: { pseudocount: settings.drugz_options?.pseudocount ?? 5, half_window_size: Number(event.target.value) } })} className={`${FIELD} mt-1 w-full`}/></label>
      <p className="text-[11px] text-muted sm:col-span-2">Chronos requires pDNA batches and collection times. Copy-number correction requires matched profiles. These methods are unavailable in this intake.</p>
    </div></details>
    {problems.length > 0 && <p role="alert" className="text-[12px] text-orange-700">{problems[0]}</p>}
    <button type="button" onClick={() => { setPlan(true); setConfirmed(false); }} disabled={disabled || problems.length > 0 || !mappingReady || !libraryId || !comparisons.some((row) => row.enabled) || comparisons.some((row) => row.enabled && (!row.treatment.length || !row.control.length))} className="h-9 rounded-md bg-ink px-4 text-[12px] font-medium text-white disabled:bg-mist disabled:text-muted">{disabled ? "Working..." : "Review analysis plan"}</button>
  </div>;
}

export function comparisonSamples(table: ExperimentTable, comparison: ExperimentComparison): IntakeSample[] {
  return table.samples.filter((sample) => comparison.treatment.includes(sample.label) || comparison.control.includes(sample.label)).map((sample) => ({ ...sample, role: comparison.treatment.includes(sample.label) ? "treatment" : sample.role === "reference" || sample.role === "plasmid" ? sample.role : "control" }));
}

export function UploadedLibraryImport({ uploads, disabled, onImport }: { uploads: LibraryUpload[]; disabled: boolean; onImport: (upload: LibraryUpload, name: string, options: LibraryImportOptions) => Promise<void> }) {
  const [libraryName, setLibraryName] = useState(uploads.length === 1 ? uploads[0].name.replace(/\.[^.]+$/, "") : "");
  const [options, setOptions] = useState<LibraryImportOptions>(DEFAULT_LIBRARY);
  return <>{uploads.length > 1 && <button type="button" disabled={disabled} className="mt-3 rounded-md border border-line px-3 py-1.5 text-[12px] text-ink" onClick={() => void onImport({ ...uploads[0], sources: uploads.map(({ fileId, sheet }) => ({ fileId, sheet })) }, libraryName || "Combined guide library", options)}>Import combined library</button>}      {uploads.map((upload) => <div key={`${upload.fileId}:${upload.sheet}`} className="mt-3 border-t border-line pt-2">
        <p className="text-[12px] text-ink">{upload.name}: {upload.rows.toLocaleString()} sequence records</p>
        {upload.warnings.map((warning) => <p key={warning} className="mt-1 text-[11.5px] text-orange-700">{warning}</p>)}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-[11.5px] text-muted">Species
            <select aria-label="Custom library species" disabled={disabled} value={options.organism_taxid} onChange={(event) => setOptions({ ...options, organism_taxid: Number(event.target.value) })} className={`${FIELD} mt-1 w-full`}>
              <option value={9606}>Human</option><option value={10090}>Mouse</option>
            </select>
          </label>
          <label className="text-[11.5px] text-muted">Modality
            <select aria-label="Custom library modality" disabled={disabled} value={options.modality} onChange={(event) => setOptions({ ...options, modality: event.target.value as LibraryImportOptions["modality"], cas: event.target.value === "knockout" ? "SpCas9" : "dCas9" })} className={`${FIELD} mt-1 w-full`}>
              <option value="knockout">Knockout</option><option value="crispri">CRISPRi</option><option value="crispra">CRISPRa</option>
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <input aria-label="Custom library name" placeholder="Custom library name" value={libraryName} onChange={(event) => setLibraryName(event.target.value)} className={`${FIELD} min-w-48 flex-1`} disabled={disabled}/>
          <button type="button" disabled={disabled} onClick={() => void onImport(upload, libraryName || upload.name.replace(/\.[^.]+$/, ""), options)} className="rounded-md bg-ink px-3 text-[12px] font-medium text-white disabled:bg-mist disabled:text-muted disabled:opacity-50">Confirm and import library</button>
        </div>
        <details className="mt-4 text-[11.5px] text-muted">
          <summary className="cursor-pointer font-medium hover:text-ink">Preview guide mapping</summary>
          <div className="mt-2 overflow-x-auto rounded-md border border-line">
            <table className="dense-table dense-table-compact"><tbody>{upload.preview.map((row, i) => <tr key={i}>{row.map((value, j) => <td key={j}>{value}</td>)}</tr>)}</tbody></table>
          </div>
        </details>
      </div>)}</>;
}
