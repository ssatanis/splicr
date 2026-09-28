import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, DenseTable, PageHeader } from "@/components/dashboard/ui";
import { getCurrentContext } from "@/lib/data/org";
import { DETAIL_PAGE_SIZE, getScreenDetail } from "@/lib/data/screen-detail";

export const dynamic = "force-dynamic";

function number(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "Not recorded";
  const numeric = Number(value);
  return numeric !== 0 && Math.abs(numeric) < 0.001 ? numeric.toExponential(2) : numeric.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export default async function ScreenPage(props: PageProps<"/dashboard/screens/[id]">) {
  const [{ id }, search, context] = await Promise.all([props.params, props.searchParams, getCurrentContext()]);
  if (context.isDemo) {
    // The explicit demo session is the only path allowed to import sample data.
    const [{ ScreenWorkspace }, { screens }] = await Promise.all([
      import("@/components/dashboard/screen-workspace"), import("@/lib/mock/data"),
    ]);
    const screen = screens.find((item) => item.id === id);
    if (!screen) notFound();
    return <ScreenWorkspace screen={screen} tab={typeof search.tab === "string" ? search.tab : "overview"} />;
  }
  const page = typeof search.page === "string" ? Number(search.page) : 1;
  const result = await getScreenDetail(id, page);
  if (result.status === "not_found") notFound();
  if (result.status === "unavailable") {
    return <Card title="Screen results unavailable"><p>The workspace records could not be read. Reload to try again.</p></Card>;
  }
  const { screen, run, stages, comparisons, hits, total } = result.detail;
  const comparisonNames = new Map(comparisons.map((comparison) => [comparison.id, comparison.name]));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-6">
      <PageHeader dense title={screen.name} body="Recorded results from your workspace" actions={<Link href="/dashboard" className="text-sm underline">Workspace overview</Link>} />
      <Card title="Experiment">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-muted">Cell line</dt><dd>{screen.cell_line ?? "Not recorded"}</dd></div>
          <div><dt className="text-muted">Perturbation</dt><dd>{screen.modality}</dd></div>
          <div><dt className="text-muted">Phenotype</dt><dd>{screen.phenotype ?? "Not recorded"}</dd></div>
          <div><dt className="text-muted">Screen status</dt><dd>{screen.status}</dd></div>
          <div><dt className="text-muted">QC verdict</dt><dd>{screen.qc}</dd></div>
          <div><dt className="text-muted">Screen ID</dt><dd className="break-all font-mono text-xs">{screen.id}</dd></div>
        </dl>
        {screen.description && <p className="mt-3 whitespace-pre-wrap text-sm">{screen.description}</p>}
        {screen.qc === "fail" && <p className="mt-3 text-sm text-orange-600">QC failed. Review the recorded stage evidence before interpreting the gene results.</p>}
      </Card>
      {!run ? <Card title="Analysis not recorded"><p>This screen has no recorded run yet. Gene results and validation confidence are unavailable.</p></Card> : <>
        <Card title="Analysis provenance">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-muted">Run ID</dt><dd className="break-all font-mono text-xs">{run.id}</dd></div>
            <div><dt className="text-muted">Run status</dt><dd>{run.status}</dd></div>
            <div><dt className="text-muted">Engine version</dt><dd>{run.engine_version ?? "Not recorded"}</dd></div>
            <div><dt className="text-muted">Container digest</dt><dd className="break-all">{run.image_digest ?? "Not recorded"}</dd></div>
          </dl>
          {run.error && <p className="mt-3 whitespace-pre-wrap text-sm text-orange-600">{run.error}</p>}
          {stages.length === 0 ? <p className="mt-3 text-sm text-muted">No stage evidence was recorded.</p> : <ol className="mt-4 space-y-2 text-sm">{stages.map((stage) => <li key={stage.stage}>
            <span className="font-medium">{stage.stage}: {stage.status}</span>
            {stage.tool && <span className="ml-2 text-muted">{stage.tool}</span>}
            {stage.detail && <p className="whitespace-pre-wrap text-muted">{stage.detail}</p>}
          </li>)}</ol>}
        </Card>
        <Card title="Gene-level evidence" subtitle={`${total.toLocaleString("en-US")} gene/comparison records in this run. Ordered by recorded FDR; this is not a validation-success ranking.`}>
          <p className="mb-3 text-sm text-muted">FDR, effect size and artifact warnings describe different evidence. A flagged amplified region can still contain a genuine dependency. Validation probabilities and intervals are unavailable unless supported by an independently evaluated model.</p>
          {hits.length === 0 ? <p className="text-sm">{total === 0 ? "No gene results were recorded for this run. This does not establish that the experiment had no hits." : "This page contains no records. Return to the first page."}</p> : <DenseTable minWidth={1000}>
            <caption className="sr-only">Observed and statistical evidence for this run, including comparison, direction, guide support and artifact warnings</caption>
            <thead><tr>{["Gene", "Comparison", "Direction", "LFC", "p-value", "FDR", "BAGEL BF", "Good / total guides", "Evidence"].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
            <tbody>{hits.map((hit) => <tr key={hit.id}>
              <td className="font-medium">{hit.gene_symbol}</td>
              <td>{comparisonNames.get(hit.comparison_id) ?? "Not recorded"}</td>
              <td>{hit.direction}</td><td>{number(hit.lfc)}</td><td>{number(hit.p_value)}</td><td>{number(hit.fdr)}</td><td>{number(hit.bayes_factor)}</td>
              <td>{number(hit.n_good_guides)} / {number(hit.n_guides)}</td>
              <td className="max-w-[400px] whitespace-normal">
                {(hit.hit_flags ?? []).length > 0 ? <ul>{hit.hit_flags.map((flag) => <li key={flag.flag}>{flag.severity}: {flag.message}</li>)}</ul> : "No artifact flags recorded"}
                {hit.guide_lfcs && hit.guide_lfcs.length > 0 && <details className="mt-1"><summary>Recorded guide effects</summary><p>{hit.guide_lfcs.map(number).join(", ")}</p></details>}
                {hit.chance_real !== null && <p className="mt-1">Recorded model output: {number(hit.chance_real)}; model {hit.model_version ?? "not recorded"}. Calibration is not established by this value.</p>}
              </td>
            </tr>)}</tbody>
          </DenseTable>}
          <nav aria-label="Gene result pages" className="mt-3 flex gap-4 text-sm">
            {page > 1 && <Link className="underline" href={`/dashboard/screens/${screen.id}?page=${page - 1}`}>Previous</Link>}
            {page > 1 && <Link className="underline" href={`/dashboard/screens/${screen.id}`}>First page</Link>}
            <span>Page {page} · {DETAIL_PAGE_SIZE} records per page</span>
            {page * DETAIL_PAGE_SIZE < total && <Link className="underline" href={`/dashboard/screens/${screen.id}?page=${page + 1}`}>Next</Link>}
          </nav>
          <p className="mt-3 text-xs text-muted">For programmatic access, use your workspace key on the <Link href="/dashboard/connect" className="underline">Connect hits API</Link>. Workspace PDF/CSV reports and outcome entry are not connected on this page.</p>
        </Card>
      </>}
    </div>
  );
}
