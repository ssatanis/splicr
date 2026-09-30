# Autonomous ingest of deposited CRISPR screens

Status 2026-09-30. Code: `engine/splicr/ingest/`, `engine/modal_app.py`,
`orchestration/airflow/dags/splicr_ingest.py`. State: Supabase schema `ingest`
(migration `20260929000500_ingest_engine.sql`).

## What it does

When a lab deposits a pooled CRISPR screen in GEO, SRA or ENA, SplicR finds it,
works out the experimental design from the deposited metadata, downloads the
raw reads, checks them, reanalyzes them with the same pipeline as every other
screen, maps every gene, cell line and compound to a standard identifier, and
publishes the result. Nobody downloads anything by hand.

```
discover ──► classify ──► plan ──► fetch + FastQC ──► count ──► QC ──► MAGeCK / BAGEL2 ──► harmonize ──► publish
 GEO/SRA/ENA  screen?      roles,    ENA HTTPS, md5      per-run    NNMD,    per contrast       Ensembl,       R2 lake +
 since the    score +      contrasts, verified            library    AUROC,                      RRID,          atlas.screens +
 watermark    reasons      entities                       detection  Gini                        ChEMBL         atlas.screen_hits
```

| Stage | Module | Output | Where it is recorded |
|---|---|---|---|
| discover | `ingest/discover.py` | StudyCandidate per study, de-duplicated across GEO/SRA/ENA | `ingest.studies` (status `discovered` or `rejected`) |
| classify | `ingest/classify.py` | score in [0,1], verdict, human-readable reasons | same row |
| plan | `ingest/metadata.py`, `ingest/design.py` | StudyPlan: runs, roles, contrasts, modality, cell line (RRID), compound (ChEMBL) | `ingest.studies.plan`, `ingest.runs`; `planned` or `needs_review` |
| fetch | `ingest/fetch.py` | FASTQ from ENA, MD5-verified, FastQC report per file | `ingest.runs.fastqc`, events |
| analyze | `ingest/analyze.py` | library detected per run from reads; counts once per sample; `pipeline.run_pipeline` per contrast and library | `ingest.runs` mapping rates |
| publish | `ingest/publish.py` | harmonized gene results, guide counts, per-contrast summaries; called hits | R2 `lake/reprocessed_*/accession=…/`; `atlas.screens`, `atlas.screen_hits` |

## Guarantees

- **Never a guessed design.** A plan is `ready` only when every included run's
  role is confident and every contrast passes `design.build_design`. Anything
  else is `needs_review` with plain-language issues. A study whose reads match
  no library SplicR holds goes to review with the best candidate and its match
  rate; it is not analyzed against the wrong library.
- **Verified inputs.** Every FASTQ is checked against ENA's size and MD5 before
  counting. FastQC runs on every file; the FAILs that are expected for amplicon
  libraries (per-base content, duplication, overrepresented sequences) are not
  reported as problems, while quality and N-content failures are.
- **Hard-mapped identifiers, enforced twice.** `harmonize.enforce` maps genes to
  Ensembl (human ENSG, mouse ENSMUSG, validated against the Ensembl 116 GTF),
  cell lines to Cellosaurus RRIDs, compounds to ChEMBL parent molecules, and
  quarantines what it cannot map. A study below 90% gene mapping is refused.
  Database triggers then reject any reanalyzed screen without an RRID (or a
  recorded reason there is none) and any gene row without an Ensembl id.
- **Idempotent and resumable.** Status only moves forward; every unit checks it
  before working; `ingest.claim()` leases work so two workers never take the
  same study. A run whose FASTQ ENA has not generated yet is retried later, not
  failed.
- **Reproducible.** Every published row carries the pipeline version (git
  commit), the tool versions are pinned in the image (MAGeCK 0.5.9.5, FastQC
  0.12.1, BAGEL2 v2.0 build 115), and the lake keeps the guide-level counts so
  any result can be recomputed.

## Running it

```bash
modal deploy engine/modal_app.py            # daily discovery 07:00 UTC, sweep every 2 h
modal run engine/modal_app.py::main --action doctor
modal run engine/modal_app.py::main --action discover --since 2026-09-01
modal run engine/modal_app.py::main --action plan --accession GSE145743
modal run engine/modal_app.py::main --action process --accession GSE145743
```

Progress is readable without credentials through `public.ingest_studies`,
`public.ingest_runs`, `public.ingest_events`, `public.ingest_summary`,
`public.reanalyzed_screens` and `public.reanalyzed_hits`.

Airflow: `orchestration/airflow/dags/splicr_ingest.py` sequences the same Modal
functions. Use it or the Modal schedules, not both.

## Infrastructure

| Piece | Where |
|---|---|
| Compute | Modal app `splicr-ingest`: `process_study` 8 CPU / 16 GB / 512 GB disk, up to 8 concurrent |
| Credentials | Modal secret `splicr-ingest`: SUPABASE_DB_URL, R2 keys, NCBI e-mail |
| Reference data | Modal volume `splicr-reference-data` under `/references` (libraries, annotation incl. Ensembl GTFs, gene sets, off-target, coordinates, Cellosaurus, ChEMBL molecules, ORCS Atlas, DepMap CN). Library files are Addgene/GPP material: internal use only, never exported. |
| Results | R2 `lake/reprocessed_{gene_results,guide_counts,screens,quarantine}/accession=…/` and Supabase |

## Acceptance test

`scripts/data/ingest-acceptance-gse145743.py` seeds the hand-curated design of
GSE145743 (HeLa, GeCKO v2 A+B, olaparib vs DMSO, T0 dropout; Juhász et al.
2020) and checks what the engine published. The same accession, planned
automatically, must reproduce that design.
