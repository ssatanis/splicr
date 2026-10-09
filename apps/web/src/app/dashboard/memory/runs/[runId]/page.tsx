import Link from "next/link";
import { Card, PageHeader } from "@/components/dashboard/ui";
import { RecordedLabEvidence } from "@/components/dashboard/evidence/lab-evidence-panel";
import { getLabRun } from "@/lib/data/lab-run";
export const dynamic = "force-dynamic";
export const metadata = { title: "Recorded gene analysis" };
export default async function RunPage({ params, searchParams }: { params: Promise<{ runId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ runId }, query] = await Promise.all([params, searchParams]);
  const gene = typeof query.gene === "string" ? query.gene : "";
  const comparison = typeof query.comparison === "string" ? query.comparison : undefined;
  const result = await getLabRun(runId, gene, comparison);
  if (result.status !== "ready") return <Card><p className="p-5 text-sm">{result.status === "not_found" ? "This recorded run is not available in your workspace." : result.status === "workspace_required" ? "Sign in to your workspace to read this run." : "Run evidence could not be read. Please retry."}</p></Card>;
  const path = `/api/v1/screens/${result.screen.id}/genes/${encodeURIComponent(gene)}/evidence?${new URLSearchParams({ run: runId, ...(comparison ? { comparison } : {}), download: "zip" })}`;
  return <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pb-8">
    <PageHeader dense title={`${gene.toUpperCase()} , ${result.screen.name}`} body={`Recorded run ${runId}`} />
    <p className="text-sm">{result.screen.current_run_id === runId ? "Current analysis" : "Historical analysis"} , {result.run.status} , QC {result.qc?.verdict ?? "Not recorded"} , {result.run.finished_at ?? "Not finished"}</p>
    <div className="flex gap-4 text-sm"><Link href={`/dashboard/memory?q=${encodeURIComponent(gene)}&history=true`} className="underline">Back to gene master table</Link><Link href={`/dashboard/screens/${result.screen.id}`} className="underline">Open screen’s current analysis</Link></div>
    <Card><div className="p-4"><h2 className="mb-3 text-sm font-medium">Recorded caller output</h2>{!result.hits.length && <p className="text-xs text-muted">No gene measurement is recorded in this run / comparison. This is not a negative result.</p>}<div className="overflow-auto"><table className="w-full text-left text-xs"><thead><tr>{["Comparison", "Guides", "Log2FC", "SplicR FDR", "Native depletion / enrichment FDR", "MLE beta / FDR", "DrugZ normZ / FDR", "BAGEL2 BF"].map(h => <th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{result.hits.map(h => <tr key={h.id} className="border-t border-line">{[h.comparison_id,h.n_guides,h.lfc,h.fdr,`${h.depleted_fdr ?? "Unknown"} / ${h.enriched_fdr ?? "Unknown"}`,`${h.mle_beta ?? "Unknown"} / ${h.mle_fdr ?? "Unknown"}`,`${h.norm_z ?? "Unknown"} / ${h.drugz_fdr ?? "Unknown"}`,h.bayes_factor].map((v, i) => <td key={i} className="p-2">{v ?? "Not recorded"}</td>)}</tr>)}</tbody></table></div></div></Card>
    {result.evidence.status === "ready" ? <RecordedLabEvidence records={result.evidence.records} downloadHref={path} /> : <Card><p className="p-4 text-xs text-muted">{result.evidence.status === "not_recorded" ? "This historical run has no lab evidence receipts. Its original caller output remains above." : "The lab evidence receipts could not be read."}</p></Card>}
    <Card><details className="p-4 text-xs"><summary>Run settings, QC, stages, flags and native results</summary><pre className="mt-3 max-h-[600px] overflow-auto whitespace-pre-wrap break-all">{JSON.stringify({ run: result.run, qc: result.qc, stages: result.stages, results: result.hits }, null, 2)}</pre></details></Card>
  </div>;
}
