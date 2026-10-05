import * as XLSX from "xlsx";
import { mappedRows, type TableMapping } from "./mapping.ts";

export interface GuideRow { guide_id: string; sequence: string; gene: string | null; is_control: boolean }
export interface ParsedTable {
  sheet: string;
  kind: "counts" | "library" | "metadata" | "context";
  header_row: number;
  columns: string[];
  guide_column: string | null;
  gene_column: string | null;
  sequence_column: string | null;
  sample_columns: string[];
  rows_seen: number;
  preview: string[][];
  guides: GuideRow[];
  guide_ids: string[];
  warnings: string[];
  mapping?: TableMapping;
  source_columns?: string[];
  records?: Record<string, string>[];
}

const DNA = /^[ACGT]{17,30}$/i;
const GENE = /^(gene|gene[_ ]?symbol|symbol|target[_ ]?gene|target)$/i;
const ID = /^(id|guide[_ ]?id|sgrna[_ ]?id|name|guide|grna|sgid|sgrna)$/i;
const NEGATIVE = /^(neg\d+|ntc\d*|non[-_ ]?targeting.*|negative[-_ ]?control.*|control)$/i;
const ANNOTATION = /^(chr|chromosome|start|end|position|cut[_ ]?pos|strand|score|efficacy|gc|length|index|is[_ ]?control|control[_ ]?type)$/i;
const GUIDE_GENE = /^([A-Za-z][A-Za-z0-9.-]*)_(?:PKc\d*|e\d|E\d)/;

function cell(value: unknown): string { return value == null ? "" : String(value).trim(); }
function integer(value: string): boolean { return value !== "" && Number.isSafeInteger(Number(value)) && Number(value) >= 0; }

/** Content determines the role. Title rows and empty first header cells are common in supplements. */
export function parseRows(sheet: string, input: unknown[][], mapping?: TableMapping): ParsedTable {
  if (mapping && mapping.kind !== "context" && mapping.kind !== "metadata") {
    const mapped = mappedRows(input, mapping);
    const table = parseRows(sheet, mapped.rows);
    if (table.kind !== mapping.kind) throw new Error("The chosen columns do not form a valid guide library or integer count matrix. Missing counts are not zero.");
    if (mapping.kind === "counts") {
      const expected = mapping.layout === "wide" ? mapping.sample_columns ?? [] : mapped.rows[0].slice(1);
      if (expected.length !== table.sample_columns.length || expected.some((name) => !table.sample_columns.includes(name))) throw new Error("One or more selected sample columns contain missing, fractional or negative counts. Correct those cells before continuing.");
      const indices = table.sample_columns.map((name) => mapped.rows[0].indexOf(name));
      if (mapped.rows.slice(1).some((row) => indices.some((i) => !integer(row[i] ?? "")))) throw new Error("Every selected count must be a nonnegative integer. Missing values are not zero.");
    }
    return { ...table, header_row: mapping.header_row, mapping, source_columns: mapped.source_columns };
  }
  const rows = input.map((row) => row.map(cell));
  for (let start = 0; start < Math.min(40, rows.length - 1); start++) {
    const columns = rows[start];
    const sample = columns.find((name) => /^(sample|sample[_ ]?(id|name)|run)$/i.test(name));
    const guide = columns.find((name) => ID.test(name));
    const count = columns.find((name) => /^(count|counts|read[_ ]?counts?|reads)$/i.test(name));
    if (!mapping && sample && guide && count) return parseRows(sheet, input, { kind: "counts", layout: "long", header_row: start + 1, guide_column: guide, sample_column: sample, count_column: count });
    if ((mapping?.kind === "metadata" && start === mapping.header_row - 1) || (!mapping && sample && !guide && columns.some((name) => /^(condition|model|cell[_ ]?line|role|replicate|batch|donor|timepoint)$/i.test(name)))) {
      const body = rows.slice(start + 1).filter((row) => row.some(Boolean));
      if (body.length > 10000) throw new Error("Sample metadata review supports up to 10,000 records.");
      return { sheet, kind: "metadata", header_row: start + 1, columns, guide_column: null, gene_column: null, sequence_column: null, sample_columns: [], rows_seen: body.length, preview: [columns, ...body.slice(0, 5)], guides: [], guide_ids: [], warnings: [], records: body.map((row) => Object.fromEntries(columns.map((name, i) => [name, row[i] ?? ""]))), mapping };
    }
  }
  if (mapping?.kind === "context") return { sheet, kind: "context", header_row: mapping.header_row, columns: rows[mapping.header_row - 1] ?? [], guide_column: null, gene_column: null, sequence_column: null, sample_columns: [], rows_seen: rows.length, preview: rows.slice(0, 6), guides: [], guide_ids: [], warnings: ["Supporting table. Not used as screening counts."], mapping };
  let best: ParsedTable | null = null;
  for (let start = 0; start < Math.min(rows.length - 1, 40); start++) {
    if (rows[start].some((value) => value !== "" && Number.isFinite(Number(value))) && !rows[start].some((value) => ID.test(value) || GENE.test(value))) continue;
    const width = Math.max(rows[start].length, rows[start + 1]?.length ?? 0);
    const columns = Array.from({ length: width }, (_, i) => rows[start][i] || (i === 0 ? "guide_id" : `column_${i + 1}`));
    const body = rows.slice(start + 1).filter((row) => row.some(Boolean));
    const probe = body.slice(0, 100);
    if (probe.length < 1) continue;
    const dna = columns.findIndex((_, i) => probe.every((row) => DNA.test(row[i] ?? "")));
    const controlColumn = columns.findIndex((name) => /^is[_ ]?control$/i.test(name));
    const gene = columns.findIndex((name) => GENE.test(name));
    let id = columns.findIndex((name, i) => i !== dna && ID.test(name));
    if (id < 0 && gene !== 0 && probe.every((row) => Boolean(row[0]) && !integer(row[0]) && !DNA.test(row[0]))) id = 0;
    const samples = columns.filter((name, i) => i !== id && i !== gene && i !== dna && !ANNOTATION.test(name) && probe.every((row) => integer(row[i] ?? "")));
    if (id < 0 && dna >= 0) id = dna;
    const kind = id >= 0 && samples.length > 0 ? "counts" : id >= 0 && dna >= 0 ? "library" : "context";
    if (kind === "context") continue;
    const warnings: string[] = [];
    if (kind === "counts" && body.length && !body[body.length - 1][id]) {
      const footer = body[body.length - 1];
      const data = body.slice(0, -1);
      if (samples.every((sample) => { const i = columns.indexOf(sample); return integer(footer[i] ?? "") && Number(footer[i]) === data.reduce((sum, row) => sum + Number(row[i]), 0); })) {
        body.pop();
        warnings.push("Verified sample totals footer. Excluded from guide counts.");
      }
    }
    const guides: GuideRow[] = [];
    if (kind === "library") {
      let inferred = false;
      const seen = new Map<string, number>();
      const occurrences = new Map<string, number>();
      for (const row of body) occurrences.set(row[id], (occurrences.get(row[id]) ?? 0) + 1);
      for (const [offset, row] of body.entries()) {
        const originalId = row[id];
        const ordinal = (seen.get(originalId) ?? 0) + 1;
        const guideId = (occurrences.get(originalId) ?? 0) > 1 ? `${originalId}__sequence_${ordinal}` : originalId;
        const sequence = row[dna]?.toUpperCase();
        if (!originalId || !DNA.test(sequence ?? "")) throw new Error(`${sheet}, row ${start + offset + 2}: invalid sequence or duplicate guide ID.`);
        seen.set(originalId, ordinal);
        const negative = (controlColumn >= 0 && /^(true|1|yes)$/i.test(row[controlColumn] ?? "")) || NEGATIVE.test(originalId) || (gene >= 0 && NEGATIVE.test(row[gene]));
        let target = gene >= 0 ? row[gene] : null;
        if (!target && !negative) { target = originalId.match(GUIDE_GENE)?.[1] ?? (originalId === "Rosa26" ? "Rosa26" : null); inferred = Boolean(target) || inferred; }
        if (!target && !negative) throw new Error(`${sheet}: ${guideId} needs a gene column. Add gene symbols to the library.`);
        guides.push({ guide_id: guideId, sequence, gene: negative ? null : target, is_control: negative });
      }
      const repeated = [...occurrences].filter(([, count]) => count > 1).map(([id]) => id);
      if (repeated.length) warnings.push(`Repeated guide IDs with distinct sequence records: ${repeated.join(", ")}. Kept as separate guides. Count rows with these IDs resolve to the shared gene only; sequence identity is unavailable.`);
      if (inferred) warnings.push("Gene symbols inferred from structured guide IDs. Confirm the mapping before importing.");
      const uniqueSequences = new Set(guides.map((guide) => guide.sequence));
      if (uniqueSequences.size !== guides.length) warnings.push(`${guides.length - uniqueSequences.size} duplicate sequences. FASTQ assignment needs review.`);
    }
    const parsed: ParsedTable = { sheet, kind, header_row: start + 1, columns, guide_column: columns[id], gene_column: gene >= 0 ? columns[gene] : null, sequence_column: dna >= 0 ? columns[dna] : null, sample_columns: samples, rows_seen: body.length, preview: [columns, ...probe.slice(0, 5)], guides, guide_ids: body.map((row) => row[id]), warnings };
    if (!best || parsed.sample_columns.length > best.sample_columns.length) best = parsed;
    // A library header is explicit; scanning its body as headers would hide bad rows.
    if (kind === "library" || (kind === "counts" && samples.length >= width - 3)) break;
  }
  return best ?? { sheet, kind: "context", header_row: 1, columns: rows[0] ?? [], guide_column: null, gene_column: null, sequence_column: null, sample_columns: [], rows_seen: rows.length, preview: rows.slice(0, 6), guides: [], guide_ids: [], warnings: ["Supporting table. Not used as screening counts."] };
}

function reviewRows(sheet: string, rows: unknown[][], mapping?: TableMapping): ParsedTable {
  try { return parseRows(sheet, rows, mapping); }
  catch (error) {
    if (mapping) throw error;
    const table = parseRows(sheet, rows, { kind: "context", layout: "wide", header_row: 1, guide_column: "" });
    return { ...table, mapping: undefined, warnings: [error instanceof Error ? error.message : "Review the table mapping.", "Choose the columns explicitly before using this table."] };
  }
}

export function parseTables(bytes: Uint8Array, name: string, mappings: Record<string, TableMapping> = {}): ParsedTable[] {
  if (/\.json(?:\.gz)?$/i.test(name)) {
    const input: unknown = JSON.parse(new TextDecoder().decode(bytes));
    let rows: unknown[][];
    if (Array.isArray(input) && input.every(Array.isArray)) rows = input;
    else if (Array.isArray(input) && input.length && input.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
      const columns = [...new Set(input.flatMap((row) => Object.keys(row)))];
      rows = [columns, ...input.map((row) => columns.map((column) => (row as Record<string, unknown>)[column]))];
    } else if (input && typeof input === "object" && "columns" in input && "data" in input && Array.isArray(input.columns) && Array.isArray(input.data) && input.data.every(Array.isArray)) rows = [input.columns, ...input.data];
    else return [parseRows("Table", [])];
    return [reviewRows("Table", rows, mappings.Table)];
  }
  const workbook = XLSX.read(bytes, { type: "array", dense: true, raw: true, cellFormula: false, cellHTML: false, cellNF: false });
  return workbook.SheetNames.map((sheet) => { const label = /\.(xlsx?|xlsb|ods)$/i.test(name) ? sheet : "Table"; return reviewRows(label, XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheet], { header: 1, defval: "", raw: true }), mappings[label]); });
}

export function suggestGuideAliases(ids: string[], guides: GuideRow[]): { source: string; target: string }[] {
  const keys = new Set(guides.map((guide) => guide.guide_id));
  const grouped = new Map<string, string[]>();
  for (const key of keys) {
    const original = key.replace(/__sequence_\d+$/, "");
    keys.add(original);
    const suffix = original.includes("_") ? original.slice(original.indexOf("_")) : "";
    grouped.set(suffix, [...new Set([...(grouped.get(suffix) ?? []), original])]);
  }
  const near = (a: string, b: string) => {
    if (a.length !== b.length) return false;
    const different = [...a].map((letter, i) => letter === b[i] ? -1 : i).filter((i) => i >= 0);
    return different.length === 1 || (different.length === 2 && different[1] === different[0] + 1 && a[different[0]] === b[different[1]] && a[different[1]] === b[different[0]]);
  };
  return [...new Set(ids)].filter((id) => !keys.has(id)).map((source) => {
    const suffix = source.includes("_") ? source.slice(source.indexOf("_")) : "";
    const candidates = (grouped.get(suffix) ?? []).filter((key) => near(source, key));
    return { source, target: candidates.length === 1 ? candidates[0] : "" };
  });
}
