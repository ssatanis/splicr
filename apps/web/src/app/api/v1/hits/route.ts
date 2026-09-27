/**
 * GET /api/v1/hits?screen=<uuid>
 *
 * Scored hits for one screen, authenticated with a SplicR Connect key.
 *
 *   curl -s "https://<host>/api/v1/hits?screen=<uuid>&max_fdr=0.1&limit=25" \
 *     -H "Authorization: Bearer spk_live_..."
 *
 * How the authentication works. `public.api_keys` stores only the sha-256 hex
 * digest of the whole plaintext key, so the presented key is hashed here and the
 * digest is what gets looked up. The key itself is never compared, stored or
 * logged.
 *
 * The lookup cannot be a plain select. This process holds the publishable key,
 * which lands on the `anon` Postgres role, and the api_keys policies only admit
 * an org admin, while `public.hits` is gated by `private.can_read_screen()`.
 * There is no service-role secret in a web process and there should not be one.
 * So the reads go through the four security definer functions added in
 * supabase/migrations/20260927000500_connect_api.sql, each of which takes the
 * digest and derives the organization from it. A caller cannot name a workspace
 * or a screen it does not hold the key for.
 *
 * Status codes:
 *   200  hits, with paging
 *   400  no screen id, or a filter that is not a number or not in the enum
 *   401  no bearer header, or a key that is unknown, revoked or expired
 *   403  a live key that does not carry hits:read
 *   404  a screen the key's organization does not own, or no such screen
 *   500  the database refused the read
 *   503  Supabase is not configured in this environment
 */
import { createHash } from "node:crypto";

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { HITS_SCOPE } from "@/lib/connect/config";
import { apiSupabase } from "@/lib/connect/supabase";

/** node:crypto and a database round trip, so never prerender or cache this. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 50;

/** Mirrors public.hit_direction. */
const DIRECTIONS = ["depleted", "enriched"] as const;

/** Mirrors public.hit_verdict. */
const VERDICTS = ["real_new", "real_known", "real_generic", "artifact", "uncertain"] as const;

/**
 * Query string contract. Absent is always allowed and means "do not filter";
 * present but unparseable is a 400 rather than a silently ignored value, because
 * an agent that misspells a filter should be told, not handed the whole table.
 */
const querySchema = z.object({
  screen: z.uuid("screen must be a screen id, for example 0199f4c2-1f8b-7c31-9a0e-2f4f1d8c77aa."),
  min_chance: z.coerce
    .number("min_chance must be a number between 0 and 1.")
    .min(0, "min_chance must be between 0 and 1.")
    .max(1, "min_chance must be between 0 and 1.")
    .optional(),
  max_fdr: z.coerce
    .number("max_fdr must be a number between 0 and 1.")
    .min(0, "max_fdr must be between 0 and 1.")
    .max(1, "max_fdr must be between 0 and 1.")
    .optional(),
  direction: z.enum(DIRECTIONS, `direction must be one of ${DIRECTIONS.join(", ")}.`).optional(),
  verdict: z.enum(VERDICTS, `verdict must be one of ${VERDICTS.join(", ")}.`).optional(),
  limit: z.coerce
    .number("limit must be a whole number.")
    .int("limit must be a whole number.")
    .min(1, "limit must be at least 1.")
    .max(MAX_LIMIT, `limit can be at most ${MAX_LIMIT}.`)
    .optional(),
  offset: z.coerce
    .number("offset must be a whole number.")
    .int("offset must be a whole number.")
    .min(0, "offset cannot be negative.")
    .optional(),
});

// ---------------------------------------------------------------------------
// Row shapes returned by the RPCs
// ---------------------------------------------------------------------------

interface KeyRow {
  key_id: string;
  key_name: string;
  org_id: string;
  org_slug: string;
  org_name: string;
  scopes: string[] | null;
  revoked: boolean;
  expired: boolean;
}

interface ScreenRow {
  screen_id: string;
  org_id: string;
  name: string;
  description: string | null;
  cell_line: string | null;
  modality: string;
  phenotype: string | null;
  status: string;
  qc: string;
  visibility: string;
  taxid: number;
  library_slug: string | null;
  library_name: string | null;
  run_id: string | null;
  n_hits: number;
  n_real_hits: number;
  created_at: string;
  updated_at: string;
}

interface HitRow {
  n_total: number | string;
  hit_id: string;
  gene_symbol: string;
  direction: string;
  verdict: string | null;
  comparison: string | null;
  chance_real: number | null;
  chance_lower: number | null;
  chance_upper: number | null;
  novelty: number | null;
  lfc: number | null;
  fdr: number | null;
  p_value: number | null;
  n_guides: number | null;
  n_good_guides: number | null;
  cn_corrected: boolean | null;
  atlas_hit_count: number | null;
  atlas_screen_count: number | null;
  atlas_hit_rate: number | null;
  model_version: string | null;
  reason: string | null;
  flags: { flag: string; severity: string; message: string }[] | null;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/**
 * Any client may call this with a bearer token it already holds, including one
 * running in a browser, so the endpoint answers cross-origin. Nothing is served
 * from a cookie, so there is no credentialed request to protect and `*` is safe.
 */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Max-Age": "86400",
};

const BASE_HEADERS: Record<string, string> = {
  ...CORS_HEADERS,
  "Cache-Control": "no-store",
};

type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "bad_request"
  | "server_error"
  | "unavailable";

function fail(
  status: number,
  code: ErrorCode,
  message: string,
  extra: Record<string, string> = {},
): NextResponse {
  const headers = { ...BASE_HEADERS, ...extra };
  if (status === 401) {
    headers["WWW-Authenticate"] = 'Bearer realm="SplicR Connect", charset="UTF-8"';
  }
  return NextResponse.json({ error: { code, message } }, { status, headers });
}

/** Six decimal places keeps a real4 honest without printing float noise. */
function round(value: number | null, places = 6): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/** "Bearer <key>", case insensitive on the scheme, or null. */
function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabase = apiSupabase();
  if (!supabase) {
    return fail(503, "unavailable", "This SplicR instance has no database configured.");
  }

  // --- 401: a bearer key has to be there before anything else happens -------
  const presented = bearerToken(request);
  if (!presented) {
    return fail(
      401,
      "unauthorized",
      "Send a SplicR Connect key as an Authorization: Bearer header. Create one under Connect in the dashboard.",
    );
  }

  const keyHash = createHash("sha256").update(presented).digest("hex");

  const keyResult = await supabase.rpc("api_key_resolve", { p_key_hash: keyHash });
  if (keyResult.error) {
    console.error(`[api/v1/hits] api_key_resolve: ${keyResult.error.message}`);
    return fail(500, "server_error", "The key could not be checked. Try again.");
  }

  const key = (Array.isArray(keyResult.data) ? (keyResult.data as KeyRow[]) : [])[0] ?? null;

  // A revoked or expired key is as good as an unknown one over HTTP. The reason
  // is logged rather than returned, so the response cannot be used to tell a
  // wrong key from a retired one.
  if (!key || key.revoked || key.expired) {
    if (key) {
      console.warn(
        `[api/v1/hits] key ${key.key_id} rejected: ${key.revoked ? "revoked" : "expired"}`,
      );
    }
    return fail(401, "unauthorized", "That API key is not valid. It may have been revoked.");
  }

  // --- 403: the key is real but does not carry the scope --------------------
  const scopes = key.scopes ?? [];
  if (!scopes.includes(HITS_SCOPE)) {
    return fail(
      403,
      "forbidden",
      `This key does not carry the ${HITS_SCOPE} scope. Its scopes are ${
        scopes.length > 0 ? scopes.join(", ") : "empty"
      }. Create a key with ${HITS_SCOPE} under Connect in the dashboard.`,
    );
  }

  // --- 400: the query string ------------------------------------------------
  const params = request.nextUrl.searchParams;
  const raw: Record<string, string> = {};
  for (const field of ["screen", "min_chance", "max_fdr", "direction", "verdict", "limit", "offset"]) {
    const value = params.get(field);
    if (value !== null && value !== "") raw[field] = value;
  }

  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path[0];
    const message = issue?.message ?? "That query is not valid.";
    return fail(400, "bad_request", field ? `${String(field)}: ${message}` : message);
  }

  const query = parsed.data;
  const limit = query.limit ?? DEFAULT_LIMIT;
  const offset = query.offset ?? 0;

  // Only now does the key count as used. Never fatal: a failed stamp must not
  // cost the caller their data.
  const touched = await supabase.rpc("api_key_touch", { p_key_hash: keyHash });
  if (touched.error) {
    console.error(`[api/v1/hits] api_key_touch: ${touched.error.message}`);
  }

  // --- 404: the screen has to belong to this key's organization -------------
  const screenResult = await supabase.rpc("api_key_screen", {
    p_key_hash: keyHash,
    p_screen_id: query.screen,
  });
  if (screenResult.error) {
    console.error(`[api/v1/hits] api_key_screen: ${screenResult.error.message}`);
    return fail(500, "server_error", "The screen could not be read. Try again.");
  }

  const screen = (Array.isArray(screenResult.data) ? (screenResult.data as ScreenRow[]) : [])[0] ?? null;
  if (!screen) {
    return fail(
      404,
      "not_found",
      `No screen ${query.screen} in ${key.org_name}. A key only reads its own workspace.`,
    );
  }

  // --- 200 ------------------------------------------------------------------
  const hitsResult = await supabase.rpc("api_key_hits", {
    p_key_hash: keyHash,
    p_screen_id: query.screen,
    p_min_chance: query.min_chance ?? null,
    p_max_fdr: query.max_fdr ?? null,
    p_direction: query.direction ?? null,
    p_verdict: query.verdict ?? null,
    p_limit: limit,
    p_offset: offset,
  });
  if (hitsResult.error) {
    console.error(`[api/v1/hits] api_key_hits: ${hitsResult.error.message}`);
    return fail(500, "server_error", "The hits could not be read. Try again.");
  }

  const rows = Array.isArray(hitsResult.data) ? (hitsResult.data as HitRow[]) : [];

  // n_total is a window count over the filtered set and is identical on every
  // row, so the first row carries it. An empty page is ambiguous: it means
  // either an empty filtered set or an offset past the end, and reporting zero
  // for the second case would tell a caller who jumped too far that the screen
  // has no hits. One cheap probe at offset 0 settles it.
  let total = rows.length > 0 ? Number(rows[0].n_total) : 0;

  if (rows.length === 0 && offset > 0) {
    const probe = await supabase.rpc("api_key_hits", {
      p_key_hash: keyHash,
      p_screen_id: query.screen,
      p_min_chance: query.min_chance ?? null,
      p_max_fdr: query.max_fdr ?? null,
      p_direction: query.direction ?? null,
      p_verdict: query.verdict ?? null,
      p_limit: 1,
      p_offset: 0,
    });
    if (probe.error) {
      console.error(`[api/v1/hits] api_key_hits total probe: ${probe.error.message}`);
    } else {
      const probeRows = Array.isArray(probe.data) ? (probe.data as HitRow[]) : [];
      total = probeRows.length > 0 ? Number(probeRows[0].n_total) : 0;
    }
  }

  const hits = rows.map((row) => ({
    id: row.hit_id,
    gene: row.gene_symbol,
    direction: row.direction,
    verdict: row.verdict,
    comparison: row.comparison,
    chance_real: round(row.chance_real, 4),
    chance_interval:
      row.chance_lower === null && row.chance_upper === null
        ? null
        : [round(row.chance_lower, 4), round(row.chance_upper, 4)],
    novelty: round(row.novelty, 4),
    lfc: round(row.lfc),
    fdr: round(row.fdr, 8),
    p_value: round(row.p_value, 10),
    n_guides: row.n_guides,
    n_good_guides: row.n_good_guides,
    cn_corrected: row.cn_corrected ?? false,
    atlas: {
      hit_count: row.atlas_hit_count,
      screen_count: row.atlas_screen_count,
      hit_rate: round(row.atlas_hit_rate, 4),
    },
    model_version: row.model_version,
    reason: row.reason,
    flags: row.flags ?? [],
  }));

  const nextOffset = offset + rows.length < total ? offset + rows.length : null;

  return NextResponse.json(
    {
      organization: { id: key.org_id, slug: key.org_slug, name: key.org_name },
      screen: {
        id: screen.screen_id,
        name: screen.name,
        description: screen.description,
        cell_line: screen.cell_line,
        modality: screen.modality,
        phenotype: screen.phenotype,
        status: screen.status,
        qc: screen.qc,
        visibility: screen.visibility,
        taxid: screen.taxid,
        library: screen.library_slug
          ? { slug: screen.library_slug, name: screen.library_name }
          : null,
        run_id: screen.run_id,
        n_hits: screen.n_hits,
        n_real_hits: screen.n_real_hits,
        updated_at: screen.updated_at,
      },
      query: {
        min_chance: query.min_chance ?? null,
        max_fdr: query.max_fdr ?? null,
        direction: query.direction ?? null,
        verdict: query.verdict ?? null,
        limit,
        offset,
      },
      paging: { total, returned: hits.length, limit, offset, next_offset: nextOffset },
      hits,
    },
    { status: 200, headers: BASE_HEADERS },
  );
}

/** Preflight for a browser based agent. */
export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
