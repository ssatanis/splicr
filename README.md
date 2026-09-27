<div align="center">

# SplicR

**Know which hits are real.**

A CRISPR screen returns hundreds of candidates. Most labs can only validate a
handful. SplicR tells you which ones are worth the months.

</div>

---

## What it does

Upload a screen. Every hit comes back with three things:

| | |
|---|---|
| **A number** | The calibrated chance the hit survives a re-test |
| **A reason** | Why, in one line, with the evidence behind it |
| **A next step** | Which hits to validate first, and a plan to do it |

It is built on every public CRISPR screen, re-analyzed through one pipeline,
plus a growing record of which hits actually held up.

## The pipeline

Nine stages, run the same way on your screen and on every screen in the Atlas.

```
ingest → detect → count → QC → call hits → flag artifacts → atlas → score → report
```

Detection identifies the library by guide sequence, not by file name. Counting
locates the spacer by scanning for the vector anchor, so staggered primers do
not cost you reads. Artifacts are named individually, so a copy-number cluster
never quietly passes as biology.

## What is measured

Numbers we can point at a file for. Each one is reproducible from this
repository.

| | |
|---|---|
| **4th of 20,916** | Re-running a published olaparib screen from raw reads puts CHD1L, the gene that paper is about, fourth, and calls PARG at FDR 0.006 |
| **0.97** | Median per-guide CPM ratio against the authors' own deposited counts, across four samples |
| **20,872 of 20,872** | Off-target flags reproduce Fortin et al. 2019's published per-gene counts exactly, mean difference zero |
| **100%** | 500 random guides fingerprint to the right library, every decoy under 2% |

Reproduce the counting figure with:

```bash
engine/.tools/env/bin/python engine/tests/validate_counts.py
```

It writes `docs/validation/counting.json`.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000. The console has a demo mode, so you can look around
before making an account. Everything invented in demo mode says so on the page
and inside every file it exports.

## The analysis engine

```bash
bash engine/setup.sh
export PATH="engine/.tools/env/bin:$PATH"
python -m splicr doctor
```

`doctor` checks the tools, the reference data, Postgres and R2 in one pass and
names whichever piece is missing. The rest of the command line:

```bash
python -m splicr libraries            # what parses, with guide and gene counts
python -m splicr detect reads.fastq.gz
python -m splicr count reads.fastq.gz --library brunello --out counts.tsv
python -m splicr run --name "My screen" --fastq T0=a.fastq.gz ... --persist
```

`engine/setup.sh` installs MAGeCK, BAGEL2, bowtie, cutadapt, fastp, seqkit and
samtools. `engine/tests/integration_test.py` runs a screen built from real
Brunello guides end to end to prove the toolchain works.

## Reference data

```bash
bash scripts/data/download.sh          # add --all for the large archives
```

Gene annotation, reference gene sets, cell line identities, pooled libraries and
public evidence.

The bulk tables do not live in Postgres. 794,206 guide rows cost 129 MB of heap
plus 167 MB of indexes there, against the 500 MB a free project gets, and the
load is what took the database down. The same rows are 8.9 MB of Parquet on R2,
read with DuckDB:

```bash
engine/.tools/env/bin/python scripts/data/build-lake.py all --upload
```

Licences differ by source. Addgene libraries and Sanger Project Score stay local
and are never redistributed. See `docs/04-data-sources.md`.

## Layout

```
apps/web            the marketing site and the console
engine/splicr       the analysis pipeline, importable as a package
engine/tests        integration and validation runs
engine/analysis     one-off measurement scripts, kept for reproducibility
supabase/migrations the schema, every table with row level security
scripts/data        downloads, the reference lake, R2 sync
scripts/db          migrate, inspect, reclaim
docs                how it all fits together
```

## Checks

```bash
npm run typecheck && npm run lint && npm run build
engine/.tools/env/bin/python engine/tests/integration_test.py
```

## Licence

MIT for the code. Data keeps the licence of whoever published it.
