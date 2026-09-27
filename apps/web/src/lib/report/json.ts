/**
 * JSON export: the lossless path, meant for a pipeline rather than a person.
 *
 * Everything the CSV carries plus the provenance the CSV can only fit in a
 * comment block: per-stage tool versions and timings, every parameter, every
 * reference release, the QC block, and the methods text that was written from
 * exactly those values. Keys are snake_case and stable, and `schema` is versioned
 * so a consumer can refuse a shape it does not know.
 *
 * Pretty-printed with two spaces on purpose. These files end up in a repository
 * next to the figure that used them, where a readable diff is worth more than
 * the bytes saved.
 *
 * `sample_data` is a top-level boolean and not only a string, so a consumer has
 * to handle it rather than read past a footnote.
 */
import { type ReportDocument } from "./document";

const SCHEMA = "https://splicr.org/schema/hit-report/2";

export function toJson(doc: ReportDocument, generatedAt: Date): string {
  const payload = {
    schema: SCHEMA,
    report_id: doc.reportId,
    generated_at: generatedAt.toISOString(),
    sample_data: doc.source === "sample",
    data_source: doc.source === "sample" ? "SplicR sample dataset" : "SplicR workspace",
    notice: doc.notice,
    screen: {
      id: doc.screen.id,
      name: doc.screen.name,
      cell_line: doc.screen.cellLine,
      organism: doc.screen.organism,
      modality: doc.screen.modality,
      phenotype: doc.screen.phenotype,
      status: doc.screen.status,
      qc_verdict: doc.screen.qcVerdict,
      created_at: doc.screen.createdAt,
    },
    library: {
      name: doc.library.label,
      n_guides: doc.library.guides,
      n_genes: doc.library.genes,
      guides_per_gene: doc.library.guidesPerGene,
      cas: doc.library.cas,
    },
    provenance: {
      pipeline: doc.run.pipeline,
      pipeline_version: doc.run.pipelineVersion,
      analysis_schema: doc.run.analysisSchema,
      run_id: doc.run.id,
      started_at: doc.run.startedAt,
      completed_at: doc.run.completedAt,
      wall_clock_seconds: doc.run.wallClockSec,
      stages: doc.run.stages.map((s) => ({
        stage: s.stage,
        title: s.title,
        tool: s.tool,
        started_at: s.startedAt,
        duration_seconds: s.durationSec,
      })),
      tools: doc.tools.map((t) => ({ stage: t.stage, name: t.name, version: t.version, role: t.role })),
      parameters: doc.parameters.map((p) => ({ label: p.label, value: p.value, note: p.note ?? null })),
      reference_data: doc.references.map((r) => ({ name: r.name, release: r.release, detail: r.detail })),
    },
    // Absent rather than zeroed when the run has no sample-level QC recorded. A
    // consumer must be able to tell "not measured" from "measured at zero".
    quality_control: doc.qc
      ? {
          n_samples: doc.qc.samples.length,
          total_reads: doc.qc.totalReads,
          mean_mapped_fraction: Number(doc.qc.meanMapped.toFixed(4)),
          gini_range: doc.qc.giniRange,
          zero_count_guide_range: doc.qc.zeroGuideRange,
          replicates_per_condition: doc.qc.replicates,
          control_separation: {
            auroc: doc.qc.auroc,
            nnmd: doc.qc.nnmd,
            essential_genes: doc.qc.essentialGenes,
            non_essential_genes: doc.qc.nonEssentialGenes,
          },
          lowest_replicate_correlation: doc.qc.worstReplicateCorr,
          flagged_samples: doc.qc.flagged.map((s) => ({
            id: s.id,
            label: s.label,
            condition: s.condition,
            replicate: s.replicate,
            timepoint: s.timepoint,
            reads: s.reads,
            mapped_fraction: s.mapped,
            zero_count_guide_fraction: s.zeroGuides,
            gini: s.gini,
            skew_ratio: s.skewRatio,
            verdict: s.verdict,
          })),
          samples: doc.qc.samples.map((s) => ({
            id: s.id,
            label: s.label,
            condition: s.condition,
            replicate: s.replicate,
            timepoint: s.timepoint,
            reads: s.reads,
            mapped_fraction: s.mapped,
            zero_count_guide_fraction: s.zeroGuides,
            gini: s.gini,
            skew_ratio: s.skewRatio,
            verdict: s.verdict,
          })),
        }
      : null,
    counts: {
      candidates: doc.counts.candidates,
      likely_real: doc.counts.likelyReal,
      flagged: doc.counts.flagged,
      enriched: doc.counts.enriched,
      depleted: doc.counts.candidates - doc.counts.enriched,
      by_verdict: doc.counts.byVerdict,
    },
    // A consumer cannot recompute a q-value without the denominator, so the
    // number of gene-level tests is a first-class field rather than prose.
    multiple_testing: {
      method: "benjamini-hochberg",
      threshold: 0.1,
      n_tests: doc.nTests,
    },
    atlas: {
      screens_total: doc.atlasScreensTotal,
      note: "Each hit's atlas.screens_testing_gene is the subset of screens_total that assayed that gene, and is the denominator of atlas.hit_rate.",
    },
    summary: doc.summary,
    methods: doc.methods.map((m) => ({ heading: m.heading, body: m.body })),
    hits: doc.hits.map((h) => ({
      rank: h.rank,
      gene_symbol: h.gene,
      verdict: h.verdict,
      chance_real: h.chance,
      novelty: h.novelty,
      direction: h.direction,
      log2_fold_change: h.lfc,
      p_value: h.pValue,
      fdr: h.fdr,
      bayes_factor: h.bayesFactor,
      n_guides: h.guides,
      n_guides_agreeing: h.guidesAgree,
      guide_concordance: Number(h.guideConcordance.toFixed(3)),
      atlas: {
        hit_count: h.atlasHits,
        screens_testing_gene: h.atlasScreens,
        hit_rate: Number(h.atlasHitRate.toFixed(6)),
      },
      flags: h.flags,
      evidence: h.evidence,
    })),
  };

  return `${JSON.stringify(payload, null, 2)}\n`;
}
