import "server-only";

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import { ModalClient } from "modal";

const APP_NAME = "splicr-ingest";
const SWEEP_FUNCTION = "sweep";

export type IngestKickResult =
  | { started: true }
  | { started: false; reason: "disabled" | "not_configured" };

function modalConfigured(): boolean {
  const hasId = process.env.MODAL_TOKEN_ID?.trim() || process.env.MODAL_API_KEY?.trim();
  const hasSecret = process.env.MODAL_TOKEN_SECRET?.trim();
  return Boolean((hasId && hasSecret) || existsSync(join(homedir(), ".modal.toml")));
}

function getModalClient() {
  const tokenId = process.env.MODAL_API_KEY?.trim() || process.env.MODAL_TOKEN_ID?.trim();
  const tokenSecret = process.env.MODAL_TOKEN_SECRET?.trim();
  
  if (tokenId && tokenSecret) {
    return new ModalClient({ tokenId, tokenSecret });
  }
  return new ModalClient();
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

  const client = getModalClient();
  try {
    const environment = process.env.MODAL_ENVIRONMENT?.trim() || undefined;
    const sweep = await client.functions.fromName(APP_NAME, SWEEP_FUNCTION, { environment });
    await sweep.spawn([]);
    return { started: true };
  } finally {
    client.close();
  }
}

/** Private uploads start independently of archive discovery. The SQL lease prevents duplicate work. */
export async function kickPrivateScreenQueue(count = 1): Promise<IngestKickResult> {
  if (process.env.SPLICR_INGEST_AUTOSTART === "0") return { started: false, reason: "disabled" };
  if (!modalConfigured()) {
    try {
      const pythonPath = join(process.cwd(), "../../engine/.tools/env/bin/python");
      const script = "from splicr.private_screen import process_one; process_one()";
      for (let i = 0; i < Math.min(64, Math.max(1, count)); i++) {
        const proc = spawn(pythonPath, ["-c", script], {
          cwd: join(process.cwd(), "../../engine"),
          env: { ...process.env, PYTHONPATH: "." },
          detached: true,
          stdio: "ignore"
        });
        proc.unref();
      }
      return { started: true };
    } catch (error) {
      console.error(error);
      return { started: false, reason: "not_configured" };
    }
  }
  const client = getModalClient();
  try {
    const worker = await client.functions.fromName(APP_NAME, "process_private_screen", { environment: process.env.MODAL_ENVIRONMENT?.trim() || undefined });
    await Promise.all(Array.from({ length: Math.min(64, Math.max(1, count)) }, () => worker.spawn([])));
    return { started: true };
  } finally { client.close(); }
}
