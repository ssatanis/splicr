"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_FIELDS, EXPORT_FIELDS, EXPORT_SECTIONS, FDR_METRICS, REQUIRED_FIELDS, type ExportField, type ExportRequest, type ExportSection } from "@/lib/report/export-options";

const groups = [...new Set(EXPORT_FIELDS.map(f => f.group))];
const control = "rounded-md border border-line bg-white px-3 py-2 text-sm text-ink";

export function ScreensExportDialog({ screenIds, onClose }: { screenIds: string[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [format, setFormat] = useState<ExportRequest["format"]>("xlsx");
  const [fields, setFields] = useState<ExportField[]>(DEFAULT_FIELDS);
  const [sections, setSections] = useState<ExportSection[]>(EXPORT_SECTIONS.map(s => s.key));
  const [rowScope, setRowScope] = useState<ExportRequest["rowScope"]>("all");
  const [fdrMetric, setFdrMetric] = useState<ExportRequest["fdrMetric"]>("fdr");
  const [threshold, setThreshold] = useState("0.1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  const validThreshold = threshold.trim() !== "" && Number.isFinite(Number(threshold)) && Number(threshold) >= 0 && Number(threshold) <= 1;
  const toggleField = (field: ExportField) => setFields(current => current.includes(field) ? current.filter(f => f !== field) : [...current, field]);
  const toggleSection = (section: ExportSection) => setSections(current => current.includes(section) ? current.filter(s => s !== section) : [...current, section]);
  const download = async () => {
    if (busy || (rowScope === "fdr" && !validThreshold)) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/screens/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        screenIds, format, fields: EXPORT_FIELDS.filter(f => fields.includes(f.key)).map(f => f.key),
        sections: EXPORT_SECTIONS.filter(s => sections.includes(s.key)).map(s => s.key), rowScope, fdrMetric, fdrThreshold: rowScope === "fdr" ? Number(threshold) : 0.1,
      }) });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error ?? "The export could not be downloaded. Please retry.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? `SplicR-screens.${format === "csv" ? "zip" : format}`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The export could not be downloaded. Please retry."); }
    finally { setBusy(false); }
  };
  return (
    <dialog ref={ref} aria-labelledby="screens-export-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
      className="m-auto max-h-[90vh] w-[min(720px,calc(100vw-32px))] overflow-y-auto rounded-xl border border-line bg-white p-6 text-ink shadow-xl backdrop:bg-black/30">
      <h2 id="screens-export-title" className="text-lg font-semibold">Export screens</h2>
      <p className="mt-1 text-sm text-muted">{screenIds.length} {screenIds.length === 1 ? "screen" : "screens"} selected. Choose the file and the recorded outputs to include.</p>
      <fieldset disabled={busy} className="mt-5 space-y-5">
        <label className="flex flex-col gap-1.5 text-sm font-medium">File format
          <select aria-label="File format" className={control} value={format} onChange={event => setFormat(event.target.value as ExportRequest["format"])}>
            <option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV tables (.zip)</option><option value="json">JSON (.json)</option>
          </select>
        </label>
        <p className="text-xs text-muted">{format === "xlsx" ? "One results worksheet per screen, with separate sheets for the evidence you choose." : format === "csv" ? "CSV has no worksheets. The ZIP contains a folder for each screen, separate evidence tables, and an export record." : "One JSON document, grouped by screen, with the selected columns and evidence."}</p>
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">Gene rows</legend>
          <label className="flex gap-2 text-sm"><input type="radio" name="export-rows" checked={rowScope === "all"} onChange={() => setRowScope("all")} />All recorded gene rows</label>
          <label className="flex gap-2 text-sm"><input type="radio" name="export-rows" checked={rowScope === "fdr"} onChange={() => setRowScope("fdr")} />Filter by FDR</label>
          {rowScope === "fdr" && <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs">FDR metric<select aria-label="FDR metric" className={control} value={fdrMetric} onChange={e => setFdrMetric(e.target.value as ExportRequest["fdrMetric"])}>{FDR_METRICS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}</select></label>
            <label className="flex flex-col gap-1 text-xs">Maximum FDR (inclusive)<input className={control} type="number" min="0" max="1" step="any" value={threshold} onChange={e => setThreshold(e.target.value)} aria-invalid={!validThreshold} /></label>
            <p className="text-xs text-muted sm:col-span-2">Rows without the selected FDR are excluded. Guide results and disagreement evidence follow the exported genes and comparisons.</p>
          </div>}
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Gene result columns</legend>
          <div className="mb-3 flex gap-3 text-xs"><button type="button" className="underline" onClick={() => setFields(EXPORT_FIELDS.map(f => f.key))}>All columns</button><button type="button" className="underline" onClick={() => setFields(DEFAULT_FIELDS)}>Standard columns</button><button type="button" className="underline" onClick={() => setFields([...REQUIRED_FIELDS])}>Identity only</button></div>
          <div className="grid gap-4 sm:grid-cols-2">{groups.map(group => <div key={group}>
            <h3 className="mb-1 text-xs font-medium text-muted">{group}</h3>
            {EXPORT_FIELDS.filter(f => f.group === group).map(f => <label key={f.key} title={f.description} className="flex items-start gap-2 py-1 text-xs"><input type="checkbox" checked={fields.includes(f.key)} disabled={REQUIRED_FIELDS.includes(f.key)} onChange={() => toggleField(f.key)} />{f.label}{REQUIRED_FIELDS.includes(f.key) ? " (required)" : ""}</label>)}
          </div>)}</div>
        </fieldset>
        <fieldset><legend className="mb-2 text-sm font-medium">Evidence sections</legend>
          {EXPORT_SECTIONS.map(s => <label key={s.key} className="mb-3 flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={sections.includes(s.key)} onChange={() => toggleSection(s.key)} /><span>{s.label}<span className="mt-0.5 block text-xs text-muted">{s.description}</span></span></label>)}
        </fieldset>
      </fieldset>
      <p className="mt-4 text-xs text-muted">Screen and run identifiers, QC status, column definitions and export choices are included with every file. Statistics are exported as recorded; blank values mean not recorded.</p>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      <div className="mt-5 flex justify-end gap-3"><button type="button" disabled={busy} onClick={onClose} className={`${control} disabled:opacity-50`}>Cancel</button>
        <button type="button" onClick={download} disabled={busy || (rowScope === "fdr" && !validThreshold)} className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? "Preparing export…" : "Download export"}</button></div>
    </dialog>
  );
}
