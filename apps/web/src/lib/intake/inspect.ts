import "server-only";

/**
 * Reading the beginning of a file a researcher has just uploaded, on the server.
 *
 * WHY THE SERVER READS IT AGAIN
 *
 * The drop zone already peeks at a count table in the browser so the researcher
 * sees their own column names immediately. That peek is a convenience and
 * nothing more. What SplicR acts on — which columns are samples, whether the
 * file is a readable FASTQ at all, which library the guides came from — is read
 * back out of storage here, from the bytes that actually arrived, so a file that
 * was truncated in transit is caught before any compute is spent on it.
 *
 * Only the head of the object is fetched: 2 MB of a count table is several
 * thousand guides, which is more than enough to fingerprint a library, and 1 MB
 * of a FASTQ is several thousand reads.
 */
import { gunzipSync, constants as zlibConstants } from "node:zlib";

import { createClient } from "@/lib/supabase/server";
import { supabaseUrl } from "@/lib/supabase/env";
import { headR2, parseR2Uri, readR2Head } from "./r2.server";

const TABLE_HEAD_BYTES = 2 * 1024 * 1024;
const FASTQ_HEAD_BYTES = 1024 * 1024;
/** Enough guides to fingerprint a library without sending a novel to Postgres. */
const FINGERPRINT_GUIDES = 2000;

export interface LibraryCandidate {
  library_id: string;
  slug: string;
  name: string;
  n_guides: number;
  n_matched: number;
  match_rate: number;
  coverage: number;
}

export interface CountTableShape {
  kind: "counts";
  delimiter: "tab" | "comma";
  columns: string[];
  guide_column: string | null;
  gene_column: string | null;
  sequence_column: string | null;
  sample_columns: string[];
  rows_seen: number;
  /** A handful of rows, so the researcher can confirm it read what they meant. */
  preview: string[][];
  libraries: LibraryCandidate[];
}

export interface FastqShape {
  kind: "fastq";
  reads_seen: number;
  read_length: number | null;
  /** The first read, so an unexpected adapter or barcode is visible. */
  first_read: string | null;
}

export type FileShape = CountTableShape | FastqShape;

export interface InspectFailure {
  ok: false;
  error: string;
}

export type InspectResult = ({ ok: true } & FileShape) | InspectFailure;

// ---------------------------------------------------------------------------
// Fetching the head of a stored object
// ---------------------------------------------------------------------------

/**
 * The first `bytes` of a stored object, with the caller's own session.
 *
 * Supabase's storage client has no range option, so this is a plain range
 * request against the same authenticated endpoint it would use. Row Level
 * Security is unchanged: the object name has to start with an organization the
 * session is a member of, which is what the policy checks.
 */
async function headOfObject(key: string, bytes: number): Promise<Uint8Array | null> {
  if (parseR2Uri(key)) return readR2Head(key, bytes);

  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;

  const response = await fetch(
    `${supabaseUrl}/storage/v1/object/authenticated/uploads/${encodeURI(key)}`,
    { headers: { authorization: `Bearer ${token}`, range: `bytes=0-${bytes - 1}` }, cache: "no-store" },
  );
  if (!response.ok && response.status !== 206) return null;
  return new Uint8Array(await response.arrayBuffer());
}

/** True when a stored object exists and is readable by this session. */
export async function objectExists(key: string): Promise<number | null> {
  if (parseR2Uri(key)) return headR2(key);

  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;

  const response = await fetch(
    `${supabaseUrl}/storage/v1/object/authenticated/uploads/${encodeURI(key)}`,
    { method: "HEAD", headers: { authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  if (!response.ok) return null;
  const length = Number(response.headers.get("content-length"));
  return Number.isFinite(length) ? length : 0;
}

/**
 * Text from a head that is probably the start of a larger file.
 *
 * Z_SYNC_FLUSH rather than the default: a gzip member cut off mid-stream is
 * exactly what a head of a compressed file is, and the default finish flush
 * treats that as corruption. The last line is dropped for the same reason — it
 * is almost certainly half a line.
 */
function decode(head: Uint8Array, compressed: boolean): string | null {
  try {
    const bytes = compressed
      ? gunzipSync(head, { finishFlush: zlibConstants.Z_SYNC_FLUSH })
      : head;
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

function lines(text: string): string[] {
  const all = text.split(/\r?\n/);
  all.pop(); // half a line, by construction
  return all.filter((line) => line.length > 0);
}

// ---------------------------------------------------------------------------
// Count tables
// ---------------------------------------------------------------------------

const GUIDE_NAME = /^(sgrna|sg_?rna|guide|grna|id|name|sgid)$/i;
const GENE_NAME = /^(gene|gene_?symbol|symbol|target|target_?gene|genes)$/i;
const SEQUENCE_NAME = /(seq|sequence|protospacer|spacer)/i;
const DNA = /^[ACGTNacgtn]{15,40}$/;

function splitRow(row: string, delimiter: string): string[] {
  return row.split(delimiter).map((cell) => cell.trim().replace(/^"|"$/g, ""));
}

function isNumeric(value: string): boolean {
  if (value === "" || value === "NA" || value === "NaN") return true;
  return Number.isFinite(Number(value));
}

function parseCountTable(text: string): Omit<CountTableShape, "libraries"> | null {
  const rows = lines(text);
  if (rows.length < 2) return null;

  // Skip MAGeCK-style comment preamble.
  let start = 0;
  while (start < rows.length && rows[start].startsWith("#")) start += 1;
  if (rows.length - start < 2) return null;

  const header = rows[start];
  const tabs = (header.match(/\t/g) ?? []).length;
  const commas = (header.match(/,/g) ?? []).length;
  if (tabs === 0 && commas === 0) return null;
  const delimiter = tabs >= commas ? "\t" : ",";

  const columns = splitRow(header, delimiter);
  if (columns.length < 2) return null;

  const body = rows.slice(start + 1).map((row) => splitRow(row, delimiter));
  const sound = body.filter((row) => row.length === columns.length);
  if (sound.length === 0) return null;
  const sampled = sound.slice(0, 200);

  const columnValues = (index: number) => sampled.map((row) => row[index] ?? "");

  let guide: string | null = null;
  let gene: string | null = null;
  let sequence: string | null = null;
  const samples: string[] = [];

  columns.forEach((column, index) => {
    const values = columnValues(index);
    const allDna = values.length > 0 && values.every((value) => DNA.test(value));
    const allNumeric = values.length > 0 && values.every(isNumeric);

    if (sequence === null && (allDna || SEQUENCE_NAME.test(column))) {
      if (allDna) {
        sequence = column;
        return;
      }
    }
    if (guide === null && GUIDE_NAME.test(column)) {
      guide = column;
      return;
    }
    if (gene === null && GENE_NAME.test(column)) {
      gene = column;
      return;
    }
    // A count column is numeric. The first column of a MAGeCK table is the
    // guide id even when it happens to look numeric, which the two checks
    // above have already claimed by name.
    if (allNumeric && index > 0) samples.push(column);
  });

  // Nothing claimed the identifier columns by name: take the leading
  // non-numeric columns as guide then gene, which is the MAGeCK layout.
  if (guide === null) {
    const leading = columns.findIndex((_, index) => !samples.includes(columns[index]));
    if (leading >= 0) guide = columns[leading];
  }

  return {
    kind: "counts",
    delimiter: delimiter === "\t" ? "tab" : "comma",
    columns,
    guide_column: guide,
    gene_column: gene,
    sequence_column: sequence,
    sample_columns: samples,
    rows_seen: sound.length,
    preview: [columns, ...sampled.slice(0, 5)],
  };
}

function guideSequences(text: string, shape: Omit<CountTableShape, "libraries">): string[] {
  if (!shape.sequence_column) return [];
  const delimiter = shape.delimiter === "tab" ? "\t" : ",";
  const index = shape.columns.indexOf(shape.sequence_column);
  if (index < 0) return [];

  const out: string[] = [];
  for (const row of lines(text).slice(1)) {
    if (row.startsWith("#")) continue;
    const cells = splitRow(row, delimiter);
    const value = cells[index];
    if (value && DNA.test(value)) out.push(value.toUpperCase());
    if (out.length >= FINGERPRINT_GUIDES) break;
  }
  return out;
}

async function detectLibrary(sequences: string[]): Promise<LibraryCandidate[]> {
  if (sequences.length < 50) return [];
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("detect_library", {
      p_sequences: sequences,
      p_limit: 4,
    });
    if (error) {
      console.error(`[intake/inspect] detect_library: ${error.message}`);
      return [];
    }
    return Array.isArray(data) ? (data as LibraryCandidate[]) : [];
  } catch (error) {
    console.error(`[intake/inspect] detect_library: ${error instanceof Error ? error.message : error}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// FASTQ
// ---------------------------------------------------------------------------

function parseFastq(text: string): FastqShape | null {
  const rows = lines(text);
  if (rows.length < 4 || !rows[0].startsWith("@")) return null;

  let reads = 0;
  let firstRead: string | null = null;
  let length: number | null = null;

  for (let i = 0; i + 3 < rows.length; i += 4) {
    if (!rows[i].startsWith("@")) return reads > 0 ? { kind: "fastq", reads_seen: reads, read_length: length, first_read: firstRead } : null;
    const read = rows[i + 1];
    if (!/^[ACGTNacgtn.]+$/.test(read)) return null;
    if (!rows[i + 2].startsWith("+")) return null;
    if (rows[i + 3].length !== read.length) return null;
    if (firstRead === null) {
      firstRead = read;
      length = read.length;
    } else if (length !== null && read.length !== length) {
      length = null; // variable length, which trimmed reads legitimately are
    }
    reads += 1;
  }

  return { kind: "fastq", reads_seen: reads, read_length: length, first_read: firstRead };
}

// ---------------------------------------------------------------------------

/**
 * What the bytes in storage actually are.
 *
 * Every failure is a sentence about the file, not about the transport: the
 * researcher can act on "this gzip file does not decompress" and cannot act on
 * "Z_BUF_ERROR".
 */
export async function inspectStoredFile(
  key: string,
  kind: "counts" | "fastq" | "library",
  compressed: boolean,
): Promise<InspectResult> {
  const head = await headOfObject(key, kind === "fastq" ? FASTQ_HEAD_BYTES : TABLE_HEAD_BYTES);
  if (head === null || head.length === 0) {
    return { ok: false, error: "The uploaded file could not be read back from storage." };
  }

  // The extension says gzip; the first two bytes decide.
  const gzipped = head.length > 1 && head[0] === 0x1f && head[1] === 0x8b;
  if (compressed && !gzipped) {
    return { ok: false, error: "This file name ends in .gz, but the uploaded bytes are not gzip." };
  }

  const text = decode(head, gzipped);
  if (text === null) {
    return { ok: false, error: "This file is marked as gzip but does not decompress. It may have been truncated." };
  }

  if (kind === "fastq") {
    const shape = parseFastq(text);
    if (!shape) {
      return { ok: false, error: "This does not read as FASTQ: the four-line record structure is not there." };
    }
    return { ok: true, ...shape };
  }

  const shape = parseCountTable(text);
  if (!shape) {
    return {
      ok: false,
      error: "This does not read as a table: no tab- or comma-separated header with at least two columns.",
    };
  }
  if (kind === "counts" && shape.sample_columns.length === 0) {
    return {
      ok: false,
      error: "This table has no numeric columns, so there are no sample counts in it.",
    };
  }

  const libraries = await detectLibrary(guideSequences(text, shape));
  return { ok: true, ...shape, libraries };
}
