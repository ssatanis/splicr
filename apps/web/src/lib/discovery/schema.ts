import { z } from "zod";

export const DISCOVERY_VERSION = "evidence-worklist-v1";
export const MAX_DOCUMENT_BYTES = 1_500_000;
const label = z.string().trim().min(1).max(160);
const gene = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._@-]{0,39}$/).transform((s) => s.toUpperCase());
const finite = z.number().finite();
const nullableText = label.nullable().default(null);
const measured = finite.nullable().default(null);
const state = z.enum(["yes", "no", "unknown"]).default("unknown");

export const contextSchema = z.object({
  model_id: label,
  biological_unit: label,
  lineage: nullableText,
  subtype: nullableText,
  culture: z.enum(["organoid", "cell_line", "other", "unknown"]).default("unknown"),
  medium: nullableText,
  matrix: nullableText,
  library: nullableText,
  modality: z.enum(["knockout", "crispri", "rnai", "drug_modifier", "other"]),
  endpoint: nullableText,
  time_hours: finite.positive().max(100_000).nullable().default(null),
  effect_metric: z.enum(["log2_fold_change", "chronos", "other"]),
}).strict();

const source = z.object({
  id: label,
  citation: z.string().trim().min(1).max(2000),
  usage: z.enum(["laboratory_owned", "commercial_permission", "licensed_commercial"]),
  rights_statement: z.string().trim().min(1).max(2000),
}).strict();
const molecular = z.object({
  gene, source_id: label,
  expression: measured,
  expression_unit: nullableText,
  copy_number: finite.nonnegative().max(1000).nullable().default(null),
  mutation: nullableText,
  paralog: gene.nullable().default(null),
  paralog_state: z.enum(["lost", "expressed", "unknown"]).default("unknown"),
  pan_essential: z.boolean().nullable().default(null),
  protein_loss_fraction: finite.min(0).max(1).nullable().default(null),
}).strict();
const drug = z.object({
  id: label, gene, source_id: label, model_id: label,
  compound: label,
  mechanism: z.enum(["inhibitor", "degrader", "unknown"]).default("unknown"),
  dose_um: finite.positive().max(1e6),
  time_hours: finite.positive().max(100_000),
  relative_viability: finite.min(0).max(10),
  biological_replicates: z.number().int().min(1).max(1000),
  engagement: state,
  selective: state,
  // GR is valid only with actual cell measurements and positive control growth.
  initial_cells: finite.positive().nullable().default(null),
  control_cells: finite.positive().nullable().default(null),
  treated_cells: finite.nonnegative().nullable().default(null),
}).strict();
const reference = z.object({
  id: label, gene, source_id: label, study_id: label,
  context: contextSchema,
  effect: finite.min(-100).max(100),
}).strict();
const partial = z.object({
  id: label, gene, source_id: label, context: contextSchema,
  selective_dependency: z.boolean(),
  orthogonally_confirmed: z.boolean().default(false),
}).strict();
const pair = z.object({
  id: label, gene, partner: gene, source_id: label,
  model_id: label, biological_unit: label,
  evidence: z.enum(["independent_pair_screen", "local_drug_sensitization", "paralog_loss"]),
  reagents_available: z.boolean(),
  notes: z.string().trim().max(2000).default(""),
}).strict().refine((p) => p.gene !== p.partner, "A combination requires two different targets.");

const nomination = z.object({
  id: label, gene, source_id: label,
  assay: z.enum(["orthogonal_confirmation", "partial_suppression", "pharmacologic_confirmation"]),
  compound: nullableText,
  dose_um: finite.positive().max(1e6).nullable().default(null),
  time_hours: finite.positive().max(100_000).nullable().default(null),
  rationale: z.string().trim().min(1).max(2000),
}).strict().superRefine((n, ctx) => {
  if (n.assay === "pharmacologic_confirmation" && (!n.compound || n.dose_um === null || n.time_hours === null)) ctx.addIssue({ code: "custom", message: "A nominated drug assay requires compound, dose and timing." });
});

const combinationAssay = z.object({
  id: label, gene, partner: gene, source_id: label, model_id: label, biological_unit: label,
  compound_a: label, compound_b: label,
  dose_a_um: finite.positive().max(1e6), dose_b_um: finite.positive().max(1e6), time_hours: finite.positive().max(100_000),
  single_a_viability: finite.min(0).max(1), single_b_viability: finite.min(0).max(1), combination_viability: finite.min(0).max(1),
  biological_replicates: z.number().int().min(1).max(1000),
  matched_controls: z.boolean(),
}).strict().refine((c) => c.gene !== c.partner && c.compound_a !== c.compound_b, "Combination assays need distinct targets and compounds.");

export const discoveryDocumentSchema = z.object({
  version: z.literal(1),
  context: contextSchema,
  sources: z.array(source).max(200),
  molecular: z.array(molecular).max(5000).default([]),
  drugs: z.array(drug).max(5000).default([]),
  references: z.array(reference).max(10_000).default([]),
  partial_suppression: z.array(partial).max(5000).default([]),
  pairs: z.array(pair).max(2000).default([]),
  nominations: z.array(nomination).max(2000).default([]),
  combination_assays: z.array(combinationAssay).max(5000).default([]),
  thresholds: z.object({
    fdr: finite.min(0).max(1).default(0.1),
    depletion_lfc: finite.positive().max(100).default(0.5),
    drug_viability: finite.min(0).max(1).default(0.5),
    minimum_drug_replicates: z.number().int().min(2).max(1000).default(3),
  }).strict().default({ fdr: 0.1, depletion_lfc: 0.5, drug_viability: 0.5, minimum_drug_replicates: 3 }),
}).strict().superRefine((doc, ctx) => {
  const sources = new Set(doc.sources.map((s) => s.id));
  if (sources.size !== doc.sources.length) ctx.addIssue({ code: "custom", message: "Source identifiers must be unique.", path: ["sources"] });
  for (const key of ["molecular", "drugs", "references", "partial_suppression", "pairs", "nominations", "combination_assays"] as const) {
    const ids = new Set<string>();
    doc[key].forEach((row, i) => {
      if (!sources.has(row.source_id)) ctx.addIssue({ code: "custom", message: "Evidence must name a declared source and its usage rights.", path: [key, i, "source_id"] });
      const id = "id" in row ? row.id : row.gene;
      if (ids.has(id)) ctx.addIssue({ code: "custom", message: "Duplicate evidence identifier.", path: [key, i] });
      ids.add(id);
    });
  }
  for (const [i, row] of doc.molecular.entries()) {
    if (row.expression !== null && row.expression_unit === null) ctx.addIssue({ code: "custom", message: "Measured expression requires a unit.", path: ["molecular", i, "expression_unit"] });
  }
});

export type DiscoveryDocument = z.infer<typeof discoveryDocumentSchema>;
export type ModelContext = z.infer<typeof contextSchema>;

export const batchDesignSchema = z.object({
  name: z.string().trim().min(1).max(120),
  budget: finite.positive().max(1e9),
  exploration_fraction: finite.min(0).max(0.5).default(0.2),
  cost_unit: label,
  default_cost: finite.positive().max(1e9),
  costs: z.record(z.string().max(500), finite.positive().max(1e9)).default({}),
  investigator_ids: z.array(z.string().min(1).max(500)).max(500).default([]),
  missed_ids: z.array(z.string().min(1).max(500)).max(100).default([]),
  endpoint_key: label,
  laboratory_threshold: finite.positive().max(1e6).nullable().default(null),
}).strict().superRefine((v, ctx) => {
  for (const key of ["investigator_ids", "missed_ids"] as const) {
    if (new Set(v[key]).size !== v[key].length) ctx.addIssue({ code: "custom", message: "Each experiment may appear only once in a list.", path: [key] });
  }
});
export type BatchDesign = z.infer<typeof batchDesignSchema>;

export const discoveryResultSchema = z.object({
  result: z.enum(["validated", "failed", "inconclusive", "pending"]),
  actual_cost: finite.nonnegative().max(1e9),
  lab_id: label,
  model_id: label,
  effect_size: finite.min(-1e6).max(1e6).nullable().default(null),
  n_replicates: z.number().int().min(1).max(1000).nullable().default(null),
  n_perturbations: z.number().int().min(1).max(1000).nullable().default(null),
  independent_perturbation: z.boolean().nullable().default(null),
  distinct_from_screen_constructs: z.boolean().nullable().default(null),
  controls: z.record(z.string().max(100), z.boolean().nullable()).default({}),
  notes: z.string().trim().max(4000).default(""),
  evidence_url: z.url().refine((s) => /^https?:\/\//.test(s), "Use an HTTP or HTTPS evidence URL.").nullable().default(null),
}).strict();
export type DiscoveryResult = z.infer<typeof discoveryResultSchema>;

export function parseDiscoveryDocument(text: string): DiscoveryDocument {
  if (new TextEncoder().encode(text).length > MAX_DOCUMENT_BYTES) throw new Error("Evidence files must be smaller than 1.5 MB. Split larger reference imports into a scoped cohort.");
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new Error("The evidence file is not valid JSON."); }
  const parsed = discoveryDocumentSchema.safeParse(json);
  if (!parsed.success) throw new Error(parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return parsed.data;
}
