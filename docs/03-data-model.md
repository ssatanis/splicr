# Data model

Applied schema: 10 migrations, 46 tables, Row Level Security on every one.
`npm run db:status` prints the live state.

## Tenancy

```
auth.users ──▶ profiles
     │
     └──▶ org_members ──▶ organizations ──▶ api_keys, org_invites
```

Every user gets a profile and a personal organization on sign-up, created by a
trigger on `auth.users`. Everything else hangs off an organization.

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
rows together and lets an old screen be detached and dropped cheaply.

## Hits

One row per gene per comparison, with each method in its own columns:

- Statistics: `lfc`, `p_value`, `fdr`, `rra_score`, `mle_beta`, `bayes_factor`, `norm_z`, `chronos_effect`
- Evidence: `n_guides`, `n_good_guides`, `guide_lfcs`, `max_guide_share`
- SplicR: `chance_real`, `chance_lower`, `chance_upper`, `novelty`, `verdict`, `reason`, `model_version`
- Atlas: `atlas_hit_count`, `atlas_screen_count`, `atlas_hit_rate`

Nothing is collapsed into a single score column. When two methods disagree the
report says so, because that disagreement is information.

`model_version` is stored per hit. A score from six months ago stays
interpretable after the model is retrained.

## The Atlas

```
atlas.genes ──┬── atlas.guides ──── atlas.libraries
              ├── atlas.gene_set_members ──── atlas.gene_sets
              ├── atlas.copy_number ──── atlas.cell_models
              └── atlas.screen_hits ──── atlas.screens
                       atlas.gene_stats        (rolled up nightly)
                       atlas.validation_records (the answer key)
```

Currently loaded: **157,085 genes** (human from HGNC, mouse from NCBI),
**310,854 guides** across 5 libraries, and 4 reference gene sets that resolve
at 100%.

`atlas.screens.embedding` is a 768-dimension pgvector column with an HNSW
index, used by `similar_screens()`.

## Jobs

```
jobs ──▶ pgmq queue ──▶ worker leases ──▶ heartbeat extends ──▶ archive
```

A row in `jobs` enqueues a message by trigger. Workers take a short visibility
timeout and extend it while running, rather than holding a six-hour lease. A
cron job every minute returns expired leases to the queue, or marks them dead
after `max_attempts`.

`idempotency_key` is unique, so a retried request cannot start the same work
twice.

## Row Level Security

Two helper functions carry almost all of it:

```sql
private.can_read_screen(id)   -- member of the owning org, or the screen is public
private.can_write_screen(id)  -- member or above in the owning org
```

They are `security definer` in the `private` schema with `search_path = ''`,
which stops a recursive policy lookup and keeps them off the public API.

Policies wrap subqueries as `(select private.is_org_member(org_id))` so
Postgres evaluates them once per statement instead of once per row. Every
column a policy filters on is indexed; without that, a policy turns a lookup
into a sequential scan.

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
