"use server";

/**
 * Server Actions for recording bench outcomes.
 *
 * The same contract as every other action in this workspace (see actions.ts):
 *
 *  - The caller's role is read back from the database inside the action and
 *    checked here, and Row Level Security checks it again on the statement, so a
 *    forged POST straight at the action id still cannot write another
 *    organization's rows. Logging and amending need member; deleting needs admin,
 *    which is what the policies say.
 *  - The organization comes from the session, never from the request.
 *  - The screen must belong to that organization. A screen id from somewhere else
 *    is refused as "not in this workspace", which is also what a mistyped one gets.
 *  - Input is validated by the shared schema before it reaches the database.
 *  - Nothing throws at the form. Every path returns `{ ok: true }` or a message,
 *    with per-field messages where the form can show them.
 *
 * What recording an outcome does NOT do: change any score. There is no model
 * retraining anywhere in this repository, and this action does not pretend
 * otherwise. The outcome is stored beside the model output that was recorded
 * when the gene was called, so the two can be compared, and that is all.
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
import type { OutcomeRow } from "@/lib/outcomes/model";
import {
  measurementFromValues,
  parseOutcomeDraft,
  type OutcomeDraft,
  type OutcomeFormField,
  type OutcomeFormValues,
} from "@/lib/outcomes/schema";
import { createClient } from "@/lib/supabase/server";
import { decideEndpoint, defaultEndpoint } from "@/lib/validation/endpoint";

import { OUTCOME_COLUMNS, likePattern, toOutcomeRow, type OutcomeDbRow } from "./outcomes";

export type OutcomeActionResult =
  | { ok: true; outcome: OutcomeRow; note: string | null }
  | { ok: false; error: string; fieldErrors?: Partial<Record<OutcomeFormField, string>> };

export type OutcomeDeleteResult = { ok: true } | { ok: false; error: string };

const SESSION_ENDED = "Your session has ended. Sign in again and retry.";
const NO_WORKSPACE = "You are not a member of a SplicR workspace yet.";
const NOT_A_MEMBER = "You are no longer a member of this workspace.";
const NOT_FOUND = "That outcome is not in this workspace, or your role cannot change it.";

interface Caller {
  userId: string;
  orgId: string;
  role: OrgRole;
}

async function authorize(minRole: OrgRole): Promise<{ ok: true; caller: Caller } | { ok: false; error: string }> {
  const context = await getCurrentContext();
  if (!context.user) return actionFailed(SESSION_ENDED);
  if (!context.org) return actionFailed(NO_WORKSPACE);
  const role = await getOrgRole(context.org.id, context.user.id);
  if (!role) return actionFailed(NOT_A_MEMBER);
  if (ROLE_RANK[role] < ROLE_RANK[minRole]) {
    return actionFailed(
      `You need the ${ROLE_LABEL[minRole].toLowerCase()} role to do that. Your role is ${ROLE_LABEL[role].toLowerCase()}.`,
    );
  }
  return { ok: true, caller: { userId: context.user.id, orgId: context.org.id, role } };
}

function failure(scope: string, error: unknown): { ok: false; error: string } {
  const record = typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  const code = typeof record.code === "string" ? record.code : "";
  console.error(`[data/outcome-actions] ${scope}: ${code}`);
  if (code === "42501" || code === "PGRST301") return actionFailed("The database refused that change for your role.");
  if (code === "23514") return actionFailed("One of those values is out of range.");
  return actionFailed("The outcome could not be saved. Try again.");
}

function refresh(): void {
  revalidatePath(DASHBOARD_PATH, "layout");
}

interface HitRow {
  id: string;
  gene_symbol: string;
  chance_real: number | string | null;
  model_version: string | null;
}

/**
 * The validation fields an insert or an update writes, scored on the server.
 *
 * The endpoint decision is computed here and not taken from the client, for the
 * same reason `candidate_decisions.evidence` is written server side: a verdict
 * the browser can set is a verdict somebody can set to whatever they want. The
 * scorer is the one the engine's own decision matrix pins
 * (apps/web/tests/endpoint-decisions.test.mjs), so the server's verdict and the
 * engine's agree by construction.
 *
 * The decision never overwrites `result`. Where the lab's label and the
 * measurement disagree, both are stored and the Truth Loop shows the
 * disagreement, because a console that silently corrected a scientist's own
 * label would be asserting something nobody measured.
 */
function validationFields(value: OutcomeFormValues) {
  const measurement = measurementFromValues(value);
  const endpoint = defaultEndpoint(value.validationType);
  const decision = endpoint
    ? decideEndpoint(endpoint, { ...measurement, result: value.result }, {
        // The laboratory's own bar is agreed at round creation. Outside a round
        // there is none, so an endpoint whose threshold belongs to the lab
        // returns `insufficient_record` and says which criterion is missing -
        // which is the correct state for an outcome logged without a
        // prespecified bar.
        laboratoryThreshold: null,
      })
    : null;
  return {
    validation_type: value.validationType,
    endpoint_id: endpoint?.endpoint_id ?? null,
    endpoint_version: endpoint?.version ?? null,
    measurement,
    lab_id: value.labId,
    endpoint_decision: decision?.decision ?? null,
    decision_because: decision?.because ?? null,
    //  Deliberately not here: round_id and arm. Which round an outcome belongs
    //  to was fixed when that round was frozen, and an edit to what the assay
    //  found must not move it to a different prediction.
  };
}

/**
 * The round and arm this outcome belongs to, if the gene is in a frozen one.
 *
 * A researcher recording a result does not know, and should not have to know,
 * which round a gene came from. The round froze that list; the outcome attaches
 * itself. Without this the round's results page sees nothing and a prospective
 * design collects nothing, which is the whole point of having drawn the set.
 *
 * Only a frozen or revealed round claims an outcome. A draft has committed to
 * nothing, so an outcome recorded while it is still being edited belongs to no
 * round. Where two rounds on one screen both drew the gene, the most recently
 * frozen one takes it, because that is the prediction still being tested.
 */
async function roundForGene(
  client: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  screenId: string,
  gene: string,
): Promise<{ roundId: string; arm: string } | null> {
  try {
    const rounds = await client
      .from("validation_rounds")
      .select("id, frozen_at")
      .eq("org_id", orgId)
      .eq("screen_id", screenId)
      .in("state", ["frozen", "revealed"])
      .order("frozen_at", { ascending: false })
      .limit(20);
    if (rounds.error || !rounds.data?.length) return null;
    const ids = (rounds.data as { id: string }[]).map((r) => r.id);
    const slots = await client
      .from("validation_slots")
      .select("round_id, arm, gene_symbol")
      .in("round_id", ids)
      .ilike("gene_symbol", likePattern(gene).slice(1, -1));
    if (slots.error || !slots.data?.length) return null;
    const order = new Map(ids.map((id, index) => [id, index]));
    const best = (slots.data as { round_id: string; arm: string }[])
      .slice()
      .sort((a, b) => (order.get(a.round_id) ?? 99) - (order.get(b.round_id) ?? 99))[0];
    return { roundId: best.round_id, arm: best.arm };
  } catch (error) {
    // A failure here costs the outcome its round, not the outcome itself.
    console.error("[data/outcome-actions] round lookup failed", error);
    return null;
  }
}

export async function logOutcome(draft: OutcomeDraft): Promise<OutcomeActionResult> {
  const auth = await authorize("member");
  if (!auth.ok) return auth;
  const { orgId, userId } = auth.caller;

  const parsed = parseOutcomeDraft(draft);
  if (!parsed.ok) return { ok: false, error: "Some fields need attention.", fieldErrors: parsed.errors };
  const value = parsed.value;
  if (!isUuid(value.screenId)) {
    return { ok: false, error: "Some fields need attention.", fieldErrors: { screenId: "That screen is not in this workspace." } };
  }

  try {
    const client = await createClient();

    const screenResult = await client
      .from("screens")
      .select("id, name, current_run_id")
      .eq("id", value.screenId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (screenResult.error) return failure("screen", screenResult.error);
    const screen = screenResult.data as { id: string; name: string; current_run_id: string | null } | null;
    if (!screen) {
      return { ok: false, error: "Some fields need attention.", fieldErrors: { screenId: "That screen is not in this workspace." } };
    }

    // Tie the outcome to the hit recorded for this gene in the screen's current
    // run, so the score stored at the time of the call travels with the result.
    // No recorded hit is a normal case (a gene picked from the literature), and
    // the outcome is saved without a link and says so.
    let hit: HitRow | null = null;
    if (screen.current_run_id) {
      const hitResult = await client
        .from("hits")
        .select("id, gene_symbol, chance_real, model_version")
        .eq("screen_id", screen.id)
        .eq("run_id", screen.current_run_id)
        .ilike("gene_symbol", likePattern(value.gene).slice(1, -1))
        .order("fdr", { ascending: true, nullsFirst: false })
        .limit(1);
      if (hitResult.error) return failure("hit", hitResult.error);
      hit = ((hitResult.data ?? []) as HitRow[])[0] ?? null;
    }

    const round = await roundForGene(client, orgId, screen.id, value.gene);

    const insert = await client
      .from("validation_outcomes")
      .insert({
        org_id: orgId,
        screen_id: screen.id,
        hit_id: hit?.id ?? null,
        gene_symbol: hit?.gene_symbol ?? value.gene,
        round_id: round?.roundId ?? null,
        arm: round?.arm ?? "unassigned",
        predicted: hit?.chance_real ?? null,
        model_version: hit?.model_version ?? null,
        result: value.result,
        ...validationFields(value),
        assay: value.assay,
        n_guides: value.nGuides,
        effect_size: value.effectSize,
        notes: value.notes,
        evidence_url: value.evidenceUrl,
        logged_by: userId,
      })
      .select(OUTCOME_COLUMNS)
      .single();
    if (insert.error) return failure("insert", insert.error);

    const outcome = toOutcomeRow(insert.data as unknown as OutcomeDbRow, "You");
    if (!outcome) return actionFailed("The outcome was saved but could not be read back. Reload the page.");
    refresh();
    return {
      ok: true,
      outcome: { ...outcome, screenName: outcome.screenName ?? screen.name },
      note: round
        ? "Counted towards a frozen validation round for this screen."
        : hit
          ? "Linked to the hit recorded for this gene in the screen's current run."
          : "Saved without a link: this screen's current run has no recorded hit for that gene.",
    };
  } catch (error) {
    return failure("logOutcome", error);
  }
}

export async function updateOutcome(id: string, draft: OutcomeDraft): Promise<OutcomeActionResult> {
  const auth = await authorize("member");
  if (!auth.ok) return auth;
  if (!isUuid(id)) return actionFailed(NOT_FOUND);

  const parsed = parseOutcomeDraft(draft);
  if (!parsed.ok) return { ok: false, error: "Some fields need attention.", fieldErrors: parsed.errors };
  const value = parsed.value;

  try {
    const client = await createClient();
    // Screen and gene identify the record, so an edit changes what was found,
    // not what it was found about.
    const update = await client
      .from("validation_outcomes")
      .update({
        result: value.result,
        ...validationFields(value),
        assay: value.assay,
        n_guides: value.nGuides,
        effect_size: value.effectSize,
        notes: value.notes,
        evidence_url: value.evidenceUrl,
      })
      .eq("id", id)
      .eq("org_id", auth.caller.orgId)
      .select(OUTCOME_COLUMNS)
      .maybeSingle();
    if (update.error) return failure("update", update.error);
    if (!update.data) return actionFailed(NOT_FOUND);
    const outcome = toOutcomeRow(update.data as unknown as OutcomeDbRow);
    if (!outcome) return actionFailed("The outcome was saved but could not be read back. Reload the page.");
    refresh();
    return { ok: true, outcome, note: null };
  } catch (error) {
    return failure("updateOutcome", error);
  }
}

export async function deleteOutcome(id: string): Promise<OutcomeDeleteResult> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;
  if (!isUuid(id)) return actionFailed(NOT_FOUND);

  try {
    const client = await createClient();
    const removed = await client
      .from("validation_outcomes")
      .delete()
      .eq("id", id)
      .eq("org_id", auth.caller.orgId)
      .select("id");
    if (removed.error) return failure("delete", removed.error);
    if (!Array.isArray(removed.data) || removed.data.length === 0) return actionFailed(NOT_FOUND);
    refresh();
    return { ok: true };
  } catch (error) {
    return failure("deleteOutcome", error);
  }
}
