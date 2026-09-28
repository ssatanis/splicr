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
