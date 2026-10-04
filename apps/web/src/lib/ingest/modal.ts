import "server-only";

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { ModalClient } from "modal";

const APP_NAME = "splicr-ingest";
const SWEEP_FUNCTION = "sweep";

export type IngestKickResult =
  | { started: true }
  | { started: false; reason: "disabled" | "not_configured" };

function modalConfigured(): boolean {
  return Boolean(
    (process.env.MODAL_TOKEN_ID?.trim() && process.env.MODAL_TOKEN_SECRET?.trim())
      || existsSync(join(homedir(), ".modal.toml")),
  );
}

/**
 * Start the deployed ingest sweep now.
 *
 * The database row remains the source of truth. This only removes the needless
 * wait for the two-hour schedule; failures are logged and the scheduled sweep
 * can still pick the request up later.
 */
export async function kickPublicIngestQueue(): Promise<IngestKickResult> {
  if (process.env.SPLICR_INGEST_AUTOSTART === "0") return { started: false, reason: "disabled" };
  if (!modalConfigured()) return { started: false, reason: "not_configured" };

  const client = new ModalClient();
  try {
    const environment = process.env.MODAL_ENVIRONMENT?.trim() || undefined;
    const sweep = await client.functions.fromName(APP_NAME, SWEEP_FUNCTION, { environment });
    await sweep.spawn([]);
    return { started: true };
  } finally {
    client.close();
  }
}
