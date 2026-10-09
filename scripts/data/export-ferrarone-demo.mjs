/** Export the actual browser-dispatched demo, refusing incomplete results.
 * Usage: node scripts/data/export-ferrarone-demo.mjs <demo-org-id>
 */
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { connect, repoRoot } from "../db/client.mjs";

const rraOnly = process.argv.includes("--rra-only");
const org = process.argv.slice(2).find(arg => !arg.startsWith("--")) ?? JSON.parse(fs.readFileSync(path.join(repoRoot, "apps/web/e2e/.auth/ferrarone/fixture.json"), "utf8")).orgId;
if (!/^[a-f0-9-]{36}$/i.test(org)) throw new Error("Provide the demo workspace UUID.");
const out = path.join(repoRoot, "artifacts/ferrarone-20261007", ...(rraOnly ? ["rra-cloud"] : []));
const prefix = `Ferrarone 2024: A549 LKB1 growth screens${rraOnly ? " (RRA validation)" : ""}, `;
fs.mkdirSync(out, { recursive: true });
const csv = (rows, columns) => [columns.join(","), ...rows.map(row => columns.map(key => {
  const value = row[key] == null ? "" : typeof row[key] === "object" ? JSON.stringify(row[key]) : String(row[key]);
  return /[,"\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}).join(","))].join("\n") + "\n";
const db = await connect();
try {
  if (process.argv.includes("--wait")) {
    for (;;) {
      const states = (await db.query(`select r.status from public.screens s join public.runs r on r.screen_id=s.id
        where s.org_id=$1 and s.name like $2`, [org, prefix + "%"])).rows;
      if (states.length !== 6) throw new Error("Expected exactly six recorded analysis runs.");
      fs.writeFileSync(path.join(out, "analysis-status.json"), JSON.stringify({ checked_at:new Date().toISOString(), completed:states.filter(run=>run.status==="complete").length, total:6, statuses:states.map(run=>run.status) },null,2)+"\n");
      if (states.some(run => ["failed", "canceled", "cancelled"].includes(run.status))) throw new Error("An analysis failed or was cancelled; no complete export will be written.");
      if (states.every(run => run.status === "complete")) break;
      await delay(30_000);
    }
  }
  const screens = (await db.query(`select s.id,s.name,s.status,s.cell_line,s.phenotype,s.modality,
      r.id run_id,r.status run_status,r.engine_version,r.settings,r.started_at,r.finished_at
    from public.screens s join public.runs r on r.screen_id=s.id
    where s.org_id=$1 and s.name like $2
    order by s.created_at,r.created_at`, [org, prefix + "%"])).rows;
  if (screens.length !== 6 || screens.some(screen => screen.run_status !== "complete"))
    throw new Error(`Expected six completed browser runs: ${JSON.stringify(screens.map(screen => ({ name: screen.name, status: screen.run_status })))}`);
  const summaries = [], references = [], all = [];
  for (const [index, screen] of screens.entries()) {
    const run = screen.run_id;
    const stages = (await db.query("select stage,status,tool,detail,metrics from public.run_stages where run_id=$1 order by position", [run])).rows;
    const samples = (await db.query("select label,role,metadata from public.samples where screen_id=$1 order by position", [screen.id])).rows;
    const hits = (await db.query(`select gene_symbol,direction,n_guides,lfc,fdr,p_value,rra_score,stat_rank,
        depleted_fdr,enriched_fdr,depleted_p,enriched_p,mle_beta,mle_fdr,
        guide_lfcs,max_guide_share,verdict,reason,chance_real
      from public.hits where run_id=$1 order by gene_symbol`, [run])).rows;
    const counts = (await db.query(`select
      (select count(*) from public.guide_effects where run_id=$1) guide_effects,
      (select count(*) from public.gene_disagreement where run_id=$1) gene_disagreement`, [run])).rows[0];
    const qc = stages.find(stage => stage.stage === "qc")?.metrics;
    const record = { ...screen, samples, stages, counts, n_genes: hits.length };
    fs.writeFileSync(path.join(out, `comparison-${index + 1}-receipt.json`), JSON.stringify(record, null, 2) + "\n");
    const columns = Object.keys(hits[0] ?? {});
    fs.writeFileSync(path.join(out, `comparison-${index + 1}-genes.csv`), csv(hits, columns));
    const summary = { comparison: screen.name.replace(prefix, ""), screen_id: screen.id, run_id: run,
      qc: qc?.verdict, genes: hits.length, guide_effects: Number(counts.guide_effects), gene_disagreement: Number(counts.gene_disagreement),
      splicr_significant: hits.filter(hit => hit.fdr != null && hit.fdr < 0.05).length,
      rra_depleted: hits.filter(hit => hit.depleted_fdr != null && hit.depleted_fdr < 0.05).length,
      rra_enriched: hits.filter(hit => hit.enriched_fdr != null && hit.enriched_fdr < 0.05).length,
      mle_significant: hits.some(hit => hit.mle_fdr != null)
        ? hits.filter(hit => hit.mle_fdr != null && hit.mle_fdr < 0.05).length : null };
    summaries.push(summary);
    for (const hit of hits.filter(hit => ["FIG4", "VAC14", "PIKFYVE", "NF2", "PTEN", "TSC1", "TSC2", "STK11"].includes(hit.gene_symbol)))
      references.push({ comparison: summary.comparison, ...hit });
    all.push({ summary, receipt: record });
  }
  fs.writeFileSync(path.join(out, "comparison-summary.csv"), csv(summaries, Object.keys(summaries[0])));
  fs.writeFileSync(path.join(out, "reference-gene-statistics.csv"), csv(references, Object.keys(references[0])));
  fs.writeFileSync(path.join(out, "cloud-verification.json"), JSON.stringify({ workspace: org, analyses: all }, null, 2) + "\n");
  console.log(JSON.stringify(summaries, null, 2));
} finally { await db.end(); }
