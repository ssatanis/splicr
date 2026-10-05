import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentContext } from "@/lib/data/org";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/data/types";
import { Card, PageHeader } from "@/components/dashboard/ui";

const METHODS = { fdr: "SplicR two-direction FDR", depleted_fdr: "MAGeCK depletion FDR", enriched_fdr: "MAGeCK enrichment FDR", drugz_fdr: "DrugZ directional FDR", mle_fdr: "MAGeCK MLE FDR" } as const;
type Method = keyof typeof METHODS;
type GeneRow = { gene_symbol: string; screen_id: string; lfc: number | null; norm_z: number | null; mle_beta: number | null; fdr: number | null; depleted_fdr: number | null; enriched_fdr: number | null; drugz_fdr: number | null; mle_fdr: number | null };

export const dynamic = "force-dynamic";
export default async function ExperimentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, search, context] = await Promise.all([params, searchParams, getCurrentContext()]);
  if (!isUuid(id) || !context.org || !context.user) notFound();
  const client = await createClient();
  const result = await client.from("screens").select("id,name,status,qc,current_run_id,cell_line").eq("org_id", context.org.id).eq("source_ref", id).order("created_at").limit(64);
  if (result.error) return <Card title="Comparisons unavailable"><p className="text-[12px] text-muted">The experiment could not be read. Reload to try again.</p></Card>;
  const screens = result.data ?? [];
  if (!screens.length) notFound();
  const requested = typeof search.method === "string" ? search.method : "fdr";
  const method: Method = Object.hasOwn(METHODS, requested) ? requested as Method : "fdr";
  const query = typeof search.q === "string" ? search.q.trim().slice(0, 40).toUpperCase() : "";
  const rows: GeneRow[] = [];
  for (let from = 0; from < 200000; from += 1000) {
    const chunk = await client.from("hits").select("gene_symbol,screen_id,lfc,norm_z,mle_beta,fdr,depleted_fdr,enriched_fdr,drugz_fdr,mle_fdr").in("run_id", screens.map((screen) => screen.current_run_id).filter(Boolean)).order("screen_id").order("gene_symbol").range(from, from + 999);
    if (chunk.error) return <Card title="Comparison results unavailable"><p className="text-[12px] text-muted">Recorded hits could not be read. Reload to try again.</p></Card>;
    rows.push(...chunk.data as GeneRow[]);
    if (chunk.data.length < 1000) break;
  }
  const byScreen = new Map<string, Map<string, { rank: number; value: number; effect: number | null }>>();
  for (const screen of screens) {
    const ranked = rows.filter((row) => row.screen_id === screen.id && row[method] !== null).sort((a, b) => a[method]! - b[method]! || a.gene_symbol.localeCompare(b.gene_symbol));
    let rank = 1;
    byScreen.set(screen.id, new Map(ranked.map((row, i) => { if (i === 0 || ranked[i - 1][method] !== row[method]) rank = i + 1; return [row.gene_symbol, { rank, value: row[method]!, effect: method === "drugz_fdr" ? row.norm_z : method === "mle_fdr" ? row.mle_beta : row.lfc }]; })));
  }
  const genes = [...new Set(rows.map((row) => row.gene_symbol))].filter((gene) => !query || gene.toUpperCase().includes(query)).sort((a, b) => {
    const best = (gene: string) => Math.min(...screens.map((screen) => byScreen.get(screen.id)?.get(gene)?.value ?? 1));
    return best(a) - best(b) || a.localeCompare(b);
  });
  return <div className="space-y-4">
    <PageHeader title="Compare experiment rankings" body={`${screens.length} comparisons. Recorded method statistics and ranks.`}/>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{screens.map((screen) => <Link key={screen.id} href={`/dashboard/screens/${screen.id}`} className="rounded-lg border border-line bg-white p-3 text-[12px]"><span className="font-medium text-ink">{screen.name}</span><span className="mt-1 block text-[11px] text-muted">{screen.status}, QC {screen.qc}</span></Link>)}</div>
    <form className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-white p-3"><label className="text-[12px] text-ink">Rank by<select name="method" defaultValue={method} className="ml-2 h-8 rounded border border-line px-2">{Object.entries(METHODS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-[12px] text-ink">Gene<input name="q" defaultValue={query} className="ml-2 h-8 w-32 rounded border border-line px-2"/></label><button className="h-8 rounded bg-ink px-3 text-[12px] text-white">Compare</button></form>
    <p className="text-[11px] text-muted">Ranks use the displayed FDR, with ties sharing a rank. Native directional FDRs test separate families. SplicR combines both directions conservatively.</p>
    <div className="overflow-x-auto rounded-lg border border-line bg-white"><table className="dense-table dense-table-compact"><thead><tr><th>Gene</th>{screens.map((screen) => <th key={screen.id}>{screen.name}<span className="block text-[10px] font-normal text-muted">Rank / FDR / effect</span></th>)}</tr></thead><tbody>{genes.slice(0, 100).map((gene) => <tr key={gene}><td className="font-medium">{gene}</td>{screens.map((screen) => { const value = byScreen.get(screen.id)?.get(gene); return <td key={screen.id} className="num">{value ? <Link href={`/dashboard/screens/${screen.id}?q=${encodeURIComponent(gene)}`} className="text-cyan-700">{value.rank} / {value.value < .001 ? value.value.toExponential(2) : value.value.toFixed(3)} / {value.effect?.toFixed(2) ?? ""}</Link> : <span className="text-muted">Not recorded</span>}</td>; })}</tr>)}</tbody></table></div>
    <p className="text-[11px] text-muted">Showing {Math.min(100, genes.length)} of {genes.length} matching genes. Open a comparison for QC, guide evidence, exports and Truth Loop.</p>
    {rows.length === 200000 && <p role="status" className="text-[11px] text-muted">This comparison reached the 200,000-row limit. Open individual screens for their complete results.</p>}
  </div>;
}
