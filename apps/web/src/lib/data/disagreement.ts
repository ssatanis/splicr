/**
 * The recorded guide-disagreement report, read and not recomputed.
 *
 * WHY NOTHING IS CALCULATED HERE
 *
 * The statistics behind this report - a gene's spread against the spread the same
 * screen shows for genes of the same size, whether its call survives dropping one
 * guide, and the Fisher exact table between depletion and the curated protein
 * feature the depleting guides share - live in one place:
 * engine/splicr/validate/domain_report.py. The engine computes them at analysis
 * time against a named reference release and stores the document. This module
 * reads it.
 *
 * That is deliberate. A second implementation in TypeScript would be a second
 * definition of the same statistics, and the two would drift. The shape is pinned
 * by `disagreement.schema.json`, generated from the pydantic model; a Python test
 * fails if the model changes without regenerating it and a Node test fails if the
 * types below stop covering it.
 *
 * Authorization is the session's own. Every query goes through the request-scoped
 * Supabase client, so Row Level Security decides what is visible, and the
 * organization is taken from the session and never from the URL.
 */
import "server-only";

import { getCurrentContext } from "@/lib/data/org";
import { isUuid } from "@/lib/data/types";
import type { EffectSeries } from "@/lib/report/effect-series";
import { createClient } from "@/lib/supabase/server";

/** Mirrors validate.domain_report.GuideEvidence. */
export interface GuideEvidence {
  guide_key: string;
  gene: string | null;
  sequence: string | null;
  log2_fold_change: number;
  /** Deviation from this gene's own mean. This is the disagreement. */
  residual: number;
  depleted: boolean;
  p_value: number | null;
  fdr: number | null;
  chromosome: string | null;
  cut_position: number | null;
  strand: string | null;
  /** Measured, never predicted. Null wherever no empirical per-guide efficacy exists. */
  measured_efficacy: number | null;
  efficacy_source: string | null;
  control_mean: number | null;
  treatment_mean: number | null;
  uniprot_accession: string | null;
  mane_transcript: string | null;
  n_residues: number | null;
  protein_residue: number | null;
  cds_fraction: number | null;
  in_last_exon: boolean | null;
  features_hit: string[];
  annotation_evidence: "curated" | "cds_only" | "none";
  /** Why there is no protein context, when there is none. */
  note: string;
}

/**
 * `not_evaluated` means the protein context was never looked up for this gene.
 * `no_features` means it was looked up and nothing curated covers any resolved
 * cut. The console says those differently, so they stay different values.
 */
export type ConcordanceStatus =
  | "shared_feature"
  | "spans_features"
  | "overlapping"
  | "no_features"
  | "not_evaluable"
  | "not_evaluated";

/** Mirrors validate.domain_report.Concordance. */
export interface Concordance {
  status: ConcordanceStatus;
  feature: string | null;
  n_depleting_annotated: number;
  n_other_annotated: number;
  /** Two-sided Fisher exact p for the 2x2 table, when it could be built. */
  fisher_p: number | null;
  /** The smallest p this table's margins allow. Null when there is no table. */
  fisher_p_floor: number | null;
  interpretation: string;
  /** Why a small p here is weaker than it looks. */
  confound: string;
}

/** Mirrors validate.domain_report.Provenance. */
export interface Provenance {
  coordinate_system: string;
  reference_versions: Record<string, string>;
  measurement_source: string;
  annotated_at: string | null;
}

/** Mirrors validate.domain_report.DisagreementReport. */
export interface DisagreementReport {
  gene_symbol: string;
  ensembl_gene_id: string | null;
  uniprot_accession: string | null;
  mane_transcript: string | null;
  n_residues: number | null;
  n_guides: number;
  mean_log2_fold_change: number;
  median_log2_fold_change: number;
  n_depleting: number;
  depletion_lfc: number;
  spread: number | null;
  /** Null when the comparison had too few same-size genes to form a baseline. */
  spread_vs_screen: number | null;
  spread_baseline_n_genes: number | null;
  discordant: boolean;
  leave_one_out_min: number;
  leave_one_out_max: number;
  fragile: boolean;
  pivotal_guide: string | null;
  guides: GuideEvidence[];
  concordance: Concordance;
  summary: string;
  provenance: Provenance;
}

/**
 * Four outcomes, kept apart.
 *
 * `no_report` and `not_analysed` are different facts. The first means this run
 * produced reports and this gene is not among them, which happens when a gene has
 * fewer than two guides with a fold change. The second means the run produced no
 * reports at all, because it predates the table. A reader must not be shown "no
 * disagreement" for either.
 */
export type DisagreementResult =
  | { status: "found"; report: DisagreementReport; recordedAt: string | null }
  | { status: "no_report"; gene: string }
  | { status: "not_analysed" }
  /** No such screen, or one another workspace owns. The two answer alike so an id cannot be probed. */
  | { status: "not_found" }
  | { status: "unavailable" };

/** The document shape, as the schema requires it, before it is trusted. */
function isReport(value: unknown): value is DisagreementReport {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.gene_symbol === "string" &&
    typeof r.n_guides === "number" &&
    typeof r.mean_log2_fold_change === "number" &&
    typeof r.summary === "string" &&
    Array.isArray(r.guides) &&
    typeof r.concordance === "object" && r.concordance !== null &&
    typeof r.provenance === "object" && r.provenance !== null
  );
}

/** A symbol, reduced to the characters a gene symbol can contain. */
export function normaliseSymbol(gene: string): string {
  return gene.trim().toUpperCase().replace(/[^A-Z0-9._-]/g, "").slice(0, 64);
}

/**
 * The stored report for one gene of one screen.
 *
 * The screen is checked against the session's organization before the report is
 * read, so a report cannot be reached by guessing an id from another workspace,
 * and Row Level Security refuses it a second time.
 */
export async function getGeneDisagreement(
  screenId: string,
  gene: string,
): Promise<DisagreementResult> {
  const symbol = normaliseSymbol(gene);
  if (!isUuid(screenId) || symbol.length === 0) return { status: "not_found" };
  const context = await getCurrentContext();
  if (!context.user || !context.org) return { status: "not_found" };
  try {
    const client = await createClient();
    const owned = await client.from("screens")
      .select("id").eq("id", screenId).eq("org_id", context.org.id).maybeSingle();
    if (owned.error) throw owned.error;
    // The same answer whether the screen belongs to somebody else or does not
    // exist, so this cannot be used to discover another workspace's screen ids.
    if (!owned.data) return { status: "not_found" };

    const found = await client.from("gene_disagreement")
      .select("report, created_at")
      .eq("screen_id", screenId)
      .eq("gene_symbol", symbol)
      .eq("schema_version", "1")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (found.error) throw found.error;
    if (found.data) {
      if (!isReport(found.data.report)) return { status: "unavailable" };
      return {
        status: "found",
        report: found.data.report,
        recordedAt: (found.data.created_at as string | null) ?? null,
      };
    }
    // Distinguish "this gene has no report" from "this run stored none".
    const any = await client.from("gene_disagreement")
      .select("gene_symbol", { count: "exact", head: true })
      .eq("screen_id", screenId);
    if (any.error) throw any.error;
    return (any.count ?? 0) > 0 ? { status: "no_report", gene: symbol } : { status: "not_analysed" };
  } catch (error) {
    console.error(`[data/disagreement] ${error instanceof Error ? error.message : "read failed"}`);
    return { status: "unavailable" };
  }
}

export type { EffectSeries } from "@/lib/report/effect-series";

/**
 * The read goes through `screen_effect_points`, a SECURITY INVOKER function, so
 * Row Level Security still decides what comes back. It returns one jsonb value,
 * which matters: PostgREST caps a collection response at a thousand rows for
 * this project, and no client-side `.limit()` can raise it. Reading the hits
 * table directly returned the first thousand gene symbols alphabetically and
 * nothing else, which is how a run with eleven significant genes came to plot
 * none of them.
 */
export type EffectPointsResult =
  | { status: "found"; series: EffectSeries }
  | { status: "unavailable" };

/** The shape `screen_effect_points` promises, before it is trusted. */
function isSeriesPayload(value: unknown): value is {
  gene: unknown[]; lfc: unknown[]; fdr: unknown[]; marks: unknown[];
  recorded: number; without_effect: number;
} {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    Array.isArray(r.gene) && Array.isArray(r.lfc) && Array.isArray(r.fdr) && Array.isArray(r.marks)
    && typeof r.recorded === "number" && typeof r.without_effect === "number"
    && r.lfc.length === r.gene.length && r.fdr.length === r.gene.length && r.marks.length === r.gene.length
  );
}

/** Recorded effect and significance for every gene of one comparison. */
export async function getEffectPoints(
  screenId: string,
  comparisonId: string,
): Promise<EffectPointsResult> {
  if (!isUuid(screenId) || !isUuid(comparisonId)) return { status: "unavailable" };
  const context = await getCurrentContext();
  if (!context.user || !context.org) return { status: "unavailable" };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc("screen_effect_points", {
      p_screen: screenId,
      p_comparison: comparisonId,
    });
    if (error) throw error;
    if (!isSeriesPayload(data)) return { status: "unavailable" };
    return {
      status: "found",
      series: {
        gene: data.gene.map(String),
        lfc: data.lfc.map(Number),
        fdr: data.fdr.map((value) => (value === null ? null : Number(value))),
        marks: data.marks.map(Number),
        recorded: data.recorded,
        withoutEffect: data.without_effect,
      },
    };
  } catch (error) {
    console.error(`[data/disagreement] points: ${error instanceof Error ? error.message : "read failed"}`);
    return { status: "unavailable" };
  }
}
