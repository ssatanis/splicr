# CRISPR libraries

This folder holds raw CRISPR library files and metadata for SplicR. All libraries are loaded into Supabase via `scripts/seed-all-libraries.mjs`.

## Library manifest

`LIBRARY_MANIFEST.json` defines all 7 libraries, their file paths, formats, and parser types. The seed script reads this manifest and parses each library accordingly.

## Raw files (`raw/`)

| Library     | Type        | Organism | Files | Format | Parser      |
|------------|-------------|----------|-------|--------|------------|
| Brunello   | knockout    | Human    | 1 TXT | TSV    | addgene_tsv |
| BRIE       | knockout    | Mouse    | 1 TXT | TSV    | addgene_tsv |
| GeCKO v2   | knockout    | Human    | 2 CSV | CSV    | gecko_csv   |
| TKO v3     | knockout    | Human    | 1 XLSX| Excel  | tko_xlsx    |
| Calabrese  | activation  | Human    | 2 TXT | TSV    | barcode_tsv |
| Dolcetto   | inhibition  | Human    | 2 TXT | TSV    | barcode_tsv |
| Dolomiti   | inhibition  | Mouse    | 2 TXT | TSV    | barcode_tsv |

## Parsing details

- **addgene_tsv** (Brunello, BRIE): Tab-separated. Columns: Target Gene ID, Target Gene Symbol, Target Transcript, Genomic Sequence, Position of Base After Cut (1-based), Strand, **sgRNA Target Sequence**, …, Rule Set 2 score. Extracts sequence, gene symbol, gene ID, chromosome, position, strand, on-target score.
- **barcode_tsv** (Calabrese, Dolcetto, Dolomiti): Tab-separated. Columns: **Barcode Sequence**, Gene Symbol (or Annotated Gene Symbol), Gene ID (or Annotated Gene ID). No chromosome/position/strand; gene info only.
- **gecko_csv** (GeCKO v2): CSV. Columns: **Target Sequence**, Public ID, Plasmid Name, …. A and B files are combined into one library. Public ID stored as `sgrna_id`.
- **tko_xlsx** (TKO v3): Excel. First sheet used. Column names auto-detected (sequence, gene symbol, gene ID, position, strand, score). Case-insensitive header match.

Sequence length is validated (typically 20 bp); malformed rows are skipped and counted in the summary.

## Seeding the database

### Prerequisites

1. Supabase tables: run migrations so `libraries` and `sgrna_sequences` exist (including extended columns: `sequence`, `start_position`, `end_position`, `sgrna_id`, `off_target_score`, `on_target_score`).
2. Env: `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `frontend/.env.local`.

### Load all 7 libraries (recommended)

From repo root:

```bash
npm run seed:all
```

Or with env loaded explicitly:

```bash
node --env-file=frontend/.env.local scripts/seed-all-libraries.mjs
```

The script will:

1. Read `data/libraries/LIBRARY_MANIFEST.json`.
2. For each library: parse all listed files (combining A/B where applicable), insert one row into `libraries`, then batch-insert into `sgrna_sequences` (1000 rows per batch).
3. Log progress per library (e.g. `Processed 10,000 / 76,441 sgRNAs...`).
4. Print a final summary and total sgRNA count (e.g. **Loaded all 7 libraries: 781,894 total sgRNAs**).

### Load only Brunello

```bash
npm run seed:libraries
```

Uses `scripts/seed-libraries.mjs` for the single Brunello file only.

### Dependencies

- **xlsx** (npm): required for TKO v3 `.xlsx` parsing. Install with `npm install` at repo root (in `devDependencies`).

## Table schema (reference)

- **libraries:** `id`, `name`, `organism`, `library_type`, `total_sgrnas`, `genes_targeted`, `sgrnas_per_gene`, `description`, `addgene_id`, timestamps.
- **sgrna_sequences:** `id`, `library_id`, `sequence`, `sgrna_id`, `gene_symbol`, `gene_id`, `chromosome`, `start_position`, `end_position`, `strand`, `off_target_score`, `on_target_score`, timestamps.

Errors (e.g. missing file, Supabase timeout) are logged; malformed rows are skipped and the skip count is reported at the end.
