-- ============================================================================
-- 0002 · Schemas, enum types and private helper functions
--
--   public   app tables exposed through the Data API (RLS on everything)
--   atlas    reference data: libraries, guides, genes, public screens, hits
--   private  helper functions and internals, never exposed through the API
-- ============================================================================

create schema if not exists private;
create schema if not exists atlas;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to postgres, service_role;

-- ---------------------------------------------------------------------------
-- Enum types (public schema so the generated TypeScript types pick them up)
-- ---------------------------------------------------------------------------
create type public.org_kind as enum ('personal', 'academic', 'core', 'biotech', 'pharma', 'ai_company');
create type public.org_role as enum ('owner', 'admin', 'member', 'viewer');
create type public.plan_tier as enum ('free', 'lab', 'core', 'biotech', 'pharma');

create type public.modality as enum ('knockout', 'crispri', 'crispra', 'base_edit', 'prime', 'knockout_cas12a');
create type public.screen_status as enum ('draft', 'queued', 'running', 'complete', 'failed', 'archived');
create type public.qc_verdict as enum ('pending', 'pass', 'warn', 'fail');
create type public.visibility as enum ('private', 'org', 'public');
create type public.screen_source as enum ('upload', 'sra', 'atlas');
create type public.sample_role as enum ('plasmid', 'reference', 'control', 'treatment');
create type public.file_kind as enum ('fastq', 'counts', 'library', 'design', 'mageck_output', 'other');
create type public.upload_status as enum ('pending', 'uploading', 'complete', 'failed');

create type public.run_status as enum ('queued', 'running', 'complete', 'failed', 'canceled');
create type public.pipeline_stage as enum ('ingest', 'detect', 'count', 'qc', 'hits', 'artifacts', 'atlas', 'score', 'report');
create type public.stage_status as enum ('queued', 'running', 'done', 'failed', 'skipped');
create type public.job_status as enum ('queued', 'leased', 'running', 'succeeded', 'failed', 'canceled', 'dead');
create type public.comparison_kind as enum ('dropout', 'enrichment', 'treatment_vs_control', 'timepoint', 'sorted');
create type public.hit_direction as enum ('depleted', 'enriched');
create type public.hit_verdict as enum ('real_new', 'real_known', 'real_generic', 'artifact', 'uncertain');
create type public.artifact_flag as enum (
  'copy_number_cluster', 'single_guide', 'promiscuous_guide', 'multi_gene_guide',
  'frequent_hitter', 'low_coverage', 'bottleneck', 'low_plasmid_representation', 'paralog_buffering'
);
create type public.flag_severity as enum ('info', 'warn', 'critical');
create type public.outcome_result as enum ('validated', 'failed', 'inconclusive', 'pending');
create type public.report_format as enum ('html', 'pdf', 'json', 'csv');
create type public.plan_status as enum ('draft', 'ordered', 'in_progress', 'complete');
create type public.atlas_source as enum ('orcs', 'depmap', 'project_score', 'geo_rerun', 'sra_rerun', 'user_public');
create type public.extraction_method as enum ('manual', 'llm', 'user', 'imported');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Time-ordered UUIDs (v7). Postgres 17 has no built-in; PG18 will.
create or replace function private.uuid_v7()
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  unix_ts_ms bytea;
  uuid_bytes bytea;
begin
  unix_ts_ms := substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3);
  uuid_bytes := unix_ts_ms || extensions.gen_random_bytes(10);
  uuid_bytes := set_byte(uuid_bytes, 6, (b'0111' || get_byte(uuid_bytes, 6)::bit(4))::bit(8)::int);
  uuid_bytes := set_byte(uuid_bytes, 8, (b'10' || get_byte(uuid_bytes, 8)::bit(6))::bit(8)::int);
  return encode(uuid_bytes, 'hex')::uuid;
end;
$$;

grant execute on function private.uuid_v7() to authenticated, service_role;

-- updated_at maintenance
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Slug from free text
create or replace function private.slugify(input text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(both '-' from regexp_replace(lower(coalesce(input, '')), '[^a-z0-9]+', '-', 'g'));
$$;

-- Role ordering used by has_org_role
create or replace function private.role_rank(r public.org_role)
returns int
language sql
immutable
set search_path = ''
as $$
  select case r
    when 'owner' then 4
    when 'admin' then 3
    when 'member' then 2
    when 'viewer' then 1
  end;
$$;
