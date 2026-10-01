/**
 * Seed the fixture and sign the disposable researcher in once.
 *
 * The session is minted through Supabase's own admin API and exchanged for
 * cookies by the app's real `/auth/callback` route, so the suite runs against
 * the session machinery the product ships rather than against a stub. It does
 * not type a password anywhere: there is no password on the fixture account,
 * which is also why that account cannot be used to log in by hand.
 */
import fs from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";
import { expect, test as setup } from "@playwright/test";

import { FIXTURE, readEnv, seed } from "./fixtures/handles";

const E2E = path.resolve(process.cwd(), "e2e");
const STATE = path.join(E2E, ".auth/researcher.json");

setup("seed the fixture workspace and sign in", async ({ page, context }) => {
  setup.setTimeout(180_000);

  const seeded = await seed();
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(
    path.join(E2E, ".auth/fixture.json"),
    `${JSON.stringify({ orgId: seeded.orgId, screenId: seeded.screenId, runId: seeded.runId }, null, 1)}\n`,
  );

  const config = readEnv();
  const admin = createClient(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email: FIXTURE.email });
  if (link.error) throw link.error;

  await page.goto(
    `/auth/callback?token_hash=${link.data.properties.hashed_token}&type=magiclink&next=/dashboard`,
  );
  // The console, not the sign-in page: a redirect back to /login means the
  // exchange failed and every later test would be asserting against a stranger.
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 60_000 });
  await expect(page.getByRole("link", { name: "New screen" }).first()).toBeVisible();

  await context.storageState({ path: STATE });
});
