# Data model

This describes migration definitions, not a verified live deployment. The
repository currently contains 20 migration files; `supabase/migrations` is the
source of truth. `npm run db:status` reads the configured database state.
Schema columns do not establish that a feature is implemented or populated.

## Tenancy

```
auth.users ──▶ profiles
     │
     └──▶ org_members ──▶ organizations ──▶ api_keys, org_invites
```

Every user gets a profile and a personal organization on sign-up, created by a
trigger on `auth.users`. Everything else hangs off an organization.

Creating one afterwards goes through `public.create_organization(name, kind)`,
not through two inserts from the client. A caller may insert the organization,
because that policy only asks that `created_by` is their own id, but may not
insert their own first `org_members` row: "admins manage membership" requires an
admin role in the organization they are joining. Split across two statements a
failure leaves an organization with no members, which nobody can read,
administer or delete. The function does both above RLS and makes the caller the
owner. Its privileged body lives in `rpc_internal` with a `security invoker`
wrapper in `public`, which is the pattern migration 0017 established.

Roles are ordered: `owner` > `admin` > `member` > `viewer`. Policies ask
`private.has_org_role(org_id, 'member')` rather than comparing strings, so
adding a role later does not mean rewriting every policy.

## A screen

```
screens ──┬── samples ──── screen_files
          ├── comparisons          (what is tested against what)
          └── runs ──┬── run_stages, run_artifacts, run_events
                     ├── sample_qc, run_qc
                     ├── guide_counts        (partitioned)
                     ├── hits ──── hit_flags
                     ├── run_neighbors       (similar Atlas screens)
                     └── reports
```

A **screen** is the experiment. A **run** is one pass of the pipeline over it.
Re-running creates a new run and leaves the old results intact, because a
published figure has to stay reproducible.

`guide_counts` is hash-partitioned into 8 partitions on `screen_id`. Guide by
sample counts are the largest table by far, and partitioning keeps one screen's
rows in a common partition. A hash partition contains multiple screens, so
detaching it is not a safe way to remove one screen. No retention/deletion
operation is implied by this schema description.

## Hits

One row per gene per comparison, with each method in its own columns:

- Statistics: `lfc`, `p_value`, `fdr`, `rra_score`, `mle_beta`, `bayes_factor`, `norm_z`, `chronos_effect`
- Evidence: `n_guides`, `n_good_guides`, `guide_lfcs`, `max_guide_share`
- SplicR: `chance_real`, `chance_lower`, `chance_upper`, `novelty`, `verdict`, `reason`, `model_version`
- Atlas: `atlas_hit_count`, `atlas_screen_count`, `atlas_hit_rate`

These are available schema fields; individual callers populate only their own
outputs. `chance_real`, intervals and model fields are reserved for a future
calibrated model. Current pipeline confidence is null, and no fitted validation
model or automated retraining is available. The portable JSON report retains
directional statistics that are not all represented in legacy database columns.

## The Atlas

```
atlas.genes ──┬── atlas.guides ──── atlas.libraries
              ├── atlas.gene_set_members ──── atlas.gene_sets
              ├── atlas.copy_number ──── atlas.cell_models
              └── atlas.screen_hits ──── atlas.screens
                       atlas.gene_stats        (rollup scheduling defined in migrations)
                       atlas.validation_records (outcome schema; no adequate calibration cohort)
```

An earlier import recorded **157,085 genes**, **310,854 guides** across five
libraries, and four reference gene sets with complete symbol resolution. These
are historical import observations, not current deployed counts. Bulk reference
data can instead live in the Parquet lake; see [data audit](../research/04_DATA_AUDIT.md).

`atlas.screens.embedding` is a 768-dimension pgvector column with an HNSW
index and a `similar_screens()` function. That schema support does not establish
a populated embedding service. Current pipeline Atlas matching uses metadata
heuristics; it is not a trained semantic retrieval service.

## Jobs

```
jobs ──▶ pgmq queue ──▶ worker leases ──▶ heartbeat extends ──▶ archive
```

Migrations define an enqueue trigger and expired-lease handling. The diagram
shows intended worker behavior: no complete job-consumption/heartbeat worker is
implemented. Scheduled database functions and current live cron state have not
been verified here.

A unique `idempotency_key` can prevent duplicate job rows. It does not guarantee
exactly-once external execution or make all pipeline side effects idempotent.

## Row Level Security

Two helper functions carry almost all of it:

```sql
private.can_read_screen(id)   -- member of the owning org, or the screen is public
private.can_write_screen(id)  -- member or above in the owning org
```

They are `security definer` in the `private` schema with `search_path = ''`,
which stops a recursive policy lookup and keeps them off the public API.

Policies use membership helpers and supporting indexes. Wrapping a function in
`SELECT` can enable caching for uncorrelated expressions; an expression depending
on each row’s `org_id` is not guaranteed to run only once per statement. Verify
actual plans against representative tenancy/data sizes before asserting performance.

The Atlas is readable by everyone, signed in or not, except custom libraries,
which stay inside the organization that uploaded them.

## Things real data forced

Two constraints were wrong until real files hit them:

- **`genes_ensembl_uq` was too strict.** HGNC is not one-to-one with Ensembl:
  `ENSG00000230417` maps to two approved symbols. Now indexed, not unique.
- **Gene sets contain duplicate symbols**, so inserts deduplicate first.

Published gene sets also carry symbols from the year they were made, so
membership resolves through `prev_symbols` and then `aliases`. That lifted
CEGv2 from 657 of 684 to all 684.
