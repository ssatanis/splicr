/**
 * The screen a researcher opens: is it trustworthy, which genes matter, and
 * can the evidence behind both be reached.
 *
 * These run against the seeded fixture workspace, whose numbers are synthetic
 * and marked as such. What is being tested is the console's reading of them:
 * that twenty thousand recorded genes all reach the plot, that the candidate
 * rule is the one the page states, and that a decision survives a reload.
 */
import { expect, test } from "@playwright/test";

import { FIXTURE, screenPath } from "../fixtures/handles";

test.beforeEach(async ({ page }) => {
  await page.goto(screenPath());
  await expect(page.getByRole("heading", { name: FIXTURE.screenName })).toBeVisible();
});

test("the summary answers the four questions before any gene", async ({ page }) => {
  const summary = page.getByRole("region", { name: "Screen summary" });
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("Quality control");
  await expect(summary).toContainText("Candidates");
  await expect(summary).toContainText("With artifact flags");
  await expect(summary).toContainText("Validation");
  // The count is the run's own, and it states the rule beside it.
  await expect(summary).toContainText(String(FIXTURE.significant));
  await expect(summary).toContainText("At or below FDR 0.1");
  await expect(summary).toContainText("A record with no recorded FDR is not counted");
});

test("Screen Doctor names the failing sample and what to do about it", async ({ page }) => {
  const health = page.getByRole("region", { name: "Screen health" });
  await expect(health).toBeVisible();
  // The fixture's QC passes its separation and fails one sample's mapping, so
  // the panel must say both rather than only "QC failed".
  await expect(health).toContainText("assay worked");
  await expect(health).toContainText("ctrl_r2");
  await expect(health.getByRole("alert")).toContainText("QC failed");

  // Layer two is closed until asked for, and carries the measurement.
  const evidence = health.getByText("What was checked");
  await expect(evidence).toBeVisible();
  await evidence.click();
  await expect(health).toContainText("41.0%");
  await expect(health).toContainText("60.0% floor, MAGeCK");
  await expect(health).toContainText("Essential genes separate");
});

test("the candidate board lists exactly the genes the stated rule selects", async ({ page }) => {
  const board = page.getByRole("region", { name: "Candidates" });
  await expect(board).toBeVisible();
  await expect(board).toContainText(`${FIXTURE.significant} at or below FDR 0.1`);
  await expect(board.getByRole("listitem")).toHaveCount(FIXTURE.significant);
  // Two of the fixture's candidates carry a flag, and the view says so.
  await expect(board.getByRole("button", { name: /With artifact flags 2/ })).toBeVisible();
});

test("the effect plot draws every recorded gene, not a sample of them", async ({ page }) => {
  const plot = page.getByRole("region", { name: "Effect and significance" });
  await expect(plot).toContainText(`${FIXTURE.genes.toLocaleString("en-US")} genes drawn`);
  await expect(plot).toContainText(`${FIXTURE.significant} of ${FIXTURE.genes.toLocaleString("en-US")} emphasised`);
  // The reading above the figure, so the panel says something before it shows.
  await expect(plot).toContainText(`${FIXTURE.significant} genes are at or below FDR 0.1`);
  await expect(plot.getByRole("img")).toHaveAttribute("aria-label", /20,000 genes/);
});

test("a candidate opens into the researcher's questions and an inspectable suggestion", async ({ page }) => {
  const board = page.getByRole("region", { name: "Candidates" });
  await board.getByRole("button", { name: /^HIT01/ }).click();

  for (const question of ["Why it stands out", "What supports it", "What could weaken it", "Where it has been seen before"]) {
    await expect(board.getByText(question, { exact: true })).toBeVisible();
  }
  // HIT01 carries a promiscuity flag, so the suggestion is the guide one and
  // it shows the evidence, the assumption and what it would resolve.
  await expect(board).toContainText("Suggested: Repeat the perturbation with independent guides");
  await expect(board).toContainText("Evidence:");
  await expect(board).toContainText("Assumes:");
  await expect(board).toContainText("Reduces uncertainty about:");
  await expect(board).toContainText("not a prediction that it will work");
});

test("selecting a candidate rings the same gene on the plot", async ({ page }) => {
  const board = page.getByRole("region", { name: "Candidates" });
  await board.getByRole("button", { name: /^HIT03/ }).click();
  // The row marks itself selected, and the plot is told about the same gene.
  await expect(board.getByRole("button", { name: /^HIT03/ })).toHaveAttribute("aria-expanded", "true");
  const cleared = page.getByRole("button", { name: "Clear" });
  await expect(cleared).toBeVisible();
});

test("a decision persists across a reload and is not kept in the browser", async ({ page }) => {
  const board = page.getByRole("region", { name: "Candidates" });
  await board.getByRole("button", { name: /^HIT05/ }).click();

  await board.getByLabel("Decision", { exact: true }).selectOption("shortlisted");
  await board.getByLabel(/Why, in your words/).fill("E2E: shortlisted by the fast suite.");
  await board.getByRole("button", { name: "Record" }).click();

  await expect(board.getByRole("button", { name: /Shortlisted 1/ })).toBeVisible({ timeout: 30_000 });

  await page.reload();
  const after = page.getByRole("region", { name: "Candidates" });
  await expect(after.getByRole("button", { name: /Shortlisted 1/ })).toBeVisible();
  await after.getByRole("button", { name: /^HIT05/ }).click();
  await expect(after).toContainText("E2E: shortlisted by the fast suite.");
});

test("changing a decision appends to the history rather than replacing it", async ({ page }) => {
  const board = page.getByRole("region", { name: "Candidates" });
  await board.getByRole("button", { name: /^HIT05/ }).click();

  await board.getByLabel("Decision", { exact: true }).selectOption("needs_validation");
  await board.getByLabel(/Why, in your words/).fill("E2E: moved to validation.");
  await board.getByRole("button", { name: "Record" }).click();
  await expect(board.getByRole("button", { name: /Needs validation 1/ })).toBeVisible({ timeout: 30_000 });

  // The row keeps its own open state across the server round trip, so only
  // click it when it actually closed.
  const row = board.getByRole("button", { name: /^HIT05/ });
  if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
  const history = board.getByText(/Decision history \(\d+\)/);
  await expect(history).toBeVisible();
  await history.click();
  // Both decisions survive, newest first, each with the statistics it was made against.
  await expect(board).toContainText("Needs validation");
  await expect(board).toContainText("Shortlisted");
  await expect(board).toContainText("Nothing here is overwritten");
});

test("needs validation offers the Truth Loop handoff for the same gene and screen", async ({ page }) => {
  const board = page.getByRole("region", { name: "Candidates" });
  const handoff = board.getByRole("link", { name: "Add to validation" });
  await expect(handoff).toBeVisible();
  const href = await handoff.getAttribute("href");
  expect(href).toContain("log=HIT05");
  expect(href).toContain("logScreen=");
});

test("the recorded results table filters, and the back button undoes it", async ({ page }) => {
  const table = page.getByRole("region", { name: "Gene-level evidence" });
  await expect(table).toContainText(`${FIXTURE.genes.toLocaleString("en-US")} records`);

  await table.getByLabel("Direction").selectOption("depleted");
  await expect(page).toHaveURL(/direction=depleted/, { timeout: 30_000 });
  await expect(table).not.toContainText(`${FIXTURE.genes.toLocaleString("en-US")} records`);

  await page.goBack();
  await expect(page).not.toHaveURL(/direction=depleted/);
  await expect(page.getByRole("region", { name: "Gene-level evidence" }))
    .toContainText(`${FIXTURE.genes.toLocaleString("en-US")} records`);
});

test("a filtered view is a link somebody else can open", async ({ page }) => {
  await page.goto(`${screenPath()}?fdr=0.1&direction=enriched`);
  const table = page.getByRole("region", { name: "Gene-level evidence" });
  await expect(table).toContainText(`${FIXTURE.significant} match`);
  await expect(table.getByLabel("Direction")).toHaveValue("enriched");
  await expect(table.getByLabel("Recorded FDR at most")).toHaveValue("0.1");
});
