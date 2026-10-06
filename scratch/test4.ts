import { mappedRows } from "../apps/web/src/lib/intake/mapping.ts";
import { parseRows } from "../apps/web/src/lib/intake/tables.ts";

const rows = [
  ["sgRNA Sequence", "Target Gene Symbol"],
  ["ACGTACGTACGTACGTACGT", "SMAD7"],
  ["TGCATGCATGCATGCATGCA", "MYC"],
  ["GATCGATCGATCGATCGATC", ""]
];

const mapping = {
  kind: "library",
  layout: "wide",
  header_row: 1,
  guide_column: "",
  gene_column: "Target Gene Symbol",
  sequence_column: "sgRNA Sequence",
  sample_columns: []
};

try {
  const mapped = mappedRows(rows, mapping as any);
  console.log("Mapped rows ok");
  const table = parseRows("Table", mapped.rows);
  console.log("Parse ok");
} catch(e) {
  console.error("ERROR:", e.message);
}

