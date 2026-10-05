import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { zipSync, strToU8 } from "fflate";

const counts = path.resolve(process.cwd(), "e2e/fixtures/files/counts-brunello.tsv");
const artifacts = path.resolve(process.cwd(), "../../artifacts/upload-redesign-20261005");
const fileRow = (page: Page, name: string) => page.getByRole("list", { name: "Attached files" }).getByRole("listitem").filter({ hasText: name });

function textPdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 40 750 Td (${text}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let output = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => { offsets.push(output.length); output += `${i+1} 0 obj\n${object}\nendobj\n`; });
  const xref = output.length;
  output += `xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}

async function open(page: Page) {
  await page.goto("/dashboard/new");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Browse files", exact: true }).click();
  return chooser;
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
  const discard = page.getByRole("button", { name: "Discard", exact: true });
  if (await discard.isVisible() && await discard.isEnabled()) {
    await discard.click();
    await expect(page.getByRole("list", { name: "Attached files" })).toHaveCount(0);
  }
});

test("browse selects several types, switching mode preserves files, and removal works", async ({ page }) => {
  const chooser = await open(page);
  await expect(page.getByRole("button", { name: "Choose a folder" })).toHaveCount(0);
  expect(chooser.isMultiple()).toBe(true);
  await expect(page.getByLabel("Upload experiment files")).not.toHaveAttribute("accept");
  const docx = zipSync({ "word/document.xml": strToU8('<w:document><w:body><w:p><w:r><w:t>Protocol: vehicle control and Olaparib treatment.</w:t></w:r></w:p></w:body></w:document>') });
  await chooser.setFiles([
    { name: "counts-brunello.tsv", mimeType: "text/tab-separated-values", buffer: fs.readFileSync(counts) },
    { name: "experiment-protocol.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from(docx) },
    { name: "instrument-output.bin", mimeType: "application/octet-stream", buffer: Buffer.from([0,255,34,4]) },
    { name: "notes.md", mimeType: "text/markdown", buffer: Buffer.from("HAP1 cells. Use DMSO as control.") },
  ]);
  for (const name of ["counts-brunello.tsv","experiment-protocol.docx","instrument-output.bin","notes.md"]) await expect(fileRow(page, name).getByText("Uploaded", { exact: true })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("radio", { name: /Published study/ }).click();
  await page.getByRole("radio", { name: /My experiment/ }).click();
  await expect(fileRow(page, "notes.md").getByText("Uploaded", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove instrument-output.bin", exact: true }).click();
  await expect(fileRow(page, "instrument-output.bin")).toHaveCount(0);
  await page.getByRole("button", { name: "Describe the experiment", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Check the experiment" })).toBeVisible();
  await page.getByText("File inspection, 3 sources", { exact: true }).click();
  await expect(page.getByText("DOCX, Text read", { exact: false })).toBeVisible();
  await page.getByText("View extracted text", { exact: true }).first().click();
  await expect(page.getByText(/Protocol: vehicle control and Olaparib treatment\./)).toBeVisible();
});

test("multiple dropped files upload and a bad ZIP does not block the batch", async ({ page }) => {
  await page.goto("/dashboard/new");
  await page.getByRole("radio", { name: /Published study/ }).click();
  await page.getByRole("radio", { name: /My experiment/ }).click();
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File(["Control: DMSO. Treated: Olaparib."], "dropped-notes.md", { type: "text/markdown" }));
    data.items.add(new File([new Uint8Array([0,255,40])], "broken.zip", { type: "application/zip" }));
    return data;
  });
  await page.getByTestId("file-drop-zone").dispatchEvent("drop", { dataTransfer: transfer });
  await transfer.dispose();
  for (const name of ["dropped-notes.md","broken.zip"]) await expect(fileRow(page, name).getByText("Uploaded", { exact: true })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Describe the experiment", exact: true }).click();
  await expect(page.getByText(/No samples could be read/)).toBeVisible();
  await expect(page.getByText(/Archive retained/).first()).toBeVisible();
  await expect(page.getByText("MD, Text read", { exact: false })).toBeVisible();
});

test("failed uploads retry without selecting the file again", async ({ page }) => {
  let failed = false;
  await page.route("**/api/intake/r2", async (route) => {
    if (!failed) { failed = true; await route.fulfill({ status: 503, json: { error: "Test interruption: try this upload again." } }); }
    else await route.continue();
  });
  const chooser = await open(page);
  await chooser.setFiles({ name: "retry-notes.md", mimeType: "text/markdown", buffer: Buffer.from("Retain this protocol.") });
  const row = fileRow(page, "retry-notes.md");
  await expect(row.getByText("Failed", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Retry retry-notes.md", exact: true }).click();
  await expect(row.getByText("Uploaded", { exact: true })).toBeVisible({ timeout: 60_000 });
});

test("the upload layout works on desktop and mobile", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  fs.mkdirSync(artifacts, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/dashboard/new");
  await page.getByRole("radio", { name: /Published study/ }).click();
  await page.getByRole("radio", { name: /My experiment/ }).click();
  await page.screenshot({ path: path.join(artifacts, "desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Browse files", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: path.join(artifacts, "mobile.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("a dropped folder includes its nested files without a folder picker", async ({ page }) => {
  await page.goto("/dashboard/new");
  await page.getByRole("radio", { name: /Published study/ }).click();
  await page.getByRole("radio", { name: /My experiment/ }).click();
  await page.getByTestId("file-drop-zone").evaluate((element) => {
    const file = new File(["Protocol: nested source."], "nested-notes.md", { type: "text/markdown" });
    const entry = { isFile: true, isDirectory: false, name: file.name, fullPath: "/experiment/nested-notes.md", file: (resolve: (file: File) => void) => resolve(file) };
    let read = false;
    const folder = { isDirectory: true, isFile: false, name: "experiment", fullPath: "/experiment", createReader: () => ({ readEntries: (resolve: (entries: unknown[]) => void) => { resolve(read ? [] : [entry]); read = true; } }) };
    const event = new DragEvent("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [], items: [{ kind: "file", webkitGetAsEntry: () => folder, getAsFile: () => file }] } });
    element.dispatchEvent(event);
  });
  await expect(fileRow(page, "experiment/nested-notes.md").getByText("Uploaded", { exact: true })).toBeVisible({ timeout: 60_000 });
});

test("multipart upload works when browser resume storage is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Storage.prototype, "getItem", { value: () => { throw new Error("Storage unavailable"); } });
    Object.defineProperty(Storage.prototype, "setItem", { value: () => { throw new Error("Storage unavailable"); } });
  });
  const actions: string[] = [];
  page.on("request", (request) => { if (request.url().endsWith("/api/intake/r2")) actions.push(request.postDataJSON().action); });
  const chooser = await open(page);
  await chooser.setFiles({ name: "multipart-test.bin", mimeType: "application/octet-stream", buffer: Buffer.alloc(7 * 1024 * 1024, 42) });
  await expect(fileRow(page, "multipart-test.bin").getByText("Uploaded", { exact: true })).toBeVisible({ timeout: 60_000 });
  expect(actions).toEqual(["multipart", "part", "complete"]);
});


test("PDF text is inspected after storage upload and images show their actual limits", async ({ page }) => {
  const chooser = await open(page);
  await chooser.setFiles([
    { name: "study-protocol.pdf", mimeType: "application/pdf", buffer: textPdf("Experiment control: DMSO") },
    { name: "instrument-image.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64") },
  ]);
  for (const name of ["study-protocol.pdf", "instrument-image.png"]) await expect(fileRow(page, name).getByText("Uploaded", { exact: true })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Describe the experiment", exact: true }).click();
  await expect(page.getByText("PDF, Text read", { exact: false })).toBeVisible();
  await expect(page.getByText("PNG, Partially inspected", { exact: false })).toBeVisible();
  await page.getByText("View extracted text", { exact: true }).click();
  await expect(page.getByText(/Experiment control: DMSO/)).toBeVisible();
  await expect(page.getByText(/Image content and text have not been interpreted/)).toBeVisible();
});
