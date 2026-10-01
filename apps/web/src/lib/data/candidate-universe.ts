/**
 * Which genes are candidates, and what the board knows about each.
 *
 * WHAT MAKES A GENE A CANDIDATE
 *
 * One rule, stated on the page: a recorded hit of the plotted comparison whose
 * recorded FDR is at or below the threshold. That is a threshold, not a
 * judgement. A record with no recorded FDR is not a candidate and is not
 * thereby insignificant, and the board says so where the list ends.
 *
 * It is deliberately not "the genes the engine flagged", not a ranking and not
 * a score. 20,916 records are not 20,916 candidates, and the difference is a
 * line somebody drew, which is why the line is printed next to the count.
 *
 * Nothing here recomputes a statistic. The read is the same `hits` rows the
 * table shows, narrowed by the same threshold the summary counts.
 */
import "server-only";

import { geneEvidence, type GeneEvidence } from "@/lib/atlas/query";
import { getCandidateDecisions, type DecisionRecord } from "@/lib/data/candidates";
import { isUuid } from "@/lib/data/types";
import type { OutcomeResult } from "@/lib/outcomes/model";
import { guidesAgreeing } from "@/lib/report/format";
import type { Candidate } from "@/lib/report/candidates";
import { createClient } from "@/lib/supabase/server";

/** More than a screenful of candidates is a threshold problem, not a paging problem. */
export const CANDIDATE_LIMIT = 200;

export type CandidateUniverse =
  | {
      status: "found";
      candidates: Candidate[];
      /** Candidates past the cap, which the board names rather than hiding. */
      beyondCap: number;
      /** False when the decision log could not be read. Not "nobody decided". */
      decisionsKnown: boolean;
    }
  | { status: "unavailable" };

export async function getCandidates({
  screenId,
  runId,
  comparisonId,
  comparisonName,
  maxFdr,
  atlas,
  outcomes,
}: {
  screenId: string;
  runId: string;
  comparisonId: string | null;
  comparisonName: string;
  maxFdr: number;
  /** The Atlas index, or null when it could not be read. */
  atlas: ReturnType<typeof import("@/lib/atlas/store").getAtlasGenes> | null;
  outcomes: Map<string, { id: string; result: OutcomeResult }> | null;
}): Promise<CandidateUniverse> {
  if (!isUuid(screenId) || !isUuid(runId)) return { status: "unavailable" };
  try {
    const client = await createClient();
    let query = client
      .from("hits")
      .select(
        "gene_symbol, comparison_id, direction, lfc, p_value, fdr, n_guides, guide_lfcs, hit_flags(flag, severity, message)",
        { count: "exact" },
      )
      .eq("screen_id", screenId)
      .eq("run_id", runId)
      .lte("fdr", maxFdr);
    if (comparisonId !== null) query = query.eq("comparison_id", comparisonId);

    const { data, error, count } = await query
      .order("fdr", { ascending: true, nullsFirst: false })
      .order("gene_symbol")
      .limit(CANDIDATE_LIMIT);
    if (error) throw error;

    const decisions = await getCandidateDecisions(screenId);
    const current = decisions.status === "found" ? decisions.current : new Map();
    const history: Map<string, DecisionRecord[]> = decisions.status === "found" ? decisions.history : new Map();

    const candidates: Candidate[] = (data ?? []).map((row) => {
      const gene = String(row.gene_symbol);
      const key = gene.toUpperCase();
      const decision = current.get(key) ?? null;
      let evidence: GeneEvidence | null = null;
      if (atlas) {
        try {
          evidence = geneEvidence(atlas, gene);
        } catch {
          evidence = null;
        }
      }
      const lfc = row.lfc === null ? null : Number(row.lfc);
      return {
        gene,
        comparison: comparisonName,
        direction: String(row.direction),
        lfc,
        pValue: row.p_value === null ? null : Number(row.p_value),
        fdr: row.fdr === null ? null : Number(row.fdr),
        nGuides: row.n_guides === null ? null : Number(row.n_guides),
        guidesAgreeing: guidesAgreeing(row.guide_lfcs as number[] | null, lfc),
        flags: (row.hit_flags ?? []) as Candidate["flags"],
        atlas: evidence === null || !evidence.found
          ? null
          : {
              hits: evidence.hitsBackground,
              tested: evidence.testedBackground,
              frequentHitter: evidence.frequentHitter === "above_threshold",
            },
        status: decision?.status ?? "unreviewed",
        decision: decision
          ? { reason: decision.reason, at: decision.decidedAt, by: decision.decidedBy, count: decision.count }
          : null,
        history: (history.get(key) ?? []).map((entry) => ({
          id: entry.id,
          state: entry.state,
          reason: entry.reason,
          at: entry.decided_at,
          evidence: (entry.evidence ?? null) as Candidate["history"][number]["evidence"],
        })),
        outcome: outcomes?.get(key)?.result ?? null,
      };
    });

    return {
      status: "found",
      candidates,
      beyondCap: Math.max(0, (count ?? candidates.length) - candidates.length),
      decisionsKnown: decisions.status === "found",
    };
  } catch (error) {
    console.error(`[data/candidate-universe] ${error instanceof Error ? error.message : "read failed"}`);
    return { status: "unavailable" };
  }
}
