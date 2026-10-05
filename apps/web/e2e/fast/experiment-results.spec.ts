import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readEnv } from "../fixtures/handles";

const artifact = path.resolve(process.cwd(), "../../artifacts/dow-screen-20261005");
test("read completed cloud comparisons, export native statistics and record published evidence", async ({ page }) => {
  test.skip(process.env.SPLICR_E2E_EXISTING_EXPERIMENT !== "1", "Requires the reviewed workbook cloud runs.");
  test.setTimeout(600_000);
  const manifest = JSON.parse(fs.readFileSync(path.join(artifact, "ui-queued-runs.json"), "utf8"));
  const config = readEnv();
  const admin = createClient(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const ids: string[] = manifest.screens.map((screen: { id: string }) => screen.id);
  const before = await admin.from("screens").select("id,name,status,current_run_id").in("id", ids);
  const preservedRuns: string[] = [];
  for (const screen of before.data ?? []) {
    if (screen.status !== "failed" && !(screen.status === "complete" && process.env.SPLICR_E2E_RERUN === "1")) continue;
    if (process.env.SPLICR_E2E_RERUN_SCREEN_NAME && screen.name !== process.env.SPLICR_E2E_RERUN_SCREEN_NAME) continue;
    if (process.env.SPLICR_E2E_PRESERVE_HISTORY === "1" && screen.status === "complete") preservedRuns.push(screen.current_run_id);
    await page.goto(`/dashboard/screens/${screen.id}`);
    await page.getByRole("button", { name: screen.status === "complete" ? "Run saved analysis again" : "Retry saved analysis", exact: true }).click();
    await expect(page.getByRole("button", { name: screen.status === "complete" ? "Run saved analysis again" : "Retry saved analysis", exact: true })).toBeHidden({ timeout: 60_000 });
  }
  const current = await admin.from("screens").select("id,current_run_id").in("id", ids);
  if (current.data!.some((screen) => !manifest.runs.some((run: { id: string }) => run.id === screen.current_run_id))) manifest.previousRuns = manifest.runs;
  for (const screen of manifest.screens) screen.current_run_id = current.data!.find((row) => row.id === screen.id)!.current_run_id;
  const currentRuns = await admin.from("runs").select("id,status,settings").in("id", current.data!.map((screen) => screen.current_run_id));
  if (currentRuns.error) throw currentRuns.error;
  manifest.runs = currentRuns.data;
  fs.writeFileSync(path.join(artifact, "ui-queued-runs.json"), JSON.stringify(manifest, null, 2));
  await expect.poll(async () => {
    const { data, error } = await admin.from("screens").select("id,status").in("id", ids);
    if (error) throw error;
    return data?.filter((screen) => screen.status === "complete").length;
  }, { timeout: 480_000, intervals: [10_000] }).toBe(6);
  for (const runId of preservedRuns) {
    const {count,error} = await admin.from("hits").select("id",{count:"exact",head:true}).eq("run_id",runId);
    if(error)throw error;
    expect(count).toBe(489);
    const {count:guides,error:guideError} = await admin.from("guide_effects").select("guide_key",{count:"exact",head:true}).eq("run_id",runId);
    if(guideError)throw guideError;
    expect(guides).toBe(3044);
  }
  for (const screen of manifest.screens) {
    const { count, error } = await admin.from("hits").select("id", { count: "exact", head: true }).eq("run_id", screen.current_run_id);
    if (error) throw error;
    expect(count).toBe(489);
    const { count: guides, error: guideError } = await admin.from("guide_effects").select("guide_key", { count: "exact", head: true }).eq("run_id", screen.current_run_id);
    if (guideError) throw new Error(JSON.stringify(guideError));
    expect(guides).toBe(3044);
    const { count: disagreement, error: disagreementError } = await admin.from("gene_disagreement").select("gene_symbol", { count: "exact", head: true }).eq("run_id", screen.current_run_id);
    if (disagreementError) throw new Error(JSON.stringify(disagreementError));
    expect(disagreement).toBeGreaterThan(400);
    const requested = manifest.runs.find((run: { id: string }) => run.id === screen.current_run_id)?.settings?.hit_callers;
    const { data: stage } = await admin.from("run_stages").select("metrics").eq("run_id", screen.current_run_id).eq("stage", "hits").single();
    if (requested) for (const method of requested) expect(stage?.metrics.methods).toContain(method);
    if (screen.name.startsWith("Gefitinib") || screen.name.startsWith("Trametinib")) expect(stage?.metrics.methods).toContain("drugz");
  }
  const experiment = manifest.screens[0].source_ref;
  await page.goto(`/dashboard/experiments/${experiment}`);
  await expect(page.getByRole("heading", { name: "Compare experiment rankings" })).toBeVisible();
  await page.getByLabel("Rank by").selectOption("drugz_fdr");
  await page.getByLabel("Gene", { exact: true }).fill("FGFR1");
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(page.getByRole("cell", { name: "FGFR1", exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(artifact, "compare-rankings.png"), fullPage: true });
  const drug = manifest.screens.find((screen: { name: string }) => screen.name === "Gefitinib ICSBCS002");
  await page.goto(`/dashboard/screens/${drug.id}?q=FGFR1`);
  await expect(page.getByRole("heading", { name: "Gefitinib ICSBCS002", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Compare experiment", exact: true })).toBeVisible();
  const response = await page.request.get(`/api/report/${drug.id}?format=json`);
  expect(response.ok()).toBeTruthy();
  const exported = await response.json();
  expect(exported.run.settings.fdr_threshold).toBe(0.05);
  expect(exported.run.settings.review_confirmed).toBe(true);
  fs.writeFileSync(path.join(artifact, "cloud-gefitinib-002-export.json"), JSON.stringify(exported, null, 2));
  expect(JSON.stringify(exported)).toContain('drugz_directional_fdr');
  expect(JSON.stringify(exported)).toContain('mageck_depletion_fdr');
  await page.goto(`/dashboard/validation?screen=${drug.id}&gene=FGFR1`);
  const prior = await admin.from("validation_outcomes").select("id").eq("screen_id", drug.id).eq("gene_symbol", "FGFR1");
  if (!prior.data?.length) {
  await page.getByRole("button", { name: /log an outcome|log the first outcome/i }).first().click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("Screen", { exact: true }).selectOption(drug.id);
  await drawer.getByLabel("Gene symbol").fill("FGFR1");
  await drawer.getByLabel("Which experiment was this?").selectOption("independent_guide");
  await drawer.getByRole("radio", { name: /Validated at the bench/i }).click();
  await drawer.getByLabel("Notes", { exact: true }).fill("Published retrospective evidence, CAN-24-0775 Figure 5B. The authors report increased gefitinib sensitivity following individual FGFR1 gRNAs in ICSBCS002. Recorded after freezing the six analysis runs. Construct independence and quantitative effect were not established from the source, so those fields remain unrecorded. This is not new prospective validation.");
  await drawer.getByLabel("Link to the evidence", { exact: true }).fill("https://pmc.ncbi.nlm.nih.gov/articles/PMC11790258/#F5");
  await drawer.getByRole("button", { name: "Save outcome" }).click();
  await expect(drawer).toBeHidden();
  }
  await page.reload();
  await expect(page.getByText("Reported Met", { exact: true })).toBeVisible();
  await expect(page.getByText(/The prespecified endpoint could not score these records/)).toBeVisible();
  const evidence = await admin.from("validation_outcomes").select("endpoint_decision").eq("screen_id", drug.id).eq("gene_symbol", "FGFR1");
  expect(evidence.data?.[0].endpoint_decision).toBe("insufficient_record");
  await page.screenshot({ path: path.join(artifact, "truth-loop.png"), fullPage: true });
  await page.goto("/dashboard/validation/network");
  await expect(page.getByRole("heading", { name: "Validation Network", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/dashboard/experiments/${experiment}`);
  await expect(page.getByRole("heading", { name: "Compare experiment rankings" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: path.join(artifact, "compare-mobile.png"), fullPage: true });
});
