/**
 * Workspace setup, walked in both directions.
 *
 * The thing this guards is not that the buttons exist. It is that moving
 * backwards neither discards what is on screen nor rewinds how far the
 * researcher has got. Before, `onboarding_step` was assigned the step after
 * whichever form was submitted, so correcting a name from step four pushed
 * somebody back to step two and made them walk the wizard again.
 *
 * The fixture researcher is seeded past onboarding, so the spec reopens it,
 * walks it, and puts the account back exactly as it found it — including the
 * laboratory fields it edits on the way.
 */
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { FIXTURE, fixtureIds, readEnv } from "../fixtures/handles";

function admin() {
  const config = readEnv();
  return createClient(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function profile() {
  const { data } = await admin()
    .from("profiles")
    .select("id, onboarding_step, onboarding_completed_at, professional_role, institution, full_name, time_zone")
    .eq("email", FIXTURE.email)
    .single();
  return data as {
    id: string; onboarding_step: number; onboarding_completed_at: string | null;
    professional_role: string | null; institution: string | null; full_name: string | null;
    time_zone: string | null;
  };
}

async function organization() {
  const { data } = await admin()
    .from("organizations")
    .select("id, name, location, time_zone")
    .eq("id", fixtureIds().orgId)
    .single();
  return data as { id: string; name: string; location: string | null; time_zone: string | null };
}

test("setup can be walked backwards without losing edits or progress", async ({ page }) => {
  test.setTimeout(120_000);

  const before = await profile();
  const org = await organization();
  const supabase = admin();

  // Reopen the wizard at its furthest point, which is the state that used to
  // be destroyed by going back.
  await supabase
    .from("profiles")
    .update({ onboarding_step: 4, onboarding_completed_at: null })
    .eq("id", before.id);

  try {
    await page.goto("/dashboard/onboarding");
    await expect(page.getByRole("heading", { name: "Make SplicR yours" })).toBeVisible();
    await expect(page).toHaveURL(/step=4|onboarding$/);
    await expect(page.getByRole("heading", { name: "Analysis defaults" })).toBeVisible();

    // Every earlier step is a link, because every earlier step has been reached.
    await expect(page.getByRole("link", { name: /Your profile/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Laboratory/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Team/ })).toBeVisible();

    await page.getByRole("button", { name: "Back to your team" }).click();
    await expect(page).toHaveURL(/step=3/);
    await expect(page.getByRole("heading", { name: "Your team" })).toBeVisible();

    await page.getByRole("button", { name: "Back to the laboratory" }).click();
    await expect(page).toHaveURL(/step=2/);

    // An edit made on the way back is written, not dropped.
    await page.getByLabel("Location").fill("Backwards, Nowhere");
    await page.getByRole("button", { name: "Back to your profile" }).click();
    await expect(page).toHaveURL(/step=1/);
    expect((await organization()).location).toBe("Backwards, Nowhere");

    // Reaching step one again must not rewind how far this researcher has got.
    expect((await profile()).onboarding_step).toBe(4);

    // And the chips still offer the whole wizard, so they are not stranded.
    await page.getByRole("link", { name: /Analysis defaults/ }).click();
    await expect(page).toHaveURL(/step=4/);
    await expect(page.getByRole("heading", { name: "Analysis defaults" })).toBeVisible();
  } finally {
    await supabase
      .from("organizations")
      .update({ name: org.name, location: org.location, time_zone: org.time_zone })
      .eq("id", org.id);
    await supabase
      .from("profiles")
      .update({
        onboarding_step: before.onboarding_step,
        onboarding_completed_at: before.onboarding_completed_at,
      })
      .eq("id", before.id);
  }
});

test("a step that has not been reached cannot be skipped to", async ({ page }) => {
  const before = await profile();
  const supabase = admin();
  await supabase
    .from("profiles")
    .update({ onboarding_step: 1, onboarding_completed_at: null })
    .eq("id", before.id);

  try {
    // Finishing from step four with an unfilled step one would complete setup
    // with no name, role or institution on the account.
    await page.goto("/dashboard/onboarding?step=4");
    await expect(page.getByRole("heading", { name: "Your researcher profile" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Analysis defaults" })).toHaveCount(0);
  } finally {
    await supabase
      .from("profiles")
      .update({
        onboarding_step: before.onboarding_step,
        onboarding_completed_at: before.onboarding_completed_at,
      })
      .eq("id", before.id);
  }
});

test("the laboratory step welcomes the lab, and the team step can invite", async ({ page }) => {
  test.setTimeout(120_000);

  const before = await profile();
  const org = await organization();
  const supabase = admin();
  await supabase
    .from("profiles")
    .update({ onboarding_step: 4, onboarding_completed_at: null })
    .eq("id", before.id);

  try {
    await page.goto("/dashboard/onboarding?step=2");
    // Named, not described: a researcher being added to a lab should be told
    // which lab, not told that an identity exists somewhere.
    await expect(page.getByRole("heading", { name: `Welcome to ${org.name}` })).toBeVisible();

    await page.goto("/dashboard/onboarding?step=3");
    await expect(page.getByRole("heading", { name: "Your team" })).toBeVisible();

    // Inviting happens here rather than on a page that loses your place.
    const email = page.getByLabel("Email address to invite");
    await expect(email).toBeVisible();
    await expect(page.getByRole("button", { name: "Send invitation" })).toBeDisabled();

    // An address already in the lab is refused before anything is written or
    // emailed, which is what makes this safe to assert against.
    await email.fill(FIXTURE.email);
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByRole("status")).toContainText("already a member of this workspace");

    const { data: invites } = await supabase
      .from("org_invites")
      .select("id")
      .eq("org_id", org.id)
      .eq("email", FIXTURE.email);
    expect(invites ?? []).toHaveLength(0);
  } finally {
    await supabase
      .from("profiles")
      .update({
        onboarding_step: before.onboarding_step,
        onboarding_completed_at: before.onboarding_completed_at,
      })
      .eq("id", before.id);
  }
});
