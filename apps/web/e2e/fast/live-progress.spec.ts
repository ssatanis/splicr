import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { FIXTURE, fixtureIds, readEnv, screenPath } from "../fixtures/handles";

// No worker job is inserted: this disposable fixture tests the UI's observation
// of durable run state, including fallback polling when realtime is absent.
test("progress survives navigation and completion populates the report", async ({ page, context }) => {
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

    const clock = await admin.from("runs").update({ started_at: new Date(Date.now()-125000).toISOString() }).eq("id", runId);
    if (clock.error) throw clock.error;
    await update("runs", runId, "running");
    await update("screens", screenId, "running");
    const active = await admin.from("run_stages").update({ status: "running", detail: "Verifying uploaded inputs" }).eq("run_id", runId).eq("stage", "ingest");
    if (active.error) throw active.error;
    await expect(page.getByRole("heading", { name: /^Analyzing:/ })).toBeVisible();
    await expect(page.getByText("Analysis worker active.")).toBeVisible();
    await expect(page.getByText("Verifying uploaded inputs")).toBeVisible();
    await expect(page.getByText(/^Elapsed: 2m/)).toBeVisible();
    await expect(page.getByText(/Progress updates automatically/)).toHaveCount(0);
    // Leave the screen within SplicR, and return through its running link.
    await page.getByRole("link", { name: "All screens", exact: true }).click();
    await page.getByRole("link", { name: FIXTURE.screenName, exact: true }).first().click();
    await expect(page.getByRole("heading", { name: /^Analyzing:/ })).toBeVisible();
    // Updates while another tab has focus are reflected on return.
    const other = await context.newPage();
    await other.goto("about:blank");
    await other.bringToFront();
    const progressed = await admin.from("run_stages").update({ status: "done", detail: "Inputs verified" }).eq("run_id", runId).eq("stage", "ingest");
    if (progressed.error) throw progressed.error;
    await page.bringToFront();
    await expect(page.getByText(`1 of ${stages.data?.length} stages complete`)).toBeVisible();
    await other.close();

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

test("a queued screen can be canceled and remains canceled on return", async ({ page }) => {
  const env = readEnv();
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);
  const { orgId } = fixtureIds();
  const screenId = crypto.randomUUID(), runId = crypto.randomUUID();
  const check = (result: { error: unknown }) => { if (result.error) throw result.error; };
  try {
    check(await admin.from("screens").insert({ id: screenId, org_id: orgId, name: "Cancel verification", status: "queued" }));
    check(await admin.from("runs").insert({ id: runId, screen_id: screenId, org_id: orgId, status: "queued" }));
    check(await admin.from("screens").update({ current_run_id: runId }).eq("id", screenId));
    check(await admin.from("run_stages").insert({ run_id: runId, stage: "ingest", status: "queued", position: 0 }));
    // Future scheduling keeps this synthetic fixture away from real workers.
    check(await admin.from("jobs").insert({ run_id: runId, org_id: orgId, kind: "pipeline", payload: { screen_id: screenId }, scheduled_at: "2099-01-01T00:00:00Z" }));
    await page.goto(`/dashboard/screens/${screenId}`);
    await page.getByRole("button", { name: "Cancel analysis", exact: true }).click();
    await page.getByRole("button", { name: "Stop analysis", exact: true }).click();
    await expect(page.getByRole("heading", { name: /^Analysis canceled:/ })).toBeVisible({ timeout: 90000 });
    const job = await admin.from("jobs").select("status,modal_cancelled_at").eq("run_id", runId).single();
    check(job); expect(job.data?.status).toBe("canceled"); expect(job.data?.modal_cancelled_at).toBeTruthy();
    await page.getByRole("link", { name: "All screens", exact: true }).click();
    await page.getByRole("link", { name: "Cancel verification", exact: true }).click();
    await expect(page.getByRole("heading", { name: /^Analysis canceled:/ })).toBeVisible();
    await expect(page.getByRole("region", { name: "Screen summary" })).toHaveCount(0);
    // Late worker writes are rejected even through a privileged connection.
    const late = await admin.from("runs").update({ status: "running" }).eq("id", runId);
    expect(late.error?.code).toBe("55000");
    const lateStage = await admin.from("run_stages").update({ status: "done" }).eq("run_id", runId);
    expect(lateStage.error?.code).toBe("55000");
  } finally {
    check(await admin.from("jobs").delete().eq("run_id", runId));
    check(await admin.from("screens").delete().eq("id", screenId));
  }
});
