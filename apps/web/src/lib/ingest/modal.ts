import "server-only";

export type IngestKickResult =
  | { started: true }
  | { started: false; reason: "disabled" | "not_configured" };

/** Only the trusted server holds the proxy token. Compute never runs in Vercel. */
async function dispatch(kind: "public" | "private", count: number): Promise<IngestKickResult> {
  if (!Number.isInteger(count) || count < 1 || count > 64) throw new Error("Compute dispatch count must be an integer from 1 to 64.");
  if (process.env.SPLICR_INGEST_AUTOSTART === "0") return { started: false, reason: "disabled" };
  const endpoint = process.env.MODAL_GATEWAY_URL?.trim();
  const key = process.env.MODAL_PROXY_TOKEN_ID?.trim();
  const secret = process.env.MODAL_PROXY_TOKEN_SECRET?.trim();
  if (!endpoint || !key || !secret) {
    // Local development uses the same authenticated Modal profile as the CLI.
    // Production keeps using the narrowly scoped HTTP proxy credentials.
    if (process.env.VERCEL || process.env.NODE_ENV !== "development") return { started: false, reason: "not_configured" };
    const { ModalClient } = await import("modal");
    const client = new ModalClient();
    try {
      const worker = await client.functions.fromName("splicr-ingest", kind === "private" ? "process_private_screen" : "sweep");
      await Promise.all(Array.from({ length: kind === "private" ? count : 1 }, () => worker.spawn([])));
      return { started: true };
    } finally {
      client.close();
    }
  }
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".modal.run") || url.username || url.password || url.search || url.hash) {
    throw new Error("The compute gateway must be an HTTPS Modal Web Function URL.");
  }
  const response = await fetch(url, {
    method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000),
    headers: { "Content-Type": "application/json", "Modal-Key": key, "Modal-Secret": secret },
    body: JSON.stringify({ kind, count }),
  });
  if (response.status !== 202) throw new Error(`The compute gateway refused dispatch (HTTP ${response.status}). The recorded job remains queued.`);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || !("accepted" in payload) || payload.accepted !== true) {
    throw new Error("The compute gateway did not acknowledge dispatch. The recorded job remains queued.");
  }
  return { started: true };
}

/** A durable database request exists before this best-effort acceleration. */
export async function kickPublicIngestQueue(): Promise<IngestKickResult> {
  return dispatch("public", 1);
}

/** The worker's atomic SQL lease prevents duplicate processing after retries. */
export async function kickPrivateScreenQueue(count = 1): Promise<IngestKickResult> {
  return dispatch("private", count);
}

/** The durable cancellation is committed before contacting Modal. */
export async function cancelPrivateScreenRun(runId: string): Promise<void> {
  const endpoint = process.env.MODAL_GATEWAY_URL?.trim();
  const key = process.env.MODAL_PROXY_TOKEN_ID?.trim();
  const secret = process.env.MODAL_PROXY_TOKEN_SECRET?.trim();
  if (!endpoint || !key || !secret) {
    if (process.env.VERCEL || process.env.NODE_ENV !== "development") return;
    const { ModalClient } = await import("modal");
    const client = new ModalClient();
    try {
      const cancel = await client.functions.fromName("splicr-ingest", "cancel_private_runs");
      await cancel.spawn([runId]);
    } finally { client.close(); }
    return;
  }
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".modal.run") || url.username || url.password || url.search || url.hash) throw new Error("Invalid compute gateway.");
  const response = await fetch(url, {
    method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000),
    headers: { "Content-Type": "application/json", "Modal-Key": key, "Modal-Secret": secret },
    body: JSON.stringify({ kind: "cancel", run_id: runId }),
  });
  if (response.status !== 202) throw new Error("Modal cancellation will retry.");
}
