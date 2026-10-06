import fs from "node:fs";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";
import { strFromU8, unzipSync } from "fflate";
import { expect, test } from "@playwright/test";
import { FIXTURE, fixtureIds, readEnv } from "../fixtures/handles";

test.beforeEach(async ({ page }) => {
  await page.goto("/dashboard/screens");
  await page.getByRole("button", { name: "Select screens", exact: true }).click();
  await page.getByRole("checkbox", { name: `Select ${FIXTURE.screenName}`, exact: true }).check();
});

for (const format of ["xlsx", "csv", "json"]) {
  test(`bulk ${format} download contains the entire recorded fixture run`, async ({ page }) => {
    await page.getByRole("button", { name: "Export selected" }).click();
    const dialog = page.getByRole("dialog", { name: "Export screens" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("File format", { exact: true }).selectOption(format);
    const downloaded = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Download export" }).click();
    const file = await downloaded;
    const at = await file.path();
    expect(at).not.toBeNull();
    const bytes = fs.readFileSync(at!);
    if (format === "json") {
      const data = JSON.parse(bytes.toString("utf8"));
      expect(data.screens).toHaveLength(1);
      expect(data.screens[0].screen.id).toBe(fixtureIds().screenId);
      expect(data.screens[0].genes).toHaveLength(FIXTURE.genes);
      expect(data.screens[0].provenance.run.id).toBe(fixtureIds().runId);
    } else if (format === "csv") {
      const files = unzipSync(bytes);
      const results = Object.keys(files).find(name => name.endsWith("gene-results.csv"))!;
      expect(strFromU8(files[results]).trimEnd().split("\r\n")).toHaveLength(FIXTURE.genes + 1);
      expect(Object.keys(files).some(name => name.endsWith("quality-control.csv"))).toBe(true);
    } else {
      const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes);
      expect(workbook.worksheets[1].rowCount).toBe(FIXTURE.genes + 1);
      expect(workbook.getWorksheet("Screens")!.getCell("H2").value).toBe(FIXTURE.genes);
      expect(workbook.getWorksheet("Quality control")).toBeTruthy();
    }
    await expect(dialog).not.toBeVisible();
  });
}

test("exact column/section selection and FDR filtering survive a real download", async ({ page }) => {
  await page.getByRole("button", { name: "Export selected" }).click();
  const dialog = page.getByRole("dialog", { name: "Export screens" });
  await dialog.getByLabel("File format", { exact: true }).selectOption("json");
  await dialog.getByRole("button", { name: "Identity only" }).click();
  for (const label of ["Quality control", "Guide-level results", "Guide disagreement", "Run provenance"]) {
    await dialog.getByRole("checkbox", { name: new RegExp(`^${label}`) }).uncheck();
  }
  await dialog.getByRole("radio", { name: "Filter by FDR", exact: true }).check();
  await dialog.getByLabel("Maximum FDR (inclusive)").fill("-1");
  await expect(dialog.getByRole("button", { name: "Download export" })).toBeDisabled();
  await dialog.getByLabel("Maximum FDR (inclusive)").fill("0.1");
  const downloaded = page.waitForEvent("download"); await dialog.getByRole("button", { name: "Download export" }).click();
  const file = await downloaded;
  const data = JSON.parse(fs.readFileSync((await file.path())!, "utf8"));
  expect(data.screens[0].genes).toHaveLength(FIXTURE.significant);
  expect(Object.keys(data.screens[0].genes[0])).toEqual(["gene_symbol", "comparison"]);
  for (const key of ["qc", "guides", "disagreement", "provenance"]) expect(data.screens[0]).not.toHaveProperty(key);
});

test("selection can be cleared and deletion canceled without modifying a screen", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "1 selected", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Delete Selected", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Delete selected screens" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("checkbox", { name: `Select ${FIXTURE.screenName}`, exact: true }).uncheck();
  await expect(page.getByRole("button", { name: "Export selected" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Delete Selected" })).toBeDisabled();
  await expect(page.getByRole("link", { name: FIXTURE.screenName, exact: true })).toBeVisible();
});

test("an export error remains in the dialog and creates no download", async ({ page }) => {
  await page.route("**/api/screens/export", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Selected evidence could not be read. Retry the export." }) }));
  await page.getByRole("button", { name: "Export selected" }).click();
  const dialog = page.getByRole("dialog", { name: "Export screens" });
  await dialog.getByRole("button", { name: "Download export" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Selected evidence could not be read. Retry the export.");
  await expect(dialog.getByRole("button", { name: "Download export" })).toBeEnabled();
  await dialog.press("Escape"); await expect(dialog).not.toBeVisible();
});

test("bulk deletion removes only two newly created disposable fixture screens", async ({ page }) => {
  const env = readEnv();
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const ids = [randomUUID(), randomUUID()];
  const orgId = fixtureIds().orgId;
  const names = ids.map(id => `E2E bulk deletion fixture ${id}`);
  const inserted = await admin.from("screens").insert(ids.map((id, index) => ({ id, org_id: orgId, name: names[index], modality: "knockout", status: "draft", tags: ["fixture", "e2e"], description: "Disposable bulk deletion test fixture; not an experiment." })));
  if (inserted.error) throw inserted.error;
  try {
    await page.reload();
    await page.getByRole("button", { name: "Select screens", exact: true }).click();
    for (const name of names) await page.getByRole("checkbox", { name: `Select ${name}`, exact: true }).check();
    await page.getByRole("button", { name: "Delete Selected", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Delete selected screens" });
    await expect(dialog).toContainText("2 screens");
    await dialog.getByRole("button", { name: "Yes, delete screens", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    for (const name of names) await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: FIXTURE.screenName, exact: true })).toBeVisible();
    const remaining = await admin.from("screens").select("id").eq("org_id", orgId).in("id", ids);
    expect(remaining.error).toBeNull(); expect(remaining.data).toEqual([]);
  } finally {
    const cleanup = await admin.from("screens").delete().eq("org_id", orgId).in("id", ids);
    if (cleanup.error) throw cleanup.error;
  }
});

test("authenticated export rejects a screen outside the selected workspace", async ({ request }) => {
  const response = await request.post("/api/screens/export", { data: { screenIds: [randomUUID()], format: "json", fields: ["gene_symbol", "comparison"], sections: [], rowScope: "all", fdrMetric: "fdr", fdrThreshold: 0.1 } });
  expect(response.status()).toBe(404);
  expect(response.headers()["content-disposition"]).toBeUndefined();
});
