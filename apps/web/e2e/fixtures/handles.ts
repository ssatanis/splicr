/**
 * The handles the specs need: the fixture's identifiers, and the seed and
 * teardown the setup project calls.
 *
 * The seeding itself lives in `seed.mjs` so it can also be run from the command
 * line when somebody wants the fixture workspace without running a test.
 */
import fs from "node:fs";
import path from "node:path";

//  CommonJS, so the one file serves both Playwright (which transpiles the
//  suite to CJS) and `node e2e/fixtures/seed.cjs seed` from a terminal.
const { FIXTURE: RAW, seed: rawSeed, teardown: rawTeardown } = require("./seed.cjs");

export const FIXTURE = RAW as {
  email: string;
  orgSlug: string;
  orgName: string;
  screenName: string;
  engineVersion: string;
  genes: number;
  significant: number;
};

export const seed = rawSeed as () => Promise<{
  userId: string; orgId: string; screenId: string; runId: string; comparisonId: string;
}>;
export const teardown = rawTeardown as () => Promise<void>;

const WEB = path.resolve(process.cwd());
const ROOT = path.resolve(WEB, "../..");

export function readEnv(): Record<string, string> {
  const read = (file: string) => {
    const at = path.join(ROOT, file);
    if (!fs.existsSync(at)) return {};
    return Object.fromEntries(
      fs.readFileSync(at, "utf8").split("\n")
        .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
        .map((line) => {
          const i = line.indexOf("=");
          return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
        }),
    );
  };
  const merged = { ...read(".env"), ...read("apps/web/.env.local"), ...process.env } as Record<string, string>;
  merged.SUPABASE_URL ||= merged.NEXT_PUBLIC_SUPABASE_URL;
  return merged;
}

/** What the setup project wrote about the workspace it seeded. */
export function fixtureIds(): { orgId: string; screenId: string; runId: string } {
  const at = path.join(WEB, "e2e/.auth/fixture.json");
  if (!fs.existsSync(at)) {
    throw new Error("the setup project did not run; there is no seeded fixture to test against");
  }
  return JSON.parse(fs.readFileSync(at, "utf8"));
}

/** The seeded screen's page. */
export function screenPath(): string {
  return `/dashboard/screens/${fixtureIds().screenId}`;
}
