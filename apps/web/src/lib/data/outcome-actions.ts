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
  DEMO_REFUSAL,
  ROLE_LABEL,
  ROLE_RANK,
  actionFailed,
  isUuid,
  type OrgRole,
} from "@/lib/data/types";
import type { OutcomeRow } from "@/lib/outcomes/model";
import {
  parseOutcomeDraft,
  type OutcomeDraft,
  type OutcomeFormField,
} from "@/lib/outcomes/schema";
import { createClient } from "@/lib/supabase/server";

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
  if (context.isDemo) return actionFailed(DEMO_REFUSAL);
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

    const insert = await client
      .from("validation_outcomes")
      .insert({
        org_id: orgId,
        screen_id: screen.id,
        hit_id: hit?.id ?? null,
        gene_symbol: hit?.gene_symbol ?? value.gene,
        predicted: hit?.chance_real ?? null,
        model_version: hit?.model_version ?? null,
        result: value.result,
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
      note: hit
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
