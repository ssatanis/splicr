-- ============================================================================
-- 0009 · Storage buckets, views and read APIs
-- ============================================================================

-- --- buckets ----------------------------------------------------------------
-- uploads: raw FASTQ and count tables (private, resumable/TUS or S3 protocol)
-- artifacts: pipeline outputs, Parquet, plots (private)
-- reports: rendered PDFs (private, served through signed URLs)
-- public-assets: library files and Atlas exports (public)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('uploads',       'uploads',       false, 536870912000, null),   -- 500 GB
  ('artifacts',     'artifacts',     false, 5368709120,   null),   -- 5 GB
  ('reports',       'reports',       false, 1073741824,   null),   -- 1 GB
  ('public-assets', 'public-assets', true,  1073741824,   null)
on conflict (id) do nothing;

-- Objects are namespaced by organization id: <org_id>/<screen_id>/<file>
-- plpgsql, not sql: a bad prefix must not raise, and only plpgsql can catch.
create or replace function private.storage_org_id(object_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return nullif(split_part(object_name, '/', 1), '')::uuid;
exception when others then
  return null;
end;
$$;

create policy "members read their org objects"
  on storage.objects for select to authenticated
  using (
    bucket_id in ('uploads', 'artifacts', 'reports')
    and (select private.is_org_member(private.storage_org_id(name)))
  );

create policy "members upload to their org prefix"
  on storage.objects for insert to authenticated
  with check (
    bucket_id in ('uploads', 'artifacts', 'reports')
    and (select private.has_org_role(private.storage_org_id(name), 'member'))
  );

create policy "members replace their org objects"
  on storage.objects for update to authenticated
  using (
    bucket_id in ('uploads', 'artifacts', 'reports')
    and (select private.has_org_role(private.storage_org_id(name), 'member'))
  );

create policy "admins delete their org objects"
  on storage.objects for delete to authenticated
  using (
    bucket_id in ('uploads', 'artifacts', 'reports')
    and (select private.has_org_role(private.storage_org_id(name), 'admin'))
  );

create policy "public assets are readable"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'public-assets');

-- ============================================================================
-- Views. security_invoker so the caller's RLS applies.
-- ============================================================================

-- Screens with their latest run and headline counts.
create view public.screen_overview
with (security_invoker = true) as
select
  s.id,
  s.org_id,
  s.name,
  s.cell_line,
  s.modality,
  s.phenotype,
  s.status,
  s.qc,
  s.visibility,
  s.created_at,
  l.name as library_name,
  r.id   as run_id,
  r.status as run_status,
  r.finished_at,
  q.nnmd,
  q.auroc,
  (select count(*) from public.hits h where h.run_id = r.id) as n_hits,
  (select count(*) from public.hits h where h.run_id = r.id and h.chance_real >= 0.6) as n_likely_real,
  (select count(*) from public.hits h where h.run_id = r.id and h.verdict = 'real_new') as n_real_new,
  (select count(*) from public.hits h where h.run_id = r.id and h.verdict = 'artifact') as n_artifacts
from public.screens s
left join atlas.libraries l on l.id = s.library_id
left join public.runs r on r.id = s.current_run_id
left join public.run_qc q on q.run_id = r.id;

-- Hits joined to their flags, ready for the Hit Report table.
create view public.hit_report
with (security_invoker = true) as
select
  h.*,
  coalesce(
    (select array_agg(f.flag order by f.severity desc) from public.hit_flags f where f.hit_id = h.id),
    '{}'::public.artifact_flag[]
  ) as flags,
  coalesce(
    (select jsonb_agg(jsonb_build_object('flag', f.flag, 'severity', f.severity, 'message', f.message, 'evidence', f.evidence))
     from public.hit_flags f where f.hit_id = h.id),
    '[]'::jsonb
  ) as flag_detail,
  g.hit_rate as atlas_gene_hit_rate,
  g.is_common_essential,
  g.is_frequent_hitter
from public.hits h
left join atlas.gene_stats g on g.gene_symbol = h.gene_symbol;

-- Organization-level calibration: predicted vs observed on logged outcomes.
create view public.org_calibration
with (security_invoker = true) as
select
  o.org_id,
  width_bucket(o.predicted, 0, 1, 10) as bucket,
  round(avg(o.predicted)::numeric, 4) as predicted,
  round((count(*) filter (where o.result = 'validated')::numeric
         / nullif(count(*) filter (where o.result in ('validated', 'failed')), 0)), 4) as observed,
  count(*) filter (where o.result in ('validated', 'failed')) as n
from public.validation_outcomes o
where o.predicted is not null
group by o.org_id, width_bucket(o.predicted, 0, 1, 10);

grant select on public.screen_overview, public.hit_report, public.org_calibration to anon, authenticated;

-- ============================================================================
-- Read APIs used by the app and by SplicR Connect
-- ============================================================================

-- A gene's history across the Atlas.
create or replace function public.gene_history(p_symbol text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'symbol', p_symbol,
    'n_screens', coalesce(gs.n_screens, 0),
    'n_hits', coalesce(gs.n_hits, 0),
    'hit_rate', coalesce(gs.hit_rate, 0),
    'is_common_essential', coalesce(gs.is_common_essential, false),
    'is_frequent_hitter', coalesce(gs.is_frequent_hitter, false),
    'n_validated', coalesce(gs.n_validated, 0),
    'n_failed', coalesce(gs.n_failed, 0),
    'contexts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'screen_id', s.source_id, 'source', s.source, 'cell_line', s.cell_line,
        'phenotype', s.phenotype, 'year', s.year, 'lfc', sh.lfc))
      from atlas.screen_hits sh
      join atlas.screens s on s.id = sh.screen_id
      where sh.gene_symbol = p_symbol and sh.is_hit
      limit 50
    ), '[]'::jsonb)
  )
  from atlas.gene_stats gs
  where gs.gene_symbol = p_symbol
  union all
  select jsonb_build_object('symbol', p_symbol, 'n_screens', 0, 'n_hits', 0, 'hit_rate', 0, 'contexts', '[]'::jsonb)
  where not exists (select 1 from atlas.gene_stats where gene_symbol = p_symbol)
  limit 1;
$$;

grant execute on function public.gene_history(text) to anon, authenticated;

-- Nearest public screens to a free-text description, by embedding.
create or replace function public.similar_screens(
  p_embedding extensions.vector(768),
  p_limit int default 10
)
returns table (
  screen_id uuid,
  source public.atlas_source,
  source_id text,
  title text,
  cell_line text,
  library_name text,
  phenotype text,
  year int,
  similarity real
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.source, s.source_id, s.title, s.cell_line, s.library_name, s.phenotype, s.year,
         (1 - (s.embedding operator(extensions.<=>) p_embedding))::real as similarity
  from atlas.screens s
  where s.embedding is not null
  order by s.embedding operator(extensions.<=>) p_embedding
  limit least(coalesce(p_limit, 10), 100);
$$;

grant execute on function public.similar_screens(extensions.vector, int) to anon, authenticated;

-- Fingerprint an uploaded guide-sequence set against known libraries.
-- Ranked by overlap as a fraction of the candidate library, so composite
-- libraries such as MinLibCas9 do not outrank their parents.
create or replace function public.detect_library(p_sequences text[], p_limit int default 5)
returns table (
  library_id uuid,
  slug text,
  name text,
  n_guides int,
  n_matched bigint,
  match_rate real,
  coverage real
)
language sql
stable
security definer
set search_path = ''
as $$
  with probe as (select distinct unnest(p_sequences) as seq),
  probe_n as (select count(*)::numeric as n from probe)
  select
    l.id, l.slug, l.name, l.n_guides,
    count(distinct g.sequence) as n_matched,
    (count(distinct g.sequence)::numeric / nullif((select n from probe_n), 0))::real as match_rate,
    (count(distinct g.sequence)::numeric / nullif(l.n_guides, 0))::real as coverage
  from atlas.libraries l
  join atlas.guides g on g.library_id = l.id and not g.is_control
  join probe p on p.seq = g.sequence
  where l.org_id is null or private.is_org_member(l.org_id)
  group by l.id, l.slug, l.name, l.n_guides
  order by coverage desc, match_rate desc
  limit least(coalesce(p_limit, 5), 20);
$$;

grant execute on function public.detect_library(text[], int) to authenticated;

-- ============================================================================
-- Scheduled maintenance
-- ============================================================================
select cron.schedule(
  'splicr-reap-leases',
  '* * * * *',
  $$select private.reap_expired_leases()$$
);

select cron.schedule(
  'splicr-refresh-gene-stats',
  '17 3 * * *',
  $$
  insert into atlas.gene_stats (gene_symbol, n_screens, n_hits, hit_rate, updated_at)
  select sh.gene_symbol,
         count(*)::int,
         count(*) filter (where sh.is_hit)::int,
         (count(*) filter (where sh.is_hit))::real / nullif(count(*), 0),
         now()
  from atlas.screen_hits sh
  group by sh.gene_symbol
  on conflict (gene_symbol) do update
    set n_screens = excluded.n_screens,
        n_hits = excluded.n_hits,
        hit_rate = excluded.hit_rate,
        is_frequent_hitter = excluded.hit_rate > 0.25,
        updated_at = now()
  $$
);
