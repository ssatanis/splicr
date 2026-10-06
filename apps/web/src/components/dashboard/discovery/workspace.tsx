"use client";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/dashboard/ui";
import type { DiscoveryView } from "@/lib/data/discovery";
import { saveDiscoveryEvidence, freezeDiscoveryBatch } from "@/lib/data/discovery-actions";
import { parseDiscoveryDocument, type BatchDesign, type ModelContext } from "@/lib/discovery/schema";
import { selectBatch } from "@/lib/discovery/model";
import { allEndpoints } from "@/lib/validation/endpoint";

const field = "w-full rounded-md border border-line bg-white px-2.5 py-2 text-sm text-ink";
const button = "rounded-md bg-cyan-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50";
const fmt = (v: number | null) => v === null ? "Not measured" : v.toLocaleString(undefined, { maximumFractionDigits: 3 });
type Ready = Extract<DiscoveryView, { status: "ready" }>;

export function DiscoveryWorkspace({ view }: { view: Ready }) {
  const router = useRouter();
  const selected = view.selected;
  const [text, setText] = useState(selected ? JSON.stringify(selected.document, null, 2) : "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [investigator, setInvestigator] = useState<string[]>([]);
  const [missed, setMissed] = useState<string[]>([]);
  const endpoints = allEndpoints();
  const [name, setName] = useState("Discovery round");
  const [budget, setBudget] = useState("20");
  const [unit, setUnit] = useState("assay units");
  const [cost, setCost] = useState("1");
  const [costs, setCosts] = useState<Record<string, number>>({});
  const [fraction, setFraction] = useState("0.2");
  const [endpoint, setEndpoint] = useState(endpoints.find((e) => e.validation_types.includes("independent_guide"))?.key ?? endpoints[0]?.key ?? "");
  const [threshold, setThreshold] = useState("");
  const dirty = selected ? text !== JSON.stringify(selected.document, null, 2) : false;
  const design: BatchDesign = { name, budget: Number(budget), cost_unit: unit, default_cost: Number(cost), costs, exploration_fraction: Number(fraction), investigator_ids: investigator, missed_ids: missed, endpoint_key: endpoint, laboratory_threshold: threshold === "" ? null : Number(threshold) };
  const preview = useMemo(() => {
    if (!selected) return null;
    try {
      // Same selector as the server. The server regenerates it from stored evidence.
      if (Number(budget) <= 0 || Number(cost) <= 0 || !Number.isFinite(Number(budget)) || !Number.isFinite(Number(cost))) return { error: "Enter a positive budget and assay cost." };
      return { plan: selectBatch(selected.experiments, { name, budget: Number(budget), cost_unit: unit, default_cost: Number(cost), costs, exploration_fraction: Number(fraction), investigator_ids: investigator, missed_ids: missed, endpoint_key: endpoint, laboratory_threshold: threshold === "" ? null : Number(threshold) }) };
    } catch (e) { return { error: e instanceof Error ? e.message : "Worklist preview unavailable." }; }
  }, [selected, budget, cost, name, unit, costs, fraction, investigator, missed, endpoint, threshold]);
  const parsed = useMemo(() => {
    try {
      const value = JSON.parse(text);
      return value && typeof value.context === "object" && !Array.isArray(value.context) ? value as { context: ModelContext } : null;
    } catch { return null; }
  }, [text]);
  const updateContext = (key: keyof ModelContext, value: string | number | null) => {
    if (!parsed) { setError("Correct the evidence JSON before editing context fields."); return; }
    setText(JSON.stringify({ ...JSON.parse(text), context: { ...parsed.context, [key]: value } }, null, 2));
  };
  const filter = selected?.experiments.filter((e) => `${e.gene} ${e.partner ?? ""} ${e.compound ?? ""} ${e.pattern}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  const shown = filter.slice((page - 1) * 30, page * 30);
  const toggle = (id: string, list: string[], setter: (v: string[]) => void) => setter(list.includes(id) ? list.filter((v) => v !== id) : [...list, id]);

  return <div className="flex flex-col gap-4">
    <Card title="Choose the experimental context">
      <form action="/dashboard/discovery" className="flex flex-wrap items-end gap-3">
        <label className="min-w-56 flex-1 text-xs">Completed screen<select name="screen" defaultValue={selected?.screen.id ?? ""} className={field} required><option value="">Choose a screen</option>{view.screens.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        {selected && <label className="min-w-48 flex-1 text-xs">Comparison<select name="comparison" defaultValue={selected.comparison.id} className={field}>{selected.comparisons.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
        <button className={button}>Open context</button>
      </form>
      <p className="mt-2 text-xs text-muted">Choose a screen first, then its comparison. The worklist uses that comparison’s recorded effects from its current completed run.</p>
      {view.screens.length === 0 && <p className="mt-2 text-sm">Complete a screen analysis to begin.</p>}
    </Card>
    {(error || view.error) && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error ?? view.error}</p>}
    {notice && <p role="status" className="rounded-md border border-cyan-200 bg-cyan-50 p-3 text-sm">{notice}</p>}
    {selected && <>
      <Card title="Evidence snapshot" subtitle="Combine local assays and molecular profiles with references you have permission to use.">
        <div className="grid gap-3 sm:grid-cols-3">
          {([['model_id', 'Model identity'], ['biological_unit', 'Patient or biological unit'], ['lineage', 'Cancer lineage'], ['subtype', 'Molecular subtype'], ['medium', 'Medium'], ['matrix', 'Matrix'], ['library', 'Library'], ['endpoint', 'Assay endpoint']] as const).map(([key, label]) => <label key={key} className="text-xs">{label}<input className={field} value={parsed?.context[key] ?? ""} disabled={!view.canWrite || pending} onChange={(e) => updateContext(key, e.target.value.trim() || null)} /></label>)}
          <label className="text-xs">Culture<select className={field} value={parsed?.context.culture ?? "unknown"} disabled={!view.canWrite || pending} onChange={(e) => updateContext("culture", e.target.value)}>{["unknown", "organoid", "cell_line", "other"].map((c) => <option key={c} value={c}>{c.replaceAll("_", " ")}</option>)}</select></label>
          <label className="text-xs">Assay duration (hours)<input className={field} type="number" min="0.01" step="any" value={parsed?.context.time_hours ?? ""} disabled={!view.canWrite || pending} onChange={(e) => updateContext("time_hours", e.target.value === "" ? null : Number(e.target.value))} /></label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="text-xs">Import evidence JSON<input aria-label="Import evidence JSON" type="file" accept=".json,application/json" disabled={!view.canWrite || pending} className="ml-2 text-xs" onChange={async (e) => {
            setError(null); const f = e.target.files?.[0]; if (!f) return;
            if (f.size > 1_500_000) { setError("Evidence imports must be smaller than 1.5 MB."); return; }
            try { setText(JSON.stringify(parseDiscoveryDocument(await f.text()), null, 2)); } catch (err) { setError(err instanceof Error ? err.message : "Import failed."); }
          }} /></label>
          <a className="text-xs text-cyan-700 underline" href={`/dashboard/discovery/template?screen=${selected.screen.id}&comparison=${selected.comparison.id}`}>Download input template</a>
        </div>
        <details className="mt-3"><summary className="cursor-pointer text-sm text-cyan-700">Edit or review the complete evidence JSON</summary><label className="block text-xs">Evidence JSON<textarea aria-label="Evidence JSON" rows={14} className={`${field} mt-2 font-mono text-xs`} value={text} onChange={(e) => setText(e.target.value)} disabled={!view.canWrite || pending} spellCheck={false} /></label></details>
        <p className="mt-3 text-xs text-muted">Missing context stays unknown. Reference matching requires the same lineage, culture, assay scale, medium, matrix, library and timing; repeated biological units count once. Source rights are your recorded attestation, not a verified license.</p>
        <button className={`${button} mt-3`} disabled={!view.canWrite || pending || (!dirty && selected.inputId !== null)} onClick={() => start(async () => {
          setError(null); const r = await saveDiscoveryEvidence({ screenId: selected.screen.id, comparisonId: selected.comparison.id, runId: selected.runId, document: text });
          if (!r.ok) setError(r.error); else { setNotice("Evidence saved. The worklist now uses this snapshot."); router.refresh(); }
        })}>{pending ? "Saving…" : "Save evidence snapshot"}</button>
      </Card>
      <Card title="Experiments to consider" subtitle={`${selected.experiments.length} proposed experiments. Priorities are explicit heuristics, not validation probabilities.`}>
        <label className="text-xs">Filter targets or compounds<input className={`${field} mb-3 mt-1 max-w-md`} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></label>
        {shown.length === 0 ? <p className="text-sm">No experiments are supported by this evidence. Import drug assays, partial-suppression evidence or molecular nominations to investigate unresolved targets.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b border-line"><th className="p-2">Target and assay</th><th className="p-2">Measured evidence</th><th className="p-2">Next experiment</th><th className="p-2">Budget and comparator</th></tr></thead><tbody>{shown.map((e) => <tr key={e.id} className="border-b border-line align-top">
          <td className="p-2"><span className="font-semibold text-ink">{e.gene}{e.partner ? ` + ${e.partner}` : ""}</span><div>{e.kind.replaceAll("_", " ")}</div><div className="text-muted">{e.allocation}</div>{e.compound && <div>{e.compound}, {e.dose_um} µM, {e.time_hours} h</div>}</td>
          <td className="max-w-64 p-2">{(e.drug_evidence ?? []).map((d) => <p key={d.id} className="mb-1">Drug viability: {fmt(d.relative_viability)}; {d.biological_replicates} replicates; engagement {d.engagement}; selectivity {d.selective}; GR {fmt(d.growth_rate)}.</p>)}{(e.combination_evidence ?? []).map((c) => <p key={c.id} className="mb-1">{c.compound_a} {c.dose_a_um} µM + {c.compound_b} {c.dose_b_um} µM: viability {fmt(c.combination_viability)}; Bliss excess {fmt(c.bliss_excess)}; {c.biological_replicates} replicates. Descriptive interaction only.</p>)}<div>LFC: {fmt(e.measured_lfc)}, FDR: {fmt(e.measured_fdr)}</div><div>Reference mean: {fmt(e.reference.mean)}</div><div>Difference: {fmt(e.reference.local_minus_reference)}</div><div className="mt-1 text-muted">{e.reference.because}</div>{e.molecular && <div className="mt-1">{e.molecular.mutation ?? "Mutation not recorded"}; CN {fmt(e.molecular.copy_number)}; expression {fmt(e.molecular.expression)} {e.molecular.expression_unit ?? ""}</div>}</td>
          <td className="max-w-md p-2"><div className="font-medium">{e.pattern}</div><p className="mt-1">{e.next_experiment}</p><details className="mt-1"><summary className="cursor-pointer text-cyan-700">Controls, alternatives and provenance</summary><p className="mt-1">Controls: {e.controls.join("; ")}.</p><p>Alternatives: {e.alternatives.join("; ")}.</p>{e.warnings.map((w) => <p key={w} className="text-amber-800">{w}</p>)}<p>Evidence IDs: {e.evidence_ids.join(", ") || "Recorded screen statistics"}</p><code className="break-all text-[10px]">{e.id}</code></details></td>
          <td className="min-w-40 p-2"><label>Estimated assay cost<input className={`${field} mb-2 max-w-24`} aria-label={`Cost for ${e.id}`} type="number" min="0.01" step="any" value={costs[e.id] ?? cost} disabled={!view.canWrite || pending} onChange={(ev) => setCosts({ ...costs, [e.id]: Number(ev.target.value) })} /></label><label className="mb-2 flex gap-2"><input type="checkbox" aria-label={`Investigator chooses ${e.id}`} checked={investigator.includes(e.id)} disabled={!view.canWrite || pending} onChange={() => toggle(e.id, investigator, setInvestigator)} />Investigator choice{investigator.includes(e.id) ? ` #${investigator.indexOf(e.id) + 1}` : ""}</label><label className="flex gap-2"><input type="checkbox" aria-label={`Missed sample ${e.id}`} checked={missed.includes(e.id)} disabled={!view.canWrite || pending} onChange={() => toggle(e.id, missed, setMissed)} />Prespecified missed sample</label></td>
        </tr>)}</tbody></table></div>}
        {filter.length > 30 && <div className="mt-3 flex items-center gap-3 text-xs"><button disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {Math.ceil(filter.length / 30)}</span><button disabled={page * 30 >= filter.length} onClick={() => setPage(page + 1)}>Next</button></div>}
      </Card>
      <Card title="Freeze a costed worklist" subtitle="Record investigator selections from the complete lab workflow, then freeze before outcomes are known.">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs">Batch name<input className={field} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="text-xs">Selection budget<input className={field} type="number" min="0.01" step="any" value={budget} onChange={(e) => setBudget(e.target.value)} /></label>
          <label className="text-xs">Cost unit<input className={field} value={unit} onChange={(e) => setUnit(e.target.value)} /></label>
          <label className="text-xs">Default assay cost<input className={field} type="number" min="0.01" step="any" value={cost} onChange={(e) => setCost(e.target.value)} /></label>
          <label className="text-xs">Exploration reserve<select className={field} value={fraction} onChange={(e) => setFraction(e.target.value)}>{["0", "0.1", "0.2", "0.3", "0.5"].map((f) => <option key={f} value={f}>{Number(f) * 100}% of budget</option>)}</select></label>
          <label className="text-xs">Prespecified endpoint<select className={field} value={endpoint} onChange={(e) => setEndpoint(e.target.value)}>{endpoints.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}</select></label>
          <label className="text-xs">Laboratory effect threshold<input className={field} type="number" min="0.001" step="any" value={threshold} onChange={(e) => setThreshold(e.target.value)} /></label>
        </div>
        <p className="mt-2 text-xs text-muted">Threshold unit: {endpoints.find((e) => e.key === endpoint)?.effect_metric}. Only compatible experiments are scored against this endpoint. Engagement checks and combinations remain reported assays, and incompatible modalities require their own batch endpoint.</p>
        {preview && "plan" in preview && preview.plan && <div className="mt-3 rounded-md bg-cyan-50 p-3 text-sm"><p>{preview.plan.splicr_ids.length} SplicR experiments, estimated cost {fmt(preview.plan.splicr_cost)} {unit}.</p><p>{investigator.length} investigator experiments, estimated cost {fmt(preview.plan.investigator_cost)} {unit}.</p><p>Union plus missed sample: {preview.plan.experiments.length} experiments, {fmt(preview.plan.union_cost)} {unit} to run at the bench.</p>{preview.plan.notes.map((n) => <p key={n} className="mt-1 text-xs">{n}</p>)}</div>}
        {preview && "error" in preview && <p className="mt-3 text-sm text-amber-800">{preview.error}</p>}
        {dirty && <p className="mt-2 text-xs text-amber-800">Save the edited evidence to refresh experiments before freezing.</p>}
        <button className={`${button} mt-3`} disabled={!view.canWrite || pending || dirty || !selected.inputId || !preview || !("plan" in preview)} onClick={() => start(async () => {
          setError(null); const r = await freezeDiscoveryBatch({ inputId: selected.inputId!, design });
          if (!r.ok) setError(r.error); else router.push(`/dashboard/discovery/${r.batchId}`);
        })}>{pending ? "Freezing…" : "Freeze worklist"}</button>
      </Card>
      <Card title="Frozen batches">{selected.batches.length === 0 ? <p className="text-sm">No worklists have been frozen for this comparison.</p> : <ul className="space-y-2 text-sm">{selected.batches.map((b) => <li key={b.id}><Link className="text-cyan-700 underline" href={`/dashboard/discovery/${b.id}`}>{b.name}</Link><span className="ml-2 text-xs text-muted">{b.frozen_at.slice(0, 10)}, {b.receipt_sha256.slice(0, 12)}, run {b.run_id.slice(0, 8)}</span></li>)}</ul>}</Card>
    </>}
  </div>;
}
