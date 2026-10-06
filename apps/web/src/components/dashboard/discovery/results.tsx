"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/dashboard/ui";
import { recordDiscoveryResult } from "@/lib/data/discovery-actions";
import type { DiscoveryBatch, DiscoveryResultRow } from "@/lib/data/discovery";
import type { EndpointDefinition } from "@/lib/validation/endpoint";

const field = "w-full rounded-md border border-line bg-white px-2.5 py-2 text-sm";
export function DiscoveryResults({ batch, results, canWrite }: { batch: DiscoveryBatch; results: DiscoveryResultRow[]; canWrite: boolean }) {
  const [experimentId, setExperimentId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const endpoint = batch.receipt.endpoint as unknown as EndpointDefinition;
  const selected = batch.receipt.plan.experiments.find((e) => e.id === experimentId);
  const byId = new Map(results.map((r) => [r.experiment_id, r]));
  const tri = (value: FormDataEntryValue | null) => value === "yes" ? true : value === "no" ? false : null;
  const numeric = (f: FormData, key: string) => f.get(key) === "" || f.get(key) === null ? null : Number(f.get(key));
  return <>
    <Card title="Frozen experiments and outcomes">
      <p className="mb-3 text-xs text-muted">Use the blinded bench worksheet to run the union without selection labels. Record measured results here after each assay finishes. A saved result is immutable; a new independent assay belongs in a new batch.</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b border-line"><th className="p-2">Target and perturbation</th><th className="p-2">Selected by</th><th className="p-2">Reported result</th><th className="p-2">Frozen endpoint decision</th><th className="p-2">Action</th></tr></thead><tbody>{batch.receipt.plan.experiments.map((e) => {
        const r = byId.get(e.id);
        return <tr key={e.id} className="border-b border-line align-top"><td className="max-w-md p-2"><b>{e.gene}{e.partner ? ` + ${e.partner}` : ""}</b><div>{e.kind.replaceAll("_", " ")}, {e.model_id}</div>{e.compound && <div>{e.compound}, {e.dose_um} µM, {e.time_hours} h</div>}<p className="mt-1">{e.next_experiment}</p><p className="mt-1 text-muted">Controls: {e.controls.join("; ")}.</p></td><td className="p-2">{e.wanted_by.join(", ")}</td><td className="p-2">{r ? String(r.measurement.result) : "Outstanding"}{r && <div className="mt-1">Actual cost: {String(r.measurement.actual_cost)} {batch.receipt.plan.design.cost_unit}</div>}</td><td className="max-w-sm p-2">{r ? <><div>{r.decision.replaceAll("_", " ")}</div><p className="mt-1 text-muted">{r.because}</p></> : "Awaiting assay"}</td><td className="p-2">{!r && canWrite && <button className="rounded border border-line px-2 py-1 text-cyan-700" onClick={() => { setError(null); setExperimentId(e.id); }}>Record result for {e.gene}</button>}</td></tr>;
      })}</tbody></table></div>
    </Card>
    {selected && <Card title={`Record ${selected.gene} ${selected.kind.replaceAll("_", " ")}`}>
      <form onSubmit={(ev) => {
        ev.preventDefault(); const f = new FormData(ev.currentTarget); setError(null);
        const measurement = { result: String(f.get("result")), model_id: selected.model_id, lab_id: String(f.get("lab_id")), actual_cost: Number(f.get("actual_cost")),
          effect_size: numeric(f, "effect_size"), n_replicates: numeric(f, "n_replicates"), n_perturbations: numeric(f, "n_perturbations"),
          independent_perturbation: tri(f.get("independent_perturbation")), distinct_from_screen_constructs: tri(f.get("distinct_from_screen_constructs")),
          controls: Object.fromEntries(endpoint.control_criteria.map((c) => [c, tri(f.get(`control:${c}`))])), notes: String(f.get("notes") ?? ""), evidence_url: f.get("evidence_url") || null };
        start(async () => { const r = await recordDiscoveryResult({ batchId: batch.id, experimentId: selected.id, measurement }); if (!r.ok) setError(r.error); else { setExperimentId(null); router.refresh(); } });
      }}>
        <p className="mb-3 text-xs">Frozen endpoint: {endpoint.label}. Effect unit: {endpoint.effect_metric}. Laboratory bar: {batch.receipt.plan.design.laboratory_threshold ?? endpoint.effect_threshold ?? "Not specified"}. Incompatible assays remain reported-only.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs">Laboratory identifier<input name="lab_id" className={field} required maxLength={160} /></label>
          <label className="text-xs">Reported assay result<select name="result" aria-label="Reported assay result" className={field}><option value="validated">Validated at the bench</option><option value="failed">Did not validate</option><option value="inconclusive">Inconclusive</option></select></label>
          <label className="text-xs">Actual cost ({batch.receipt.plan.design.cost_unit})<input name="actual_cost" className={field} type="number" min="0" step="any" defaultValue={selected.cost} required /></label>
          <label className="text-xs">Measured effect size<input name="effect_size" className={field} type="number" step="any" /></label>
          <label className="text-xs">Biological replicates<input name="n_replicates" className={field} type="number" min="1" step="1" /></label>
          <label className="text-xs">Independent perturbations<input name="n_perturbations" className={field} type="number" min="1" step="1" /></label>
          {([['independent_perturbation', 'Independent perturbation'], ['distinct_from_screen_constructs', 'Different constructs from screening library'], ...endpoint.control_criteria.map((c) => [`control:${c}`, `Control: ${c.replaceAll("_", " ")}`])] as string[][]).map(([key, label]) => <label key={key} className="text-xs">{label}<select name={key} aria-label={label} className={field}><option value="">Not recorded</option><option value="yes">Yes</option><option value="no">No</option></select></label>)}
          <label className="text-xs">Evidence URL<input name="evidence_url" type="url" className={field} /></label>
        </div>
        <label className="mt-3 block text-xs">Assay notes<textarea name="notes" rows={3} maxLength={4000} className={field} /></label>
        {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
        <div className="mt-3 flex gap-3"><button disabled={pending} className="rounded-md bg-cyan-700 px-3 py-2 text-sm text-white disabled:opacity-50">{pending ? "Saving…" : "Save measured result"}</button><button type="button" disabled={pending} onClick={() => setExperimentId(null)} className="text-sm text-cyan-700">Cancel</button></div>
      </form>
    </Card>}
  </>;
}
