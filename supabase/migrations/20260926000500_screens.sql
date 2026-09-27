-- ============================================================================
-- 0005 · User screens: the unit of work
-- screens · samples · screen_files · comparisons
-- ============================================================================

create table public.screens (
  id           uuid primary key default private.uuid_v7(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  created_by   uuid references auth.users (id) on delete set null,
  name         text not null,
  description  text,
  source       public.screen_source not null default 'upload',
  source_ref   text,
  taxid        int not null default 9606,
  cell_line    text,
  cell_model_id uuid references atlas.cell_models (id) on delete set null,
  modality     public.modality not null default 'knockout',
  phenotype    text,
  library_id   uuid references atlas.libraries (id) on delete set null,
  library_call jsonb not null default '{}'::jsonb,   -- {slug, match_rate, offset, strand, alternatives[]}
  status       public.screen_status not null default 'draft',
  qc           public.qc_verdict not null default 'pending',
  visibility   public.visibility not null default 'private',
  current_run_id uuid,
  n_hits       int not null default 0,
  n_real_hits  int not null default 0,
  tags         text[] not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  archived_at  timestamptz,
  constraint screens_name_ck check (char_length(name) between 1 and 200)
);

create index screens_org_ix on public.screens (org_id, created_at desc);
create index screens_status_ix on public.screens (status) where status in ('queued', 'running');
create index screens_library_ix on public.screens (library_id);
create index screens_name_trgm_ix on public.screens using gin (name extensions.gin_trgm_ops);

create trigger screens_touch before update on public.screens
  for each row execute function private.set_updated_at();

-- --- samples ---------------------------------------------------------------
create table public.samples (
  id          uuid primary key default private.uuid_v7(),
  screen_id   uuid not null references public.screens (id) on delete cascade,
  label       text not null,
  condition   text not null,
  replicate   int not null default 1,
  timepoint   text,
  role        public.sample_role not null default 'treatment',
  position    int not null default 0,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  unique (screen_id, label)
);

create index samples_screen_ix on public.samples (screen_id);

-- --- files -----------------------------------------------------------------
create table public.screen_files (
  id            uuid primary key default private.uuid_v7(),
  screen_id     uuid not null references public.screens (id) on delete cascade,
  sample_id     uuid references public.samples (id) on delete set null,
  kind          public.file_kind not null,
  storage_key   text not null,                 -- bucket-relative path or s3:// uri
  original_name text not null,
  byte_size     bigint,
  checksum_md5  text,
  read_pair     int,                           -- 1 or 2 for paired-end
  status        public.upload_status not null default 'pending',
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  constraint screen_files_pair_ck check (read_pair is null or read_pair in (1, 2))
);

create index screen_files_screen_ix on public.screen_files (screen_id);
create index screen_files_sample_ix on public.screen_files (sample_id);

-- --- comparisons: what gets tested against what -----------------------------
create table public.comparisons (
  id             uuid primary key default private.uuid_v7(),
  screen_id      uuid not null references public.screens (id) on delete cascade,
  name           text not null,
  kind           public.comparison_kind not null default 'treatment_vs_control',
  treatment_ids  uuid[] not null,
  control_ids    uuid[] not null,
  paired         boolean not null default false,
  is_primary     boolean not null default false,
  settings       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  unique (screen_id, name),
  constraint comparisons_arms_ck check (
    array_length(treatment_ids, 1) >= 1 and array_length(control_ids, 1) >= 1
  )
);

create index comparisons_screen_ix on public.comparisons (screen_id);
create unique index comparisons_primary_uq on public.comparisons (screen_id) where is_primary;
