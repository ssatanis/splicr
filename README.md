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

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000. The dashboard has a demo mode, so you can look
around before making an account.

## The analysis engine

```bash
bash engine/setup.sh
export PATH="engine/.tools/env/bin:$PATH"
python engine/tests/integration_test.py
```

This installs MAGeCK, BAGEL2, bowtie, cutadapt, fastp, seqkit and samtools,
then runs a screen built from real Brunello guides end to end to prove the
toolchain works.

## Reference data

```bash
bash scripts/data/download.sh
```

Gene annotation, reference gene sets, cell line identities, pooled libraries
and public evidence. Add `--all` for the large archives.

Licences differ by source. Addgene libraries and Sanger Project Score stay
local and are never redistributed. See `docs/04-data-sources.md`.

## Layout

```
apps/web      the web app and dashboard
engine        the analysis pipeline
supabase      database migrations
scripts       data downloads and database tools
docs          how it all fits together
```

## Checks

```bash
npm run typecheck
npm run lint
npm run build
```

## Licence

MIT for the code. Data keeps the licence of whoever published it.
