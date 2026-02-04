#!/usr/bin/env node

/**
 * Parse all CRISPR library files (TXT, CSV, XLSX) and upload to Supabase.
 * Run: npm run seed:all
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in frontend/.env.local
 * Tables: libraries, sgrna_sequences (see data/libraries/README.md)
 */

import { createReadStream, readFileSync, existsSync, statSync } from 'fs';
import { createInterface } from 'readline';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RAW_DIR = join(ROOT, 'data', 'libraries', 'raw');
const MANIFEST_PATH = join(ROOT, 'data', 'libraries', 'LIBRARY_MANIFEST.json');

const BATCH_SIZE = 1000;
const PROGRESS_INTERVAL = 10000;

// Load env from frontend/.env.local
const envPath = join(ROOT, 'frontend', '.env.local');
if (existsSync(envPath)) {
  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eq = trimmed.indexOf('=');
      if (eq > 0) {
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
          value = value.slice(1, -1);
        if (!process.env[key]) process.env[key] = value;
      }
    }
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing Supabase config. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in frontend/.env.local');
  process.exit(1);
}

function rest(path, options = {}) {
  const { prefer = 'return=representation', ...restOptions } = options;
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...restOptions,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: prefer,
      ...options.headers,
    },
  });
}

// --- Parsers ---

/** Addgene-style TSV: Target Gene ID, Symbol, ..., Position, Strand, sgRNA Target Sequence, ..., Rule Set 2 score */
async function parseAddgeneTsv(filePath) {
  console.log(`  Reading file: ${filePath}`);
  if (!existsSync(filePath)) {
    console.error(`  ERROR: File not found: ${filePath}`);
    return { rows: [], skipped: 0 };
  }

  const rows = [];
  let skipped = 0;
  let lineCount = 0;
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let isHeader = true;

  for await (const rawLine of rl) {
    const line = rawLine.startsWith('\uFEFF') ? rawLine.slice(1) : rawLine;
    lineCount++;
    if (lineCount === 1) {
      console.log(`  First line (header): ${line.substring(0, 100)}...`);
    }
    if (isHeader) { isHeader = false; continue; }
    const cols = line.split('\t');
    if (cols.length < 7) { skipped++; continue; }
    const sequence = cols[6]?.trim();
    if (!sequence) { skipped++; continue; }
    const positionRaw = cols[4]?.trim();
    const position = positionRaw ? parseInt(positionRaw, 10) : null;
    const scoreCol = cols[10];
    const onTargetScore = scoreCol != null && scoreCol !== '' ? parseFloat(scoreCol) : null;
    const rawStrand = cols[5]?.trim() || null;
    rows.push({
      sequence,
      gene_symbol: cols[1]?.trim() || null,
      gene_id: cols[0]?.trim() || null,
      chromosome: cols[3]?.trim() || null,
      start_position: Number.isFinite(position) ? position : null,
      end_position: Number.isFinite(position) ? position + 20 : null,
      strand: normalizeStrand(rawStrand),
      on_target_score: onTargetScore,
      off_target_score: null,
      sgrna_id: null,
    });
    if (lineCount === 2) {
      console.log(`  First data row parsed: sequence=${sequence.substring(0, 20)}, gene=${cols[1]?.trim()}`);
    }
  }

  if (lineCount === 0) {
    try {
      if (statSync(filePath).size === 0) {
        console.error(`  ERROR: File is empty (0 bytes). Save the file in your editor or restore the library contents, then run again.`);
      }
    } catch (_) {}
  }
  console.log(`  Total lines read: ${lineCount}, rows parsed: ${rows.length}, skipped: ${skipped}`);
  return { rows, skipped };
}

/** Barcode-style TSV: Barcode Sequence, Gene Symbol (or Annotated Gene Symbol), Gene ID (or Annotated Gene ID) */
async function parseBarcodeTsv(filePath) {
  console.log(`  Reading file: ${filePath}`);
  const rows = [];
  let skipped = 0;
  let lineCount = 0;
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let isHeader = true;
  let symIdx = 1;
  let idIdx = 2;

  for await (const rawLine of rl) {
    const line = rawLine.startsWith('\uFEFF') ? rawLine.slice(1) : rawLine;
    lineCount++;
    if (isHeader) {
      isHeader = false;
      const h = line.split('\t').map((c) => c.trim().toLowerCase());
      if (h.includes('annotated gene symbol')) symIdx = h.indexOf('annotated gene symbol');
      else if (h.includes('gene symbol')) symIdx = h.indexOf('gene symbol');
      if (h.includes('annotated gene id')) idIdx = h.indexOf('annotated gene id');
      else if (h.includes('gene id')) idIdx = h.indexOf('gene id');
      continue;
    }
    const cols = line.split('\t');
    if (cols.length < 3) { skipped++; continue; }
    const sequence = cols[0]?.trim();
    if (!sequence) { skipped++; continue; }
    rows.push({
      sequence,
      gene_symbol: cols[symIdx]?.trim() || null,
      gene_id: cols[idIdx]?.trim() || null,
      chromosome: null,
      start_position: null,
      end_position: null,
      strand: null,
      on_target_score: null,
      off_target_score: null,
      sgrna_id: null,
    });
  }

  if (lineCount === 0 && existsSync(filePath)) {
    try {
      if (statSync(filePath).size === 0) {
        console.error(`  ERROR: File is empty (0 bytes). Save the file in your editor or restore the library contents.`);
      }
    } catch (_) {}
  }
  console.log(`  Total lines read: ${lineCount}, rows parsed: ${rows.length}`);
  return { rows, skipped };
}

/** GeCKO CSV: "Target Sequence","Public ID","Plasmid Name",... */
async function parseGeckoCsv(filePath) {
  const rows = [];
  let skipped = 0;
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let isHeader = true;
  for await (const line of rl) {
    const raw = (line.startsWith('\uFEFF') ? line.slice(1) : line).trim();
    if (!raw) continue;
    const cols = parseCsvLine(raw);
    if (isHeader) { isHeader = false; continue; }
    const sequence = cols[0]?.trim();
    if (!sequence) { skipped++; continue; }
    rows.push({
      sequence,
      gene_symbol: null,
      gene_id: null,
      chromosome: null,
      start_position: null,
      end_position: null,
      strand: null,
      on_target_score: null,
      off_target_score: null,
      sgrna_id: cols[1]?.trim() || null,
    });
  }
  return { rows, skipped };
}

function parseCsvLine(str) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '"') { inQuotes = !inQuotes; continue; }
    if (!inQuotes && (c === ',' || c === '\t')) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

/** Normalize strand values to '+', '-', or null */
function normalizeStrand(rawStrand) {
  if (!rawStrand || rawStrand === 'N/A') return null;
  const lower = rawStrand.toLowerCase().trim();
  if (lower === 'sense' || lower === 'plus' || lower === '+') return '+';
  if (lower === 'antisense' || lower === 'minus' || lower === '-') return '-';
  console.warn(`  Warning: Unknown strand value "${rawStrand}", setting to null`);
  return null;
}

/** Generate unique sgrna_id when missing */
function generateSgrnaId(row, libraryName, index, usedIds) {
  // Try file's ID first
  if (row.sgrna_id && row.sgrna_id.trim()) {
    const id = row.sgrna_id.trim();
    if (!usedIds.has(id)) {
      usedIds.add(id);
      return id;
    }
    // ID exists, add counter
    let counter = 2;
    while (usedIds.has(`${id}_v${counter}`)) counter++;
    const uniqueId = `${id}_v${counter}`;
    usedIds.add(uniqueId);
    return uniqueId;
  }

  // Generate from gene + sequence
  if (row.gene_symbol && row.sequence) {
    const hash = row.sequence.substring(0, 8);
    const id = `${row.gene_symbol}_${hash}`;
    if (!usedIds.has(id)) {
      usedIds.add(id);
      return id;
    }
    // Add counter if duplicate
    let counter = 2;
    while (usedIds.has(`${id}_v${counter}`)) counter++;
    const uniqueId = `${id}_v${counter}`;
    usedIds.add(uniqueId);
    return uniqueId;
  }

  // Fallback to library + index
  const id = `${libraryName}_${String(index).padStart(6, '0')}`;
  usedIds.add(id);
  return id;
}

/** TKO XLSX: detect columns from first row */
async function parseTkoXlsx(filePath) {
  console.log(`  Reading file: ${filePath}`);
  const { createRequire } = await import('module');
  const require = createRequire(import.meta.url);
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(filePath);
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (!data.length) return { rows: [], skipped: 0 };
  const header = (data[0] || []).map((c) => String(c).trim().toLowerCase());
  const rows = [];
  let skipped = 0;
  const seqIdx = findCol(header, ['sequence', 'target sequence', 'sgrna sequence', 'guide sequence', 'sgRNA']);
  const geneIdx = findCol(header, ['gene', 'gene symbol', 'symbol', 'gene symbol']);
  const idIdx = findCol(header, ['gene id', 'id', 'gene_id']);
  const posIdx = findCol(header, ['position', 'start', 'start position', 'pos']);
  const strandIdx = findCol(header, ['strand']);
  const scoreIdx = findCol(header, ['score', 'on target', 'rule set 2']);
  if (seqIdx === -1) {
    console.warn('  Warning: no sequence column found in XLSX, using first column. Header:', header.slice(0, 10));
  }
  const useSeqIdx = seqIdx >= 0 ? seqIdx : 0;
  for (let i = 1; i < data.length; i++) {
    const row = data[i] || [];
    const sequence = String(row[useSeqIdx] ?? '').trim();
    if (!sequence) { skipped++; continue; }
    const posRaw = posIdx >= 0 ? row[posIdx] : null;
    const startPos = posRaw != null ? parseInt(String(posRaw), 10) : null;
    const scoreVal = scoreIdx >= 0 && row[scoreIdx] != null && row[scoreIdx] !== '' ? parseFloat(String(row[scoreIdx])) : null;
    const rawStrand = strandIdx >= 0 && row[strandIdx] != null ? String(row[strandIdx]).trim() : null;
    rows.push({
      sequence,
      gene_symbol: geneIdx >= 0 ? (row[geneIdx] != null ? String(row[geneIdx]).trim() : null) : null,
      gene_id: idIdx >= 0 ? (row[idIdx] != null ? String(row[idIdx]).trim() : null) : null,
      chromosome: null,
      start_position: Number.isFinite(startPos) ? startPos : null,
      end_position: Number.isFinite(startPos) ? startPos + 20 : null,
      strand: normalizeStrand(rawStrand),
      on_target_score: scoreVal,
      off_target_score: null,
      sgrna_id: null,
    });
  }

  console.log(`  Total rows parsed: ${rows.length}, skipped: ${skipped}`);
  return { rows, skipped };
}

function findCol(header, names) {
  for (const n of names) {
    const i = header.findIndex((h) => h && h.includes(n));
    if (i >= 0) return i;
  }
  return -1;
}

/** Validate sequence length (optional, log only) */
function validateSequence(seq) {
  if (!seq) return false;
  const len = seq.length;
  if (len !== 20 && len !== 19 && len !== 21) return false;
  return /^[ACGT]+$/i.test(seq);
}

// --- Supabase ---

async function insertLibrary(meta) {
  const payload = {
    name: meta.name,
    organism: meta.organism,
    library_type: meta.library_type,
    total_sgrnas: meta.total_sgrnas ?? 0,
    genes_targeted: meta.genes_targeted ?? 0,
    sgrnas_per_gene: meta.sgrnas_per_gene ?? 0,
    description: meta.description ?? null,
    addgene_id: meta.addgene_id ?? null,
  };
  const res = await rest('/libraries', {
    method: 'POST',
    body: JSON.stringify(payload),
    prefer: 'return=representation',
  });
  if (!res.ok) throw new Error(`Insert library: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return Array.isArray(data) ? data[0]?.id : data?.id;
}

async function insertSgrnaBatch(libraryId, batch) {
  const records = batch.map((r) => ({
    library_id: libraryId,
    sequence: r.sequence,
    gene_symbol: r.gene_symbol || null,
    gene_id: r.gene_id || null,
    chromosome: r.chromosome || null,
    start_position: r.start_position ?? null,
    end_position: r.end_position ?? null,
    strand: r.strand || null,
    off_target_score: r.off_target_score ?? null,
    on_target_score: r.on_target_score ?? null,
    sgrna_id: r.sgrna_id,
  }));

  try {
    const res = await rest('/sgrna_sequences', {
      method: 'POST',
      body: JSON.stringify(records),
      prefer: 'return=minimal',
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return { success: batch.length, failed: 0, errors: [] };
  } catch (err) {
    // Batch failed - try individual inserts
    console.warn(`  Batch insert failed (${err.message}), trying individual inserts...`);
    let success = 0;
    let failed = 0;
    const errors = [];

    for (let i = 0; i < records.length; i++) {
      try {
        const res = await rest('/sgrna_sequences', {
          method: 'POST',
          body: JSON.stringify([records[i]]),
          prefer: 'return=minimal',
        });
        if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
        success++;
      } catch (e) {
        failed++;
        if (failed <= 5) {
          errors.push({ row: i, sgrna_id: records[i].sgrna_id, error: e.message });
        }
      }
    }

    return { success, failed, errors };
  }
}

// --- Main ---

async function parseLibraryFiles(lib, rawDir) {
  const allRows = [];
  let totalSkipped = 0;
  for (const file of lib.files) {
    const path = join(rawDir, file);
    if (!existsSync(path)) {
      console.warn(`  Warning: file not found ${file}`);
      continue;
    }
    let result;
    if (lib.parser === 'addgene_tsv') result = await parseAddgeneTsv(path);
    else if (lib.parser === 'barcode_tsv') result = await parseBarcodeTsv(path);
    else if (lib.parser === 'gecko_csv') result = await parseGeckoCsv(path);
    else if (lib.parser === 'tko_xlsx') result = await parseTkoXlsx(path);
    else {
      console.warn(`  Unknown parser: ${lib.parser}`);
      continue;
    }
    allRows.push(...result.rows);
    totalSkipped += result.skipped;
    if (result.skipped > 0) console.log(`    ${file}: ${result.rows.length} rows, ${result.skipped} skipped`);
  }
  return { rows: allRows, skipped: totalSkipped };
}

async function main() {
  if (!existsSync(MANIFEST_PATH)) {
    console.error('Manifest not found:', MANIFEST_PATH);
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
  const libraries = manifest.libraries;

  let totalSgrnas = 0;
  let totalSkipped = 0;
  const summary = [];

  console.log('Loading all 7 CRISPR libraries into Supabase...\n');

  for (const lib of libraries) {
    console.log(`\n--- ${lib.name} (${lib.organism}, ${lib.library_type}) ---`);
    const { rows, skipped } = await parseLibraryFiles(lib, RAW_DIR);
    totalSkipped += skipped;
    if (rows.length === 0) {
      console.log('  No rows parsed, skipping library insert.');
      console.log('  Tip: If the file has content in your editor, save it to disk and run again.');
      summary.push({ name: lib.name, count: 0, error: 'No data' });
      continue;
    }
    console.log(`  Parsed ${rows.length.toLocaleString()} sgRNAs${skipped ? ` (${skipped} malformed skipped)` : ''}.`);
    let invalidCount = 0;
    rows.forEach((r) => { if (!validateSequence(r.sequence)) invalidCount++; });
    if (invalidCount > 0) console.log(`  Note: ${invalidCount} sequences with non-20bp or non-ACGT.`);

    let libraryId;
    try {
      libraryId = await insertLibrary(lib);
      console.log('  Library id:', libraryId);
    } catch (e) {
      console.error('  Failed to insert library:', e.message);
      summary.push({ name: lib.name, count: 0, error: e.message });
      continue;
    }

    // Generate unique sgrna_ids for all rows
    console.log('  Generating unique sgrna_ids...');
    const usedIds = new Set();
    for (let i = 0; i < rows.length; i++) {
      rows[i].sgrna_id = generateSgrnaId(rows[i], lib.key, i, usedIds);
    }

    let inserted = 0;
    let totalFailed = 0;
    const allErrors = [];

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const result = await insertSgrnaBatch(libraryId, batch);
      inserted += result.success;
      totalFailed += result.failed;
      if (result.errors.length > 0) {
        allErrors.push(...result.errors);
      }
      if (inserted % PROGRESS_INTERVAL === 0 || (inserted + totalFailed) >= rows.length) {
        console.log(`  Processed ${(inserted + totalFailed).toLocaleString()} / ${rows.length.toLocaleString()} sgRNAs (${inserted.toLocaleString()} inserted, ${totalFailed} failed)...`);
      }
    }

    if (allErrors.length > 0) {
      console.error(`  First ${Math.min(5, allErrors.length)} errors:`);
      allErrors.slice(0, 5).forEach((err) => {
        console.error(`    Row ${err.row}, sgrna_id="${err.sgrna_id}": ${err.error}`);
      });
    }

    totalSgrnas += inserted;
    if (totalFailed > 0) {
      summary.push({ name: lib.name, count: inserted, error: `${totalFailed} rows failed` });
    } else {
      summary.push({ name: lib.name, count: inserted });
    }
    console.log(`  Done: ${inserted.toLocaleString()} sgRNAs inserted${totalFailed > 0 ? `, ${totalFailed} failed` : ''}.`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  summary.forEach((s) => {
    if (s.error) console.log(`  ${s.name}: ${s.count} inserted, error: ${s.error}`);
    else console.log(`  ${s.name}: ${s.count.toLocaleString()} sgRNAs`);
  });
  if (totalSkipped > 0) console.log(`  Malformed rows skipped: ${totalSkipped}`);
  console.log('\n✅ Loaded all 7 libraries: ' + totalSgrnas.toLocaleString() + ' total sgRNAs');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
