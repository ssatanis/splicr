import { mappedRows } from "../apps/web/src/lib/intake/mapping.ts";
import { parseRows } from "../apps/web/src/lib/intake/tables.ts";
const rows = [
  ["sgRNA Sequence", "Target Gene Symbol"],
  ["ACGT", "SMAD7"],
  ["TGCA", "MYC"]
];
const mapping = {
  kind: "library", layout: "wide", header_row: 1, guide_column: "", gene_column: "Target Gene Symbol", sequence_column: "sgRNA Sequence"
};
try {
  const mapped = mappedRows(rows, mapping as any);
  console.log("Mapped rows:", mapped.rows);
  const table = parseRows("Sheet1", mapped.rows);
  console.log("Parsed table:", table.kind);
} catch(e) {
  console.error("ERROR:", e.message);
}
