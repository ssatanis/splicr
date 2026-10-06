import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { fixtureIds, readEnv, screenPath } from "../fixtures/handles";

// No worker job is inserted: this disposable fixture tests the UI's observation
// of durable run state, including fallback polling when realtime is absent.
test("queued, running and completed states update without a reload", async ({ page }) => {
  const env = readEnv();
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);
  const { runId, screenId } = fixtureIds();
  const stages = await admin.from("run_stages").select("*").eq("run_id", runId);
  const update = async (table: "runs" | "screens", id: string, status: string) => {
    const result = await admin.from(table).update({ status }).eq("id", id);
    if (result.error) throw result.error;
  };
  await page.routeWebSocket(/\/realtime\//, socket => socket.close());
  let disconnected = false;
  await page.route("**/rest/v1/run_stages?**", route => disconnected ? route.abort() : route.continue());
  try {
    await update("runs", runId, "queued");
    await update("screens", screenId, "queued");
    const reset = await admin.from("run_stages").update({ status: "queued", detail: null }).eq("run_id", runId);
    if (reset.error) throw reset.error;
    await page.goto(screenPath());
    await expect(page.getByRole("heading", { name: /^Queued:/ })).toBeVisible();
    await expect(page.getByText("Waiting for an analysis worker. Starts automatically.")).toBeVisible();
    await expect(page.getByText("Running...", { exact: true })).toHaveCount(0);

    disconnected = true;
    await expect(page.getByText("Live updates are unavailable. Reconnecting automatically…")).toBeVisible();
    disconnected = false;
    await expect(page.getByRole("heading", { name: /^Queued:/ })).toBeVisible();

    await update("runs", runId, "running");
    await update("screens", screenId, "running");
    const active = await admin.from("run_stages").update({ status: "running", detail: "Verifying uploaded inputs" }).eq("run_id", runId).eq("stage", "ingest");
    if (active.error) throw active.error;
    await expect(page.getByRole("heading", { name: /^Analyzing:/ })).toBeVisible();
    await expect(page.getByText("Analysis worker active. Progress updates automatically.")).toBeVisible();
    await expect(page.getByText("Verifying uploaded inputs")).toBeVisible();

    // A run can finish even if no final stage update reaches the browser.
    await update("runs", runId, "complete");
    await update("screens", screenId, "complete");
    await expect(page.getByRole("region", { name: "Screen summary" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Analyzing:/ })).toHaveCount(0);
  } finally {
    await update("runs", runId, "complete");
    await update("screens", screenId, "complete");
    if (stages.data?.length) {
      const restored = await admin.from("run_stages").upsert(stages.data);
      if (restored.error) throw restored.error;
    }
  }
});
