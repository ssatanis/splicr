import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/dashboard/ui";
import { DiscoveryResults } from "@/components/dashboard/discovery/results";
import { getDiscoveryBatch } from "@/lib/data/discovery";
import { evaluateBatch } from "@/lib/discovery/evaluate";

export const dynamic = "force-dynamic";
export default async function DiscoveryBatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let view;
  try { view = await getDiscoveryBatch(id); } catch (e) { return <Card title="Frozen batch unavailable"><p className="text-sm">{e instanceof Error ? e.message : "The database could not be read."}</p></Card>; }
  if (!view) notFound();
  const { batch, results, canWrite } = view;
  const evaluation = evaluateBatch(batch.receipt.plan, results);
  return <div className="flex flex-col gap-4 pb-6"><PageHeader dense title={batch.name} body="Frozen discovery worklist" actions={<Link href={`/dashboard/discovery?screen=${batch.screen_id}&comparison=${batch.comparison_id}`} className="text-xs text-cyan-700 underline">Back to discovery</Link>} />
    <Card title="Selection receipt">
      <p className="text-sm">Model {batch.receipt.evidence.context.model_id}, comparison {batch.comparison_id}, run {batch.run_id}</p>
      <p className="mt-1 break-all font-mono text-xs">SHA-256: {batch.receipt_sha256}</p>
      <p className="mt-1 text-xs">Frozen {batch.frozen_at}. Estimated union cost: {batch.receipt.plan.union_cost} {batch.receipt.plan.design.cost_unit}; each strategy’s selection budget: {batch.receipt.plan.design.budget}.</p>
      <div className="mt-3 flex flex-wrap gap-4 text-sm text-cyan-700 underline"><a href={`/dashboard/discovery/${batch.id}/export?format=blind`}>Download blinded bench worksheet</a><a href={`/dashboard/discovery/${batch.id}/export?format=json`}>Download full evidence receipt</a><Link href="/dashboard/validation">Open Truth Loop outcomes</Link></div>
    </Card>
    <Card title="Prospective assay results">
      <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th className="p-2">Selection strategy</th><th className="p-2">Selected</th><th className="p-2">Recorded</th><th className="p-2">Decided</th><th className="p-2">Endpoint confirmed</th><th className="p-2">Inconclusive</th><th className="p-2">Unscored</th><th className="p-2">Actual cost</th></tr></thead><tbody>{evaluation.arms.map((a) => <tr key={a.arm} className="border-t border-line"><td className="p-2">{a.arm.replaceAll("_", " ")}</td><td className="p-2">{a.selected}</td><td className="p-2">{a.recorded}</td><td className="p-2">{a.decided}</td><td className="p-2">{a.confirmed}</td><td className="p-2">{a.inconclusive}</td><td className="p-2">{a.unscored}</td><td className="p-2">{a.actual_cost} {batch.receipt.plan.design.cost_unit}</td></tr>)}</tbody></table></div>
      <p className="mt-2 text-xs">{evaluation.overlap} experiments shared by both strategies are performed once and credited to both.</p>
      {evaluation.arms.filter((a) => a.selected > 0).map((a) => <p key={a.arm} className="mt-1 text-xs">{a.arm}: {a.modalities.map((m) => `${m.kind.replaceAll("_", " ")}: ${m.confirmed}/${m.decided} decided (${m.selected} selected)`).join("; ")}</p>)}
      <p className="mt-3 text-xs text-muted">{evaluation.notes}</p>
    </Card>
    <DiscoveryResults batch={batch} results={results} canWrite={canWrite} />
  </div>;
}
