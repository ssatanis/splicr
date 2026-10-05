/**
 * A lab's own screen, from a dropped file to a queued run.
 *
 * This is the one workflow where a browser writes bytes to storage directly,
 * so it is the one workflow a server-side test cannot stand in for. The spec
 * drives the real control: it puts a real count table built from real Brunello
 * guide sequences through the real drop zone, and then asserts the things that
 * would be wrong if any link in the chain were pretend —
 *
 *   · the object is in the uploads bucket, under the organization's prefix
 *   · the row records a SHA-256 that matches the file on disk
 *   · the server read the stored bytes back and found the sample columns
 *   · `detect_library` matched the guides to Brunello
 *   · `start_screen_analysis` created a run, nine stages and a queued job
 *
 * Everything it creates is removed afterwards, including the stored object.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { DeleteObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { fixtureIds, readEnv } from "../fixtures/handles";

const COUNTS = path.resolve(process.cwd(), "e2e/fixtures/files/counts-brunello.tsv");
const SCREEN_NAME = "E2E intake (synthetic counts, not a real experiment)";

function admin() {
  const config = readEnv();
  return createClient(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** The same object store the app signs upload URLs against. */
function objectStore() {
  const config = readEnv();
  return new S3Client({
    region: "auto",
    endpoint: config.R2_ENDPOINT || `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.R2_ACCESS_KEY_ID,
      secretAccessKey: config.R2_SECRET_ACCESS_KEY,
    },
  });
}

/** `r2://bucket/key` split back into its two halves. */
function splitUri(uri: string): { bucket: string; key: string } {
  const match = uri.match(/^r2:\/\/([^/]+)\/(.+)$/);
  if (!match) throw new Error(`not an object-store uri: ${uri}`);
  return { bucket: match[1], key: match[2] };
}

async function removeTestScreens() {
  const supabase = admin();
  const { data } = await supabase.from("screens").select("id").eq("org_id", fixtureIds().orgId).eq("name", SCREEN_NAME);
  for (const row of data ?? []) {
    const id = (row as { id: string }).id;
    const { data: files } = await supabase.from("screen_files").select("storage_key").eq("screen_id", id);
    for (const file of files ?? []) {
      const stored = splitUri(file.storage_key);
      await objectStore().send(new DeleteObjectCommand({ Bucket: stored.bucket, Key: stored.key }));
    }
    await supabase.from("screens").delete().eq("id", id).eq("org_id", fixtureIds().orgId);
  }
  // Drafts abandoned by an earlier failed run would otherwise accumulate.
  await supabase.from("screens").delete().eq("org_id", fixtureIds().orgId).eq("name", "Untitled screen").eq("status", "draft");
}

test.afterEach(removeTestScreens);

test("a count table becomes a queued run", async ({ page }) => {
  test.setTimeout(120_000);
  await removeTestScreens();

  await page.goto("/dashboard/new");
  await expect(page.getByRole("heading", { name: "New analysis" })).toBeVisible();

  // "My experiment" is the default, and the published-study path is the other
  // radio. Assert the choice exists rather than assuming which one is selected.
  await page.getByRole("radio", { name: /My experiment/ }).click();

  await page.locator('input[type="file"]:not([webkitdirectory])').setInputFiles(COUNTS);

  const row = page.getByRole("listitem").filter({ hasText: "counts-brunello.tsv" });
  await expect(row).toBeVisible();
  await expect(row.getByText("Uploaded")).toBeVisible({ timeout: 60_000 });

  // The checksum shown is the first eight hex digits of the real digest.
  const digest = createHash("sha256").update(fs.readFileSync(COUNTS)).digest("hex");
  await expect(row.getByText(`sha256 ${digest.slice(0, 8)}`)).toBeVisible();

  await page.getByRole("button", { name: "Describe the experiment" }).click();

  // The summary is read back from the stored bytes, not from the browser's own
  // peek at the file, so these five values are the server's conclusions.
  await expect(page.getByRole("heading", { name: "Check the experiment" })).toBeVisible({ timeout: 60_000 });
  const summary = page.getByRole("definition");
  await expect(summary.filter({ hasText: "Brunello" })).toBeVisible();
  await expect(page.getByText("3 samples", { exact: true })).toBeVisible();
  await expect(page.getByText("2 samples", { exact: true })).toBeVisible();
  await expect(page.getByText("2 treated vs 3 control").first()).toBeVisible();

  await page.getByRole("button", { name: "Edit design" }).click();

  // Sample columns come from the server reading the stored object back.
  await expect(page.getByRole("cell", { name: "T0", exact: true })).toBeVisible();
  for (const label of ["DMSO_R1", "DMSO_R2", "Olaparib_R1", "Olaparib_R2"]) {
    await expect(page.getByRole("cell", { name: label, exact: true })).toBeVisible();
  }

  // Guessed arms: T0 is the start of the screen, DMSO is the control, the drug
  // is the treatment. Getting these wrong would contrast the wrong samples.
  await expect(page.getByLabel("Arm for T0")).toHaveValue("reference");
  await expect(page.getByLabel("Arm for DMSO_R1")).toHaveValue("control");
  await expect(page.getByLabel("Arm for Olaparib_R1")).toHaveValue("treatment");
  await expect(page.getByLabel("Replicate number for DMSO_R2")).toHaveValue("2");

  await page.getByRole("textbox", { name: "Screen name" }).fill(SCREEN_NAME);
  await page.getByRole("textbox", { name: "Cell line or model" }).fill("HAP1");

  await page.getByLabel("Use T0 in this comparison").uncheck();
  await page.getByRole("button", { name: /Pipeline settings/ }).click();
  const bagel = page.getByRole("checkbox", { name: "BAGEL2", exact: true });
  if (await bagel.isChecked()) await bagel.uncheck();
  await page.getByRole("button", { name: "Start the analysis" }).click();
  await expect(page.getByRole("button", { name: "Run analysis" })).toBeDisabled();
  await page.getByLabel("Confirm reviewed analysis plan").check();
  await page.getByRole("button", { name: "Run analysis", exact: true }).click();
  await expect(page.getByText(/is (queued|analysing)/)).toBeVisible({ timeout: 60_000 });

  // --- what the database actually holds -----------------------------------
  const supabase = admin();
  const { data: screens } = await supabase
    .from("screens")
    .select("id, org_id, status, source, library_id, current_run_id, cell_line")
    .eq("name", SCREEN_NAME);
  expect(screens).toHaveLength(1);
  const screen = screens![0] as {
    id: string; org_id: string; status: string; source: string;
    library_id: string | null; current_run_id: string | null; cell_line: string | null;
  };
  // The engine may already have leased the job by the time this reads, so the
  // assertion is that the draft became real work, not that it is still waiting.
  expect(["queued", "running", "complete", "failed"]).toContain(screen.status);
  expect(screen.source).toBe("upload");
  expect(screen.cell_line).toBe("HAP1");
  expect(screen.library_id).not.toBeNull();
  expect(screen.current_run_id).not.toBeNull();
  expect(screen.org_id).toBe(fixtureIds().orgId);

  const { data: files } = await supabase
    .from("screen_files")
    .select("storage_key, checksum_sha256, status, byte_size, kind")
    .eq("screen_id", screen.id);
  expect(files).toHaveLength(1);
  const file = files![0] as {
    storage_key: string; checksum_sha256: string; status: string; byte_size: number; kind: string;
  };
  expect(file.status).toBe("complete");
  expect(file.kind).toBe("counts");
  expect(file.checksum_sha256).toBe(digest);
  expect(file.byte_size).toBe(fs.statSync(COUNTS).size);
  // Namespaced by organization, which is what the signing route enforces: a
  // key outside the caller's own prefix is refused.
  const stored = splitUri(file.storage_key);
  expect(stored.key.startsWith(`${screen.org_id}/${screen.id}/`)).toBe(true);

  // The object is really there, and it is byte-for-byte the file on disk.
  const object = await objectStore().send(
    new GetObjectCommand({ Bucket: stored.bucket, Key: stored.key }),
  );
  const bytes = Buffer.from(await object.Body!.transformToByteArray());
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(digest);

  const { data: samples } = await supabase
    .from("samples")
    .select("label, role, replicate")
    .eq("screen_id", screen.id);
  expect(samples).toHaveLength(4);

  const { data: comparisons } = await supabase
    .from("comparisons")
    .select("treatment_ids, control_ids, is_primary")
    .eq("screen_id", screen.id);
  expect(comparisons).toHaveLength(1);
  const comparison = comparisons![0] as {
    treatment_ids: string[]; control_ids: string[]; is_primary: boolean;
  };
  expect(comparison.is_primary).toBe(true);
  expect(comparison.treatment_ids).toHaveLength(2);
  expect(comparison.control_ids).toHaveLength(2);

  const { data: stages } = await supabase
    .from("run_stages")
    .select("stage, status")
    .eq("run_id", screen.current_run_id!);
  expect(stages).toHaveLength(9);

  const { data: jobs } = await supabase
    .from("jobs")
    .select("kind, status, idempotency_key")
    .eq("run_id", screen.current_run_id!);
  expect(jobs).toHaveLength(1);
  expect((jobs![0] as { kind: string }).kind).toBe("pipeline");
});

test("a supporting document is retained without becoming screen counts", async ({ page }) => {
  await page.goto("/dashboard/new");
  await page.getByRole("radio", { name: /My experiment/ }).click();
  const unreadable = path.join(process.cwd(), "e2e/fixtures/files/.tmp-notes.docx");
  fs.writeFileSync(unreadable, "not sequencing");
  try {
    await page.locator('input[type="file"]:not([webkitdirectory])').setInputFiles(unreadable);
    const row = page.getByRole("listitem").filter({ hasText: ".tmp-notes.docx" });
    await expect(row.getByText("Uploaded")).toBeVisible({ timeout: 60_000 });
    await expect(row.getByText("Supporting file").first()).toBeVisible();
    await page.getByRole("button", { name: "Describe the experiment" }).click();
    await expect(page.getByText("No samples could be read from these files. A count table needs numeric sample columns.")).toBeVisible();
    await page.getByRole("button", { name: "Discard", exact: true }).click();
  } finally {
    fs.rmSync(unreadable, { force: true });
  }
});
