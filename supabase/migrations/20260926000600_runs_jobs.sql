-- ============================================================================
-- 0006 · Pipeline execution: runs, stages, jobs, events
-- A run is one pass of the nine-stage pipeline over one screen.
-- Jobs are leased by external workers (Modal) through pgmq.
-- ============================================================================

create table public.runs (
  id             uuid primary key default private.uuid_v7(),
  screen_id      uuid not null references public.screens (id) on delete cascade,
  org_id         uuid not null references public.organizations (id) on delete cascade,
  triggered_by   uuid references auth.users (id) on delete set null,
  status         public.run_status not null default 'queued',
  settings       jsonb not null default '{}'::jsonb,   -- normalization, callers, cn correction...
  engine_version text,
  image_digest   text,                                  -- container digest, for reproducibility
  error          text,
  started_at     timestamptz,
  finished_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index runs_screen_ix on public.runs (screen_id, created_at desc);
create index runs_org_ix on public.runs (org_id, created_at desc);
create index runs_active_ix on public.runs (status) where status in ('queued', 'running');

create trigger runs_touch before update on public.runs
  for each row execute function private.set_updated_at();

alter table public.screens
  add constraint screens_current_run_fk
  foreign key (current_run_id) references public.runs (id) on delete set null;

-- --- stages ----------------------------------------------------------------
create table public.run_stages (
  id           uuid primary key default private.uuid_v7(),
  run_id       uuid not null references public.runs (id) on delete cascade,
  stage        public.pipeline_stage not null,
  status       public.stage_status not null default 'queued',
  position     int not null,
  detail       text,
  tool         text,
  metrics      jsonb not null default '{}'::jsonb,
  started_at   timestamptz,
  finished_at  timestamptz,
  duration_sec numeric(10,2),
  unique (run_id, stage)
);

create index run_stages_run_ix on public.run_stages (run_id, position);

-- --- artifacts produced by stages ------------------------------------------
create table public.run_artifacts (
  id          uuid primary key default private.uuid_v7(),
  run_id      uuid not null references public.runs (id) on delete cascade,
  stage       public.pipeline_stage not null,
  name        text not null,
  storage_key text not null,
  content_type text,
  byte_size   bigint,
  checksum_md5 text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  unique (run_id, name)
);

create index run_artifacts_run_ix on public.run_artifacts (run_id);

-- --- jobs: the durable work queue ------------------------------------------
create table public.jobs (
  id              uuid primary key default private.uuid_v7(),
  run_id          uuid references public.runs (id) on delete cascade,
  org_id          uuid references public.organizations (id) on delete cascade,
  kind            text not null,                      -- stage name or maintenance task
  payload         jsonb not null default '{}'::jsonb,
  status          public.job_status not null default 'queued',
  priority        int not null default 100,
  idempotency_key text unique,
  attempts        int not null default 0,
  max_attempts    int not null default 3,
  lease_owner     text,
  lease_expires_at timestamptz,
  queue_msg_id    bigint,
  progress        numeric(5,4) not null default 0,
  error           text,
  scheduled_at    timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint jobs_progress_ck check (progress between 0 and 1)
);

create index jobs_run_ix on public.jobs (run_id);
create index jobs_ready_ix on public.jobs (status, priority, scheduled_at) where status = 'queued';
create index jobs_lease_ix on public.jobs (lease_expires_at) where status in ('leased', 'running');

create trigger jobs_touch before update on public.jobs
  for each row execute function private.set_updated_at();

-- --- events: append-only audit and progress feed ----------------------------
create table public.run_events (
  id         bigint generated always as identity primary key,
  run_id     uuid not null references public.runs (id) on delete cascade,
  stage      public.pipeline_stage,
  level      text not null default 'info',
  message    text not null,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint run_events_level_ck check (level in ('debug', 'info', 'warn', 'error'))
);

create index run_events_run_ix on public.run_events (run_id, id desc);

-- ---------------------------------------------------------------------------
-- Queue plumbing. The engine enqueues a pgmq message per job and leases it
-- with a short visibility timeout, extending it from its heartbeat.
-- ---------------------------------------------------------------------------
select pgmq.create('splicr_jobs');

create or replace function private.enqueue_job(p_job_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg_id bigint;
begin
  select pgmq.send('splicr_jobs', jsonb_build_object('job_id', p_job_id)) into v_msg_id;
  update public.jobs set queue_msg_id = v_msg_id where id = p_job_id;
  return v_msg_id;
end;
$$;

-- Enqueue automatically when a job row is created in the queued state.
create or replace function private.on_job_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'queued' then
    perform private.enqueue_job(new.id);
  end if;
  return new;
end;
$$;

create trigger jobs_enqueue after insert on public.jobs
  for each row execute function private.on_job_insert();

-- Requeue jobs whose lease expired (called by pg_cron every minute).
create or replace function private.reap_expired_leases()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  with expired as (
    update public.jobs
       set status = case when attempts >= max_attempts then 'dead' else 'queued' end,
           lease_owner = null,
           lease_expires_at = null,
           error = coalesce(error, 'lease expired')
     where status in ('leased', 'running')
       and lease_expires_at < now()
    returning id, status
  )
  select count(*) into v_count from expired;
  return v_count;
end;
$$;
