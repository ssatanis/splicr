#!/usr/bin/env node

/**
 * Parse CRISPR library TSV files and upload to Supabase (libraries + sgrna_sequences).
 *
 * Usage (from repo root):
 *   npm run seed:libraries
 *
 * Or with env loaded from frontend:
 *   node --env-file=frontend/.env.local scripts/seed-libraries.mjs
 *
 * Requires in env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY).
 * Tables: libraries, sgrna_sequences (see data/libraries/README.md for schema).
 */

import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const BATCH_SIZE = 1000;
const PROGRESS_INTERVAL = 10000;

// Load env from frontend/.env.local if not set
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
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = value;
      }
    }
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing Supabase config. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) in frontend/.env.local');
  process.exit(1);
}

const BRUNELLO_PATH = join(ROOT, 'data', 'libraries', 'raw', 'brunello-library-contents.txt');

/**
 * Brunello file columns (tab-separated):
 * 0: Target Gene ID
 * 1: Target Gene Symbol
 * 2: Target Transcript
 * 3: Genomic Sequence (e.g. NC_000019.10)
 * 4: Position of Base After Cut (1-based)
 * 5: Strand (sense/antisense)
 * 6: sgRNA Target Sequence (20bp)
 */
function parseLine(line) {
  const cols = line.split('\t');
  if (cols.length < 7) return null;
  const geneId = cols[0]?.trim() ?? '';
  const geneSymbol = cols[1]?.trim() ?? '';
  const genomicSeq = cols[3]?.trim() ?? ''; // chromosome ref
  const positionRaw = cols[4]?.trim();
  const position = positionRaw ? parseInt(positionRaw, 10) : null;
  const strand = cols[5]?.trim() ?? '';
  const sgrnaSequence = cols[6]?.trim() ?? '';
  if (!sgrnaSequence) return null;
  return {
    sgrna_sequence: sgrnaSequence,
    gene_symbol: geneSymbol,
    gene_id: geneId,
    chromosome: genomicSeq,
    position: Number.isFinite(position) ? position : null,
    strand: strand || null,
  };
}

function rest(path, options = {}) {
  const { prefer = 'return=representation', ...restOptions } = options;
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  return fetch(url, {
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

async function insertLibrary() {
  const payload = {
    name: 'Brunello',
    organism: 'Human',
    library_type: 'knockout',
    total_sgrnas: 76441,
    genes_targeted: 19114,
    sgrnas_per_gene: 4,
    description: 'Human CRISPR Knockout Pooled Library (Brunello)',
    addgene_id: '73179',
  };
  const res = await rest('/libraries', {
    method: 'POST',
    body: JSON.stringify(payload),
    prefer: 'return=representation',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Insert library: ${res.status} ${text}`);
  }
  const data = await res.json();
  const id = Array.isArray(data) ? data[0]?.id : data?.id;
  if (!id) throw new Error('No library id returned');
  return id;
}

async function insertSgrnaBatch(libraryId, rows) {
  const records = rows.map((r) => ({
    library_id: libraryId,
    sgrna_sequence: r.sgrna_sequence,
    gene_symbol: r.gene_symbol,
    gene_id: r.gene_id,
    chromosome: r.chromosome,
    position: r.position,
    strand: r.strand,
  }));
  const res = await rest('/sgrna_sequences', {
    method: 'POST',
    body: JSON.stringify(records),
    prefer: 'return=minimal',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Insert batch: ${res.status} ${text}`);
  }
}

async function main() {
  if (!existsSync(BRUNELLO_PATH)) {
    console.error('File not found:', BRUNELLO_PATH);
    process.exit(1);
  }

  console.log('Parsing', BRUNELLO_PATH, '...');
  const rows = [];
  const rl = createInterface({ input: createReadStream(BRUNELLO_PATH), crlfDelay: Infinity });
  let isHeader = true;
  for await (const line of rl) {
    if (isHeader) {
      isHeader = false;
      continue;
    }
    const row = parseLine(line);
    if (row) rows.push(row);
  }

  const total = rows.length;
  console.log('Parsed', total.toLocaleString(), 'sgRNA rows.\n');

  console.log('Inserting library record...');
  let libraryId;
  try {
    libraryId = await insertLibrary();
    console.log('Library id:', libraryId);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  console.log('Inserting sgRNA sequences in batches of', BATCH_SIZE, '...');
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    try {
      await insertSgrnaBatch(libraryId, batch);
      inserted += batch.length;
      if (inserted % PROGRESS_INTERVAL === 0 || inserted === total) {
        console.log('Processed', inserted.toLocaleString(), '/', total.toLocaleString(), 'sgRNAs...');
      }
    } catch (e) {
      console.error('Batch failed at row', inserted + 1, ':', e.message);
      process.exit(1);
    }
  }

  console.log('Done. Inserted', inserted.toLocaleString(), 'sgRNA sequences for library', libraryId);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
