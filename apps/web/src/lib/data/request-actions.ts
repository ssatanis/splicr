"use server";

/**
 * Asking SplicR to analyse a public accession, and withdrawing the ask.
 *
 * Same contract as the rest of the workspace actions: the organization comes
 * from the session, the role is re-checked on the server, Row Level Security
 * enforces it again on the statement, nothing throws at the UI, and a demo
 * visitor is told why rather than silently ignored.
 *
 * The action records a request. It does not start an analysis, and it does not
 * pretend to: the ingest engine owns every step after this row exists, and the
 * message the caller gets back says exactly that.
 */

import { revalidatePath } from "next/cache";

import { getCurrentContext, getOrgRole } from "./org";
import { isSupportedAccession, normaliseAccession } from "./request-shape";
import { actionFailed, ROLE_RANK, type ActionResult } from "./types";

import { createClient } from "@/lib/supabase/server";

const PATH = "/dashboard/new";

export async function requestScreenAnalysis(formData: FormData): Promise<ActionResult> {
  const raw = String(formData.get("accession") ?? "");
  const accession = normaliseAccession(raw);
  if (accession === "") {
    return actionFailed("Enter a GEO, BioProject or SRA study accession.");
  }
  if (!isSupportedAccession(accession)) {
    return actionFailed(
      `${accession} is not an accession SplicR can resolve. It reads GEO series (GSE…), BioProjects (PRJNA…, PRJEB…, PRJDB…) and SRA, ENA or DDBJ studies (SRP…, ERP…, DRP…).`,
    );
  }

  const context = await getCurrentContext();
  if (!context.user || !context.org) {
    return actionFailed("Sign in to a workspace to request an analysis.");
  }
  const role = await getOrgRole(context.org.id, context.user.id);
  if (!role || ROLE_RANK[role] < ROLE_RANK.member) {
    return actionFailed("Viewers can read this workspace but cannot queue an analysis. Ask an administrator.");
  }

  try {
    const client = await createClient();
    const { error } = await client.from("screen_requests").insert({
      org_id: context.org.id,
      requested_by: context.user.id,
      accession,
    });
    if (error) {
      // A second ask while the first is live is the same ask, not an error
      // worth showing as one.
      if (error.code === "23505") {
        revalidatePath(PATH);
        return { ok: true };
      }
      throw error;
    }
  } catch (error) {
    console.error(`[actions/request] ${error instanceof Error ? error.message : "write failed"}`);
    return actionFailed("The request could not be recorded. Nothing was queued. Try again.");
  }

  revalidatePath(PATH);
  return { ok: true };
}

export async function withdrawScreenRequest(formData: FormData): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  const context = await getCurrentContext();
  if (!context.user || !context.org) return actionFailed("Sign in to a workspace.");

  try {
    const client = await createClient();
    // Only a queued request can be withdrawn, and the policy says so too: once
    // the engine has started there is nothing here to cancel.
    const { error } = await client
      .from("screen_requests")
      .delete()
      .eq("id", id)
      .eq("org_id", context.org.id)
      .eq("status", "queued");
    if (error) throw error;
  } catch (error) {
    console.error(`[actions/withdraw] ${error instanceof Error ? error.message : "delete failed"}`);
    return actionFailed("The request could not be withdrawn. It is still queued.");
  }

  revalidatePath(PATH);
  return { ok: true };
}
