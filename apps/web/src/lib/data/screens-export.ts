import "server-only";
import { getCurrentContext } from "@/lib/data/org";
import { createClient } from "@/lib/supabase/server";
import { getScreenReportData, type ReportData } from "./screen-report";
import type { ExportRequest } from "@/lib/report/export-options";

export type EvidenceRow = Record<string, unknown>;
export interface ExportScreen extends ReportData {
  qcEvidence?: EvidenceRow | null;
  guides?: EvidenceRow[];
  disagreement?: EvidenceRow[];
  stages?: EvidenceRow[];
}
export class ExportError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
const CHUNK = 1000;
const EVIDENCE_CAP = 120_000;
const TOTAL_CAP = 300_000;
const GUIDE_COLUMNS = "comparison_id, guide_key, gene_symbol, sequence, method, lfc, p_value, fdr, control_mean, treatment_mean, chrom, cut_pos, strand, uniprot_accession, mane_transcript, protein_residue, n_residues, cds_fraction, in_last_exon, features_hit, annotation_evidence, reference_versions";
const DISAGREEMENT_COLUMNS = "comparison_id, gene_symbol, ensembl_gene_id, n_guides, n_depleting, mean_lfc, median_lfc, spread, spread_vs_screen, discordant, fragile, pivotal_guide, concordance_status, concordance_feature, fisher_p, fisher_p_floor, schema_version, report";

export async function getScreensExport(request: ExportRequest): Promise<ExportScreen[]> {
  const context = await getCurrentContext();
  if (!context.user || !context.org) throw new ExportError("Sign in to a workspace to export screens.", 401);
  const client = await createClient();
  let totalRows = 0;
  const screens: ExportScreen[] = [];
  // Bound memory and concurrent database reads. Every file is all-or-nothing.
  for (const id of request.screenIds) {
    const result = await getScreenReportData(id);
    if (result.status === "not_found") throw new ExportError("A selected screen is no longer available in this workspace.", 404);
    if (result.status === "workspace_required") throw new ExportError("Sign in to a workspace to export screens.", 401);
    if (result.status !== "found") throw new ExportError("Screen results could not be read. Retry the export.", 503);
    const data = result.data;
    if (!data.run || data.run.status !== "complete") throw new ExportError(`“${data.screen.name}” does not have a completed current run.`, 409);
    if (data.truncated) throw new ExportError("A selected run exceeds the 50,000 gene-row export limit. No partial file was created.", 413);

    const readRows = async (table: string, columns: string, order: string[]): Promise<EvidenceRow[]> => {
      const rows: EvidenceRow[] = [];
      for (let from = 0; ; from += CHUNK) {
        let query = client.from(table).select(columns).eq("screen_id", id).eq("run_id", data.run!.id);
        for (const column of order) query = query.order(column);
        const chunk = await query.range(from, from + CHUNK - 1);
        if (chunk.error || chunk.data === null) throw new ExportError("Selected evidence could not be read. Retry the export.", 503);
        rows.push(...chunk.data as unknown as EvidenceRow[]);
        if (rows.length > EVIDENCE_CAP) throw new ExportError("Selected evidence exceeds the export limit. Export fewer screens or omit guide evidence.", 413);
        if (chunk.data.length < CHUNK) return rows;
      }
    };
    const output: ExportScreen = { ...data };
    const tasks: Promise<void>[] = [];
    if (request.sections.includes("qc")) tasks.push((async () => {
      const qc = await client.from("run_qc")
        .select("verdict, notes, nnmd, auroc, min_replicate_r, median_replicate_r, bottlenecked_samples, metrics")
        .eq("run_id", data.run!.id).maybeSingle();
      if (qc.error) throw new ExportError("Quality control could not be read. Retry the export.", 503);
      output.qcEvidence = qc.data as EvidenceRow | null;
    })());
    if (request.sections.includes("guides")) tasks.push(readRows("guide_effects", GUIDE_COLUMNS, ["comparison_id", "gene_symbol", "guide_key"])
      .then(rows => { output.guides = rows; }));
    if (request.sections.includes("disagreement")) tasks.push(readRows("gene_disagreement", DISAGREEMENT_COLUMNS, ["comparison_id", "gene_symbol"])
      .then(rows => { output.disagreement = rows; }));
    if (request.sections.includes("provenance")) tasks.push((async () => {
      const stages = await client.from("run_stages").select("stage, status, position, detail, tool, metrics, started_at, finished_at, duration_sec")
        .eq("run_id", data.run!.id).order("position");
      if (stages.error || stages.data === null) throw new ExportError("Run provenance could not be read. Retry the export.", 503);
      output.stages = stages.data as EvidenceRow[];
    })());
    await Promise.all(tasks);
    totalRows += output.hits.length + (output.guides?.length ?? 0) + (output.disagreement?.length ?? 0);
    if (totalRows > TOTAL_CAP) throw new ExportError("This export exceeds 300,000 rows. Select fewer screens or omit guide evidence.", 413);
    screens.push(output);
  }
  return screens;
}
