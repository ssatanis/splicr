/**
 * The rest of the console: that every route a researcher reaches renders for a
 * signed-in session, says something true when it has nothing to show, and does
 * not offer a control it cannot honour.
 *
 * These are deliberately shallow. Each page's own behaviour is covered by its
 * unit tests; what cannot be covered there is that the page renders at all
 * against a real session, a real database and the real component tree.
 */
import { expect, test } from "@playwright/test";

import { FIXTURE } from "../fixtures/handles";

test("a signed-out visitor is sent to sign in and no further", async ({ browser }) => {
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await anonymous.newPage();
  await page.goto("/dashboard/screens");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText(/by invitation/i)).toBeVisible();
  // There is no way to make an account from here.
  await expect(page.getByRole("link", { name: /sign up|create an account/i })).toHaveCount(0);
  await anonymous.close();
});

test("there is no public signup form, signed in or out", async ({ page, browser }) => {
  // Signed in, /signup lands on the console; signed out, on sign-in. Neither
  // renders a way to make an account.
  await page.goto("/signup");
  await expect(page).toHaveURL(/\/dashboard/);

  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const stranger = await anonymous.newPage();
  await stranger.goto("/signup");
  await expect(stranger).toHaveURL(/\/login/);
  await expect(stranger.getByLabel(/^password/i)).toHaveCount(1, { timeout: 10_000 });
  await expect(stranger.getByRole("button", { name: /create|sign up/i })).toHaveCount(0);
  await anonymous.close();
});

test("the overview greets the researcher and offers the one obvious action", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: "New screen" }).first()).toBeVisible();
  await expect(page.getByText(/^(Good morning|Good afternoon|Good evening)/)).toBeVisible();
});

test("the screens list shows the fixture screen and links to it", async ({ page }) => {
  await page.goto("/dashboard/screens");
  const link = page.getByRole("link", { name: FIXTURE.screenName });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.getByRole("region", { name: "Screen summary" })).toBeVisible();
});

test("new screen offers the accession path and refuses what it cannot resolve", async ({ page }) => {
  await page.goto("/dashboard/new");
  const field = page.getByLabel("Accession", { exact: true });
  await field.fill("SRR11086081");
  // A run accession is not a study, so the control refuses it before the server does.
  await expect(page.getByText(/not a shape SplicR can resolve/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Queue the analysis" })).toBeDisabled();
  // And there is no file input, because nothing would consume the job.
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
});

test("the planner is three steps and the plan updates as the design changes", async ({ page }) => {
  await page.goto("/dashboard/planner");
  const steps = page.getByRole("navigation", { name: "Planner steps" });
  await expect(steps.getByRole("button")).toHaveCount(3);

  const plan = page.getByRole("region", { name: "The plan" });
  await expect(plan).toContainText("Cells to transduce");
  const before = await plan.innerText();

  await steps.getByRole("button", { name: /Scale/ }).click();
  await page.getByLabel(/Cells per guide/).fill("1000");
  await page.getByLabel(/Cells per guide/).blur();
  await expect
    .poll(async () => (await plan.innerText()) !== before, { timeout: 15_000 })
    .toBe(true);
});

test("a planner design is a link that reopens as it was", async ({ page }) => {
  await page.goto("/dashboard/planner?cov=120&moi=0.8&rep=1");
  const plan = page.getByRole("region", { name: "The plan" });
  await expect(plan).toContainText("need");
  await expect(plan).toContainText("Coverage is below");
});

for (const [name, route, expected] of [
  ["Atlas", "/dashboard/atlas", /Atlas/i],
  ["Truth Loop", "/dashboard/validation", /validation|Truth Loop/i],
  ["Connect", "/dashboard/connect", /Connect|API/i],
  ["Settings", "/dashboard/settings", /Profile|Settings/i],
] as const) {
  test(`${name} renders for a signed-in researcher`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(route);
    await expect(page.getByRole("main")).toContainText(expected);
    expect(errors, `${name} threw in the browser`).toEqual([]);
  });
}

test("the command palette opens and finds the fixture screen", async ({ page }) => {
  await page.goto("/dashboard");
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog");
  await expect(palette).toBeVisible();
  await palette.getByRole("combobox").or(palette.getByRole("textbox")).first().fill("fixture");
  await expect(palette).toContainText(/fixture/i, { timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
});

test("signing out ends the session", async ({ page, context }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/(login|$)/, { timeout: 30_000 });
  await page.goto("/dashboard/screens");
  await expect(page).toHaveURL(/\/login/);
  // Leave the stored state untouched for the specs that follow in other files.
  await context.clearCookies();
});
