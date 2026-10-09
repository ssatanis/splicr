import { z } from "zod";

export const EXPORT_FIELDS = [
  { key: "gene_symbol", label: "Gene", group: "Identity", description: "Recorded gene symbol. Stored as text in Excel." },
  { key: "comparison", label: "Comparison", group: "Identity", description: "Recorded comparison name." },
  { key: "comparison_id", label: "Comparison ID", group: "Identity", description: "Stable identifier for joining gene results to guide evidence." },
  { key: "id", label: "Result ID", group: "Identity", description: "Identifier of the recorded gene result." },
  { key: "direction", label: "Direction", group: "Effect", description: "Recorded direction of the effect." },
  { key: "lfc", label: "Log2 fold change", group: "Effect", description: "Recorded gene log2 fold change." },
  { key: "p_value", label: "P value", group: "Effect", description: "Recorded gene p value." },
  { key: "stat_rank", label: "Recorded statistical rank", group: "Statistics", description: "Rank stored by the analysis. Not recalculated for the export." },
  { key: "rra_score", label: "MAGeCK RRA score", group: "Statistics", description: "Recorded robust rank aggregation score." },
  { key: "fdr", label: "SplicR FDR", group: "Statistics", description: "Recorded combined SplicR FDR. Distinct from native caller statistics." },
  { key: "depleted_fdr", label: "MAGeCK depletion FDR", group: "Statistics", description: "Native MAGeCK depletion FDR." },
  { key: "enriched_fdr", label: "MAGeCK enrichment FDR", group: "Statistics", description: "Native MAGeCK enrichment FDR." },
  { key: "norm_z", label: "DrugZ normZ", group: "Statistics", description: "Recorded DrugZ normalized Z score." },
  { key: "drugz_fdr", label: "DrugZ directional FDR", group: "Statistics", description: "Recorded FDR for the DrugZ direction." },
  { key: "mle_beta", label: "MAGeCK MLE beta", group: "Statistics", description: "Recorded MLE coefficient." },
  { key: "mle_fdr", label: "MAGeCK MLE FDR", group: "Statistics", description: "Recorded MLE FDR." },
  { key: "bayes_factor", label: "BAGEL2 Bayes factor", group: "Statistics", description: "Recorded BAGEL2 Bayes factor. It is not an FDR." },
  { key: "chronos_effect", label: "Chronos effect", group: "Statistics", description: "Recorded Chronos effect, where available." },
  { key: "n_guides", label: "Guides", group: "Guides", description: "Recorded number of guides." },
  { key: "n_good_guides", label: "Good guides", group: "Guides", description: "Recorded caller count of good guides." },
  { key: "cn_corrected", label: "CN corrected", group: "Guides", description: "Whether copy-number correction was recorded. Blank means unknown." },
  { key: "max_guide_share", label: "Largest guide signal share", group: "Guides", description: "Recorded fraction of absolute signal attributable to the strongest guide." },
  { key: "guide_lfcs", label: "Recorded guide LFC array", group: "Guides", description: "Stored LFC array encoded as JSON. Array positions do not identify guide sequences; use Guide-level results for keyed guide records." },
  { key: "flags", label: "Artifact flags", group: "Context", description: "Recorded flag names and severities. A flag does not establish a false hit." },
  { key: "flag_messages", label: "Flag evidence", group: "Context", description: "Recorded evidence messages for each flag." },
  { key: "hit_flags", label: "Artifact flag records (JSON)", group: "Context", description: "Complete flag names, severities and messages encoded as JSON." },
  { key: "atlas_hit_count", label: "Atlas hits at analysis", group: "Context", description: "Atlas hits stored for this gene when the run was analyzed." },
  { key: "atlas_screen_count", label: "Atlas screens at analysis", group: "Context", description: "Recorded gene-specific Atlas denominator, not the total archive size." },
  { key: "atlas_hit_rate", label: "Atlas hit rate at analysis", group: "Context", description: "Recorded gene-specific hit rate on a 0–1 scale." },
  { key: "chance_real", label: "Recorded model score", group: "Model output", description: "Stored uncalibrated score. It is not a validation probability." },
  { key: "chance_lower", label: "Recorded score lower bound", group: "Model output", description: "Stored lower bound, if any. It is not a validated uncertainty interval." },
  { key: "chance_upper", label: "Recorded score upper bound", group: "Model output", description: "Stored upper bound, if any. It is not a validated uncertainty interval." },
  { key: "model_version", label: "Model version", group: "Model output", description: "Version recorded with the model output." },
  { key: "novelty", label: "Recorded novelty score", group: "Model output", description: "Stored novelty score. It does not demonstrate a new discovery." },
  { key: "verdict", label: "Recorded verdict", group: "Model output", description: "Stored candidate interpretation." },
  { key: "reason", label: "Recorded reason", group: "Model output", description: "Stored explanation, exported without rewriting." },
  { key: "reason_features", label: "Recorded reason features (JSON)", group: "Model output", description: "Stored explanation features encoded as JSON, without rewriting." },
] as const;

export type ExportField = (typeof EXPORT_FIELDS)[number]["key"];
export const REQUIRED_FIELDS: ExportField[] = ["gene_symbol", "comparison"];
export const DEFAULT_FIELDS: ExportField[] = EXPORT_FIELDS.filter(f => f.group !== "Model output").map(f => f.key);
export const EXPORT_SECTIONS = [
  { key: "qc", label: "Quality control", description: "Run QC, sample metrics and replicate correlations." },
  { key: "guides", label: "Guide-level results", description: "Recorded guide effects, sequences and resolved annotations." },
  { key: "disagreement", label: "Guide disagreement", description: "Recorded guide spread, fragile calls and concordance evidence." },
  { key: "lab", label: "Laboratory evidence", description: "Isoform mappings, kinetic trajectories, reference context and library diagnostics. ZIP figure bundles are limited to 2,000 receipts; use individual gene downloads for larger runs." },
  { key: "provenance", label: "Run provenance", description: "Run settings, tool stages, timings and recorded reference evidence." },
] as const;
export type ExportSection = (typeof EXPORT_SECTIONS)[number]["key"];
export const FDR_METRICS = [
  { key: "fdr", label: "SplicR FDR" },
  { key: "depleted_fdr", label: "MAGeCK depletion FDR" },
  { key: "enriched_fdr", label: "MAGeCK enrichment FDR" },
  { key: "drugz_fdr", label: "DrugZ directional FDR" },
  { key: "mle_fdr", label: "MAGeCK MLE FDR" },
] as const;

export const exportRequestSchema = z.object({
  screenIds: z.array(z.uuid()).min(1).max(50).refine(ids => new Set(ids).size === ids.length, "Select each screen once."),
  format: z.enum(["xlsx", "csv", "json"]),
  fields: z.array(z.enum(EXPORT_FIELDS.map(f => f.key) as [ExportField, ...ExportField[]])).min(2)
    .refine(fields => new Set(fields).size === fields.length && REQUIRED_FIELDS.every(f => fields.includes(f)), "Include Gene and Comparison once."),
  sections: z.array(z.enum(["qc", "guides", "disagreement", "provenance", "lab"])).max(5)
    .refine(sections => new Set(sections).size === sections.length, "Select each section once."),
  rowScope: z.enum(["all", "fdr"]),
  fdrMetric: z.enum(["fdr", "depleted_fdr", "enriched_fdr", "drugz_fdr", "mle_fdr"]),
  fdrThreshold: z.number().finite().min(0).max(1),
}).strict();
export type ExportRequest = z.infer<typeof exportRequestSchema>;
