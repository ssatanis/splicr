import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const next = (page: Page) => page.getByRole("button", { name: "Next Step", exact: true });
const ingestion = (page: Page) =>
  page.getByRole("button", { name: "1 Data Ingestion", exact: true });
const artifacts = path.resolve(
  process.cwd(),
  "../../artifacts/intelligent-intake-20261006",
);

async function expectStep(page: Page, step: number) {
  await expect(
    page
      .getByRole("list", { name: "Analysis progress" })
      .locator('li[aria-current="step"]'),
  ).toContainText(String(step));
  await expect(page.getByTestId("file-drop-zone")).toHaveCount(step === 1 ? 1 : 0);
  await expect(
    page.getByRole("heading", { name: "Guide library", exact: true }),
  ).toHaveCount(step === 2 ? 1 : 0);
  await expect(
    page.getByRole("heading", { name: "Comparisons", exact: true }),
  ).toHaveCount(step === 3 ? 1 : 0);
  await expect(
    page.getByRole("heading", { name: "Pipeline settings", exact: true }),
  ).toHaveCount(step === 4 ? 1 : 0);
  await expect(page.getByRole("button", { name: /^Initialize/ })).toHaveCount(
    step === 4 ? 1 : 0,
  );
}

test("fresh Step 1 and mode switching display an enabled upload zone", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/dashboard/new");
  await ingestion(page).click();
  await expectStep(page, 1);
  await expect(next(page)).toBeDisabled();
  await expect(page.getByText("No comparisons could be auto-generated.")).toHaveCount(0);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Browse files", exact: true }).click();
  expect((await chooser).isMultiple()).toBe(true);
  await page.getByRole("radio", { name: /Published study/ }).click();
  await page.getByRole("radio", { name: /My experiment/ }).click();
  await expect(page.getByTestId("file-drop-zone")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Browse files", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("uploaded counts traverse four isolated bodies and clicking Step 1 restores uploads", async ({
  page,
}) => {
  await page.goto("/dashboard/new");
  await page
    .getByLabel("Upload experiment files")
    .setInputFiles(path.resolve(process.cwd(), "e2e/fixtures/files/counts-brunello.tsv"));
  await expect(page.getByText("Uploaded", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await next(page).click();
  await expectStep(page, 2);
  const library = page.getByLabel("Experiment guide library");
  if (!(await library.inputValue()))
    await library.selectOption({ label: "Brunello, 77,441 guides" });
  await expect
    .poll(
      async () =>
        (await next(page).isEnabled()) ||
        (await page
          .getByRole("button", { name: "Confirm guide mapping", exact: true })
          .count()) > 0,
      { timeout: 90_000 },
    )
    .toBe(true);
  const mapping = page.getByRole("button", {
    name: "Confirm guide mapping",
    exact: true,
  });
  if (await mapping.count()) await mapping.click();
  await next(page).click();
  await expectStep(page, 3);
  await expect(page.getByRole("checkbox", { name: /^Run / }).first()).toBeVisible();
  await next(page).click();
  await expectStep(page, 4);
  await expect(next(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Initialize/ })).toBeDisabled();
  await page.getByLabel("Confirm reviewed analysis plan").check();
  await expect(page.getByRole("button", { name: /^Initialize/ })).toBeEnabled();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expectStep(page, 3);
  await next(page).click();
  await expect(page.getByLabel("Confirm reviewed analysis plan")).not.toBeChecked();
  await ingestion(page).click();
  await expectStep(page, 1);
  await expect(page.getByTestId("file-drop-zone")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Browse files", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("list", { name: "Attached files" })).toContainText(
    "counts-brunello.tsv",
  );
});

test("Jacquere files upload, detect the library, build comparisons and return to Step 1", async ({
  page,
}) => {
  test.skip(
    !process.env.SPLICR_E2E_JACQUERE_COUNTS || !process.env.SPLICR_E2E_JACQUERE_LIBRARY,
    "Set Jacquere file paths to exercise the real dataset.",
  );
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  fs.mkdirSync(artifacts, { recursive: true });
  await page.goto("/dashboard/new");
  await ingestion(page).click();
  await expectStep(page, 1);
  await page.screenshot({
    path: path.join(artifacts, "step-1-upload.png"),
    fullPage: true,
  });
  await page
    .getByLabel("Upload experiment files")
    .setInputFiles([
      process.env.SPLICR_E2E_JACQUERE_COUNTS!,
      process.env.SPLICR_E2E_JACQUERE_LIBRARY!,
    ]);
  await expect(page.getByText("Uploaded", { exact: true })).toHaveCount(2, {
    timeout: 90_000,
  });
  await next(page).click();
  await expect(
    page.getByRole("heading", { name: "Guide library", exact: true }),
  ).toBeVisible({ timeout: 90_000 });
  await expectStep(page, 2);
  await expect(page.getByText(/Library auto-detected from uploaded map/)).toHaveCount(0);
  await expect(page.getByLabel("Experiment guide library")).toBeVisible();
  await expect(page.getByLabel("Experiment guide library")).not.toHaveValue("");
  await expect
    .poll(
      async () =>
        (await next(page).isEnabled()) ||
        (await page
          .getByRole("button", { name: "Confirm guide mapping", exact: true })
          .count()) > 0,
      { timeout: 90_000 },
    )
    .toBe(true);
  const confirmMapping = page.getByRole("button", {
    name: "Confirm guide mapping",
    exact: true,
  });
  if (await confirmMapping.count()) await confirmMapping.click();
  await page.screenshot({
    path: path.join(artifacts, "step-2-library.png"),
    fullPage: true,
  });
  await next(page).click();
  await expectStep(page, 3);
  await expect(page.getByText("No comparisons could be auto-generated.")).toHaveCount(0);
  expect(await page.getByRole("checkbox", { name: /^Run / }).count()).toBeGreaterThan(0);
  await expect(page.getByLabel("Experiment date")).toHaveValue("2025-06-27");
  await page.screenshot({
    path: path.join(artifacts, "step-3-design.png"),
    fullPage: true,
  });
  await next(page).click();
  await expectStep(page, 4);
  await page.getByLabel("Confirm reviewed analysis plan").check();
  await expect(page.getByRole("button", { name: /^Initialize/ })).toBeEnabled();
  await ingestion(page).click();
  await expectStep(page, 1);
  await expect(page.getByTestId("file-drop-zone")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Browse files", exact: true }),
  ).toBeEnabled();
  await expect(page.getByText("Uploaded", { exact: true })).toHaveCount(2);
  await page.screenshot({
    path: path.join(artifacts, "step-1-after-return.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
