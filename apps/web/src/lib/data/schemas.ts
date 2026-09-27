import "server-only";

/**
 * Runtime validation for workspace settings.
 *
 * WHY THIS IS NOT IN types.ts
 *
 * Thirteen Client Components import types and constants from `@/lib/data/types`,
 * which is deliberate: that module has no server-only guard so the settings
 * panels can share the same shapes the server validates against. But the zod
 * schemas used to live there too, and a schema is a runtime value, not a type.
 * Importing anything from that module therefore pulled zod's whole runtime into
 * the client graph, about 388 KB of it, for components that never validate
 * anything. TypeScript types are erased at build; zod objects are not.
 *
 * So the schemas moved here, behind `server-only`, and the types they describe
 * are written out by hand in types.ts. The two could drift, so the assertions at
 * the bottom of this file fail the build if they ever do.
 *
 * Only `actions.ts` and `org.ts` need these, and both already run on the server.
 */

import { z } from "zod";

import {
  DEFAULT_WORKSPACE_SETTINGS,
  HIT_CALLERS,
  MODALITIES,
  NORMALIZATIONS,
  type WorkspaceSettings,
  type WorkspaceSettingsPatch,
} from "./types";

const defaultsShape = {
  /** atlas.libraries.slug, or null to let the detect stage call the library. */
  library_slug: z.string().trim().min(1).max(64).nullable(),
  modality: z.enum(MODALITIES),
  /** NCBI taxid. 9606 human, 10090 mouse. */
  organism_taxid: z.number().int().positive().max(10_000_000),
  fdr_threshold: z.number().gt(0).lte(0.5),
  normalization: z.enum(NORMALIZATIONS),
  hit_callers: z.array(z.enum(HIT_CALLERS)).min(1).max(HIT_CALLERS.length),
  /** CRISPRcleanR style copy-number correction before hits are called. */
  cn_correction: z.boolean(),
};

const qcShape = {
  min_mapping_rate: z.number().min(0).max(1),
  max_zero_fraction: z.number().min(0).max(1),
  max_gini: z.number().min(0).max(1),
  min_reads_per_guide: z.number().min(0).max(100_000),
  /** NNMD is negative when essentials drop out. Lower is better. */
  nnmd_threshold: z.number().min(-20).max(0),
};

const retentionShape = {
  /** Days to keep uploaded FASTQ. 0 means delete as soon as counting is done. */
  raw_reads_days: z.number().int().min(0).max(3650),
  keep_artifacts: z.boolean(),
};

const notificationsShape = {
  email_on_complete: z.boolean(),
  email_on_qc_fail: z.boolean(),
  weekly_digest: z.boolean(),
};

const brandingShape = {
  display_name: z.string().trim().max(120),
  /** Empty string means "no contact address on reports". */
  contact_email: z.union([z.literal(""), z.email().max(200)]),
  institution: z.string().trim().max(160),
};

const defaultsSchema = z.object(defaultsShape);
const qcSchema = z.object(qcShape);
const retentionSchema = z.object(retentionShape);
const notificationsSchema = z.object(notificationsShape);
const brandingSchema = z.object(brandingShape);

/** The full, complete settings document. Every field is required here. */
export const workspaceSettingsSchema = z.object({
  defaults: defaultsSchema,
  qc: qcSchema,
  retention: retentionSchema,
  notifications: notificationsSchema,
  branding: brandingSchema,
});

/** A partial update. Anything left out keeps its stored value. */
export const workspaceSettingsPatchSchema = z.object({
  defaults: defaultsSchema.partial().optional(),
  qc: qcSchema.partial().optional(),
  retention: retentionSchema.partial().optional(),
  notifications: notificationsSchema.partial().optional(),
  branding: brandingSchema.partial().optional(),
});

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Read a stored settings blob into a complete, valid document.
 *
 * Each section is validated on its own and falls back to its defaults, so a
 * stale or hand-edited jsonb blob can never break a read: one bad section costs
 * that section, not the page.
 */
export function parseWorkspaceSettings(raw: unknown): WorkspaceSettings {
  const stored = asRecord(raw);
  const base = DEFAULT_WORKSPACE_SETTINGS;

  const defaults = defaultsSchema.safeParse({ ...base.defaults, ...asRecord(stored.defaults) });
  const qc = qcSchema.safeParse({ ...base.qc, ...asRecord(stored.qc) });
  const retention = retentionSchema.safeParse({
    ...base.retention,
    ...asRecord(stored.retention),
  });
  const notifications = notificationsSchema.safeParse({
    ...base.notifications,
    ...asRecord(stored.notifications),
  });
  const branding = brandingSchema.safeParse({ ...base.branding, ...asRecord(stored.branding) });

  return {
    defaults: defaults.success ? defaults.data : base.defaults,
    qc: qc.success ? qc.data : base.qc,
    retention: retention.success ? retention.data : base.retention,
    notifications: notifications.success ? notifications.data : base.notifications,
    branding: branding.success ? branding.data : base.branding,
  };
}

/**
 * The hand-written types in types.ts and these schemas describe the same thing,
 * and nothing enforces that at runtime, so enforce it at compile time. Both
 * directions are checked, because one alone would let a field be added on
 * either side unnoticed. If the build fails here, the two have drifted.
 */
type SchemaSettings = z.infer<typeof workspaceSettingsSchema>;
type SchemaPatch = z.infer<typeof workspaceSettingsPatchSchema>;

const _settingsMatchesSchema: SchemaSettings = null as unknown as WorkspaceSettings;
const _schemaMatchesSettings: WorkspaceSettings = null as unknown as SchemaSettings;
const _patchMatchesSchema: SchemaPatch = null as unknown as WorkspaceSettingsPatch;
const _schemaMatchesPatch: WorkspaceSettingsPatch = null as unknown as SchemaPatch;
void _settingsMatchesSchema;
void _schemaMatchesSettings;
void _patchMatchesSchema;
void _schemaMatchesPatch;
