import { getLabMemory } from "@/lib/data/lab-memory";
import { csvTable } from "@/lib/report/screens-export";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = params.get("q") ?? "";
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(query.trim())) return Response.json({ error: "Enter a gene symbol or alias." }, { status: 400 });
  const result = await getLabMemory(query, params.get("history") === "true", Number(params.get("page") ?? 1), params.get("all") === "true");
  const headers = { "cache-control": "private, no-store" };
  if (result.status !== "ready") return Response.json(result, { status: result.status === "workspace_required" ? 401 : result.status === "unavailable" ? 503 : 400, headers });
  if (params.get("format") === "csv") {
    const columns = ["screen_name", "screen_id", "run_id", "current_run", "comparison_name", "comparison_id", "cell_line", "phenotype", "modality", "measurement_status", "lfc", "fdr", "threshold", "threshold_source", "qc_verdict", "n_guides", "mle_beta", "mle_fdr", "norm_z", "drugz_fdr", "bayes_factor", "reagent_lot", "completed_methods", "validation_outcomes"];
    const rows = result.data.rows.map(row => Object.fromEntries(columns.map(key => {
      const value = row[key as keyof typeof row];
      return [key, typeof value === "object" && value !== null ? JSON.stringify(value) : value];
    })));
    const csv = csvTable({ name: result.data.gene, columns, rows });
    if (new TextEncoder().encode(csv).byteLength > 4_000_000) return Response.json({ error: "The full master table exceeds the download response limit. Download its paginated CSV files instead; no partial file was returned." }, { status: 413, headers });
    return new Response(csv, { headers: { ...headers, "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${result.data.gene}-memory-${params.get("all") === "true" ? "all" : `page-${result.page}`}.csv"` } });
  }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 4_000_000) return Response.json({ error: "The master table exceeds the JSON response limit; use paginated exports." }, { status: 413, headers });
  return Response.json({ ...result, scope: params.get("all") === "true" ? "All entries at one database snapshot. Historical runs are not independent screens." : "This page only; total and page identify coverage. Historical runs are not independent screens." }, { headers });
}
