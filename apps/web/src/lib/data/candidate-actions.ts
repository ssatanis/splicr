"use server";

/**
 * Recording what a researcher decided about a candidate.
 *
 * The evidence snapshot is built here, on the server, from the stored hit row
 * and the run that produced it. It is never taken from the client: a decision
 * whose evidence the browser supplied could be made to say the FDR was anything
 * at all, and the whole point of the record is that it is what was known.
 *
 * Nothing is updated and nothing is deleted. Changing a decision appends
 * another, and the database has no policy that would allow otherwise.
 */

import { revalidatePath } from "next/cache";

import { geneEvidence } from "@/lib/atlas/query";
import { getAtlasGenes } from "@/lib/atlas/store";
import { CANDIDATE_STATES, type CandidateState } from "@/lib/report/candidates";
import { createClient } from "@/lib/supabase/server";

import { getCurrentContext, getOrgRole } from "./org";
import { normaliseSymbol } from "./disagreement";
import { actionFailed, ROLE_RANK, isUuid, type ActionResult } from "./types";

const REASON_LIMIT = 2000;

function isState(value: string): value is CandidateState {
  return (CANDIDATE_STATES as readonly string[]).includes(value);
}

export async function recordCandidateDecision(formData: FormData): Promise<ActionResult> {
  const screenId = String(formData.get("screenId") ?? "");
  const gene = normaliseSymbol(String(formData.get("gene") ?? ""));
  const state = String(formData.get("state") ?? "");
  const reason = String(formData.get("reason") ?? "").trim().slice(0, REASON_LIMIT);

  if (!isUuid(screenId) || gene === "") return actionFailed("That gene could not be identified.");
  if (!isState(state)) return actionFailed("That is not a decision SplicR records.");

  const context = await getCurrentContext();
  if (!context.user || !context.org) return actionFailed("Sign in to a workspace to record a decision.");
  const role = await getOrgRole(context.org.id, context.user.id);
  if (!role || ROLE_RANK[role] < ROLE_RANK.member) {
    return actionFailed("Viewers can read this workspace but cannot record decisions. Ask an administrator.");
  }

  try {
    const client = await createClient();

    // The screen is checked against the session's organization before anything
    // is written, so a decision cannot be attached to another lab's screen by
    // guessing an id, and Row Level Security refuses it a second time.
    const screen = await client.from("screens")
      .select("id, current_run_id").eq("id", screenId).eq("org_id", context.org.id).maybeSingle();
    if (screen.error) throw screen.error;
    if (!screen.data) return actionFailed("That screen is not in this workspace.");

    // The evidence, as the run recorded it. A gene with no row still gets a
    // decision: the snapshot then says the run recorded nothing for it, which
    // is itself what was known.
    const hit = await client.from("hits")
      .select("comparison_id, run_id, direction, lfc, p_value, fdr, n_guides, n_good_guides, guide_lfcs, hit_flags(flag, severity, message)")
      .eq("screen_id", screenId)
      .eq("gene_symbol", gene)
      .order("fdr", { ascending: true, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (hit.error) throw hit.error;

    const run = await client.from("runs")
      .select("id, engine_version, image_digest")
      .eq("id", hit.data?.run_id ?? screen.data.current_run_id ?? "")
      .maybeSingle();

    // The Atlas as it stood. Read from the snapshot on disk, so a failure here
    // records that it was not looked up rather than inventing a count.
    let atlas: { hits: number; tested: number; frequent_hitter: boolean } | null = null;
    try {
      const index = getAtlasGenes();
      const found = geneEvidence(index, gene);
      if (found.found) {
        atlas = {
          hits: found.hitsBackground,
          tested: found.testedBackground,
          frequent_hitter: found.frequentHitter === "above_threshold",
        };
      }
    } catch {
      atlas = null;
    }

    const evidence = {
      schema: "splicr.candidate_evidence.v1",
      recorded: hit.data !== null,
      direction: hit.data?.direction ?? null,
      lfc: hit.data?.lfc ?? null,
      p_value: hit.data?.p_value ?? null,
      fdr: hit.data?.fdr ?? null,
      n_guides: hit.data?.n_guides ?? null,
      n_good_guides: hit.data?.n_good_guides ?? null,
      guide_lfcs: hit.data?.guide_lfcs ?? null,
      flags: hit.data?.hit_flags ?? [],
      comparison_id: hit.data?.comparison_id ?? null,
      //  Null means the Atlas was not looked up or holds no such gene. It never
      //  means the gene was measured and never called; that is tested = 0.
      atlas,
      engine_version: run.data?.engine_version ?? null,
      image_digest: run.data?.image_digest ?? null,
      frozen_at: new Date().toISOString(),
    };

    const { error } = await client.from("candidate_decisions").insert({
      org_id: context.org.id,
      screen_id: screenId,
      run_id: hit.data?.run_id ?? screen.data.current_run_id ?? null,
      comparison_id: hit.data?.comparison_id ?? null,
      gene_symbol: gene,
      state,
      reason: reason === "" ? null : reason,
      evidence,
      decided_by: context.user.id,
    });
    if (error) throw error;
  } catch (error) {
    console.error(`[actions/candidate] ${error instanceof Error ? error.message : "write failed"}`);
    return actionFailed("The decision could not be recorded. Nothing was saved.");
  }

  revalidatePath(`/dashboard/screens/${screenId}`);
  return { ok: true };
}
