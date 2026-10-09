import { z } from "zod";
export type LabKind = "isoforms" | "kinetics" | "context" | "drift";
export interface Transcript { id: string; chromosome: string; strand: string | null; exons: { start: number; end: number; number: number | null }[]; cds: { start: number; end: number }[] }
export interface IsoformPayload {
  status: string; reason?: string; reference?: string; coordinate_system?: string; interpretation?: string;
  transcripts?: Transcript[];
  guides?: { guide_key: string; lfc: number | null; chromosome: string | null; cut_position: number | null; strand: string | null; status: string; reason?: string;
    annotation?: { n_transcripts: number; n_coding: number; coding_fraction: number | null; exonic_fraction: number | null; covering: string[]; note: string };
    expression?: { status: string; coding_fraction?: number | null; exonic_fraction?: number | null; source: string; note: string } }[];
}
export interface KineticPayload {
  status: string; reason?: string; interpretation?: string; unit?: string; normalization?: string; pseudocount?: number; n_guides?: number;
  unmeasured_trajectories?: { condition: string; replicate: string; reason: string }[];
  trajectories?: { condition: string; replicate: string; days: number[]; samples: string[]; mean_lfc: number[]; slope: number; intercept: number; residual_rmse: number;
    guides: { guide_key: string; lfc: number[]; counts: number[] }[] }[];
  conditions?: { condition: string; slope: number; n_replicates: number; standard_error: number | null; ci95: [number, number] | null }[];
}
export interface AggregateContext { n_measured_models: number; median_effect: number | null; mean_effect: number | null; fraction_effect_le_minus_0_5: number | null }
export interface ContextPayload {
  status: string; reason?: string; interpretation?: string; gene_effect_release?: string; requested_cell_line?: string | null;
  model_id?: string | null; match_tier?: string; lineage?: string | null;
  exact?: { effect: number | null; status: string };
  lineage_reference?: AggregateContext; global_reference?: AggregateContext;
  copy_number?: { value: number | null; scale: string; status: string; release: string };
}
export interface DriftPayload {
  status: string; reason?: string; interpretation?: string; library?: string; reagent_lot?: string | null;
  negative_controls?: { n_guides: number; sd_lfc: number | null; median_lfc: number | null; mad_lfc: number | null; status: string };
  flags?: { sample: string; severity: string; code: string; value: number; threshold: number; message: string }[];
  core_essential_guides?: { within_gene_variance_lfc?: number | null; n_multiguide_genes?: number; n_guides: number; sd_lfc: number | null; median_lfc: number | null; mad_lfc: number | null; status: string };
  samples?: { sample: string; role: string | null; n_guides: number; total_counts: number; zero_fraction: number; raw_count_gini: number | null; baseline: boolean; lorenz: [number, number][] }[];
}
export type LabReceipt = {
  schema: "splicr.lab-evidence.v1"; gene: string; inputs: Record<string, unknown>; sha256: string;
  canonical?: string; comparison_id?: string; recorded_at?: string;
} & ({ kind: "isoforms"; payload: IsoformPayload } | { kind: "kinetics"; payload: KineticPayload } | { kind: "context"; payload: ContextPayload } | { kind: "drift"; payload: DriftPayload });
export function isLabReceipt(value: unknown): value is LabReceipt {
  return receiptSchema.safeParse(value).success;
}

// Runtime validation is separate from the display types. Corrupt/old documents
// must fail closed rather than fabricate an empty plot or crash a researcher’s page.

const finite = z.number().finite();
const nullable = finite.nullable();
const interval = z.object({ start: finite.int().min(0), end: finite.int().positive(), number: finite.int().nullable().optional() }).refine(r => r.end > r.start);
const basePayload = z.object({ status: z.string(), reason: z.string().optional(), interpretation: z.string().optional() });
const aggregate = z.object({ n_measured_models: finite.int().min(0), median_effect: nullable, mean_effect: nullable.optional(), fraction_effect_le_minus_0_5: nullable.optional() }).passthrough();
const isoforms = basePayload.extend({
  transcripts: z.array(z.object({ id: z.string(), chromosome: z.string(), strand: z.string().nullable(), exons: z.array(interval), cds: z.array(interval) })).optional(),
  guides: z.array(z.object({ guide_key: z.string(), lfc: nullable, chromosome: z.string().nullable(), cut_position: finite.int().min(0).nullable(), strand: z.string().nullable(), status: z.string(), reason: z.string().optional(),
    annotation: z.object({ n_transcripts: finite.int().min(0), n_coding: finite.int().min(0), coding_fraction: nullable, exonic_fraction: nullable, covering: z.array(z.string()), note: z.string() }).passthrough().optional(),
    expression: z.object({ status: z.string(), coding_fraction: nullable.optional(), exonic_fraction: nullable.optional(), source: z.string(), note: z.string() }).optional(),
  }).passthrough()).optional(),
}).passthrough();
const trajectory = z.object({ condition: z.string(), replicate: z.string(), days: z.array(finite), samples: z.array(z.string()), mean_lfc: z.array(finite), slope: finite, intercept: finite, residual_rmse: finite,
  guides: z.array(z.object({ guide_key: z.string(), lfc: z.array(finite), counts: z.array(finite) })) }).refine(r => r.days.length === r.samples.length && r.days.length === r.mean_lfc.length && r.guides.every(g => g.lfc.length === r.days.length && g.counts.length === r.days.length));
const kinetics = basePayload.extend({ trajectories: z.array(trajectory).optional(), conditions: z.array(z.object({ condition: z.string(), slope: finite, n_replicates: finite.int().positive(), standard_error: nullable, ci95: z.tuple([finite,finite]).nullable() })).optional() }).passthrough();
const context = basePayload.extend({ exact: z.object({ effect: nullable, status: z.string() }).optional(), lineage_reference: aggregate.optional(), global_reference: aggregate.optional(),
  copy_number: z.object({ value: nullable, scale: z.string(), status: z.string(), release: z.string() }).optional() }).passthrough();
const dispersion = z.object({ n_guides: finite.int().min(0), sd_lfc: nullable, median_lfc: nullable, mad_lfc: nullable, status: z.string() });
const drift = basePayload.extend({ negative_controls: dispersion.optional(), core_essential_guides: dispersion.optional(), samples: z.array(z.object({ sample: z.string(), role: z.string().nullable(), n_guides: finite.int().positive(), total_counts: finite.min(0), zero_fraction: finite.min(0).max(1), raw_count_gini: nullable, baseline: z.boolean(), lorenz: z.array(z.tuple([finite,finite])) })).optional() }).passthrough();
const receiptSchema = z.object({ schema: z.literal("splicr.lab-evidence.v1"), gene: z.string().min(1), sha256: z.string().regex(/^[0-9a-f]{64}$/), inputs: z.record(z.string(),z.unknown()), canonical: z.string().optional() }).and(z.discriminatedUnion("kind",[
  z.object({ kind: z.literal("isoforms"), payload: isoforms }), z.object({ kind: z.literal("kinetics"), payload: kinetics }),
  z.object({ kind: z.literal("context"), payload: context }), z.object({ kind: z.literal("drift"), payload: drift }),
]));
