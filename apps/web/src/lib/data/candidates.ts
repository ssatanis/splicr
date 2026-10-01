/**
 * The candidates of a screen, and whatever the lab has decided about them.
 *
 * A candidate is a recorded hit at or below the page's significance threshold.
 * That is a threshold, not a judgement: the console says which one it used, and
 * a record with no recorded FDR is not counted and is not called insignificant.
 *
 * Reads go through the request-scoped Supabase client, so Row Level Security
 * decides what comes back, and the organization comes from the session.
 */
import "server-only";

import { getCurrentContext } from "@/lib/data/org";
import { isUuid } from "@/lib/data/types";
import type { CandidateStatus } from "@/lib/report/candidates";
import { createClient } from "@/lib/supabase/server";

/** The decision log for one gene, newest first. */
export interface DecisionRecord {
  id: string;
  state: string;
  reason: string | null;
  decided_at: string;
  decided_by: string | null;
  evidence: Record<string, unknown>;
}

export interface CurrentDecision {
  gene: string;
  status: CandidateStatus;
  reason: string | null;
  decidedAt: string;
  decidedBy: string | null;
  count: number;
}

export type DecisionsResult =
  | {
      status: "found";
      current: Map<string, CurrentDecision>;
      /** Every decision ever recorded for this screen, newest first, by gene. */
      history: Map<string, DecisionRecord[]>;
    }
  /** The decisions could not be read. Not the same as no decisions. */
  | { status: "unavailable" };

/** A screen's decision log is small; a cap only stops a pathological one. */
const HISTORY_LIMIT = 500;

/** What this workspace has decided about the genes of one screen. */
export async function getCandidateDecisions(screenId: string): Promise<DecisionsResult> {
  if (!isUuid(screenId)) return { status: "unavailable" };
  const context = await getCurrentContext();
  if (!context.user || !context.org) return { status: "found", current: new Map(), history: new Map() };
  try {
    const client = await createClient();
    // One read of the log, rather than the view plus a query per gene. The
    // current state is the newest row, which is what the view computes too.
    const { data, error } = await client
      .from("candidate_decisions")
      .select("id, gene_symbol, state, reason, decided_at, decided_by, evidence")
      .eq("screen_id", screenId)
      .order("decided_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(HISTORY_LIMIT);
    if (error) throw error;

    const current = new Map<string, CurrentDecision>();
    const history = new Map<string, DecisionRecord[]>();
    for (const row of data ?? []) {
      const key = String(row.gene_symbol).toUpperCase();
      const record: DecisionRecord = {
        id: String(row.id),
        state: String(row.state),
        reason: (row.reason as string | null) ?? null,
        decided_at: String(row.decided_at),
        decided_by: (row.decided_by as string | null) ?? null,
        evidence: (row.evidence ?? {}) as Record<string, unknown>,
      };
      const trail = history.get(key);
      if (trail) trail.push(record);
      else history.set(key, [record]);
      // The first row seen for a gene is its newest, because of the order above.
      if (!current.has(key)) {
        current.set(key, {
          gene: String(row.gene_symbol),
          status: record.state as CandidateStatus,
          reason: record.reason,
          decidedAt: record.decided_at,
          decidedBy: record.decided_by,
          count: 1,
        });
      } else {
        const held = current.get(key) as CurrentDecision;
        held.count += 1;
      }
    }
    return { status: "found", current, history };
  } catch (error) {
    console.error(`[data/candidates] ${error instanceof Error ? error.message : "read failed"}`);
    return { status: "unavailable" };
  }
}

export type HistoryResult =
  | { status: "found"; decisions: DecisionRecord[] }
  | { status: "unavailable" };

/** Every decision ever recorded for one gene of one screen, newest first. */
export async function getDecisionHistory(screenId: string, gene: string): Promise<HistoryResult> {
  if (!isUuid(screenId)) return { status: "unavailable" };
  const context = await getCurrentContext();
  if (!context.user || !context.org) return { status: "found", decisions: [] };
  try {
    const client = await createClient();
    const { data, error } = await client
      .from("candidate_decisions")
      .select("id, state, reason, decided_at, decided_by, evidence")
      .eq("screen_id", screenId)
      .eq("gene_symbol", gene.toUpperCase())
      .order("decided_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return { status: "found", decisions: (data ?? []) as unknown as DecisionRecord[] };
  } catch (error) {
    console.error(`[data/candidates] history: ${error instanceof Error ? error.message : "read failed"}`);
    return { status: "unavailable" };
  }
}
