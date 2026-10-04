"use server";

/**
 * Blinded rounds: create, freeze, reveal.
 *
 * The order is the whole point. A round is designed against a screen's recorded
 * hits, frozen into a content-addressed receipt before any follow-up runs, and
 * only then can outcomes be attached. Every one of those steps is refused out of
 * order, here and again by the database's own triggers, because the application
 * is not the only thing that can write to it.
 *
 * The receipt is built on the server from the stored hit rows, never from
 * anything the client sends. A commitment the browser can compose is a
 * commitment somebody can compose to say whatever they want.
 */
import { revalidatePath } from "next/cache";

import { getCurrentContext, getOrgRole } from "@/lib/data/org";
import {
  DASHBOARD_PATH,
  ROLE_LABEL,
  ROLE_RANK,
  actionFailed,
  isUuid,
  type OrgRole,
} from "@/lib/data/types";
import { createClient } from "@/lib/supabase/server";
import {
  COVERAGE_THRESHOLDS,
  MAX_BUDGET,
  MIN_BUDGET,
  QUESTIONS,
  SELECTABLE_ARMS,
  isRoundDesign,
  type RoundDesign,
} from "@/lib/validation/model";
import { endpointByKey } from "@/lib/validation/endpoint";
import { buildReceipt, ReceiptError, type ReceiptCandidate } from "@/lib/validation/receipt";

export type RoundResult =
  | { ok: true; roundId: string; note: string }
  | { ok: false; error: string };

export type FreezeResult =
  | { ok: true; sha256: string; note: string }
  | { ok: false; error: string };

const NOT_FOUND = "That round is not in this workspace.";

async function authorize(minRole: OrgRole) {
  const context = await getCurrentContext();
  if (!context.user) return actionFailed("Your session has ended. Sign in again and retry.");
  if (!context.org) return actionFailed("You are not a member of a SplicR workspace yet.");
  const role = await getOrgRole(context.org.id, context.user.id);
  if (!role) return actionFailed("You are not a member of this workspace.");
  if (ROLE_RANK[role] < ROLE_RANK[minRole]) {
    return actionFailed(
      `You need the ${ROLE_LABEL[minRole].toLowerCase()} role to do that. Your role is ${ROLE_LABEL[role].toLowerCase()}.`,
    );
  }
  return { ok: true as const, userId: context.user.id, orgId: context.org.id };
}

function failure(scope: string, error: unknown): { ok: false; error: string } {
  const record = typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  const code = typeof record.code === "string" ? record.code : "";
  console.error(`[data/round-actions] ${scope}: ${code || error}`);
  if (code === "42501" || code === "PGRST301") {
    return actionFailed("The database refused that change for your role.");
  }
  // A trigger refusal carries its own sentence, which is the one worth showing:
  // it says which rule was broken rather than that something went wrong.
  const message = typeof record.message === "string" ? record.message : "";
  if (message.includes("round ") && message.includes("cannot")) {
    return actionFailed(message.replace(/^.*?ERROR:\s*/i, ""));
  }
  return actionFailed("That round could not be saved. Try again.");
}

interface HitRow {
  gene_symbol: string;
  fdr: number | string | null;
  lfc: number | string | null;
  p_value: number | string | null;
  bayes_factor: number | string | null;
  n_guides: number | null;
  n_good_guides: number | null;
  stat_rank: number | null;
  direction: string | null;
  cn_corrected: boolean | null;
}

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * Rank candidates the way each strategy would, from the stored hits.
 *
 * Mirrors `engine/splicr/validation/baselines.py`: missing last, ties broken by
 * position, and a strategy that cannot place a candidate says so rather than
 * scoring it zero — a missing q-value treated as 0 would be the most
 * significant gene in the screen.
 */
function rank(hits: HitRow[], key: (h: HitRow) => number | null, ascending: boolean): number[] {
  return hits
    .map((hit, index) => ({ index, value: key(hit) }))
    .sort((a, b) => {
      const av = a.value === null ? Infinity : ascending ? a.value : -a.value;
      const bv = b.value === null ? Infinity : ascending ? b.value : -b.value;
      return av - bv || a.index - b.index;
    })
    .map((row) => row.index);
}

/**
 * The validation set: the union of each strategy's top k.
 *
 * An earlier version assigned a shared candidate to whichever strategy came
 * first in a precedence order, which sounded conservative and was broken. Two
 * rankings that mostly agree would hand every good candidate to the first
 * strategy and leave the second with the leftovers, so the second could not
 * look anything but worse no matter what the bench found.
 *
 * So the arms overlap, which is what
 * `research/15_PROSPECTIVE_VALIDATION_PROTOCOL.md` specifies: the validation
 * set is the union of each strategy's top k, a candidate both chose is
 * validated once and counted for both, and the comparison that carries
 * information is over the candidates only one of them chose. `wanted_by`
 * records every strategy that reached a candidate; `arm` is the one shown in a
 * table and is first-in-precedence purely for display.
 */
function buildSlots(
  hits: HitRow[],
  design: RoundDesign,
  budget: number,
  chosenArms: readonly string[],
): { gene: string; arm: string; stratum: string; rankInArm: number; rankOverall: number; wantedBy: string[] }[] {
  const byFdr = rank(hits, (h) => num(h.fdr), true);
  const byEffect = rank(
    hits,
    (h) => {
      const fdr = num(h.fdr);
      const lfc = num(h.lfc);
      if (fdr === null || lfc === null) return null;
      return -Math.log10(Math.max(fdr, 1e-300)) * Math.abs(lfc);
    },
    false,
  );
  const byMageck = rank(hits, (h) => num(h.stat_rank), true);
  const byBagel = rank(hits, (h) => num(h.bayes_factor), false);
  // SplicR has no fitted model, so its ranking is the console's evidence order:
  // significance weighted by effect, which is what the candidate board ranks by
  // today. Named honestly in the receipt as the ranking that was actually used.
  const bySplicr = byEffect;

  const overall = new Map<number, number>();
  byFdr.forEach((index, position) => overall.set(index, position + 1));

  const taken = new Set<number>();
  const slots: ReturnType<typeof buildSlots> = [];
  const wanted = new Map<number, string[]>();

  if (design === "rank_stratified") {
    // The published design: the top block, plus a block at each percentile.
    const n = bySplicr.length;
    const scale = Math.min(1, budget / 70);
    const topN = Math.max(1, Math.round(20 * scale));
    const perPct = Math.max(1, Math.round(10 * scale));
    const claim = (position: number, stratum: string) => {
      const index = bySplicr[position];
      if (index === undefined || taken.has(index) || slots.length >= budget) return;
      taken.add(index);
      slots.push({
        gene: hits[index].gene_symbol,
        arm: "splicr",
        stratum,
        rankInArm: slots.length + 1,
        rankOverall: overall.get(index) ?? position + 1,
        wantedBy: ["rank_stratified"],
      });
    };
    for (let i = 0; i < topN; i++) claim(i, `top_${topN}`);
    for (const pct of [5, 10, 25, 50, 75]) {
      const centre = Math.round((pct / 100) * (n - 1));
      const half = Math.floor(perPct / 2);
      for (let offset = Math.max(0, centre - half); offset < Math.min(n, centre - half + perPct); offset++) {
        claim(offset, `p${pct}`);
      }
    }
    for (let i = n - 1; i >= 0 && slots.length < budget; i--) claim(i, "unclaimed_ranks");
    return slots;
  }

  // Only the arms the researcher asked for, in the precedence order that
  // credits a shared candidate to the earlier arm. SplicR stays last whichever
  // subset is chosen, so a lift it measures is always conservative.
  const available: [string, number[]][] = [
    ["investigator", byMageck],
    ["fdr", byFdr],
    ["random", byBagel],
    ["splicr", bySplicr],
  ];
  const arms = available.filter(([name]) => chosenArms.includes(name));
  if (arms.length === 0) return [];
  const share = Math.max(1, Math.floor(budget / arms.length));
  for (const [name, order] of arms) {
    for (const index of order.slice(0, share)) {
      wanted.set(index, [...(wanted.get(index) ?? []), name]);
    }
  }
  // The union, in precedence order so a shared candidate's displayed arm is
  // stable. `budget` is the number of distinct validations the lab agreed to,
  // and overlap buys depth: if two strategies agree on three candidates, the
  // same budget reaches further down each list.
  const perArm = new Map<string, number>();
  const push = (index: number, name: string) => {
    taken.add(index);
    perArm.set(name, (perArm.get(name) ?? 0) + 1);
    slots.push({
      gene: hits[index].gene_symbol,
      arm: name,
      stratum: name,
      rankInArm: perArm.get(name) ?? 1,
      rankOverall: overall.get(index) ?? 0,
      wantedBy: wanted.get(index) ?? [name],
    });
  };
  for (const [name, order] of arms) {
    for (const index of order.slice(0, share)) {
      if (slots.length >= budget) break;
      if (taken.has(index)) continue;
      push(index, name);
    }
  }
  // Overlap left room. Deepen every arm together rather than filling one, so
  // the arms stay the same size and their rates stay comparable.
  let depth = share;
  while (slots.length < budget && depth < hits.length) {
    depth = Math.min(hits.length, depth + share);
    let progressed = false;
    for (const [name, order] of arms) {
      for (const index of order.slice(0, depth)) {
        if (slots.length >= budget) break;
        if (taken.has(index)) continue;
        // Deepening extends what this arm wanted, so the record follows.
        wanted.set(index, [...(wanted.get(index) ?? []), name]);
        push(index, name);
        progressed = true;
        break;
      }
      if (slots.length >= budget) break;
    }
    if (!progressed) break;
  }
  return slots;
}

export async function createRound(input: {
  screenId: string;
  name: string;
  design: string;
  budget: string;
  endpointKey: string;
  laboratoryThreshold: string;
  /** Which selection strategies to draw from. Ignored by the rank-stratified design. */
  arms?: string[];
}): Promise<RoundResult> {
  const auth = await authorize("member");
  if (!("ok" in auth) || !auth.ok) return auth as { ok: false; error: string };
  const { orgId, userId } = auth;

  const name = input.name.trim().slice(0, 120) || "Validation round";
  if (!isUuid(input.screenId)) return actionFailed("Choose a screen from this workspace.");
  const design: RoundDesign = isRoundDesign(input.design) ? input.design : "stratified_arms";
  const budget = Number(input.budget);
  if (!Number.isInteger(budget) || budget < MIN_BUDGET || budget > MAX_BUDGET) {
    return actionFailed(
      `A validation budget is a whole number from ${MIN_BUDGET} to ${MAX_BUDGET}.`,
    );
  }
  const arms = (input.arms ?? [...SELECTABLE_ARMS]).filter((arm) =>
    (SELECTABLE_ARMS as readonly string[]).includes(arm),
  );
  if (design === "stratified_arms") {
    if (arms.length < 2) {
      return actionFailed(
        "Pick at least two strategies to compare. One strategy on its own measures nothing against anything.",
      );
    }
    if (budget < arms.length * 2) {
      return actionFailed(
        `A budget of ${budget} across ${arms.length} strategies leaves fewer than two candidates each, which cannot carry a comparison.`,
      );
    }
  }
  const endpoint = endpointByKey(input.endpointKey);
  if (!endpoint) return actionFailed("Choose the endpoint this round will be scored against.");
  const threshold = input.laboratoryThreshold.trim() === "" ? null : Number(input.laboratoryThreshold);
  if (endpoint.threshold_owner === "laboratory") {
    if (threshold === null || !Number.isFinite(threshold) || threshold <= 0) {
      return actionFailed(
        "This endpoint's effect threshold belongs to your assay. Agree it now, before any outcome exists.",
      );
    }
  }

  try {
    const client = await createClient();
    const screenResult = await client
      .from("screens")
      .select("id, name, current_run_id")
      .eq("id", input.screenId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (screenResult.error) return failure("screen", screenResult.error);
    const screen = screenResult.data as { id: string; name: string; current_run_id: string | null } | null;
    if (!screen) return actionFailed("That screen is not in this workspace.");
    if (!screen.current_run_id) {
      return actionFailed("That screen has no completed run, so there are no candidates to draw from.");
    }

    const hitsResult = await client
      .from("hits")
      .select(
        "gene_symbol, fdr, lfc, p_value, bayes_factor, n_guides, n_good_guides, stat_rank, direction, cn_corrected, comparison_id",
      )
      .eq("screen_id", screen.id)
      .eq("run_id", screen.current_run_id)
      .order("fdr", { ascending: true, nullsFirst: false })
      .limit(1000);
    if (hitsResult.error) return failure("hits", hitsResult.error);
    const hits = (hitsResult.data ?? []) as unknown as (HitRow & { comparison_id: string })[];
    if (hits.length < budget) {
      return actionFailed(
        `That screen has ${hits.length} recorded candidate(s), fewer than the budget of ${budget}.`,
      );
    }

    const slots = buildSlots(hits, design, budget, arms);
    if (slots.length === 0) return actionFailed("No candidate could be drawn for this design.");

    const insert = await client
      .from("validation_rounds")
      .insert({
        org_id: orgId,
        screen_id: screen.id,
        run_id: screen.current_run_id,
        comparison_id: hits[0].comparison_id ?? null,
        name,
        design,
        budget,
        endpoint_id: endpoint.endpoint_id,
        endpoint_version: endpoint.version,
        laboratory_threshold: threshold,
        created_by: userId,
      })
      .select("id")
      .single();
    if (insert.error) return failure("insert round", insert.error);
    const roundId = (insert.data as { id: string }).id;

    const slotRows = slots.map((slot) => ({
      round_id: roundId,
      org_id: orgId,
      gene_symbol: slot.gene,
      arm: slot.arm,
      stratum: slot.stratum,
      rank_in_arm: slot.rankInArm,
      rank_overall: slot.rankOverall,
      //  Every strategy that reached this candidate, not just the one it is
      //  displayed under. The results page scores over this, so a candidate two
      //  strategies both picked counts for both. Losing it would make the
      //  overlapping design behave like the first-come-first-served one it
      //  replaced, where the second strategy could only ever get leftovers.
      wanted_by: [...new Set(slot.wantedBy)],
      // The evidence as it stood, written server side from the stored hit row.
      evidence: (() => {
        const hit = hits.find((h) => h.gene_symbol === slot.gene);
        return hit
          ? {
              hit: {
                lfc: num(hit.lfc),
                fdr: num(hit.fdr),
                p_value: num(hit.p_value),
                bayes_factor: num(hit.bayes_factor),
                n_guides: hit.n_guides,
                n_good_guides: hit.n_good_guides,
                stat_rank: hit.stat_rank,
                direction: hit.direction,
                cn_corrected: hit.cn_corrected,
              },
            }
          : {};
      })(),
    }));
    const slotInsert = await client.from("validation_slots").insert(slotRows);
    if (slotInsert.error) return failure("insert slots", slotInsert.error);

    revalidatePath(DASHBOARD_PATH, "layout");
    const overlap = slots.filter((s) => s.wantedBy.length > 1).length;
    return {
      ok: true,
      roundId,
      note:
        design === "rank_stratified"
          ? `${slots.length} candidates drawn by rank, from the top block and five percentile blocks.`
          : `${slots.length} distinct candidates across ${arms.length} strategies. ${overlap} were wanted by more than one and were credited to the earlier one.`,
    };
  } catch (error) {
    return failure("createRound", error);
  }
}

/**
 * Freeze a round: write the receipt, then record its hash.
 *
 * The receipt holds the whole candidate universe, not just the picks, so a
 * later analysis cannot choose which non-picks to count as negatives. It is
 * assembled here from the stored rows and hashed with the same canonical bytes
 * the engine uses, so the engine can verify a receipt the console wrote.
 */
export async function freezeRound(roundId: string): Promise<FreezeResult> {
  const auth = await authorize("member");
  if (!("ok" in auth) || !auth.ok) return auth as { ok: false; error: string };
  const { orgId, userId } = auth;
  if (!isUuid(roundId)) return actionFailed(NOT_FOUND);

  try {
    const client = await createClient();
    const roundResult = await client
      .from("validation_rounds")
      .select(
        "id, name, state, screen_id, run_id, comparison_id, design, budget, endpoint_id, endpoint_version, laboratory_threshold, blind_seed, screens(name)",
      )
      .eq("id", roundId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (roundResult.error) return failure("round", roundResult.error);
    const round = roundResult.data as Record<string, unknown> | null;
    if (!round) return actionFailed(NOT_FOUND);
    if (round.state !== "draft") {
      return actionFailed(
        `This round is already ${round.state}. A frozen round is frozen; a changed design is a new round.`,
      );
    }

    const [slotsResult, hitsResult] = await Promise.all([
      client
        .from("validation_slots")
        .select("gene_symbol, arm, stratum, rank_in_arm, rank_overall, evidence")
        .eq("round_id", roundId)
        .order("rank_in_arm"),
      client
        .from("hits")
        .select("gene_symbol, fdr, lfc, p_value, bayes_factor, n_guides, n_good_guides, stat_rank, direction, cn_corrected")
        .eq("screen_id", round.screen_id as string)
        .eq("run_id", round.run_id as string)
        .order("fdr", { ascending: true, nullsFirst: false })
        .limit(1000),
    ]);
    if (slotsResult.error) return failure("slots", slotsResult.error);
    if (hitsResult.error) return failure("hits", hitsResult.error);
    const slots = (slotsResult.data ?? []) as Record<string, unknown>[];
    const hits = (hitsResult.data ?? []) as unknown as HitRow[];
    if (slots.length === 0) {
      return actionFailed("This round has no candidates selected, so there is nothing to commit to.");
    }

    // The whole universe, in the ranking order the design used.
    const candidates: ReceiptCandidate[] = hits.map((hit, index) => ({
      gene: hit.gene_symbol,
      rank: index + 1,
      score: num(hit.fdr) === null ? null : -Math.log10(Math.max(num(hit.fdr) as number, 1e-300)),
      probability: null,
      question: null,
      evidence: {
        lfc: num(hit.lfc),
        fdr: num(hit.fdr),
        p_value: num(hit.p_value),
        bayes_factor: num(hit.bayes_factor),
        n_guides: hit.n_guides,
        n_good_guides: hit.n_good_guides,
        stat_rank: hit.stat_rank,
        direction: hit.direction,
        cn_corrected: hit.cn_corrected,
      },
    }));

    const screen = Array.isArray(round.screens) ? round.screens[0] : round.screens;
    const endpointKey = `${round.endpoint_id}.v${round.endpoint_version}`;
    const built = buildReceipt({
      roundId,
      createdUtc: new Date().toISOString().replace("Z", "+00:00"),
      screen: {
        screen_id: round.screen_id,
        screen_name: (screen as { name: string | null } | null)?.name ?? null,
        run_id: round.run_id,
        comparison_id: round.comparison_id ?? null,
        n_candidates: candidates.length,
      },
      candidates,
      validationSet: {
        design: round.design,
        budget: round.budget,
        n_slots: slots.length,
        slots: slots.map((slot) => ({
          gene: slot.gene_symbol,
          arm: slot.arm,
          stratum: slot.stratum,
          rank_in_arm: slot.rank_in_arm,
          rank_overall: slot.rank_overall,
        })),
      },
      rankings: {
        splicr: {
          name: "splicr",
          ordered_on: "-log10(fdr) * |lfc|",
          note: "No validation model is fitted, so this is the console's evidence order, not a calibrated ranking.",
        },
        fdr: { name: "fdr", ordered_on: "hits.fdr" },
      },
      model: {
        fitted: false,
        note: "No validation head is fitted for any question; this round freezes a ranking, not a probability.",
      },
      calibration: null,
      coverage: {
        available: false,
        reason: "network_not_calibrated",
        thresholds: {
          min_stratum_outcomes: COVERAGE_THRESHOLDS.minStratumOutcomes,
          min_stratum_labs: COVERAGE_THRESHOLDS.minStratumLabs,
          min_stratum_screens: COVERAGE_THRESHOLDS.minStratumScreens,
          min_network_outcomes: COVERAGE_THRESHOLDS.minNetworkOutcomes,
          min_network_labs: COVERAGE_THRESHOLDS.minNetworkLabs,
        },
        questions: [...QUESTIONS],
      },
      endpoint: endpointKey,
      laboratoryThreshold: num(round.laboratory_threshold),
      provenance: {
        written_by: "console",
        schema: "splicr.validation-network.v1",
      },
    });

    const receiptInsert = await client.from("prediction_receipts").insert({
      org_id: orgId,
      round_id: roundId,
      sha256: built.sha256,
      payload: built.payload,
      n_candidates: candidates.length,
      n_selected: slots.length,
      engine_schema: "splicr.validation-network.v1",
      feature_spec_sha256: "0".repeat(64),
      endpoint_registry_sha256: "0".repeat(64),
      created_by: userId,
    });
    if (receiptInsert.error) return failure("receipt", receiptInsert.error);

    const update = await client
      .from("validation_rounds")
      .update({
        state: "frozen",
        receipt_sha256: built.sha256,
        frozen_at: new Date().toISOString(),
        frozen_by: userId,
      })
      .eq("id", roundId)
      .eq("org_id", orgId);
    if (update.error) return failure("freeze", update.error);

    revalidatePath(DASHBOARD_PATH, "layout");
    return {
      ok: true,
      sha256: built.sha256,
      note: `${candidates.length} candidates and ${slots.length} selections committed. Give this hash to somebody outside the project.`,
    };
  } catch (error) {
    if (error instanceof ReceiptError) return actionFailed(error.message);
    return failure("freezeRound", error);
  }
}

/** Mark a round revealed. Outcomes are attached through the Truth Loop. */
export async function revealRound(roundId: string): Promise<RoundResult> {
  const auth = await authorize("member");
  if (!("ok" in auth) || !auth.ok) return auth as { ok: false; error: string };
  if (!isUuid(roundId)) return actionFailed(NOT_FOUND);
  try {
    const client = await createClient();
    const update = await client
      .from("validation_rounds")
      .update({
        state: "revealed",
        revealed_at: new Date().toISOString(),
        revealed_by: auth.userId,
      })
      .eq("id", roundId)
      .eq("org_id", auth.orgId)
      .eq("state", "frozen")
      .select("id")
      .maybeSingle();
    if (update.error) return failure("reveal", update.error);
    if (!update.data) {
      return actionFailed(
        "Only a frozen round can be revealed. A round that was never frozen committed to nothing.",
      );
    }
    revalidatePath(DASHBOARD_PATH, "layout");
    return { ok: true, roundId, note: "Outcomes recorded for these genes now count against the frozen prediction." };
  } catch (error) {
    return failure("revealRound", error);
  }
}
