import { mappedRows } from "../apps/web/src/lib/intake/mapping.ts";
console.log(mappedRows([["a", "b", "c"], ["1", "2", "3"]], {
  kind: "library",
  layout: "wide",
  header_row: 1,
  guide_column: "a",
  gene_column: "b",
  sequence_column: "c"
}));
