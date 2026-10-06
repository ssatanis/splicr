import { mappedRows } from "../apps/web/src/lib/intake/mapping.ts";
import { parseRows } from "../apps/web/src/lib/intake/tables.ts";
const rows = [
  ["sgRNA Sequence", "Target Gene Symbol"],
  ["ACGTACGTACGTACGTACGT", "SMAD7"],
  ["TGCATGCATGCATGCATGCA", "MYC"]
];
const mapping = {
  kind: "library", layout: "wide", header_row: 1, guide_column: "", gene_column: "Target Gene Symbol", sequence_column: "sgRNA Sequence"
};
const mapped = mappedRows(rows, mapping as any);
const table = parseRows("Sheet1", mapped.rows);
console.log(table);
