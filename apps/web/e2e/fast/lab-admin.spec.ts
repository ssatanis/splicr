/**
 * Running a lab: the rail, the palette, the logo and the usage page, against a
 * real session and the real database.
 *
 * The unit tests already cover what each action refuses and what the panel
 * says. What they cannot cover is the part that only exists once a browser has
 * laid the page out: whether a 68px rail scrolls sideways, whether a focus ring
 * is drawn, and whether a file picked in a browser ends up in a bucket and back
 * on the page as an image.
 */
import { expect, test } from "@playwright/test";

import { FIXTURE } from "../fixtures/handles";

const RAIL_COOKIE = "splicr_rail";

/** Open the console with the rail already collapsed, as a returning visitor. */
async function collapsed(page: import("@playwright/test").Page) {
  await page.context().addCookies([
    { name: RAIL_COOKIE, value: "1", url: "http://localhost:3000" },
  ]);
  await page.goto("/dashboard/settings");
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
}

test("a collapsed rail does not scroll sideways", async ({ page }) => {
  await collapsed(page);
  const nav = page.locator('nav[aria-label="Workspace"]');
  const overflow = await nav.evaluate((el) => el.scrollWidth - el.clientWidth);
  // The label beside each icon used to sit at left-full inside this scroller,
  // which both put a horizontal scrollbar across the rail and left the label
  // clipped by the rail's own overflow. It is a fixed box now.
  expect(overflow, "the navigation has nothing to scroll to horizontally").toBe(0);
});

test("a collapsed rail names an item on keyboard focus, outside the rail", async ({ page }) => {
  await collapsed(page);
  const rail = page.locator("aside").first();
  const link = page.locator('aside a[href="/dashboard/atlas"]');
  await link.focus();

  const tip = page.getByText("Atlas", { exact: true }).locator("visible=true").last();
  await expect(tip).toBeVisible();

  const [tipBox, railBox] = await Promise.all([tip.boundingBox(), rail.boundingBox()]);
  expect(tipBox && railBox).toBeTruthy();
  expect(tipBox!.x, "the label clears the rail rather than being clipped by it").toBeGreaterThanOrEqual(
    railBox!.x + railBox!.width - 1,
  );
});

test("the command palette field takes focus without a ring around it", async ({ page }) => {
  await page.goto("/dashboard");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");

  const input = page.locator(".palette-input");
  await expect(input).toBeFocused();
  const drawn = await input.evaluate((el) => ({
    focusVisible: el.matches(":focus-visible"),
    outline: getComputedStyle(el).outlineStyle,
    shadow: getComputedStyle(el).boxShadow,
  }));
  // It matches :focus-visible, which is exactly the state the console's navy
  // ring is drawn for, and no ring is drawn.
  expect(drawn.focusVisible).toBe(true);
  expect(drawn.outline).toBe("none");
  expect(drawn.shadow).toBe("none");

  // Everything else in the console still gets one.
  await page.keyboard.press("Escape");
  const ring = await page
    .getByRole("link", { name: "New analysis" })
    .first()
    .evaluate((el) => {
      el.focus();
      return getComputedStyle(el).outlineStyle;
    });
  expect(ring).toBe("solid");
});

test("a lab logo is uploaded, replaces the one before it, and can be taken off again", async ({
  page,
}) => {
  await page.goto("/dashboard/settings?panel=lab");

  // The URL field is gone: a lab is asked for a file, not for somewhere it has
  // already hosted one.
  await expect(page.getByLabel("Lab logo URL")).toHaveCount(0);

  const picker = page.getByLabel("Lab logo image file");
  const placeholder = page.getByText("Lab logo", { exact: true });
  await expect(placeholder).toBeVisible();

  const png = (seed: number) =>
    page.evaluate(async (n) => {
      const canvas = document.createElement("canvas");
      canvas.width = 32;
      canvas.height = 32;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = n === 1 ? "#0f766e" : "#1d4ed8";
      ctx.fillRect(0, 0, 32, 32);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      const bytes = new Uint8Array(await blob!.arrayBuffer());
      return Array.from(bytes);
    }, seed);

  await picker.setInputFiles({
    name: "crest.png",
    mimeType: "image/png",
    buffer: Buffer.from(await png(1)),
  });
  await expect(page.getByText("Logo saved.")).toBeVisible({ timeout: 15_000 });

  const mark = page.getByRole("img", { name: `${FIXTURE.orgName} logo` }).first();
  await expect(mark).toBeVisible();
  const first = await mark.evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(first).toContain("/lab-logos/");

  // Replacing writes a new object rather than overwriting, so the address
  // changes and no reader is served a half-written file under the old one.
  await picker.setInputFiles({
    name: "crest-2.png",
    mimeType: "image/png",
    buffer: Buffer.from(await png(2)),
  });
  await expect(page.getByText("Logo saved.")).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(async () => mark.evaluate((el) => getComputedStyle(el).backgroundImage), {
      timeout: 15_000,
    })
    .not.toBe(first);

  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Logo removed.")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("img", { name: `${FIXTURE.orgName} logo` })).toHaveCount(0);
});

test("a file that is not an image is refused, whatever it calls itself", async ({ page }) => {
  await page.goto("/dashboard/settings?panel=lab");
  await page.getByLabel("Lab logo image file").setInputFiles({
    name: "crest.png",
    mimeType: "image/png",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'),
  });
  await expect(page.getByText(/has to be a PNG, JPEG or WebP/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("img", { name: `${FIXTURE.orgName} logo` })).toHaveCount(0);
});

test("usage names one plan for the lab and counts what its people have done", async ({ page }) => {
  await page.goto("/dashboard/settings?panel=usage");

  await expect(
    page.getByText(/Everything here is carried by .* on the .* plan/),
  ).toBeVisible();
  await expect(
    page.getByText(/do not get a workspace or a plan of their own/),
  ).toBeVisible();

  // The fixture workspace has one person and one screen, and the table says so
  // rather than showing a total with nobody attached to it.
  const row = page.getByRole("row").filter({ hasText: FIXTURE.email });
  await expect(row).toHaveCount(1);
  await expect(row.getByText("Owner")).toBeVisible();

  const screens = await page
    .getByRole("row")
    .filter({ hasText: FIXTURE.email })
    .locator("td")
    .nth(2)
    .innerText();
  expect(Number(screens)).toBeGreaterThanOrEqual(1);

  // Nothing counts down from an allowance, because nothing enforces one.
  await expect(page.getByText(/seats|quota|remaining/i)).toHaveCount(0);
});

test("only an admin is offered the controls that change who is in the lab", async ({ page }) => {
  await page.goto("/dashboard/settings/members");
  // The fixture researcher owns their workspace, so the panel is theirs.
  await expect(page.getByRole("heading", { name: "Invite somebody" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Role for the person/ })).toBeVisible();

  // And the roles on offer are named the way a lab names them.
  await page.getByRole("button", { name: /Role for the person/ }).click();
  for (const role of ["Owner", "Admin", "Researcher", "Viewer"]) {
    await expect(page.getByRole("menuitem").filter({ hasText: role }).first()).toBeVisible();
  }
  await expect(page.getByRole("menuitem").filter({ hasText: /^Member/ })).toHaveCount(0);
});
