// Read-only visual inspection of the file downloaded from SplicR.
import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "/Users/sahaj/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";
const dir = "/Users/sahaj/Documents/Projects/SplicR/artifacts/dow-screen-20261005/export";
await fs.mkdir(`${dir}/previews`, { recursive: true });
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(`${dir}/SplicR-Dow-kinome-results.xlsx`));
console.log((await workbook.inspect({ kind: "sheet", include: "id,name", maxChars: 2500 })).ndjson);
const names = ["Screens", "Essentiality ICSBCS002", "Gefitinib ICSBCS002", "Trametinib ICSBCS002", "Essentiality ICSBCS007", "Gefitinib ICSBCS007", "Trametinib ICSBCS007", "Quality control", "Guide results", "Guide disagreement", "Run provenance", "Data dictionary", "Export record"];
for (const name of names) {
  const range = name === "Screens" ? "A1:E7" : name === "Quality control" || name === "Run provenance" ? "B1:E8" : name === "Data dictionary" || name === "Export record" ? "A1:C8" : name.startsWith("Guide") ? "D1:J7" : "A1:H8";
  const image = await workbook.render({ sheetName: name, range, scale: 1.3, format: "png" });
  await fs.writeFile(`${dir}/previews/${name.replaceAll(" ", "-")}.png`, new Uint8Array(await image.arrayBuffer()));
  console.log(`Rendered ${name}`);
}
