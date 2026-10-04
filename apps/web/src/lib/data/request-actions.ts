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

import { kickPublicIngestQueue } from "@/lib/ingest/modal";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const PATH = "/dashboard/new";
const PICKUP_WAIT_MS = 12_000;
const PICKUP_POLL_MS = 1_500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function annotateQueuedRequest(id: string, detail: string) {
  const admin = createAdminClient();
  if (!admin) return;
  const { error } = await admin
    .from("screen_requests")
    .update({ detail })
    .eq("id", id)
    .eq("status", "queued");
  if (error) {
    console.error(`[actions/request] could not annotate queued request ${id}: ${error.message}`);
  }
}

async function waitForRequestPickup(client: Awaited<ReturnType<typeof createClient>>, id: string): Promise<boolean> {
  for (let waited = 0; waited < PICKUP_WAIT_MS; waited += PICKUP_POLL_MS) {
    await sleep(PICKUP_POLL_MS);
    const { data, error } = await client
      .from("screen_requests")
      .select("status")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      console.error(`[actions/request] could not check request ${id}: ${error.message}`);
      return false;
    }
    if (data?.status && data.status !== "queued") return true;
  }
  return false;
}

async function startIngestForRequest(
  client: Awaited<ReturnType<typeof createClient>>,
  requestId: string,
  accession: string,
) {
  try {
    const kick = await kickPublicIngestQueue();
    if (!kick.started) {
      await annotateQueuedRequest(
        requestId,
        kick.reason === "not_configured"
          ? "Recorded, but this deployment is missing Modal credentials, so the ingest engine cannot be started from the console."
          : "Recorded. Automatic ingest start is disabled for this deployment.",
      );
      return;
    }
    const pickedUp = await waitForRequestPickup(client, requestId);
    if (!pickedUp) {
      await annotateQueuedRequest(
        requestId,
        "The ingest engine was started, but it has not reported its first status yet. It will keep trying from the scheduled sweep.",
      );
    }
  } catch (kickError) {
    console.error(
      `[actions/request] queued ${accession}, but could not start the ingest sweep: ${
        kickError instanceof Error ? kickError.message : "kick failed"
      }`,
    );
    await annotateQueuedRequest(
      requestId,
      "Recorded, but the console could not start the ingest engine. The scheduled sweep can still pick this up.",
    );
  }
}

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
    const { data, error } = await client
      .from("screen_requests")
      .insert({
        org_id: context.org.id,
        requested_by: context.user.id,
        accession,
      })
      .select("id")
      .single();
    if (error) {
      // A second ask while the first is live is the same ask, not an error
      // worth showing as one. It still kicks the engine, because a queued row
      // may be the thing the researcher is trying to unstick.
      if (error.code === "23505") {
        const existing = await client
          .from("screen_requests")
          .select("id")
          .eq("org_id", context.org.id)
          .eq("accession", accession)
          .eq("status", "queued")
          .maybeSingle();
        if (existing.data?.id) {
          await startIngestForRequest(client, existing.data.id, accession);
        }
        revalidatePath(PATH);
        return { ok: true };
      }
      throw error;
    }
    await startIngestForRequest(client, data.id, accession);
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
