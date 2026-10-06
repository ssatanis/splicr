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

## Biophysical validation of guides (added 2026-09-30)

`engine/splicr/validate/` places every guide on hg38, predicts how the Cas9
break is repaired (Lindel, MIT, pinned), and maps in-frame outcomes onto the
protein (MANE CDS + UniProt curated residues). It is wired for annotation, not
as a correction to the statistics, because the correction was tested and did not
work: weighting guide counts by predicted frameshift — or by Rule Set 3
on-target activity, or by GC content — makes essential-gene detection slightly
*worse* on 100 individual Avana screens. The measurements, the mechanism, and
what is still worth keeping are in
[research/18](../research/18_BIOPHYSICAL_VALIDATION.md). Read that before
building anything on per-guide weighting.

## Scope of "every public screen"

Measured 2026-09-30. The broad GEO query matches 80,081 series all time and ENA
lists 95,375 amplicon runs whose study title mentions CRISPR. In the two-month
window the engine has actually classified, 406 studies yielded 71 screen-or-maybe
and 355 of 1,950 watched series carried SRA raw reads, so on those ratios the
processable historical corpus is on the order of a few thousand studies, not
80,000. At the observed cost of one study (12 runs, 3 GB of FASTQ, ~25 min on
8 CPUs) that is terabytes of transfer and thousands of CPU-hours: a budgeted
backfill, not a switch to flip. The engine processes forward automatically from
the watermark; a historical backfill is a separate, costed decision.

## Private screen activity and automatic deployment

The web server dispatches saved private analyses immediately through the
proxy-authenticated `queue_gateway`. Production uses `MODAL_GATEWAY_URL`,
`MODAL_PROXY_TOKEN_ID`, and `MODAL_PROXY_TOKEN_SECRET`. In local development,
when those are absent, the server uses the authenticated Modal CLI profile
through the JavaScript SDK. Tokens stay on the server.

`private_queue_scheduled` checks due private jobs every minute, independent of
web requests or open browser tabs, and starts workers up to the configured
concurrency limit. It also recovers missed dispatches and scheduled retries.
Each worker renews a five-minute database lease once per minute. The database
requeues expired leases and fails jobs that exhaust their retries. Job transitions
synchronize the run, screen, and stage activity, including input downloads.

The screen page distinguishes queued work from an active worker. Realtime
updates have a five-second polling fallback covering run state, stages, and QC;
returning to the tab triggers an immediate refresh. A disconnected client shows
that it is reconnecting instead of presenting stale activity as current.
Modal's `Inactive` label is expected when a function has no current calls:
workers scale down after completing their work.

`.github/workflows/modal-deploy.yml` deploys engine changes pushed to `main`,
then checks the deployed tools, references, and database with `doctor`.
It uses the repository's `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` Actions secrets.
The deployed pipeline version includes a source-content hash, so different
working-tree builds cannot silently share the same version label.
