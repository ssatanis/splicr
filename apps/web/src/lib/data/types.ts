/**
 * Shared types for the lab workspace data layer.
 *
 * This module is deliberately free of any server-only import so that both
 * Server Components and Client Components can use the enums, labels and
 * validation schemas. The reads live in `@/lib/data/org` (server only) and the
 * mutations in `@/lib/data/actions` (Server Actions).
 *
 * Every enum below mirrors a Postgres enum from
 * supabase/migrations/20260926000200_schemas_types_helpers.sql, so a value that
 * typechecks here is a value the database accepts.
 */

// ---------------------------------------------------------------------------
// Roles and tenancy
// ---------------------------------------------------------------------------

export const ORG_ROLES = ["owner", "admin", "member", "viewer"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const ORG_KINDS = [
  "personal",
  "academic",
  "core",
  "biotech",
  "pharma",
  "ai_company",
] as const;
export type OrgKind = (typeof ORG_KINDS)[number];

export const PLAN_TIERS = ["free", "lab", "core", "biotech", "pharma"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export const MODALITIES = [
  "knockout",
  "crispri",
  "crispra",
  "base_edit",
  "prime",
  "knockout_cas12a",
] as const;
export type Modality = (typeof MODALITIES)[number];

/** Same ordering as `private.role_rank()` in the database. Owner is highest. */
export const ROLE_RANK: Record<OrgRole, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
};

/**
 * What each role is called on screen.
 *
 * The database enum stays `member`, because renaming a Postgres enum value that
 * Row Level Security policies, invite rows and the engine all compare against
 * would be a migration with nothing to show for it. What a lab actually calls
 * that person is a researcher, so that is the word the console uses, in one
 * place, for every sentence that names a role.
 */
export const ROLE_LABEL: Record<OrgRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Researcher",
  viewer: "Viewer",
};

export const ORG_KIND_LABEL: Record<OrgKind, string> = {
  personal: "Personal",
  academic: "Academic lab",
  core: "Core facility",
  biotech: "Biotech",
  pharma: "Pharma",
  ai_company: "Computational group",
};

export const PLAN_LABEL: Record<PlanTier, string> = {
  free: "Free",
  lab: "Lab",
  core: "Core",
  biotech: "Biotech",
  pharma: "Pharma",
};

/**
 * True when `role` is at least `min`. This is the TypeScript mirror of
 * `private.has_org_role(org, min_role)`; the database enforces the same rule
 * inside Row Level Security, so a UI check here is a convenience and never the
 * only line of defence.
 */
export function roleAtLeast(role: OrgRole | null | undefined, min: OrgRole): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === "string" && (ORG_ROLES as readonly string[]).includes(value);
}

export function isOrgKind(value: unknown): value is OrgKind {
  return typeof value === "string" && (ORG_KINDS as readonly string[]).includes(value);
}

export function isPlanTier(value: unknown): value is PlanTier {
  return typeof value === "string" && (PLAN_TIERS as readonly string[]).includes(value);
}

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

// ---------------------------------------------------------------------------
// Row shapes returned by the data layer
// ---------------------------------------------------------------------------

/** The verified JWT subject. Never read from the client. */
export interface SessionUser {
  id: string;
  email: string | null;
  /**
   * An honorific the researcher chose for themselves: "Dr.", "Professor".
   *
   * It lives in the Auth user's metadata rather than in `profiles` because it
   * is set during invitation acceptance, before a profile row is the thing the
   * console reads from, and because adding a column to a table the harmonized
   * pipeline also touches is not worth it for a greeting. A profile column is
   * the right home once onboarding writes one.
   *
   * It is never a job title. "Research Scientist" is a role and does not belong
   * in front of somebody's name: see `lib/people.ts`.
   */
  preferredTitle: string | null;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  orcid: string | null;
  default_org_id: string | null;
  preferred_title: string | null;
  professional_role: string | null;
  institution: string | null;
  time_zone: string | null;
  onboarding_step: number;
  onboarding_completed_at: string | null;
}

export interface Organization {
  id: string;
  slug: string;
  name: string;
  kind: OrgKind;
  plan: PlanTier;
  created_at: string;
  updated_at: string;
  logo_url: string | null;
  location: string | null;
  time_zone: string | null;
}

/** One row of the team table: membership joined to the member's profile. */
export interface OrgMember {
  id: string;
  name: string;
  email: string;
  role: OrgRole;
  avatar: string | null;
  joined_at: string;
}

export interface OrgInvite {
  id: string;
  email: string;
  role: OrgRole;
  /** Raw invite token. Readable by admins only, per the org_invites policies. */
  token: string;
  invited_by: string | null;
  expires_at: string;
  created_at: string;
  delivery_state: "pending" | "sent" | "existing_user" | "failed" | "revoked";
  delivered_at: string | null;
  delivery_error: string | null;
  /** Convenience flag so the UI can separate live links from stale ones. */
  expired: boolean;
}

export type ApiKeyStatus = "active" | "expired" | "revoked";

/** An API key as the UI sees it. The sha-256 hash never leaves the database. */
export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  created_by: string | null;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  status: ApiKeyStatus;
}

export interface WorkspaceStats {
  screens: number;
  runs: number;
  hits: number;
  outcomes: number;
  members: number;
}

/** Everything a dashboard page needs to know about who is asking. */
export interface WorkspaceContext {
  user: SessionUser | null;
  profile: Profile | null;
  org: Organization | null;
  role: OrgRole | null;
}

/** All workspace pages hang off this layout, so revalidating it is enough. */
export const DASHBOARD_PATH = "/dashboard";

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

/** Scopes a SplicR Connect key can carry. Stored in api_keys.scopes. */
export const API_SCOPES = [
  "atlas:read",
  "hits:read",
  "screens:read",
  "screens:write",
  "runs:read",
  "runs:write",
  "outcomes:read",
  "outcomes:write",
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

/** Matches the api_keys.scopes column default. */
export const DEFAULT_API_SCOPES: ApiScope[] = ["atlas:read", "hits:read"];

export const API_SCOPE_LABEL: Record<ApiScope, string> = {
  "atlas:read": "Read the Atlas",
  "hits:read": "Read hits and reports",
  "screens:read": "Read screens",
  "screens:write": "Create and edit screens",
  "runs:read": "Read runs",
  "runs:write": "Start runs",
  "outcomes:read": "Read validation outcomes",
  "outcomes:write": "Log validation outcomes",
};

export function isApiScope(value: unknown): value is ApiScope {
  return typeof value === "string" && (API_SCOPES as readonly string[]).includes(value);
}

/** Plaintext key format: "spk_live_" plus 32 url-safe characters. */
export const API_KEY_PREFIX = "spk_live_";
/** Characters of the plaintext stored in api_keys.key_prefix for display. */
export const API_KEY_PREFIX_LENGTH = 12;

// ---------------------------------------------------------------------------
// Workspace settings (organizations.settings jsonb)
// ---------------------------------------------------------------------------

export const NORMALIZATIONS = ["median", "total", "control"] as const;
export type Normalization = (typeof NORMALIZATIONS)[number];

export const NORMALIZATION_LABEL: Record<Normalization, string> = {
  median: "Median ratio, the MAGeCK default",
  total: "Total count",
  control: "Control guides",
};

export const HIT_CALLERS = [
  "mageck_rra",
  "mageck_mle",
  "bagel2",
  "drugz",
  "chronos",
] as const;
export type HitCaller = (typeof HIT_CALLERS)[number];

export const HIT_CALLER_LABEL: Record<HitCaller, string> = {
  mageck_rra: "MAGeCK RRA",
  mageck_mle: "MAGeCK MLE",
  bagel2: "BAGEL2",
  drugz: "DrugZ",
  chronos: "Chronos",
};

/**
 * The settings document, written out rather than inferred from a zod schema.
 *
 * The schemas live in `./schemas`, behind `server-only`, because a schema is a
 * runtime value: defining them here pulled zod's whole runtime into every Client
 * Component that imports a type or constant from this module, and thirteen of
 * them do. Types are erased at build, so these cost nothing. `./schemas` asserts
 * at compile time that the two still describe the same shape.
 */
export interface WorkspaceSettings {
  defaults: {
    /** atlas.libraries.slug, or null to let the detect stage call the library. */
    library_slug: string | null;
    modality: Modality;
    /** NCBI taxid. 9606 human, 10090 mouse. */
    organism_taxid: number;
    fdr_threshold: number;
    normalization: Normalization;
    hit_callers: HitCaller[];
    /** CRISPRcleanR style copy-number correction before hits are called. */
    cn_correction: boolean;
  };
  qc: {
    min_mapping_rate: number;
    max_zero_fraction: number;
    max_gini: number;
    min_reads_per_guide: number;
    /** NNMD is negative when essentials drop out. Lower is better. */
    nnmd_threshold: number;
  };
  retention: {
    /** Days to keep uploaded FASTQ. 0 means delete as soon as counting is done. */
    raw_reads_days: number;
    keep_artifacts: boolean;
  };
  notifications: {
    email_on_complete: boolean;
    email_on_qc_fail: boolean;
    weekly_digest: boolean;
  };
  branding: {
    display_name: string;
    /** Empty string means "no contact address on reports". */
    contact_email: string;
    institution: string;
  };
}

/** A partial update. Anything left out keeps its stored value. */
export type WorkspaceSettingsPatch = {
  [S in keyof WorkspaceSettings]?: Partial<WorkspaceSettings[S]>;
};

export type WorkspaceSettingsSection = keyof WorkspaceSettings;

export const WORKSPACE_SETTINGS_SECTIONS: readonly WorkspaceSettingsSection[] = [
  "defaults",
  "qc",
  "retention",
  "notifications",
  "branding",
];

/**
 * Defaults for a brand new workspace.
 *
 * The QC numbers are the engine's own thresholds (engine/splicr/config.py):
 * mapping rate 0.60 and zero fraction 0.01 from the MAGeCK wiki, endpoint Gini
 * 0.35, 185 mean reads per guide from DepMap, and NNMD at most -1.25 from the
 * Chronos median/MAD definition. Keeping both copies in step matters, because
 * the engine writes the QC verdict the dashboard reads back.
 */
export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  defaults: {
    library_slug: null,
    modality: "knockout",
    organism_taxid: 9606,
    fdr_threshold: 0.1,
    normalization: "median",
    hit_callers: ["mageck_rra", "mageck_mle", "bagel2"],
    cn_correction: true,
  },
  qc: {
    min_mapping_rate: 0.6,
    max_zero_fraction: 0.01,
    max_gini: 0.35,
    min_reads_per_guide: 185,
    nnmd_threshold: -1.25,
  },
  retention: {
    raw_reads_days: 90,
    keep_artifacts: true,
  },
  notifications: {
    email_on_complete: true,
    email_on_qc_fail: true,
    weekly_digest: false,
  },
  branding: {
    display_name: "",
    contact_email: "",
    institution: "",
  },
};


/**
 * Turn whatever is in organizations.settings into a complete, typed document.
 *
 * Reads must never fail because of a stale or hand edited jsonb blob, so each
 * section is validated on its own and falls back to its defaults if it cannot
 * be parsed. Unknown keys are dropped.
 */

function withDefined<T extends object>(base: T, patch: Partial<T> | undefined): T {
  const next: T = { ...base };
  if (!patch) return next;
  const target = next as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) target[key] = value;
  }
  return next;
}

/** Merge a validated patch over the current settings, section by section. */
export function applySettingsPatch(
  current: WorkspaceSettings,
  patch: WorkspaceSettingsPatch,
): WorkspaceSettings {
  return {
    defaults: withDefined(current.defaults, patch.defaults),
    qc: withDefined(current.qc, patch.qc),
    retention: withDefined(current.retention, patch.retention),
    notifications: withDefined(current.notifications, patch.notifications),
    branding: withDefined(current.branding, patch.branding),
  };
}

// ---------------------------------------------------------------------------
// Server Action results
// ---------------------------------------------------------------------------

/**
 * Every Server Action resolves to one of these. Actions never throw at the UI,
 * so a form can render `error` straight into the page.
 */
export type ActionResult = { ok: true } | { ok: false; error: string };

/** Same contract, plus the payload a successful call hands back. */
export type ActionResultWith<T> = ({ ok: true } & T) | { ok: false; error: string };

export type ActionFailure = { ok: false; error: string };

export function actionFailed(error: string): ActionFailure {
  return { ok: false, error };
}
