-- ============================================================================
-- 0007 · Results: guide counts, QC, hits, flags, outcomes, reports
--
-- Guide-level counts are large (guides x samples). They are partitioned by
-- hash of screen_id so a single screen's rows stay together and an old screen
-- can be detached and dropped cheaply.
-- ============================================================================

-- --- guide counts (partitioned) ---------------------------------------------
create table public.guide_counts (
  screen_id  uuid not null,
  run_id     uuid not null,
  sample_id  uuid not null,
  guide_key  text not null,
  gene_symbol text,
  count      integer not null,
  lfc        real,
  primary key (screen_id, run_id, sample_id, guide_key)
) partition by hash (screen_id);

do $$
begin
  for i in 0..7 loop
    execute format(
      'create table public.guide_counts_p%s partition of public.guide_counts for values with (modulus 8, remainder %s)',
      i, i
    );
  end loop;
end;
$$;

create index guide_counts_run_ix on public.guide_counts (run_id, sample_id);
create index guide_counts_gene_ix on public.guide_counts (screen_id, gene_symbol);

-- --- per-sample QC ----------------------------------------------------------
create table public.sample_qc (
  run_id        uuid not null references public.runs (id) on delete cascade,
  sample_id     uuid not null references public.samples (id) on delete cascade,
  total_reads   bigint,
  mapped_reads  bigint,
  mapped_frac   real,
  zero_guides   integer,
  zero_frac     real,
  gini          real,                  -- MAGeCK definition, on log(count+1)
  skew_ratio    real,                  -- 90th / 10th percentile guide count
  mean_reads_per_guide real,
  verdict       public.qc_verdict not null default 'pending',
  notes         text,
  metrics       jsonb not null default '{}'::jsonb,
  primary key (run_id, sample_id)
);

-- --- per-run QC -------------------------------------------------------------
create table public.run_qc (
  run_id              uuid primary key references public.runs (id) on delete cascade,
  verdict             public.qc_verdict not null default 'pending',
  auroc               real,             -- essential vs nonessential separation
  auprc               real,
  nnmd                real,             -- (med(ess) - med(non)) / MAD(non); pass <= -1.25
  fpr_15th_pct        real,             -- nonessentials among the 15% most depleted
  min_replicate_r     real,
  median_replicate_r  real,
  library_match_rate  real,
  bottlenecked_samples int not null default 0,
  atlas_percentile    real,             -- where this run sits among Atlas runs on the same library
  metrics             jsonb not null default '{}'::jsonb,
  notes               text
);

-- --- hits: one row per gene per comparison ----------------------------------
create table public.hits (
  id            uuid primary key default private.uuid_v7(),
  run_id        uuid not null references public.runs (id) on delete cascade,
  screen_id     uuid not null references public.screens (id) on delete cascade,
  comparison_id uuid not null references public.comparisons (id) on delete cascade,
  gene_symbol   text not null,
  gene_id       bigint references atlas.genes (id) on delete set null,
  direction     public.hit_direction not null default 'depleted',

  -- statistics, one column family per method so nothing is silently overwritten
  n_guides       int,
  n_good_guides  int,                   -- MAGeCK goodsgrna
  lfc            real,
  rra_score      real,
  p_value        real,
  fdr            real,
  stat_rank      int,
  mle_beta       real,
  mle_fdr        real,
  bayes_factor   real,                  -- BAGEL2
  norm_z         real,                  -- DrugZ
  chronos_effect real,
  cn_corrected   boolean not null default false,
  guide_lfcs     real[],                -- per-guide, for the concordance view
  max_guide_share real,                 -- fraction of |signal| from the top guide

  -- SplicR score
  chance_real    real,
  chance_lower   real,
  chance_upper   real,
  novelty        real,
  verdict        public.hit_verdict,
  reason         text,
  reason_features jsonb not null default '{}'::jsonb,
  model_version  text,

  -- Atlas context
  atlas_hit_count   int,
  atlas_screen_count int,
  atlas_hit_rate    real,

  created_at     timestamptz not null default now(),
  unique (comparison_id, gene_symbol),
  constraint hits_chance_ck check (chance_real is null or chance_real between 0 and 1),
  constraint hits_novelty_ck check (novelty is null or novelty between 0 and 1)
);

create index hits_run_ix on public.hits (run_id);
create index hits_screen_ix on public.hits (screen_id);
create index hits_chance_ix on public.hits (comparison_id, chance_real desc nulls last);
create index hits_fdr_ix on public.hits (comparison_id, fdr asc nulls last);
create index hits_gene_ix on public.hits (gene_symbol);
create index hits_verdict_ix on public.hits (comparison_id, verdict);

-- --- artifact flags ---------------------------------------------------------
create table public.hit_flags (
  id         uuid primary key default private.uuid_v7(),
  hit_id     uuid not null references public.hits (id) on delete cascade,
  flag       public.artifact_flag not null,
  severity   public.flag_severity not null default 'warn',
  evidence   jsonb not null default '{}'::jsonb,   -- {neighbors:[], cn:2.9, guide:"...", ...}
  message    text not null,
  created_at timestamptz not null default now(),
  unique (hit_id, flag)
);

create index hit_flags_hit_ix on public.hit_flags (hit_id);
create index hit_flags_flag_ix on public.hit_flags (flag);

-- --- similar screens retrieved from the Atlas -------------------------------
create table public.run_neighbors (
  run_id           uuid not null references public.runs (id) on delete cascade,
  atlas_screen_id  uuid not null references atlas.screens (id) on delete cascade,
  similarity       real not null,
  shared_hits      int,
  rank             int not null,
  primary key (run_id, atlas_screen_id)
);

create index run_neighbors_rank_ix on public.run_neighbors (run_id, rank);

-- --- Truth Loop: validation plans and outcomes ------------------------------
create table public.validation_plans (
  id          uuid primary key default private.uuid_v7(),
  screen_id   uuid not null references public.screens (id) on delete cascade,
  org_id      uuid not null references public.organizations (id) on delete cascade,
  name        text not null,
  assay       text,
  status      public.plan_status not null default 'draft',
  created_by  uuid references auth.users (id) on delete set null,
  plate_map   jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index validation_plans_screen_ix on public.validation_plans (screen_id);

create trigger validation_plans_touch before update on public.validation_plans
  for each row execute function private.set_updated_at();

create table public.validation_outcomes (
  id           uuid primary key default private.uuid_v7(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  screen_id    uuid not null references public.screens (id) on delete cascade,
  plan_id      uuid references public.validation_plans (id) on delete set null,
  hit_id       uuid references public.hits (id) on delete set null,
  gene_symbol  text not null,
  predicted    real,                       -- chance_real at the time of prediction
  model_version text,
  result       public.outcome_result not null default 'pending',
  assay        text,
  n_guides     int,
  effect_size  real,
  notes        text,
  evidence_url text,
  shared_with_atlas boolean not null default false,
  logged_by    uuid references auth.users (id) on delete set null,
  logged_at    timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create index validation_outcomes_org_ix on public.validation_outcomes (org_id, logged_at desc);
create index validation_outcomes_screen_ix on public.validation_outcomes (screen_id);
create index validation_outcomes_gene_ix on public.validation_outcomes (gene_symbol);

-- Literature-extracted outcomes feeding the public answer key.
create table atlas.validation_records (
  id            uuid primary key default private.uuid_v7(),
  gene_symbol   text not null,
  gene_id       bigint references atlas.genes (id) on delete set null,
  screen_id     uuid references atlas.screens (id) on delete set null,
  result        public.outcome_result not null,
  assay         text,
  cell_line     text,
  phenotype     text,
  pmid          text,
  doi           text,
  quote         text,                      -- the sentence the claim came from
  method        public.extraction_method not null default 'llm',
  model         text,
  confidence    real,
  reviewed_by   uuid references auth.users (id) on delete set null,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  constraint validation_records_conf_ck check (confidence is null or confidence between 0 and 1)
);

create index atlas_validation_gene_ix on atlas.validation_records (gene_symbol);
create index atlas_validation_screen_ix on atlas.validation_records (screen_id);
create index atlas_validation_pmid_ix on atlas.validation_records (pmid);

-- --- model registry and calibration -----------------------------------------
create table public.score_models (
  id            uuid primary key default private.uuid_v7(),
  version       text not null unique,
  algorithm     text not null,
  trained_at    timestamptz not null default now(),
  n_train       int,
  n_calibration int,
  features      text[] not null default '{}',
  metrics       jsonb not null default '{}'::jsonb,   -- {andcg100, brier, ece, auroc}
  is_default    boolean not null default false,
  org_id        uuid references public.organizations (id) on delete cascade,  -- null = global
  notes         text
);

create unique index score_models_default_uq on public.score_models (coalesce(org_id::text, 'global'))
  where is_default;

-- org_id null means the global model. A primary key cannot hold an
-- expression, so uniqueness is enforced by two partial indexes instead.
create table public.calibration_bins (
  id            bigint generated always as identity primary key,
  model_version text not null,
  org_id        uuid references public.organizations (id) on delete cascade,
  bin_lower     real not null,
  bin_upper     real not null,
  predicted     real not null,
  observed      real not null,
  n             int not null
);

create unique index calibration_bins_org_uq
  on public.calibration_bins (model_version, org_id, bin_lower)
  where org_id is not null;

create unique index calibration_bins_global_uq
  on public.calibration_bins (model_version, bin_lower)
  where org_id is null;

-- --- reports ----------------------------------------------------------------
create table public.reports (
  id          uuid primary key default private.uuid_v7(),
  run_id      uuid not null references public.runs (id) on delete cascade,
  screen_id   uuid not null references public.screens (id) on delete cascade,
  org_id      uuid not null references public.organizations (id) on delete cascade,
  version     int not null default 1,
  format      public.report_format not null default 'html',
  storage_key text,
  summary     jsonb not null default '{}'::jsonb,
  share_token text unique,
  share_expires_at timestamptz,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (run_id, version, format)
);

create index reports_screen_ix on public.reports (screen_id);
create index reports_share_ix on public.reports (share_token) where share_token is not null;
