import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readEnv, fixtureIds } from "../fixtures/handles";

const LIBRARY = process.env.SPLICR_E2E_LIBRARY;
const COUNTS = process.env.SPLICR_E2E_COUNTS;

test("review an uploaded multi-model workbook and queue its six comparisons", async ({ page }) => {
  test.skip(!LIBRARY || !COUNTS, "Set workbook fixture paths to run the real experiment intake.");
  test.setTimeout(240_000);
  await page.goto("/dashboard/new");
  await page.getByRole("radio", { name: /My experiment/ }).click();
  await page.locator('input[type="file"]:not([webkitdirectory])').setInputFiles([COUNTS!, LIBRARY!]);
  for (const filename of [path.basename(COUNTS!), path.basename(LIBRARY!)]) await expect(page.getByRole("listitem").filter({ hasText: filename }).getByText("Uploaded")).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "Describe the experiment" }).click();
  await expect(page.getByRole("heading", { name: "Review experiment" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("2 count tables, 20 samples.", { exact: false })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /^Run / })).toHaveCount(6);
  await page.getByLabel("Custom library name").fill("Vakoc kinase-domain #117725, reviewed upload");
  await page.getByRole("button", { name: "Confirm and import library" }).click();
  await expect(page.getByText("Library imported: 3,051 guides, 489 target labels, 50 negative controls.")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Confirm guide ID mapping" })).toBeVisible();
  for (const suffix of ["e4.1", "e3.1", "e4.2", "e3.2"]) await expect(page.getByLabel(`Map PRL9_${suffix}`)).toHaveValue(`RPL9_${suffix}`);
  await page.getByRole("button", { name: "Confirm guide mapping", exact: true }).click();
  await page.locator("summary").filter({ hasText: "Pipeline settings" }).click();
  await page.getByLabel("Experiment FDR threshold").fill("0.05");
  await page.getByLabel("Experiment model type").selectOption("organoid");
  const bagel = page.getByRole("checkbox", { name: /Add BAGEL2/ });
  if (await bagel.isChecked()) await bagel.uncheck();
  await page.screenshot({ path: path.resolve(process.cwd(), "../../artifacts/dow-screen-20261005/experiment-review.png"), fullPage: true });
  await page.getByRole("button", { name: "Review analysis plan" }).click();
  await expect(page.getByRole("heading", { name: "Confirm analysis plan" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run 6 comparisons" })).toBeDisabled();
  await page.getByLabel("Confirm reviewed analysis plan").check();
  await page.getByRole("button", { name: "Run 6 comparisons" }).click();
  await expect(page.getByText("The runs are queued.", { exact: false })).toBeVisible({ timeout: 60_000 });
  const links = page.getByRole("link").filter({ hasText: /^(Essentiality|Gefitinib|Trametinib) ICSBCS/ });
  await expect(links).toHaveCount(6);
  const config = readEnv();
  const admin = createClient(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const screenIds = await links.evaluateAll((links) => links.map((link) => link.getAttribute("href")!.split("/").pop()!));
  const { data: screens, error } = await admin.from("screens").select("id,name,org_id,cell_line,current_run_id,source_ref").in("id", screenIds);
  if (error) throw error;
  expect(screens).toHaveLength(6);
  expect(screens!.every((screen) => screen.org_id === fixtureIds().orgId)).toBeTruthy();
  const { data: runs, error: runError } = await admin.from("runs").select("id,settings,status").in("id", screens!.map((screen) => screen.current_run_id));
  if (runError) throw runError;
  expect(runs).toHaveLength(6);
  for (const run of runs!) { expect(run.settings.fdr_threshold).toBe(.05); expect(run.settings.guide_aliases.PRL9_e4_1).toBeUndefined(); expect(Object.keys(run.settings.guide_aliases)).toHaveLength(4); }
  const { data: comparisons, error: comparisonError } = await admin.from("comparisons").select("screen_id,treatment_ids,control_ids").in("screen_id", screenIds);
  if (comparisonError) throw comparisonError;
  for (const comparison of comparisons!) { const screen = screens!.find((screen) => screen.id === comparison.screen_id)!; const expected = screen.cell_line === "ICSBCS002" ? 2 : 3; expect(comparison.treatment_ids).toHaveLength(expected); expect(comparison.control_ids).toHaveLength(expected); }
  const manifestPath = path.resolve(process.cwd(), "../../artifacts/dow-screen-20261005/ui-queued-runs.json");
  if (fs.existsSync(manifestPath)) fs.copyFileSync(manifestPath, manifestPath.replace(".json", ".previous.json"));
  fs.writeFileSync(manifestPath, JSON.stringify({ screens, runs }, null, 2));
});
