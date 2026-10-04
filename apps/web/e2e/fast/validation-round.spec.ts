/**
 * A whole round, run the way a researcher would, with results at the end.
 *
 * The only test that exercises the full loop against a real session and a real
 * database: configure, freeze, record a mixed set of outcomes, reveal, read the
 * results. Everything else in this suite checks one piece of it.
 *
 * Draws a configured set, freezes it, records a mixed set of outcomes through
 * the Truth Loop, reveals the round, and reads the results page. This is the
 * only test that exercises the full loop; everything else checks a piece of it.
 */
import { expect, test } from "@playwright/test";

const NETWORK = "/dashboard/validation/network";
const TRUTH_LOOP = "/dashboard/validation";
//  Screenshots only when asked for. A test that writes files into the repo on
//  every CI run is a test that makes the repo dirty for no reason.
const SHOTS = process.env.SPLICR_SHOTS ?? null;
const shot = async (page: import("@playwright/test").Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}`, fullPage: true });
};

test("run a round and read its results", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1250 });

  const name = `Run ${Date.now().toString(36).slice(-5)}`;
  await page.goto(NETWORK);
  await page.getByRole("region", { name: /^Set up a round/ }).waitFor();

  // 1. Configure, in place. The form is on the page, not behind a button.
  const setup = page.getByRole("region", { name: /^Set up a round/ });
  await expect(setup).toBeVisible();
  await setup.getByLabel("Name").fill(name);
  await setup.getByLabel("Budget").fill("8");
  for (const arm of ["Investigator's choice", "Random across ranks"]) {
    const box = setup.getByRole("checkbox", { name: new RegExp(arm) });
    if (await box.isChecked()) await box.uncheck();
  }
  const threshold = setup.getByLabel("Counts as a pass");
  if ((await threshold.count()) > 0) await threshold.fill("1");
  // The preview answers "what will this do" before anything is written, and it
  // updates as the controls change.
  await expect(setup.getByText(/8 candidates to test/)).toBeVisible();
  await expect(setup.getByText(/About 4 from each of 2 strategies/)).toBeVisible();
  await shot(page, "08-configure.png");
  await setup.getByRole("button", { name: "Draw the set" }).click();
  await expect(page.getByRole("row", { name: new RegExp(name) })).toBeVisible();

  // 2. Freeze.
  const row = page.getByRole("row", { name: new RegExp(name) });
  await expect(row).toContainText("Draft");
  await row.getByRole("button", { name: "Freeze" }).click();
  await row.getByRole("button", { name: "Yes" }).click();
  await expect(page.getByRole("row", { name: new RegExp(name) })).toContainText("Frozen");

  // 3. Read the drawn candidates off the results view, then record outcomes.
  await page
    .getByRole("row", { name: new RegExp(name) })
    .getByRole("link", { name: /Record results|See results/ })
    .click();
  await expect(page.getByRole("region", { name: /^Candidates/ })).toBeVisible();
  const genes = await page
    .getByRole("region", { name: /^Candidates/ })
    .locator("tbody tr td:first-child")
    .allInnerTexts();
  expect(genes.length).toBeGreaterThanOrEqual(6);

  // A mixed set, as a real round produces: some pass, some do not, one is
  // inconclusive and one is left outstanding.
  const plan: [string, string, string][] = [
    [genes[0], "Validated at the bench", "-1.8"],
    [genes[1], "Validated at the bench", "-1.5"],
    [genes[2], "Did not validate", "-0.1"],
    [genes[3], "Validated at the bench", "-1.4"],
    [genes[4], "Did not validate", "-0.2"],
    [genes[5], "Inconclusive", ""],
  ];
  for (const [gene, result, effect] of plan) {
    await page.goto(TRUTH_LOOP);
    await page.getByRole("button", { name: /log an outcome|log the first outcome/i }).first().click();
    const form = page.getByRole("dialog");
    await form.getByLabel("Screen").selectOption({ index: 1 });
    await form.getByLabel("Gene symbol").fill(gene);
    await form.getByLabel("Which experiment was this?").selectOption({ label: "Independent CRISPR guide" });
    await form.getByRole("radio", { name: new RegExp(result, "i") }).click();
    if (effect) await form.getByLabel("Effect size").fill(effect);
    await form.getByLabel("Biological replicates").fill("3");
    await form.getByLabel("Independent perturbation").selectOption({ label: "Yes" });
    await form.getByLabel("Laboratory").fill("LAB-E2E");
    await form.getByRole("button", { name: "Save outcome" }).click();
    await expect(form).toBeHidden();
  }

  // 4. Reveal.
  await page.goto(NETWORK);
  const frozen = page.getByRole("row", { name: new RegExp(name) });
  await frozen.getByRole("button", { name: "Reveal" }).click();
  await frozen.getByRole("button", { name: "Yes" }).click();
  await expect(page.getByRole("row", { name: new RegExp(name) })).toContainText("Revealed");

  // 5. Results.
  await page
    .getByRole("row", { name: new RegExp(name) })
    .getByRole("link", { name: "See results" })
    .click();
  const results = page.getByRole("region", { name: /^By strategy/ });
  await expect(results).toBeVisible();
  const text = (await page.locator("main").innerText()).replace(/\s+/g, " ");

  // The figures a researcher came for.
  expect(text).toMatch(/Recorded/);
  expect(text).toMatch(/Decided/);
  expect(text).toMatch(/Confirmed/);
  expect(text).toMatch(/Validations per confirmation/);
  // Per-strategy rates with their denominators.
  expect(text).toMatch(/SplicR/);
  expect(text).toMatch(/FDR ranking/);
  // The comparison, stated as what it is entitled to say.
  expect(text).toMatch(/confirmed .* of its candidates than|Not comparable yet/);
  // And no claim that one strategy is better.
  expect(text).not.toMatch(/\bbetter\b|\boutperform/i);

  await shot(page, "09-results.png");
});
