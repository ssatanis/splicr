import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
const next = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: "Next Step", exact: true });
async function readyLibrary(page: import("@playwright/test").Page) {
  await expect(page.getByText(/Checking guides against/)).toHaveCount(0, {
    timeout: 90_000,
  });
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
  const confirm = page.getByRole("button", {
    name: "Confirm guide mapping",
    exact: true,
  });
  if (await confirm.count()) await confirm.click();
  await expect(next(page)).toBeEnabled();
}
const upload = (name: string, text: string) => ({
  name,
  mimeType: "text/plain",
  buffer: Buffer.from(text),
});
const counts = "guide,gene,T0,treated\nunknownA,A1BG,100,20\nunknownB,BRAF,50,30\n";
const library =
  "guide,gene,sequence\nunknownA,A1BG,ACGTACGTACGTACGTACGT\nunknownB,BRAF,TGCATGCATGCATGCATGCA\n";

test("unmatched counts accept a library in place, preserve configuration, and resume a complete draft", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const draftName = `Draft configuration fixture ${Date.now()}`;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/dashboard/new");
  await page
    .getByLabel("Upload experiment files")
    .setInputFiles(upload("counts_2025-06-27_fixture.csv", counts));
  await expect(page.getByText("Uploaded", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await expect(next(page)).toBeEnabled({ timeout: 60_000 });
  await next(page).click();
  await expect(
    page.getByRole("heading", { name: "Guide library", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Experiment guide library")
    .selectOption({ label: "Brunello, 77,441 guides" });
  await expect(
    page.getByText("These inputs do not fit the selected library.", { exact: false }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(next(page)).toBeDisabled();
  await page
    .getByLabel("Upload guide library")
    .setInputFiles(upload("fixture-guide-library.csv", library));
  await readyLibrary(page);
  await expect(
    page.getByRole("heading", { name: "Guide library", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Experiment guide library")).not.toHaveValue("");
  await expect(
    page.getByText(
      /Library auto-imported|Library auto-detected from uploaded map|File inspection, /,
    ),
  ).toHaveCount(0);
  await page.getByLabel("Experiment library name").fill("Lab library 2025");
  await next(page).click();
  await expect(page.getByLabel("Experiment date")).toHaveValue("2025-06-27");
  await expect(page.getByLabel("Screen researcher")).not.toHaveValue("");
  await page.getByLabel("Screen researcher").selectOption({ label: "E2E Colleague" });
  await page.getByLabel("Screen name").fill(draftName);
  await page.getByLabel("Experiment date").fill("2025-06-28");
  await page.getByText("Edit sample details", { exact: true }).click();
  await page.getByLabel("Replicate of treated").fill("3");
  await page.getByLabel("donor of treated").fill("Donor 4");
  await page.getByRole("button", { name: "1 Data Ingestion", exact: true }).click();
  await expect(page.getByTestId("file-drop-zone")).toBeVisible();
  await next(page).click();
  await readyLibrary(page);
  await next(page).click();
  await expect(page.getByLabel("Screen name")).toHaveValue(draftName);
  await expect(page.getByLabel("Experiment date")).toHaveValue("2025-06-28");
  await page.getByRole("button", { name: "Save as Draft", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/screens$/, { timeout: 60_000 });
  const row = page.getByRole("row").filter({ hasText: draftName });
  await expect(row).toContainText("2025-06-28");
  await expect(row).toContainText("E2E Colleague");
  await row.getByRole("link", { name: draftName, exact: true }).click();
  await expect(page).toHaveURL(/draft=/);
  await expect(next(page)).toBeEnabled({ timeout: 60_000 });
  await next(page).click();
  await readyLibrary(page);
  await expect(page.getByLabel("Experiment library name")).toHaveValue(
    "Lab library 2025",
  );
  await next(page).click();
  await expect(page.getByLabel("Screen name")).toHaveValue(draftName);
  await expect(page.getByLabel("Experiment date")).toHaveValue("2025-06-28");
  await page.getByText("Edit sample details", { exact: true }).click();
  await expect(page.getByLabel("Replicate of treated")).toHaveValue("3");
  await expect(page.getByLabel("donor of treated")).toHaveValue("Donor 4");
  expect(errors).toEqual([]);
});

test("every count file exposes a preview and correcting selected columns updates sample choices", async ({
  page,
}) => {
  await page.goto("/dashboard/new");
  await page
    .getByLabel("Upload experiment files")
    .setInputFiles(path.resolve(process.cwd(), "e2e/fixtures/files/counts-brunello.tsv"));
  await expect(next(page)).toBeEnabled({ timeout: 60_000 });
  await page.getByText("Inspect file", { exact: true }).click();
  await page.getByText("counts-brunello.tsv / Table", { exact: false }).click();
  await expect(
    page.getByLabel("Table purpose for counts-brunello.tsv Table"),
  ).toBeVisible();
  await expect(page.getByRole("table").first()).toContainText("A1BG");
  await page.getByLabel("Count column Olaparib_R2", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Apply interpretation", exact: true }).click();
  await expect(next(page)).toBeEnabled({ timeout: 60_000 });
  await next(page).click();
  await readyLibrary(page);
  await next(page).click();
  await expect(page.getByLabel(/Olaparib_R2 in/)).toHaveCount(0);
  await expect(page.getByLabel(/Olaparib_R1 in/)).toHaveCount(2);
});

test("FASTQ reads with adapter prefixes identify a library and reach a reviewable sequencing plan", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const sequences = fs
    .readFileSync(
      path.resolve(process.cwd(), "e2e/fixtures/files/counts-brunello.tsv"),
      "utf8",
    )
    .trim()
    .split(/\r?\n/)
    .slice(1, 101)
    .map((line) => line.split("\t")[2]);
  const reads = sequences
    .map((sequence, i) => {
      const seq = "TACGATTGCC" + sequence + "GATTACA";
      return `@read${i}\n${seq}\n+\n${"I".repeat(seq.length)}\n`;
    })
    .join("");
  await page.goto("/dashboard/new");
  await page
    .getByLabel("Upload experiment files")
    .setInputFiles([
      upload("T0_rep1_R1.fastq", reads),
      upload("treated_rep1_R1.fastq", reads),
    ]);
  await expect(page.getByText("Uploaded", { exact: true })).toHaveCount(2, {
    timeout: 60_000,
  });
  await expect(next(page)).toBeEnabled({ timeout: 90_000 });
  await next(page).click();
  const selector = page.getByLabel("Experiment guide library");
  if (!(await selector.inputValue()))
    await selector.selectOption({ label: "Brunello, 77,441 guides" });
  await readyLibrary(page);
  await expect(page.getByText(/sampled reads match this library/)).toContainText("100%");
  await next(page).click();
  await expect(
    page.getByRole("heading", { name: "Comparisons", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /^Run / })).toHaveCount(1);
  await next(page).click();
  await expect(page.getByText(/MLE design needs more samples/)).toBeVisible();
  await page.getByText("Advanced settings", { exact: true }).click();
  await page.getByRole("checkbox", { name: "Add MAGeCK MLE", exact: true }).uncheck();
  await page.getByLabel("Confirm reviewed analysis plan").check();
  await expect(page.getByRole("button", { name: /^Initialize/ })).toBeEnabled();
});
