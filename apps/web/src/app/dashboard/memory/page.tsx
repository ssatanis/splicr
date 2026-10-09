import Link from "next/link";
import { Card, PageHeader } from "@/components/dashboard/ui";
import { getLabMemory } from "@/lib/data/lab-memory";
import { STATUS_LABEL } from "@/lib/lab/memory";
export const dynamic = "force-dynamic";
export const metadata = { title: "Lab memory" };
const number = (value: number | null) => value === null ? "Not recorded" : value.toPrecision(3);
export default async function MemoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await searchParams;
  const q = typeof search.q === "string" ? search.q : "";
  const history = search.history === "true";
  const page = Number(search.page ?? 1);
  const result = q ? await getLabMemory(q, history, page) : null;
  const link = (gene: string, p = 1) => `/dashboard/memory?${new URLSearchParams({ q: gene, history: String(history), page: String(p) })}`;
  return <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-8">
    <PageHeader dense title="Lab memory" body="Every recorded screen, call and validation outcome for a gene" />
    <Card><form className="flex flex-wrap items-center gap-3 p-4" method="get">
      <label className="flex flex-1 items-center gap-3 text-sm">Gene or alias<input name="q" defaultValue={q} placeholder="PIKFYVE, PIKFYE, P53…" maxLength={64} className="h-10 min-w-40 flex-1 rounded-md border border-line px-3" required /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="history" value="true" defaultChecked={history} /> Include historical runs</label>
      <button className="rounded-md bg-ink px-4 py-2 text-sm text-white">Search lab</button>
    </form></Card>
    {!result && <Card><p className="p-5 text-sm text-body">Search a candidate to see where it was a hit, where it was measured without passing the run’s threshold, and where measurements are missing. All results use recorded statistics. There is no AI inference.</p></Card>}
    {result?.resolution.kind === "suggested" && <p className="text-sm text-body">Showing <strong>{result.resolution.symbol}</strong>, a spelling suggestion for “{q}”. <Link className="underline" href={link(q)}>Review search</Link></p>}
    {result?.resolution.kind === "alias" && <p className="text-sm text-body">“{q}” resolves to the recorded alias <strong>{result.resolution.symbol}</strong>.</p>}
    {result?.status === "choose_gene" && <Card><div className="space-y-3 p-5"><p>Choose a gene; the query is ambiguous or invalid.</p><div className="flex flex-wrap gap-3">{result.resolution.suggestions.map(s => <Link key={s} href={link(s)} className="rounded border border-line px-3 py-2">{s}</Link>)}</div></div></Card>}
    {result && !["ready", "choose_gene"].includes(result.status) && <Card><p role="status" className="p-5 text-sm">{result.status === "workspace_required" ? "Sign in to your lab workspace to read its institutional memory." : result.status === "invalid_page" ? "That page number is invalid." : "Lab memory could not be read. The database may need the lab evidence migration. Retry after it is available."}</p></Card>}
    {result?.status === "ready" && <>
      <div className="flex flex-wrap items-center gap-3 text-sm"><strong>{result.data.gene}</strong><span>{result.data.total} recorded screen / comparison / run entries</span><a className="ml-auto underline" href={`/api/v1/lab/memory?${new URLSearchParams({ q: result.data.gene, history: String(history), page: String(page), all: "true", format: "csv" })}`}>Download master table (CSV)</a><a className="underline" href={`/api/v1/lab/memory?${new URLSearchParams({ q: result.data.gene, history: String(history), page: String(page), all: "true" })}`}>JSON</a></div>
      <Card><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-canvas text-muted"><tr>{["Screen / comparison", "Context", "Measurement", "Effect / FDR", "Threshold / QC", "Bench outcomes"].map(h => <th key={h} className="p-3 font-medium">{h}</th>)}</tr></thead><tbody>{result.data.rows.map((row, i) => <tr key={`${row.screen_id}:${row.run_id}:${row.comparison_id}:${i}`} className="border-t border-line">
        <td className="p-3"><Link className="font-medium text-ink underline" href={row.run_id ? `/dashboard/memory/runs/${row.run_id}?gene=${encodeURIComponent(result.data.gene)}${row.comparison_id ? `&comparison=${row.comparison_id}` : ""}` : `/dashboard/screens/${row.screen_id}`}>{row.screen_name}</Link><p className="mt-1 text-muted">{row.comparison_name ?? "No comparison"}, {row.current_run ? "Current" : "Historical"}</p><p className="mt-1 break-all font-mono text-[10px] text-muted">{row.run_id ?? "No run"}</p></td>
        <td className="p-3">{row.cell_line ?? "Cell line not recorded"}<p className="mt-1 text-muted">{row.phenotype ?? "Phenotype not recorded"}, {row.modality}</p>{row.reagent_lot && <p className="mt-1">Lot {row.reagent_lot}</p>}</td>
        <td className="p-3"><span className={`rounded px-2 py-1 ${row.measurement_status === "hit" ? "bg-teal-50 text-teal-800" : "bg-canvas text-body"}`}>{STATUS_LABEL[row.measurement_status]}</span><p className="mt-2 text-muted">{row.n_guides ?? "Unknown"} guides</p></td>
        <td className="p-3 font-mono">{number(row.lfc)} / {number(row.fdr)}<p className="mt-1 font-sans text-muted">{row.completed_methods?.join(", ") ?? "Methods not recorded"}</p></td>
        <td className="p-3">{number(row.threshold)} ({row.threshold_source})<p className="mt-1 text-muted">QC: {row.qc_verdict ?? "Not recorded for this run"}</p></td>
        <td className="p-3">{row.validation_outcomes?.length ? row.validation_outcomes.map((o, j) => <p key={j}>{o.assay ?? "Assay not recorded"}: {o.result}</p>) : "No recorded bench outcome"}<Link className="mt-2 block underline" href="/dashboard/validation">Open validation records</Link></td>
      </tr>)}</tbody></table>{!result.data.rows.length && <p className="p-5 text-sm">No screens are recorded in this workspace.</p>}</div></Card>
      <p className="max-w-4xl text-xs leading-relaxed text-muted">Calls use each run’s recorded SplicR FDR and threshold; native caller statistics are available in JSON and CSV. Missing measurements are not negative results. Historical analyses and overlapping comparisons are not independent replicates. Bench outcomes are screen-level records and may not apply to every historical run. This table supports stratified review; it does not pool incompatible assays into a single statistical effect.</p>
      <nav className="flex gap-4 text-sm" aria-label="Memory pages">{page > 1 && <Link href={link(result.data.gene, page - 1)}>Previous</Link>}{page * 100 < result.data.total && <Link href={link(result.data.gene, page + 1)}>Next</Link>}</nav>
    </>}
  </div>;
}
