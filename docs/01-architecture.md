# Architecture

Status reviewed 2026-09-27. This describes source implementation; it does not
verify the deployed database, operational backups or live service availability.
See [the repository audit](../research/01_REPOSITORY_AUDIT.md).

## Implemented components

| Component | Current responsibility |
|---|---|
| Next.js / React web app | Marketing pages, explicit demonstrations, authenticated workspace reads and scoped APIs |
| Python CLI | Local FASTQ/count ingestion, detection, counting, QC, hit calling, artifact evidence, Atlas context and JSON report |
| Supabase / Postgres | Organization-scoped schema, row policies and optional persisted pipeline results |
| Local references / Parquet lake | Libraries, annotations and public evidence; optional R2 storage |

```text
Authenticated web routes ──▶ Supabase client + organization checks ──▶ Postgres/RLS
Local FASTQ/count table ──▶ Python pipeline ──▶ local evidence report
                                    └── optional --persist ──▶ Postgres
Public reference files ──▶ local parsing / Parquet ──▶ pipeline context
```

The CLI can run without database writes. Its calibrated scoring stage is
explicitly skipped: no fitted independent-validation probability model exists.
Pre-screen research is a separate workflow under `engine/analysis` and does not
consume a target screen's counts. Its archived benchmark values are not evidence
that a production model outperforms published baselines.

## Authorization

Web requests use authenticated Supabase clients and explicit organization/record
checks. Database Row Level Security provides another boundary. Real sessions do
not fall back to sample records when data are missing or unavailable. Demo pages
require explicit demo context. The configured public console disable gate remains
active; source implementation is not a deployment announcement.

Engine credentials can bypass RLS. Keep them server-side, use only authorized
organizations, and do not assume database policies constrain a privileged CLI.
Production tenant isolation still needs live-environment testing; local tests
exercise request and data-adapter behavior.

## Database definitions

| Schema | Defined contents |
|---|---|
| `public` | Screens, runs, jobs, hits, validation outcomes and reports |
| `atlas` | Reference genes/libraries, public screen summaries and evidence |
| `private` | Security-definer membership/policy helpers |

Schema support does not establish that each feature has a functioning UI,
worker or populated data. Atlas summaries retain source authors' heterogeneous
hit calls; they are not a uniform raw-read reanalysis.

## Planned orchestration

Migrations define job queues, leases and progress-related structures. A complete
worker that claims jobs, extends leases and executes the pipeline is not
implemented. Browser resumable FASTQ uploading and job submission are not wired
to that worker. Their intended design is direct object-storage upload followed
by external CPU analysis, rather than large sequencing jobs in a web request.

The same distinction applies to calibrated validation confidence, full outcome
entry and workspace report export: partial schemas/routes are not completed
end-to-end workflows. Local runs now produce portable JSON evidence reports.

## Environments and operations

Configuration determines local database/storage targets. Do not infer that a
local command uses an isolated database. `--persist`, migrations, reference
imports and R2 upload flags can change external state. Read-only `doctor` checks
connectivity but does not certify permissions, backups or production readiness.

Preview database branching, Linux worker images, backup/PITR configuration and
capacity guarantees require separate operational verification. They are not
established by this repository audit. Preserve local-only workflows and versioned
reference manifests while that integration is completed.

## Data platform (reviewed 2026-09-29)

Every layer below is labelled with what exists. "Running" means it runs today
against real data; "Built" means code exists and is tested but has no deployed
scheduler or service; "Target" means designed, not provisioned, and names what
provisioning needs.

| Layer | Target (exascale) | What runs today | Status |
|---|---|---|---|
| Raw object store | S3 / GCS | Cloudflare R2 bucket `splicr` (~10.6 GB); public sources read in place from S3 (JUMP), GCS (Arc) and Hugging Face (Tahoe) | Running |
| Columnar matrices | BigQuery / Snowflake | Parquet lake (`data/lake`, mirrored to R2 `lake/`) queried with DuckDB; row-group pruning makes a one-gene read of a 133 MB matrix ~2.5 s from R2 | Running |
| Graph | Neo4j | `kg_nodes` / `kg_edges` in the lake (69k nodes, 2.95M edges, 7 edge types), multi-hop queries in DuckDB (<1 s); `graph.export_neo4j()` writes neo4j-admin import files | Running (Neo4j: target, needs an instance) |
| Vectors | Milvus / Pinecone | Exact cosine search over Perturb-seq, JUMP and DepMap gene embeddings (8k–18k vectors each) in NumPy/DuckDB; `vectors.export_vectors()` for a vector DB | Running (vector DB: target) |
| App database | Supabase Postgres | Tenant data under RLS plus small reference rollups (`atlas.gene_dependency`, `gene_stats`, `cell_models`, `data_sources`) | Running |
| Entity resolution | Hard-mapped ontologies | `engine/splicr/harmonize.py`: Ensembl gene ids for human and mouse (validated against the Ensembl 116 GTF; HGNC/MGI and Entrez kept as cross-references), Cellosaurus RRID (cell lines), ChEMBL parent (compounds); ambiguous inputs are never guessed; `harmonize.enforce()` quarantines unmappable rows and database triggers reject unharmonized reanalyzed screens | Running |
| Ingestion | Airflow + serverless | Autonomous GEO/SRA/ENA screen ingest on Modal (`engine/modal_app.py`, docs/06): discover, plan, ENA FASTQ + MD5 + FastQC, count, MAGeCK/BAGEL2, harmonize, publish; Airflow DAG in `orchestration/airflow`; reference connectors in `scripts/data/ingest-sources.py` | Running (end-to-end on GSE145743) |
| Burst compute | Modal (MAGeCK, BAGEL2, DrugZ) | Modal app `splicr-ingest`: 8 CPU / 16 GB / 512 GB disk per study, pinned MAGeCK 0.5.9.5, FastQC 0.12.1, BAGEL2 build 115 | Running |
| GPU training | K8s + A100/H100 | CPU ridge dependency model (research/17); no GPU hardware or cluster | Target |
| NL query | LLM -> Cypher | `splicr graph` / `graph.selective_dependencies` give the executable, statistically tested query an LLM would call; no LLM endpoint wired | Built |

### Why DuckDB and Parquet before BigQuery and Neo4j

At SplicR's current holdings (a few GB of harmonized matrices, ~3M graph edges,
~40k embedding vectors) a columnar file read with predicate pushdown answers the
app's questions in about a second without a warehouse bill or a second database
to secure. The layout is chosen so the move is a load, not a rewrite: the lake
is hive-partitioned Parquet (BigQuery external tables read it directly), the
graph exports in neo4j-admin format, and vectors export as (id, vector) Parquet.
The move becomes worth it when a single query must scan tens of GB (Tahoe-100M
cell matrices, scBaseCount per-cell metadata), which today are read in place.

### Autonomous ingest: what is automatic and what is not

1. **Detect** (built): E-utilities query for GEO series describing pooled CRISPR
   screens; 1,950 series, 355 with SRA raw reads, 87 already in the Atlas by PMID.
2. **Retrieve, count, call** (built, manual trigger): `python -m splicr run` on
   FASTQ or counts.
3. **Schedule** (target): a scheduler (Airflow, or a Modal cron) running step 1
   daily and step 2 per new accession. Needs a compute account and a worker that
   claims `public.jobs` (the queue schema exists; the worker does not).
