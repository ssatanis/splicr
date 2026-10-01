/**
 * Reads for the Truth Loop.
 *
 * Every query runs with the caller's own session and is scoped to the
 * organization the session resolves to, never to one named in the address, so
 * Row Level Security is the second lock and not the only one. A failed read
 * comes back as `unavailable`. It is never an empty list, because "no outcomes
 * recorded" and "the database did not answer" are different statements and only
 * one of them is good news.
 */
import "server-only";

import { getCurrentContext, listMembers } from "@/lib/data/org";
import {
  OUTCOME_PAGE_SIZE,
  OUTCOME_RESULTS,
  emptyCounts,
  isOutcomeResult,
  type OutcomeCounts,
  type OutcomeFilters,
  type OutcomeResult,
  type OutcomeRow,
} from "@/lib/outcomes/model";
import { createClient } from "@/lib/supabase/server";

export interface OutcomeScreenOption {
  id: string;
  name: string;
}

export interface OutcomeView {
  status: "ready";
  rows: OutcomeRow[];
  /** Rows matching every filter, before paging. */
  total: number;
  page: number;
  /** Counts over the screen filter only, so the tiles survive choosing a result. */
  counts: OutcomeCounts;
  screens: OutcomeScreenOption[];
  /** Whether the reader's role can log and amend outcomes (member and above). */
  canWrite: boolean;
  /** Whether the reader's role can delete one (admin and above). */
  canDelete: boolean;
  currentUserId: string;
}

export type OutcomeViewResult = OutcomeView | { status: "workspace_required" | "unavailable" };

export const OUTCOME_COLUMNS =
  "id, screen_id, gene_symbol, result, assay, effect_size, n_guides, predicted, model_version, notes, evidence_url, hit_id, logged_by, logged_at, screens(name)";

export interface OutcomeDbRow {
  id: string;
  screen_id: string;
  gene_symbol: string;
  result: string;
  assay: string | null;
  effect_size: number | string | null;
  n_guides: number | null;
  predicted: number | string | null;
  model_version: string | null;
  notes: string | null;
  evidence_url: string | null;
  hit_id: string | null;
  logged_by: string | null;
  logged_at: string;
  screens?: { name: string | null } | { name: string | null }[] | null;
}

function finite(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** A database row as the UI holds it. An unknown result is refused, not defaulted. */
export function toOutcomeRow(row: OutcomeDbRow, loggedByName: string | null = null): OutcomeRow | null {
  if (!isOutcomeResult(row.result)) return null;
  const screen = Array.isArray(row.screens) ? row.screens[0] : row.screens;
  return {
    id: row.id,
    screenId: row.screen_id,
    screenName: screen?.name ?? null,
    gene: row.gene_symbol,
    result: row.result,
    assay: row.assay,
    effectSize: finite(row.effect_size),
    nGuides: row.n_guides,
    predicted: finite(row.predicted),
    modelVersion: row.model_version,
    notes: row.notes,
    evidenceUrl: row.evidence_url,
    loggedAt: row.logged_at,
    loggedBy: loggedByName ?? row.logged_by,
    hitLinked: row.hit_id !== null,
  };
}

/** `_` is a wildcard in ILIKE and may appear in a symbol, so it is escaped. */
export function likePattern(text: string): string {
  const safe = text.replace(/[^A-Za-z0-9._@-]/g, "").replace(/_/g, "\\_");
  return `%${safe}%`;
}

export async function getOutcomeView(filters: OutcomeFilters): Promise<OutcomeViewResult> {
  const context = await getCurrentContext();
  if (!context.user || !context.org) return { status: "workspace_required" };
  const orgId = context.org.id;
  const role = context.role;

  try {
    const client = await createClient();
    const from = (filters.page - 1) * OUTCOME_PAGE_SIZE;

    let rowsQuery = client
      .from("validation_outcomes")
      .select(OUTCOME_COLUMNS, { count: "exact" })
      .eq("org_id", orgId);
    if (filters.result) rowsQuery = rowsQuery.eq("result", filters.result);
    if (filters.screen) rowsQuery = rowsQuery.eq("screen_id", filters.screen);
    if (filters.q.trim() !== "") rowsQuery = rowsQuery.ilike("gene_symbol", likePattern(filters.q));
    rowsQuery = rowsQuery
      .order("logged_at", { ascending: false })
      .order("id")
      .range(from, from + OUTCOME_PAGE_SIZE - 1);

    const countQuery = (result: OutcomeResult) => {
      let query = client
        .from("validation_outcomes")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("result", result);
      if (filters.screen) query = query.eq("screen_id", filters.screen);
      return query;
    };

    const [rowsResult, screensResult, members, ...countResults] = await Promise.all([
      rowsQuery,
      client.from("screens").select("id, name").eq("org_id", orgId).order("name").limit(500),
      listMembers(orgId),
      ...OUTCOME_RESULTS.map(countQuery),
    ]);

    if (rowsResult.error) throw rowsResult.error;
    if (screensResult.error) throw screensResult.error;
    for (const result of countResults) if (result.error) throw result.error;
    if (!Array.isArray(rowsResult.data) || rowsResult.count === null) return { status: "unavailable" };

    const names = new Map(members.map((member) => [member.id, member.name]));
    const rows: OutcomeRow[] = [];
    for (const raw of rowsResult.data as unknown as OutcomeDbRow[]) {
      const who = raw.logged_by === context.user.id ? "You" : raw.logged_by ? (names.get(raw.logged_by) ?? "A former member") : null;
      const mapped = toOutcomeRow(raw, who);
      if (mapped) rows.push(mapped);
    }

    const counts = emptyCounts();
    OUTCOME_RESULTS.forEach((result, index) => {
      const n = countResults[index].count;
      counts[result] = typeof n === "number" ? n : 0;
      counts.total += counts[result];
    });

    const canWrite = role === "member" || role === "admin" || role === "owner";
    return {
      status: "ready",
      rows,
      total: rowsResult.count,
      page: filters.page,
      counts,
      screens: ((screensResult.data ?? []) as { id: string; name: string }[]).map((s) => ({ id: s.id, name: s.name })),
      canWrite,
      canDelete: role === "admin" || role === "owner",
      currentUserId: context.user.id,
    };
  } catch (error) {
    // The code says what happened; the message can carry a private value.
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "read_error";
    console.error(`[data/outcomes] ${code}`);
    return { status: "unavailable" };
  }
}

export type OutcomeExportResult =
  | { status: "ready"; rows: OutcomeRow[]; truncated: boolean; screenName: string | null }
  | { status: "workspace_required" | "unavailable" };

/** An export is a file, not a page: it reads in chunks until it has everything or hits the cap. */
export const OUTCOME_EXPORT_CAP = 20_000;
const EXPORT_CHUNK = 1000;

export async function getOutcomeExport(filters: OutcomeFilters): Promise<OutcomeExportResult> {
  const context = await getCurrentContext();
  if (!context.user || !context.org) return { status: "workspace_required" };
  const orgId = context.org.id;

  try {
    const client = await createClient();
    const members = await listMembers(orgId);
    const names = new Map(members.map((member) => [member.id, member.name]));
    const rows: OutcomeRow[] = [];
    let truncated = false;

    for (let from = 0; ; from += EXPORT_CHUNK) {
      let query = client.from("validation_outcomes").select(OUTCOME_COLUMNS).eq("org_id", orgId);
      if (filters.result) query = query.eq("result", filters.result);
      if (filters.screen) query = query.eq("screen_id", filters.screen);
      if (filters.q.trim() !== "") query = query.ilike("gene_symbol", likePattern(filters.q));
      const chunk = await query
        .order("logged_at", { ascending: false })
        .order("id")
        .range(from, from + EXPORT_CHUNK - 1);
      if (chunk.error) throw chunk.error;
      const data = (chunk.data ?? []) as unknown as OutcomeDbRow[];
      for (const raw of data) {
        const who = raw.logged_by === context.user.id ? "You" : raw.logged_by ? (names.get(raw.logged_by) ?? "A former member") : null;
        const mapped = toOutcomeRow(raw, who);
        if (mapped) rows.push(mapped);
      }
      if (data.length < EXPORT_CHUNK) break;
      if (rows.length >= OUTCOME_EXPORT_CAP) {
        truncated = true;
        break;
      }
    }

    const screenName = rows.find((row) => row.screenId === filters.screen)?.screenName ?? null;
    return { status: "ready", rows: rows.slice(0, OUTCOME_EXPORT_CAP), truncated, screenName };
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "read_error";
    console.error(`[data/outcomes] export ${code}`);
    return { status: "unavailable" };
  }
}

/**
 * The bench result, if any, for each of a page of genes on one screen, so a hit
 * table can show "Validated" beside a gene instead of offering to log what has
 * already been logged. The newest outcome for a gene wins. A failed read is null,
 * not an empty map: no badge is shown, and none is claimed to be absent.
 */
export async function getGeneOutcomes(
  screenId: string,
  genes: readonly string[],
): Promise<Map<string, { id: string; result: OutcomeResult }> | null> {
  const context = await getCurrentContext();
  if (!context.user || !context.org || genes.length === 0) return new Map();
  try {
    const client = await createClient();
    const result = await client
      .from("validation_outcomes")
      .select("id, gene_symbol, result, logged_at")
      .eq("org_id", context.org.id)
      .eq("screen_id", screenId)
      .in("gene_symbol", [...genes])
      .order("logged_at", { ascending: false });
    if (result.error) throw result.error;
    const map = new Map<string, { id: string; result: OutcomeResult }>();
    for (const row of (result.data ?? []) as { id: string; gene_symbol: string; result: string }[]) {
      const key = row.gene_symbol.toUpperCase();
      if (!map.has(key) && isOutcomeResult(row.result)) map.set(key, { id: row.id, result: row.result });
    }
    return map;
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "read_error";
    console.error(`[data/outcomes] gene outcomes ${code}`);
    return null;
  }
}
