/**
 * Release verification against the services nobody here controls.
 *
 * These are separated from the fast suite because they depend on Supabase Auth
 * delivery, on Resend, and on the deployed Modal app. Ordinary CI must not fail
 * because NCBI was slow, and a developer must not have to wait on a sweep to
 * know whether their change broke the console. Run with `npm run e2e:live`
 * before a release.
 *
 * Nothing here downloads sequencing data or creates an Atlas study. The
 * accession round trip uses a well-formed accession that is not in GEO, which
 * exercises every link in the chain - the form, the queue, the deployed drain,
 * the engine's real archive lookup, the write back and the console - and ends
 * in a refusal rather than in compute.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { readEnv } from "../fixtures/handles";

const run = promisify(execFile);

/**
 * Ask the deployed sweep to run now.
 *
 * Waiting for the two-hourly schedule would make this test a two-hour test, and
 * a test nobody runs proves nothing. This calls the same deployed function the
 * schedule calls, so what is exercised is still production.
 */
async function sweepNow(): Promise<void> {
  await run("python3", ["-c", [
    "import json, modal",
    "fn = modal.Function.from_name('splicr-ingest', 'sweep')",
    "print(json.dumps(fn.remote(), default=str))",
  ].join("\n")], { timeout: 10 * 60_000 });
}

function admin() {
  const config = readEnv();
  return createClient(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function userCount(): Promise<number> {
  const { data, error } = await admin().auth.admin.listUsers({ perPage: 200 });
  if (error) throw error;
  return data.users.length;
}

test.describe("authentication cannot be used to make an account", () => {
  test("a sign-in code for an unknown address is refused and creates nobody", async () => {
    const config = readEnv();
    const anonymous = createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const before = await userCount();

    const otp = await anonymous.auth.signInWithOtp({
      email: `nobody-${Date.now()}@splicr.invalid`,
      options: { shouldCreateUser: false },
    });

    expect(otp.error?.message ?? "").toMatch(/not allowed/i);
    expect(await userCount()).toBe(before);
  });

  test("a password reset for an unknown address is neutral and creates nobody", async () => {
    const config = readEnv();
    const anonymous = createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const before = await userCount();

    // No error, deliberately: telling a stranger whether an address has an
    // account is a disclosure, and the console says the same either way.
    const reset = await anonymous.auth.resetPasswordForEmail(`nobody-${Date.now()}@splicr.invalid`);
    expect(reset.error).toBeNull();
    expect(await userCount()).toBe(before);
  });

  test("the sign-in page says the same thing for an unknown address as for a known one", async ({ browser }) => {
    const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await anonymous.newPage();
    await page.goto("/forgot-password");
    await page.getByLabel(/email/i).fill(`nobody-${Date.now()}@splicr.invalid`);
    await page.getByRole("button", { name: /send|reset|email/i }).first().click();
    // Whatever it says, it must not say the address is unknown.
    await expect(page.getByText(/no account|not found|does not exist|unknown/i)).toHaveCount(0);
    await anonymous.close();
  });
});

test.describe("the accession request reaches the deployed engine", () => {
  test("a well-formed accession that is not in GEO comes back refused, with the reason", async ({ page }) => {
    test.setTimeout(10 * 60_000);
    const accession = `GSE9999999${Math.floor(Math.random() * 9)}`;

    await page.goto("/dashboard/new");
    await page.getByLabel("Accession", { exact: true }).fill(accession);
    await page.getByRole("button", { name: "Queue the analysis" }).click();

    const panel = page.getByRole("region", { name: "Analyse a public accession" });
    await expect(panel).toContainText(accession, { timeout: 60_000 });
    await expect(panel).toContainText("Queued");

    await sweepNow();

    await expect(async () => {
      await page.reload();
      await expect(page.getByRole("region", { name: "Analyse a public accession" }))
        .not.toContainText("Queued");
    }).toPass({ timeout: 4 * 60_000, intervals: [10_000] });

    const after = page.getByRole("region", { name: "Analyse a public accession" });
    await expect(after).toContainText("Not accepted");
    // The engine's own words, not a template chosen from the status.
    await expect(after).toContainText(/not found in GEO/);

    // And nothing was created in the shared evidence for a study that is not there.
    await expect(after).not.toContainText("In the Atlas");
  });
});
