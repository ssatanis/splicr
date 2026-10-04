/**
 * The Validation Network, against a real session and a real database.
 *
 * What cannot be covered by a unit test is that the whole chain holds: the form
 * writes an experiment type and its prespecified criteria, the server scores
 * the measurement against the endpoint it chose, the database accepts the row
 * under RLS, the ladder view places it on the right rung, and the network page
 * says — truthfully, from the database and not from a string — that no
 * calibrated probability is available and what would change that.
 *
 * Every outcome these tests create belongs to the disposable researcher's own
 * workspace and is removed at the end, so a canonical record is never
 * rewritten by a test.
 */
import { expect, test, type Page } from "@playwright/test";

import { FIXTURE } from "../fixtures/handles";

const TRUTH_LOOP = "/dashboard/validation";
const NETWORK = "/dashboard/validation/network";

/**
 * Open the network page and wait for it to have arrived.
 *
 * The page runs several reads before it can render and shows a loading skeleton
 * meanwhile. Reading `innerText` straight after `goto` races that skeleton, and
 * a test that sometimes asserts against a loading state is worse than no test.
 */
async function openNetwork(page: Page) {
  await page.goto(NETWORK);
  await expect(page.getByRole("heading", { name: "Validation Network" })).toBeVisible();
  // The setup form is the page's primary content, so its presence means the
  // server component finished rather than merely started.
  await expect(page.getByRole("region", { name: /^Set up a round/ })).toBeVisible();
}

/** A gene nobody else in the fixture touches, per test, so runs do not collide. */
const gene = (suffix: string) => `E2E${suffix}${Date.now().toString(36).slice(-4)}`.toUpperCase();

async function logOutcome(
  page: Page,
  options: {
    gene: string;
    experiment: string;
    result: string;
    effect?: string;
    replicates?: string;
    independent?: "Yes" | "No" | "Not recorded";
    compound?: string;
  },
) {
  await page.goto(TRUTH_LOOP);
  await page.getByRole("button", { name: /log an outcome|log the first outcome/i }).first().click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();

  await drawer.getByLabel("Screen").selectOption({ label: FIXTURE.screenName });
  await drawer.getByLabel("Gene symbol").fill(options.gene);
  await drawer.getByLabel("Which experiment was this?").selectOption({ label: options.experiment });
  await drawer.getByRole("radio", { name: new RegExp(options.result, "i") }).click();
  if (options.effect !== undefined) await drawer.getByLabel("Effect size").fill(options.effect);
  if (options.replicates !== undefined) {
    await drawer.getByLabel("Biological replicates").fill(options.replicates);
  }
  if (options.independent !== undefined) {
    await drawer.getByLabel("Independent perturbation").selectOption({ label: options.independent });
  }
  if (options.compound !== undefined) {
    await drawer.getByLabel("Compound").fill(options.compound);
  }
  await drawer.getByRole("button", { name: "Save outcome" }).click();
  await expect(drawer).toBeHidden();
}

async function removeOutcomes(page: Page, symbol: string) {
  for (let attempt = 0; attempt < 8; attempt++) {
    await page.goto(`${TRUTH_LOOP}?q=${encodeURIComponent(symbol)}`);
    const row = page.getByRole("button", { name: new RegExp(`^${symbol}`, "i") }).first();
    if ((await row.count()) === 0) return;
    await row.click();
    const drawer = page.getByRole("dialog");
    await drawer.getByRole("button", { name: "Delete" }).click();
    await drawer.getByRole("button", { name: "Yes, delete" }).click();
    await expect(drawer).toBeHidden();
  }
}

test("the page is the round, and nothing else", async ({ page }) => {
  await openNetwork(page);
  const body = (await page.locator("main").innerText()).replace(/\s+/g, " ");

  // The thing you do is open on arrival, and the list it adds to is visible at
  // the same time. A drawer over the page made that impossible.
  expect(body).toContain("Set up a round");
  // Uppercased by CSS, so matched case-insensitively.
  expect(body).toMatch(/this will draw/i);
  expect(body).toContain("Rounds");
  expect(body).toMatch(/Test your top hits at the bench/);

  // Nothing is calibrated, so there is no calibration section. A permanent line
  // saying so is a true sentence a researcher cannot act on.
  expect(body).not.toMatch(/No calibrated probability is available/);
  expect(body).not.toMatch(/questions calibrated/);
  expect(body).not.toContain("Independent genetic reproduction in the same model");
  await expect(page.locator("main details")).toHaveCount(0);

  // Not a single percentage anywhere, because there is nothing to put one on.
  expect(body).not.toMatch(/(?<![-\u2013])\b\d{1,3}%/);
  // And no long dashes.
  expect(body).not.toMatch(/[\u2014\u2013]/);
});

test("the preview answers what a configuration will do before it does it", async ({ page }) => {
  await openNetwork(page);
  const setup = page.getByRole("region", { name: /^Set up a round/ });
  await setup.getByLabel("Budget").fill("20");
  await expect(setup.getByText(/20 candidates to test/)).toBeVisible();
  await expect(setup.getByText(/About 5 from each of 4 strategies/)).toBeVisible();

  // It follows the controls.
  await setup.getByRole("checkbox", { name: /Random across ranks/ }).uncheck();
  await expect(setup.getByText(/About 6 from each of 3 strategies/)).toBeVisible();

  // And it refuses a configuration that cannot work, with the reason.
  await setup.getByLabel("Budget").fill("2");
  await expect(setup.getByText(/Budget is a whole number from 4 to 500/)).toBeVisible();
  await expect(setup.getByRole("button", { name: "Draw the set" })).toBeDisabled();
});

test("the page is controls and tables rather than paragraphs", async ({ page }) => {
  await openNetwork(page);
  // Prose creeps back one sentence at a time, so the budget is checked against
  // the rendered page rather than trusted. Measured over paragraphs and list
  // items only: a table's cells carry figures.
  const words = await page.evaluate(() => {
    const main = document.querySelector("main");
    if (!main) return 0;
    return [...main.querySelectorAll("p, li")]
      .map((node) => (node.textContent ?? "").trim())
      .join(" ")
      .split(/\s+/)
      .filter(Boolean).length;
  });
  expect(words).toBeLessThanOrEqual(140);

  // And it is controls, not reading. A page with no round yet has no table to
  // show, which is correct; what it must have is the thing you act on.
  const controls = await page.locator("main select, main input, main button").count();
  expect(controls).toBeGreaterThanOrEqual(8);
});

test("the endpoint a round will use explains itself where it is chosen", async ({ page }) => {
  await openNetwork(page);
  const setup = page.getByRole("region", { name: /^Set up a round/ });
  await expect(setup.getByText("What counts as validated")).toBeVisible();
  // Every endpoint is selectable, and the chosen one says what a negative
  // result on it does not mean, under the control that picks it.
  const options = await setup.getByLabel("What counts as validated").locator("option").count();
  expect(options).toBeGreaterThanOrEqual(9);
  await expect(
    setup.getByText(/does not establish that the gene has no phenotype/),
  ).toBeVisible();

  await setup
    .getByLabel("What counts as validated")
    .selectOption({ label: "Selective small-molecule inhibition" });
  await expect(setup.getByText(/not evidence that the screen hit was false/)).toBeVisible();
});

test("a round can be drawn, frozen into a receipt, and revealed", async ({ page }) => {
  // The whole prospective discipline, end to end: a ranked set committed to a
  // content hash before any outcome exists, and a hash that cannot be rewritten
  // afterwards.
  await openNetwork(page);
  const setup = page.getByRole("region", { name: /^Set up a round/ });
  if ((await setup.getByRole("button", { name: "Draw the set" }).count()) === 0) {
    test.skip(true, "this workspace has no screen with recorded hits to draw from");
    return;
  }

  const name = `E2E round ${Date.now().toString(36).slice(-5)}`;
  await setup.getByLabel("Name").fill(name);
  await setup.getByLabel("Budget").fill("8");
  const threshold = setup.getByLabel("Counts as a pass");
  if ((await threshold.count()) > 0) await threshold.fill("1");
  await setup.getByRole("button", { name: "Draw the set" }).click();

  const row = page.getByRole("row", { name: new RegExp(name) });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Draft");
  // A draft has no receipt: nothing has been committed.
  await expect(row).not.toContainText(/[0-9a-f]{12}/);

  // Freeze. The confirmation names what is about to be committed.
  await row.getByRole("button", { name: "Freeze" }).click();
  await expect(row.getByText(/Commit \d+\?/)).toBeVisible();
  await row.getByRole("button", { name: "Yes" }).click();

  const frozen = page.getByRole("row", { name: new RegExp(name) });
  await expect(frozen).toContainText("Frozen");
  await expect(frozen).toContainText(/[0-9a-f]{12}/);

  // Reveal ends the blind. A revealed round links straight to its results, or
  // to the Truth Loop when nothing has come back yet.
  await frozen.getByRole("button", { name: "Reveal" }).click();
  await frozen.getByRole("button", { name: "Yes" }).click();
  const revealed = page.getByRole("row", { name: new RegExp(name) });
  await expect(revealed).toContainText("Revealed");
  await expect(revealed.getByRole("link", { name: /See results/ })).toBeVisible();
});

test("an outcome must name its experiment before it can be saved", async ({ page }) => {
  await page.goto(TRUTH_LOOP);
  await page.getByRole("button", { name: /log an outcome|log the first outcome/i }).first().click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("Screen").selectOption({ label: FIXTURE.screenName });
  await drawer.getByLabel("Gene symbol").fill("TP53");
  await drawer.getByRole("radio", { name: /validated at the bench/i }).click();
  await drawer.getByRole("button", { name: "Save outcome" }).click();

  // The drawer stays open with the field's own message, and nothing was saved.
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Choose which experiment this was.")).toBeVisible();
});

test("choosing the experiment says which question it bears on", async ({ page }) => {
  await page.goto(TRUTH_LOOP);
  await page.getByRole("button", { name: /log an outcome|log the first outcome/i }).first().click();
  const drawer = page.getByRole("dialog");
  const select = drawer.getByLabel("Which experiment was this?");

  await select.selectOption({ label: "Independent CRISPR guide" });
  await expect(
    drawer.getByText(/Bears on: independent genetic reproduction in the same model/i),
  ).toBeVisible();

  await select.selectOption({ label: "Small-molecule inhibition" });
  await expect(
    drawer.getByText(/Bears on: pharmacologic recapitulation with a selective compound/i),
  ).toBeVisible();
  // A compound only matters for this one, so it appears only here.
  await expect(drawer.getByLabel("Compound")).toBeVisible();

  await select.selectOption({ label: "CRISPRi" });
  await expect(drawer.getByLabel("Compound")).toHaveCount(0);

  // 'Other' bears on nothing, and says so rather than being hidden.
  await select.selectOption({ label: "Other" });
  await expect(drawer.getByText(/Bears on none of the four questions/)).toBeVisible();
});

test("a prespecified criterion can be left not recorded, which is not 'no'", async ({ page }) => {
  await page.goto(TRUTH_LOOP);
  await page.getByRole("button", { name: /log an outcome|log the first outcome/i }).first().click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("Which experiment was this?").selectOption({ label: "CRISPRi" });

  const independent = drawer.getByLabel("Independent perturbation");
  await expect(independent).toHaveValue("");
  await expect(independent.getByRole("option", { name: "Not recorded" })).toHaveCount(1);
  await expect(
    drawer.getByText(/Blank is not .no.: an outcome missing a criterion the endpoint requires/),
  ).toBeVisible();
});

test("PRKDC climbs the ladder genetically and does not climb it pharmacologically", async ({
  page,
}) => {
  // The published case, reproduced through the product end to end. In
  // doi:10.1158/0008-5472.CAN-24-0775 the individual gRNAs reduced organoid
  // growth while the LTURM34 and AZD7648 inhibitors showed no potent activity
  // at the tested concentrations. Both facts are true, and the ladder has to
  // hold both without averaging them.
  const symbol = gene("PRKDC");
  try {
    await logOutcome(page, {
      gene: symbol,
      experiment: "Independent CRISPR guide",
      result: "Validated at the bench",
      effect: "-1.4",
      replicates: "3",
      independent: "Yes",
    });
    await logOutcome(page, {
      gene: symbol,
      experiment: "Small-molecule inhibition",
      result: "Did not validate",
      effect: "-0.05",
      replicates: "3",
      independent: "Yes",
      compound: "AZD7648",
    });

    await page.goto(`${TRUTH_LOOP}?gene=${symbol}`);
    const ladder = page.getByRole("region", { name: new RegExp(`Validation ladder: ${symbol}`, "i") });
    await expect(ladder).toBeVisible();

    const text = (await ladder.innerText()).replace(/\s+/g, " ");
    // Genetic reproduction met; pharmacologic not met; the untested rungs are
    // "Not tested" and never styled or worded as failures.
    expect(text).toMatch(/Guide reproducibility Met/);
    expect(text).toMatch(/Pharmacologic evidence Not met/);
    expect(text).toMatch(/Orthogonal genetic evidence Not tested/);
    expect(text).toMatch(/In vivo Not tested/);
    expect(text).toMatch(/not a negative result about this gene/);
    // The next experiment is the earliest untested rung, not a repeat of one
    // that already has an answer.
    expect(text).toMatch(/Next: Orthogonal genetic evidence/);
    // No probability on any rung, because none is calibrated.
    expect(text).toMatch(/No calibrated probability is available/);
    expect(text).not.toMatch(/\b\d{1,3}%/);
  } finally {
    await removeOutcomes(page, symbol);
  }
});

test("two inhibitors that disagree leave the rung mixed, not failed", async ({ page }) => {
  // PTK2 in the same paper: GSK2256098 had no effect on either organoid line
  // and PF-573228 produced a partial response in one. Calling that rung
  // "failed" or "met" would both be wrong.
  const symbol = gene("PTK2");
  try {
    await logOutcome(page, {
      gene: symbol,
      experiment: "Small-molecule inhibition",
      result: "Did not validate",
      effect: "-0.01",
      replicates: "3",
      independent: "Yes",
      compound: "GSK2256098",
    });
    await logOutcome(page, {
      gene: symbol,
      experiment: "Small-molecule inhibition",
      result: "Validated at the bench",
      effect: "-0.9",
      replicates: "3",
      independent: "Yes",
      compound: "PF-573228",
    });

    await page.goto(`${TRUTH_LOOP}?gene=${symbol}`);
    const ladder = page.getByRole("region", { name: new RegExp(`Validation ladder: ${symbol}`, "i") });
    const text = (await ladder.innerText()).replace(/\s+/g, " ");
    expect(text).toMatch(/Pharmacologic evidence Mixed/);
    expect(text).toMatch(/1 met, 1 did not/);
    expect(text).toMatch(/disagreement is information rather than noise/);
    // A mixed rung is worth another replicate before a new rung is climbed.
    expect(text).toMatch(/Next: Pharmacologic evidence/);
  } finally {
    await removeOutcomes(page, symbol);
  }
});

test("the Truth Loop shows the experiment, and the engine's verdict only when it disagrees", async ({
  page,
}) => {
  const symbol = gene("CDK2");
  try {
    await logOutcome(page, {
      gene: symbol,
      experiment: "Independent CRISPR guide",
      result: "Validated at the bench",
      effect: "-1.4",
      replicates: "3",
      independent: "Yes",
    });
    await page.goto(`${TRUTH_LOOP}?q=${symbol}`);
    const row = page.getByRole("row", { name: new RegExp(symbol, "i") }).first();
    await expect(row).toContainText("Independent CRISPR guide");
    await expect(row).toContainText("Validated");
    // Logged outside a round there is no prespecified laboratory bar, so the
    // record is not scorable against the endpoint. That is a gap in the
    // record, not a disagreement, so the row is not annotated.
    await expect(row).not.toContainText("against the endpoint");
    // And the workspace's own contribution shows up on the network page.
    await openNetwork(page);
    // The outcome is in the Truth Loop; the network page is about rounds now.
    await expect(page.getByRole("region", { name: /^Set up a round/ })).toBeVisible();
  } finally {
    await removeOutcomes(page, symbol);
  }
});

test("the outcome export carries the experiment and the question it bears on", async ({ page }) => {
  const symbol = gene("EXP");
  try {
    await logOutcome(page, {
      gene: symbol,
      experiment: "CRISPRi",
      result: "Inconclusive",
      replicates: "2",
    });
    await page.goto(`${TRUTH_LOOP}?q=${symbol}`);
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: /export csv/i }).first().click();
    const file = await download;
    const body = (await (await import("node:fs/promises")).readFile(await file.path())).toString();

    expect(body).toMatch(/validation_type/);
    expect(body).toMatch(/"crispri"/);
    expect(body).toMatch(/"target_specific"/);
    // The preamble says what the four questions are for and what
    // 'insufficient_record' does not mean.
    expect(body).toMatch(/The four never share a number/);
    expect(body).toMatch(/it is NOT a failure and belongs in neither/);
    expect(body).toMatch(/means not recorded, which is not the same as false/);
  } finally {
    await removeOutcomes(page, symbol);
  }
});
