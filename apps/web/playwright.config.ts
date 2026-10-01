/**
 * Two suites, deliberately separated.
 *
 * `fast` drives the console against the workspace's own recorded screen with a
 * session minted for a disposable researcher. It touches no external archive,
 * downloads no sequencing data and makes no claim that depends on NCBI being
 * up, so it is safe to run on every change. Its mutations belong to the
 * disposable researcher's own workspace and are cleaned up afterwards, so a
 * canonical review record is never rewritten by a test.
 *
 * `live` is for release verification: real Supabase Auth delivery, a real
 * accession through the real Modal sweep, a real email. It is slow, it depends
 * on services nobody here controls, and ordinary CI must not wait on it.
 *
 * Both need SUPABASE_DB_URL and SUPABASE_SECRET_KEY to mint a session, which
 * is why neither runs in an environment that does not have them: the setup
 * project fails loudly rather than silently testing a signed-out console.
 */
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.SPLICR_E2E_PORT ?? 3210);
const baseURL = process.env.SPLICR_E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // A screen page reads a 20,916-row run; the generous timeout is for the
  // first compile in dev mode, not for a slow assertion.
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "fast",
      testMatch: /fast\/.*\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/researcher.json" },
    },
    {
      name: "live",
      testMatch: /live\/.*\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/researcher.json" },
    },
  ],
  webServer: process.env.SPLICR_E2E_BASE_URL
    ? undefined
    : {
        command: `npx next start --port ${PORT}`,
        url: `http://localhost:${PORT}/login`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
