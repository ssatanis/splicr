-- ============================================================================
-- 0021 · Autonomous ingest: state for discovering, planning, fetching and
--        reanalyzing deposited CRISPR screens (engine/splicr/ingest), and the
--        database half of entity harmonization.
--
-- State lives in its own schema, `ingest`, which PostgREST does not expose.
-- The engine writes it with the database owner's credentials (Modal secret).
-- Signed-out readers see progress through the security_invoker views at the
-- bottom; everything in them is public repository metadata.
--
-- HARMONIZATION IS ENFORCED HERE, NOT ONLY IN PYTHON. A reanalyzed screen
-- (atlas.screens.source in geo_rerun / sra_rerun) cannot be inserted without a
-- Cellosaurus RRID, or an explicit recorded reason there is none (primary
-- cells, organoids); its gene rows cannot be inserted without an Ensembl gene
-- id; a compound, when present, must be a ChEMBL id. The Python gate
-- (harmonize.enforce) quarantines unmappable rows before they get here; these
-- triggers make sure no other code path can skip it.
-- ============================================================================

create schema if not exists ingest;
revoke all on schema ingest from public;
grant usage on schema ingest to anon, authenticated, service_role;
comment on schema ingest is
  'Autonomous GEO/SRA/ENA screen ingest state. Not exposed by PostgREST; read via public.ingest_* views.';

create table if not exists ingest.studies (
  accession       text primary key
                  check (accession ~ '^(GSE[0-9]+|PRJ[EDN][A-Z][0-9]+|[SED]RP[0-9]+)$'),
  source          text not null check (source in ('geo', 'sra', 'ena')),
  title           text not null,
  summary         text,
  organism        text,
  taxid           int,
  xrefs           jsonb not null default '{}'::jsonb,
  pubmed_ids      text[] not null default '{}',
  first_public    date,
  last_updated    date,
  n_runs          int,
  score           real not null check (score between 0 and 1),
  verdict         text not null check (verdict in ('screen', 'maybe', 'not_screen')),
  reasons         text[] not null default '{}',
  status          text not null default 'discovered' check (status in
                    ('discovered', 'rejected', 'planned', 'needs_review', 'fetching',
                     'analyzing', 'published', 'failed')),
  plan            jsonb,
  plan_confidence real check (plan_confidence is null or plan_confidence between 0 and 1),
  issues          text[] not null default '{}',
  attempts        int not null default 0,
  error_stage     text,
  error           text,
  lease_owner     text,
  lease_expires   timestamptz,
  atlas_screen_id uuid references atlas.screens (id) on delete set null,
  discovered_at   timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists ingest_studies_status_ix on ingest.studies (status, updated_at);
create index if not exists ingest_studies_verdict_ix on ingest.studies (verdict, score desc);
create index if not exists ingest_studies_atlas_ix on ingest.studies (atlas_screen_id);

create table if not exists ingest.runs (
  run            text primary key check (run ~ '^[SED]RR[0-9]+$'),
  accession      text not null references ingest.studies (accession) on delete cascade,
  label          text,
  role           text check (role is null or role in ('plasmid', 'reference', 'control', 'treatment', 'exclude')),
  read_count     bigint,
  fastq          jsonb not null default '[]'::jsonb,   -- [{url, bytes, md5, verified}]
  fastqc         jsonb,                                -- FastqcReport per file
  mapped_reads   bigint,
  mapping_rate   real,
  status         text not null default 'pending' check (status in
                   ('pending', 'downloaded', 'qc_done', 'counted', 'failed', 'skipped')),
  error          text,
  updated_at     timestamptz not null default now()
);
create index if not exists ingest_runs_accession_ix on ingest.runs (accession);

create table if not exists ingest.events (
  id         bigint generated always as identity primary key,
  accession  text references ingest.studies (accession) on delete cascade,
  stage      text not null,
  status     text not null check (status in ('started', 'ok', 'warn', 'failed', 'skipped')),
  message    text not null,
  detail     jsonb not null default '{}'::jsonb,
  at         timestamptz not null default now()
);
create index if not exists ingest_events_accession_ix on ingest.events (accession, at desc);

create table if not exists ingest.watermarks (
  source        text primary key check (source in ('geo', 'sra', 'ena')),
  last_checked  timestamptz,
  last_seen     date,
  cursor        jsonb not null default '{}'::jsonb
);

create or replace function ingest.touch() returns trigger language plpgsql
set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists studies_touch on ingest.studies;
create trigger studies_touch before update on ingest.studies for each row execute function ingest.touch();
drop trigger if exists runs_touch on ingest.runs;
create trigger runs_touch before update on ingest.runs for each row execute function ingest.touch();

-- Claim the next study at a stage, with a lease so two workers never take the
-- same one and a crashed worker's study comes back after the lease expires.
create or replace function ingest.claim(p_status text, p_owner text, p_lease interval default '2 hours')
returns setof ingest.studies
language sql
volatile
set search_path = ''
as $$
  update ingest.studies s
     set lease_owner = p_owner, lease_expires = now() + p_lease, attempts = s.attempts + 1
   where s.accession = (
     select accession from ingest.studies
      where status = p_status and (lease_expires is null or lease_expires < now()) and attempts < 5
      order by score desc, discovered_at
      for update skip locked
      limit 1)
  returning s.*;
$$;
revoke all on function ingest.claim(text, text, interval) from public, anon, authenticated;

-- --- entity harmonization, enforced ---------------------------------------------
alter table atlas.screens add column if not exists cell_line_rrid text;
alter table atlas.screens add column if not exists compound_chembl text;
alter table atlas.screens add column if not exists ingest_accession text;
alter table atlas.screen_hits add column if not exists ensembl_gene_id text;
alter table atlas.gene_dependency add column if not exists ensembl_gene_id text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'screens_rrid_format') then
    alter table atlas.screens add constraint screens_rrid_format
      check (cell_line_rrid is null or cell_line_rrid ~ '^CVCL_[A-Z0-9]{4}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'screens_chembl_format') then
    alter table atlas.screens add constraint screens_chembl_format
      check (compound_chembl is null or compound_chembl ~ '^CHEMBL[0-9]+$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'screen_hits_ensembl_format') then
    alter table atlas.screen_hits add constraint screen_hits_ensembl_format
      check (ensembl_gene_id is null or ensembl_gene_id ~ '^ENS(MUS)?G[0-9]{11}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'gene_dependency_ensembl_format') then
    alter table atlas.gene_dependency add constraint gene_dependency_ensembl_format
      check (ensembl_gene_id is null or ensembl_gene_id ~ '^ENSG[0-9]{11}$');
  end if;
end;
$$;

create index if not exists atlas_screen_hits_ensembl_ix on atlas.screen_hits (ensembl_gene_id) where is_hit;
create index if not exists atlas_screens_ingest_ix on atlas.screens (ingest_accession);
create index if not exists gene_dependency_ensembl_ix on atlas.gene_dependency (ensembl_gene_id);

create or replace function atlas.require_harmonized_screen() returns trigger language plpgsql
set search_path = '' as $$
begin
  if new.source in ('geo_rerun', 'sra_rerun') then
    if new.cell_line_rrid is null and coalesce(new.metadata ->> 'cell_line_unmappable', '') = '' then
      raise exception 'reanalyzed screen % has no Cellosaurus RRID and no recorded reason (metadata.cell_line_unmappable)',
        new.source_id using errcode = '23514';
    end if;
    if new.ingest_accession is null then
      raise exception 'reanalyzed screen % has no ingest_accession', new.source_id using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists screens_require_harmonized on atlas.screens;
create trigger screens_require_harmonized before insert or update on atlas.screens
  for each row execute function atlas.require_harmonized_screen();

create or replace function atlas.require_harmonized_hit() returns trigger language plpgsql
set search_path = '' as $$
begin
  if new.ensembl_gene_id is null and exists (
       select 1 from atlas.screens s where s.id = new.screen_id and s.source in ('geo_rerun', 'sra_rerun')) then
    raise exception 'gene % in reanalyzed screen % has no Ensembl id; quarantine it before insert',
      new.gene_symbol, new.screen_id using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists screen_hits_require_harmonized on atlas.screen_hits;
create trigger screen_hits_require_harmonized before insert or update on atlas.screen_hits
  for each row execute function atlas.require_harmonized_hit();

-- --- read access -------------------------------------------------------------------
alter table ingest.studies    enable row level security;
alter table ingest.runs       enable row level security;
alter table ingest.events     enable row level security;
alter table ingest.watermarks enable row level security;

drop policy if exists "ingest studies are public" on ingest.studies;
create policy "ingest studies are public" on ingest.studies for select to anon, authenticated using (true);
drop policy if exists "ingest runs are public" on ingest.runs;
create policy "ingest runs are public" on ingest.runs for select to anon, authenticated using (true);
drop policy if exists "ingest events are public" on ingest.events;
create policy "ingest events are public" on ingest.events for select to anon, authenticated using (true);
drop policy if exists "ingest watermarks are public" on ingest.watermarks;
create policy "ingest watermarks are public" on ingest.watermarks for select to anon, authenticated using (true);

grant select on ingest.studies, ingest.runs, ingest.events, ingest.watermarks to anon, authenticated;

create or replace view public.ingest_studies
with (security_invoker = true) as
select accession, source, title, organism, taxid, pubmed_ids, first_public, n_runs, score, verdict,
       reasons, status, plan_confidence, issues, error_stage, error, atlas_screen_id,
       discovered_at, updated_at
from ingest.studies;

create or replace view public.ingest_runs
with (security_invoker = true) as
select run, accession, label, role, read_count, fastqc, mapped_reads, mapping_rate, status, error, updated_at
from ingest.runs;

create or replace view public.ingest_events
with (security_invoker = true) as
select id, accession, stage, status, message, detail, at from ingest.events;

create or replace view public.ingest_summary
with (security_invoker = true) as
select status, verdict, count(*) as n, max(updated_at) as last_change
from ingest.studies group by status, verdict;

grant select on public.ingest_studies, public.ingest_runs, public.ingest_events, public.ingest_summary
  to anon, authenticated;

notify pgrst, 'reload schema';
