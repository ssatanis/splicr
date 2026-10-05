/**
 * Release verification for a lab-owned screen.
 *
 * This is intentionally live-only. It writes a disposable screen through the
 * browser, verifies the file landed in private object storage, asks the deployed
 * Modal worker to process one private job, and then checks the persisted run
 * through Supabase. Ordinary CI should run the fast suite instead.
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { readEnv } from "../fixtures/handles";

const run = promisify(execFile);

function clean(value: string | undefined): string {
  return (value ?? "").trim().replace(/^['"]|['"]$/g, "");
}

function admin() {
  const config = readEnv();
  return createClient(clean(config.SUPABASE_URL), clean(config.SUPABASE_SECRET_KEY), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function r2Client(config: Record<string, string>) {
  const account = clean(config.R2_ACCOUNT_ID);
  return new S3Client({
    region: "auto",
    endpoint: clean(config.R2_ENDPOINT) || `https://${account}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: clean(config.R2_ACCESS_KEY_ID),
      secretAccessKey: clean(config.R2_SECRET_ACCESS_KEY),
    },
  });
}

async function processPrivateNow(): Promise<void> {
  await run("python3", ["-c", [
    "import json, modal",
    "fn = modal.Function.from_name('splicr-ingest', 'process_private_screen')",
    "print(json.dumps(fn.remote(), default=str))",
  ].join("\n")], { timeout: 15 * 60_000 });
}

async function cleanup(screenName: string) {
  const config = readEnv();
  const supabase = admin();
  const { data } = await supabase
    .from("screens")
    .select("id, screen_files(storage_key)")
    .eq("name", screenName);
  const storageKeys = (data ?? []).flatMap((screen) =>
    ((screen as { screen_files?: { storage_key: string }[] }).screen_files ?? []).map((file) => file.storage_key),
  );

  await supabase.from("screens").delete().eq("name", screenName);

  const client = r2Client(config);
  const bucket = clean(config.R2_BUCKET);
  for (const uri of storageKeys) {
    const match = uri.match(/^r2:\/\/([^/]+)\/(.+)$/);
    if (!match) continue;
    await client.send(new DeleteObjectCommand({ Bucket: match[1] || bucket, Key: match[2] })).catch(() => undefined);
  }
}

test.describe("private experiment intake", () => {
  test("browser upload becomes a persisted analysed workspace screen", async ({ page }) => {
    test.setTimeout(20 * 60_000);
    const config = readEnv();
    for (const key of ["R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "SUPABASE_SECRET_KEY"]) {
      test.skip(!clean(config[key]), `${key} is required for live private-ingestion verification`);
    }

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const uploadName = `splicr-live-private-${suffix}.tsv`;
    const screenName = uploadName.replace(/\.tsv$/, "");
    const fixture = path.resolve(process.cwd(), "public/__test_counts.tsv");
    const buffer = fs.readFileSync(fixture);

    await cleanup(screenName);
    try {
      await page.goto("/dashboard/new");
      await page.setInputFiles("input[type='file']:not([webkitdirectory])", {
        name: uploadName,
        mimeType: "text/tab-separated-values",
        buffer,
      });

      await expect(page.getByText("Uploaded")).toBeVisible({ timeout: 90_000 });
      await page.getByRole("button", { name: "Describe the experiment" }).click();
      await expect(page.getByLabel("Analysis progress")).toContainText("Checking experiment");

      if (await page.getByRole("button", { name: "Looks right" }).count()) {
        await expect(page.getByText("Brunello")).toBeVisible();
        await expect(page.getByText("5")).toBeVisible();
        await page.getByRole("button", { name: "Looks right" }).click();
      } else {
        await page.getByLabel("Screen name").fill(screenName);
        await page.getByRole("button", { name: "Start the analysis" }).click();
      }

      await expect(page.getByText(/is analysing/)).toBeVisible({ timeout: 60_000 });

      const supabase = admin();
      let persisted: {
        id: string;
        current_run_id: string | null;
        screen_files?: { storage_key: string; checksum_sha256: string | null; byte_size: number | null }[];
      } | null = null;
      await expect(async () => {
        const { data } = await supabase
          .from("screens")
          .select("id, org_id, current_run_id, screen_files(storage_key, checksum_sha256, byte_size)")
          .eq("name", screenName)
          .maybeSingle();
        persisted = data as null | {
          id: string;
          current_run_id: string | null;
          screen_files?: { storage_key: string; checksum_sha256: string | null; byte_size: number | null }[];
        };
        expect(persisted).not.toBeNull();
      }).toPass({ timeout: 60_000 });

      expect(persisted).not.toBeNull();
      const verified = persisted!;
      expect(verified.current_run_id).toBeTruthy();
      expect(verified.screen_files?.[0]?.storage_key).toMatch(/^r2:\/\//);
      expect(verified.screen_files?.[0]?.checksum_sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(verified.screen_files?.[0]?.byte_size).toBe(buffer.length);

      await processPrivateNow();

      await expect(async () => {
        const { data } = await supabase
          .from("screens")
          .select("status, qc, n_hits")
          .eq("id", verified.id)
          .maybeSingle();
        expect(data).toMatchObject({ status: "complete" });
        expect((data as { n_hits?: number } | null)?.n_hits ?? 0).toBeGreaterThan(0);
      }).toPass({ timeout: 12 * 60_000, intervals: [10_000] });

      await page.goto(`/dashboard/screens/${verified.id}`);
      await expect(page.getByRole("heading", { name: screenName })).toBeVisible();
      await expect(page.getByText("Screen Doctor")).toBeVisible();
      await expect(page.getByText("Candidates")).toBeVisible();
    } finally {
      await cleanup(screenName);
    }
  });
});
