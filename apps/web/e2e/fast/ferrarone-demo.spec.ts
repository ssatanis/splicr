import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Explicit opt-in: these original genome-wide files dispatch real cloud work.
test("Ferrarone archive counts auto-configure and launch six genetic comparisons", async ({ page }) => {
  test.skip(process.env.SPLICR_FERRARONE_DEMO !== "1", "Requires original downloads and real Modal compute.");
  test.setTimeout(300_000);
  const rraOnly = process.env.SPLICR_FERRARONE_RRA_ONLY === "1";
  const root = path.resolve(process.cwd(), "../..");
  const out = path.join(root, "artifacts/ferrarone-20261007", ...(rraOnly ? ["rra-cloud"] : []));
  fs.mkdirSync(out, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const next = () => page.getByRole("button", { name: "Next Step", exact: true });
  await page.goto("/dashboard/new");
  const bundle = process.env.SPLICR_FERRARONE_ZIP === "1";
  await page.getByLabel("Upload experiment files").setInputFiles(bundle ? ["/Users/sahaj/Downloads/SplicR-Ferrarone-demo.zip"] : [
    "/Users/sahaj/Downloads/2d_crispr_screen_read_counts.txt",
    "/Users/sahaj/Downloads/spheroid_crispr_screen_read_counts.txt",
  ]);
  await expect(page.getByText("Uploaded", { exact: true })).toHaveCount(bundle ? 3 : 2, { timeout: 120_000 });
  await expect(next()).toBeEnabled({ timeout: 120_000 });
  await next().click();
  await expect(page.getByLabel("Experiment guide library").locator("option:checked")).toContainText("TKOv3", { timeout: 120_000 });
  await expect(next()).toBeEnabled({ timeout: 120_000 });
  await page.screenshot({ path: path.join(out, "library-matching.png"), fullPage: true });
  await next().click();
  await expect(page.getByLabel("Screen name")).toHaveValue("Ferrarone 2024: A549 LKB1 growth screens");
  if (rraOnly) await page.getByLabel("Screen name").fill("Ferrarone 2024: A549 LKB1 growth screens (RRA validation)");
  await expect(page.getByRole("checkbox", { name: /^Run / })).toHaveCount(6);
  for (const culture of ["2D", "Spheroid"]) for (const arm of ["EV vs plasmid", "WT vs plasmid", "WT vs EV"])
    await expect(page.getByRole("checkbox", { name: `Run ${culture}: ${arm}`, exact: true })).toBeChecked();
  await page.screenshot({ path: path.join(out, "reviewed-comparisons.png"), fullPage: true });
  await next().click();
  await page.getByText("Advanced settings", { exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Add MAGeCK MLE", exact: true })).toBeChecked();
  if (rraOnly) await page.getByRole("checkbox", { name: "Add MAGeCK MLE", exact: true }).uncheck();
  await expect(page.getByRole("checkbox", { name: "Add BAGEL2 to fitness comparisons", exact: true })).not.toBeChecked();
  await page.getByLabel("Confirm reviewed analysis plan").check();
  await page.screenshot({ path: path.join(out, "reviewed-launch.png"), fullPage: true });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export.*plan/i }).click();
  await (await downloadPromise).saveAs(path.join(out, "browser-analysis-plan.json"));
  await expect(page.getByRole("button", { name: /^Initialize/ })).toBeEnabled();
  if (process.env.SPLICR_FERRARONE_LAUNCH === "1") {
    await page.getByRole("button", { name: /^Initialize/ }).click();
    await expect(page.getByText(/The runs are queued/)).toBeVisible({ timeout: 120_000 });
    for (const culture of ["2D", "Spheroid"]) for (const arm of ["EV vs plasmid", "WT vs plasmid", "WT vs EV"])
      await expect(page.getByRole("link", { name: `${culture}: ${arm}`, exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(out, "cloud-queued.png"), fullPage: true });
  }
  fs.writeFileSync(path.join(out, "browser-errors.json"), JSON.stringify(errors, null, 2));
  expect(errors).toEqual([]);
});
