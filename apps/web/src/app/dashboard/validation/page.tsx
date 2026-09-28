import Link from "next/link";
import { Suspense } from "react";

import { Card, DenseTable, PageHeader } from "@/components/dashboard/ui";
import { RecordPages, WorkspaceReadNotice } from "@/components/dashboard/workspace-records";
import { getCurrentContext } from "@/lib/data/org";
import { getWorkspaceOutcomes } from "@/lib/data/workspace-lists";

export const metadata = { title: "Truth Loop" };
export const dynamic = "force-dynamic";

export default async function ValidationPage(props: PageProps<"/dashboard/validation">) {
  const [context, search] = await Promise.all([getCurrentContext(), props.searchParams]);
  if (context.isDemo) {
    const { TruthLoop } = await import("./truth-loop");
    return <Suspense fallback={<div aria-hidden="true" />}><TruthLoop /></Suspense>;
  }
  const page = typeof search.page === "string" ? Number(search.page) : 1;
  const result = await getWorkspaceOutcomes(page);
  return <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-6">
    <PageHeader dense title="Truth Loop" body="Validation outcomes recorded in your workspace" />
    {result.status !== "ready" ? <WorkspaceReadNotice status={result.status} /> : <Card title={`${result.total.toLocaleString("en-US")} recorded outcomes`}>
      <p className="mb-3 text-sm text-muted">Pending, failed and inconclusive assays remain separate. These records do not by themselves establish model calibration. Outcome entry and adaptive experiment planning are not connected here yet.</p>
      {result.rows.length === 0 ? <p className="text-sm">{result.total === 0 ? "No validation outcomes have been recorded in your workspace." : "No outcomes on this page. Open the first page."}</p> : <DenseTable minWidth={700}>
        <caption className="sr-only">Recorded independent assay outcomes, with no inferred failures or model probabilities</caption>
        <thead><tr>{["Gene", "Result", "Assay", "Effect size", "Recorded at", "Screen"].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
        <tbody>{result.rows.map((outcome) => <tr key={outcome.id}>
          <td className="font-medium">{outcome.gene_symbol}</td><td>{outcome.result}</td><td>{outcome.assay ?? "Not recorded"}</td>
          <td>{outcome.effect_size === null || !Number.isFinite(Number(outcome.effect_size)) ? "Not recorded" : Number(outcome.effect_size).toLocaleString("en-US", { maximumSignificantDigits: 5 })}</td>
          <td>{outcome.logged_at}</td><td><Link className="underline" href={`/dashboard/screens/${outcome.screen_id}`}>View screen</Link></td>
        </tr>)}</tbody>
      </DenseTable>}
      <RecordPages path="/dashboard/validation" page={page} total={result.total} />
    </Card>}
  </div>;
}
