<div align="center">

# SplicR

**Inspect the evidence behind CRISPR screen hits.**

SplicR analyzes screening measurements and organizes evidence for follow-up.
Independent validation is still needed to determine which candidates reproduce.

</div>

---

## What it does

The local analysis engine processes FASTQ or count tables and returns gene-level
statistics, QC and artifact evidence. The intended Hit Report has three parts:

| | |
|---|---|
| **A number** | Measured effect and method-specific significance; calibrated validation probability is not available yet |
| **A reason** | Why, in one line, with the evidence behind it |
| **A next step** | Which hits to validate first, and a plan to do it |

The Atlas imports public BioGRID ORCS screen summaries and retains their original
authors' hit calls. It is not a uniform raw-read reanalysis of every public screen.
The post-screen pipeline currently skips calibrated scoring because no validation
confidence model is fitted. The browser upload and completed-outcome entry are not connected end to end.
Authenticated workspace pages read actual records; demonstrations require an
explicit demo context. The local CLI and scoped hits API have implemented paths. See `research/01_REPOSITORY_AUDIT.md`.

## The pipeline

Nine stage names organize a local screen analysis. The scoring stage is currently
skipped, and imported Atlas summaries have not all been processed by these stages.

```
ingest → detect → count → QC → call hits → flag artifacts → atlas → score → report
```

Detection identifies the library by guide sequence, not by file name. Counting
uses vector-anchor and offset detection to support staggered primers.
Artifact annotations identify possible confounders; their absence does not prove
a hit is genuine, and an amplified-region hit is not automatically false.

## What is measured

The current [research results](research/10_FINAL_RESULTS.md) and website
`/evidence` page use actual measurements. No new benchmark leadership or perfect
accuracy is claimed.

| Measurement | Result and scope |
|---|---|
| **Pre-screen prediction** | New router 0.160369 versus published ensemble 0.163091 AnDCG@100; no demonstrated improvement |
| **Raw sequencing replay** | 26,336,701 reads across four GSE145743 samples; guide-level Spearman 0.9289–0.9548 |
| **Count agreement** | 84.01–89.49% of 65,383 guides per sample within 25% of deposited CPM |
| **Processed-count analysis** | Directional-statistics correction changes q<0.1 calls from 39 to 22; CHD1L nonsignificant and QC failed |

Earlier raw-read CHD1L, reference-annotation and library-fingerprint checks remain
in the research history. They use different inputs and cannot substitute for
independent validation or be treated as universal accuracy estimates.

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

Open http://localhost:3000. The current proxy configuration disables public
console and authentication routes. Explicit demo code is retained for review;
sample pages and exports identify their data and are isolated from real
workspace sessions. Enabling or deploying the console is a separate step.

## Website evidence and checks

The homepage, Technology and Evidence pages read a shared snapshot generated
from measured research artifacts. The homepage hit row is the actual processed
CHD1L audit, including its nonsignificant result, its six per-guide fold changes
and the QC limitation. Contact posts to `/api/demo-request` and sends through
Resend; it confirms only once the send succeeded, and shows a failure as one.

```bash
npm run evidence:generate  # update public downloads from research artifacts
npm run evidence:check    # fail on stale downloads or measurements
npm run test:web
npm run typecheck
npm run lint
npm run build -w apps/web -- --webpack
```

The website distinguishes implemented local tools, stored workspace readers and
unavailable workflows. Model scores are uncalibrated; sample values are confined
to explicit demonstrations. The Evidence downloads are a subset of the full
repository and do not include the complete data/environment needed to reproduce
all analyses. See [website consistency record](research/12_WEBSITE_CONSISTENCY.md).

## The analysis engine

```bash
bash engine/setup.sh
export PATH="$PWD/engine/.tools/env/bin:$PATH"
export PYTHONPATH="$PWD/engine${PYTHONPATH:+:$PYTHONPATH}"
python -m splicr doctor
```

`doctor` checks the tools, the reference data, Postgres and R2 in one pass and
names whichever piece is missing. The rest of the command line:

```bash
python -m splicr libraries            # what parses, with guide and gene counts
python -m splicr detect reads.fastq.gz
python -m splicr count reads.fastq.gz --library brunello --out counts.tsv
python -m splicr run --name "My screen" --counts counts.tsv \
  --library brunello --control T0 --treatment endpoint \
  --role T0=reference --phenotype "cell proliferation" \
  --fitness-assay --workdir data/work/my-screen
```

Run these commands from the repository root. Replace sample names and paths
with columns and files from your experiment. Use `--no-fitness-assay` for
phenotypes where essential-gene depletion is not an appropriate control. Local
analysis does not require `--persist`; that option writes to the configured
database and requires an authorized organization. `doctor` includes optional
database/storage checks, so missing credentials do not by themselves prevent
a local-only analysis.

`engine/setup.sh` installs MAGeCK, BAGEL2, bowtie, cutadapt, fastp, seqkit and
samtools. `engine/tests/integration_test.py` runs a screen built from real
Brunello guides end to end to check toolchain wiring. Its planted effects do not validate
biological prediction. Optional research dependencies have separate pins in
`engine/requirements.txt`; see [engine setup caveats](docs/05-engine.md).

## Reference data

```bash
bash scripts/data/download.sh          # add --all for the large archives
```

Gene annotation, reference gene sets, cell line identities, pooled libraries and
public evidence.

The reference lake supports compressed Parquet and DuckDB to limit database
storage. A historical measurement found 794,206 guide rows used 129 MB of heap
plus 167 MB of indexes, versus 8.9 MB of Parquet. This is a recorded local/storage
comparison, not a statement of current deployed contents or plan limits. Build
local lake files with:

```bash
engine/.tools/env/bin/python scripts/data/build-lake.py all
```

Uploading with the separate `--upload` flag writes to configured R2; verify
source permissions before doing so. Licences differ by source. Addgene and
direct Sanger data require source-specific review for commercial use or export. See `docs/04-data-sources.md`.

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
PYTHONPATH=engine engine/.tools/env/bin/python engine/tests/integration_test.py
```

If Turbopack encounters the documented environment port-binding restriction,
`npm run build -w apps/web -- --webpack` is the verified alternative. The current
research test record and limits are in [the final report](research/10_FINAL_RESULTS.md).

## Licence

MIT for the code. Data keeps the licence of whoever published it.
