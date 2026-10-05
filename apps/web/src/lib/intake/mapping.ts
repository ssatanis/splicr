export interface TableMapping {
  kind: "counts" | "library" | "metadata" | "context";
  layout: "wide" | "long" | "transposed";
  header_row: number;
  guide_column: string;
  gene_column?: string;
  sequence_column?: string;
  sample_columns?: string[];
  sample_column?: string;
  count_column?: string;
  control_column?: string;
  control_value?: string;
}

const cell = (value: unknown) => value == null ? "" : String(value).trim();
export function mappedRows(input: unknown[][], mapping: TableMapping): { rows: string[][]; source_columns: string[] } {
  if (!Number.isInteger(mapping.header_row) || mapping.header_row < 1 || mapping.header_row > 40) throw new Error("Choose a header row from 1 to 40.");
  const rows = input.map((row) => row.map(cell));
  const header = rows[mapping.header_row - 1];
  if (!header?.length) throw new Error("The selected header row is empty.");
  if (new Set(header.filter(Boolean)).size !== header.filter(Boolean).length) throw new Error("The selected header has duplicate column names.");
  const body = rows.slice(mapping.header_row).filter((row) => row.some(Boolean));
  const index = (name: string | undefined, required = false) => {
    if (!name && !required) return -1;
    const i = header.indexOf(name ?? "");
    if (i < 0) throw new Error(`Column ${name || "(not selected)"} is missing.`);
    return i;
  };
  if (mapping.kind === "context" || mapping.kind === "metadata") return { rows: [header, ...body], source_columns: header };
  if (mapping.layout === "transposed") {
    if (mapping.kind !== "counts") throw new Error("Transposed input is supported for guide counts only.");
    const names = body.map((row) => row[0]);
    if (names.some((name) => !name) || new Set(names).size !== names.length) throw new Error("Transposed rows need unique sample labels in the first column.");
    return { rows: [["guide_id", ...names], ...header.slice(1).map((guide, i) => [guide, ...body.map((row) => row[i + 1] ?? "")])], source_columns: header };
  }
  const guide = index(mapping.guide_column, true), gene = index(mapping.gene_column), sequence = index(mapping.sequence_column);
  if (mapping.kind === "library") {
    if (sequence < 0) throw new Error("Select a guide sequence column.");
    const control = index(mapping.control_column);
    return { rows: [["guide_id", "Gene", "Sequence", "is_control"], ...body.map((row) => [row[guide], gene < 0 ? "" : row[gene], row[sequence], String(control >= 0 && row[control]?.toLowerCase() === (mapping.control_value || "1").toLowerCase())])], source_columns: header };
  }
  if (mapping.layout === "long") {
    const sample = index(mapping.sample_column, true), count = index(mapping.count_column, true);
    const names = [...new Set(body.map((row) => row[sample]))];
    if (names.some((name) => !name)) throw new Error("Every long-format row needs a sample label.");
    const guides = new Map<string, Map<string, string>>();
    for (const row of body) {
      if (!row[guide]) throw new Error("Every long-format row needs a guide ID.");
      const values = guides.get(row[guide]) ?? new Map();
      if (values.has(row[sample])) throw new Error(`Duplicate count for ${row[guide]} / ${row[sample]}. Resolve duplicate measurements before importing.`);
      values.set(row[sample], row[count] ?? ""); guides.set(row[guide], values);
    }
    return { rows: [["guide_id", ...names], ...[...guides].map(([key, values]) => [key, ...names.map((name) => values.get(name) ?? "")])], source_columns: header };
  }
  const samples = mapping.sample_columns ?? [];
  if (!samples.length || new Set(samples).size !== samples.length) throw new Error("Choose unique count columns.");
  const columns = samples.map((name) => index(name, true));
  if (columns.some((i) => [guide, gene, sequence].includes(i))) throw new Error("Identity columns cannot also be sample counts.");
  return { rows: [["guide_id", ...(gene < 0 ? [] : ["Gene"]), ...(sequence < 0 ? [] : ["Sequence"]), ...samples], ...body.map((row) => [row[guide] ?? "", ...(gene < 0 ? [] : [row[gene]]), ...(sequence < 0 ? [] : [row[sequence]]), ...columns.map((i) => row[i] ?? "")])], source_columns: header };
}
