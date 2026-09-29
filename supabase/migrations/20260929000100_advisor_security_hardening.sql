-- ============================================================================
-- 0017 · Security advisor hardening
--
-- Clears every finding the Supabase security advisor raised on 2026-09-29, and
-- each change below says which finding it closes and whether the exposure was
-- real or intended.
--
-- 1. rls_disabled_in_public (ERROR x8): guide_counts_p0..p7          REAL LEAK
--    RLS on a partitioned parent does not carry to its partitions, and
--    PostgREST exposes each partition as its own table. Verified before this
--    migration: as `anon`, public.guide_counts_p6 returned 775,056 rows while
--    public.guide_counts (the parent, under RLS) returned 0. Every guide count
--    of every private screen was readable with the publishable key.
--    Fix: enable RLS on each partition with no policies, and revoke direct
--    privileges. Reads through the parent keep using the parent's policy.
--
-- 2. public_bucket_allows_listing (WARN): public-assets
--    A public bucket serves objects by URL without any storage.objects policy.
--    The broad SELECT policy only added the ability to LIST the bucket, which
--    nothing in the app uses. Dropped.
--
-- 3. *_security_definer_function_executable (WARN x18)
--    a. Postgres grants EXECUTE on new functions to PUBLIC. Every earlier
--       `grant ... to authenticated` therefore also left `anon` able to call
--       accept_org_invite and detect_library. Revoked from PUBLIC and anon.
--    b. gene_history, similar_screens, atlas_corpus_state and detect_library
--       read only atlas tables whose select policies already decide what the
--       caller may see. They never needed to bypass RLS: now SECURITY INVOKER.
--    c. accept_org_invite (signed-in users) and the four api_key_* functions
--       (bearer-key Connect API, called on `anon`) must bypass RLS by design;
--       see 20260926000300 and 20260927000500. Their SECURITY DEFINER bodies
--       move to `rpc_internal`, a schema PostgREST does not expose, and the
--       public names become thin SECURITY INVOKER wrappers with the same
--       signatures, so /rest/v1/rpc/<name> and the app's calls are unchanged.
--       This is Supabase's documented remediation. It does NOT narrow who can
--       call them: that exposure is intended, and is limited by the functions
--       themselves (an invite token bound to the caller's email; a sha-256 key
--       digest that resolves exactly one organization).
-- ============================================================================

-- --- 1 · guide_counts partitions -------------------------------------------
do $$
declare
  part regclass;
begin
  for part in
    select inhrelid::regclass from pg_catalog.pg_inherits
     where inhparent = 'public.guide_counts'::regclass
  loop
    execute format('alter table %s enable row level security', part);
    execute format('revoke all on table %s from anon, authenticated', part);
  end loop;
end;
$$;

comment on table public.guide_counts is
  'Guide-level counts, hash-partitioned by screen_id. Query the parent: its RLS '
  'policy applies. Partitions have RLS enabled with no policies and no API grants.';

-- --- 2 · public-assets listing -----------------------------------------------
drop policy if exists "public assets are readable" on storage.objects;

-- --- 3b · functions that never needed to bypass RLS --------------------------
alter function public.gene_history(text) security invoker;
alter function public.similar_screens(extensions.vector, int) security invoker;
alter function public.atlas_corpus_state() security invoker;

-- detect_library filtered on private.is_org_member(), which an invoker cannot
-- name (no USAGE on `private`). The atlas.libraries and atlas.guides select
-- policies already apply exactly that filter, so the clause is dropped rather
-- than widened.
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
security invoker
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
  group by l.id, l.slug, l.name, l.n_guides
  order by coverage desc, match_rate desc
  limit least(coalesce(p_limit, 5), 20);
$$;

revoke all on function public.detect_library(text[], int) from public, anon;
grant execute on function public.detect_library(text[], int) to authenticated;

-- gene_history, similar_screens and atlas_corpus_state serve public Atlas data
-- to signed-out visitors on purpose; keep anon, but grant explicitly.
revoke all on function public.gene_history(text) from public;
revoke all on function public.similar_screens(extensions.vector, int) from public;
revoke all on function public.atlas_corpus_state() from public;
grant execute on function public.gene_history(text) to anon, authenticated;
grant execute on function public.similar_screens(extensions.vector, int) to anon, authenticated;
grant execute on function public.atlas_corpus_state() to anon, authenticated;

-- --- 3c · definer bodies behind invoker wrappers -----------------------------
create schema if not exists rpc_internal;
comment on schema rpc_internal is
  'SECURITY DEFINER bodies of public RPCs. Not exposed by PostgREST; reached only '
  'through the SECURITY INVOKER wrappers of the same name in public.';
revoke all on schema rpc_internal from public;
grant usage on schema rpc_internal to anon, authenticated, service_role;
alter default privileges in schema rpc_internal revoke execute on functions from public;

alter function public.accept_org_invite(text) set schema rpc_internal;
alter function public.api_key_resolve(text) set schema rpc_internal;
alter function public.api_key_touch(text) set schema rpc_internal;
alter function public.api_key_screen(text, uuid) set schema rpc_internal;
alter function public.api_key_hits(text, uuid, real, real, text, text, int, int) set schema rpc_internal;

revoke all on function rpc_internal.accept_org_invite(text) from public, anon;
grant execute on function rpc_internal.accept_org_invite(text) to authenticated;
revoke all on function rpc_internal.api_key_resolve(text) from public;
revoke all on function rpc_internal.api_key_touch(text) from public;
revoke all on function rpc_internal.api_key_screen(text, uuid) from public;
revoke all on function rpc_internal.api_key_hits(text, uuid, real, real, text, text, int, int) from public;
grant execute on function rpc_internal.api_key_resolve(text) to anon, authenticated;
grant execute on function rpc_internal.api_key_touch(text) to anon, authenticated;
grant execute on function rpc_internal.api_key_screen(text, uuid) to anon, authenticated;
grant execute on function rpc_internal.api_key_hits(text, uuid, real, real, text, text, int, int)
  to anon, authenticated;

create function public.accept_org_invite(invite_token text)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$ select rpc_internal.accept_org_invite(invite_token) $$;

create function public.api_key_resolve(p_key_hash text)
returns table (
  key_id uuid, key_name text, org_id uuid, org_slug text, org_name text,
  scopes text[], revoked boolean, expired boolean
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from rpc_internal.api_key_resolve(p_key_hash) $$;

create function public.api_key_touch(p_key_hash text)
returns timestamptz
language sql
volatile
security invoker
set search_path = ''
as $$ select rpc_internal.api_key_touch(p_key_hash) $$;

create function public.api_key_screen(p_key_hash text, p_screen_id uuid)
returns table (
  screen_id uuid, org_id uuid, name text, description text, cell_line text,
  modality text, phenotype text, status text, qc text, visibility text,
  taxid int, library_slug text, library_name text, run_id uuid,
  n_hits int, n_real_hits int, created_at timestamptz, updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from rpc_internal.api_key_screen(p_key_hash, p_screen_id) $$;

create function public.api_key_hits(
  p_key_hash   text,
  p_screen_id  uuid,
  p_min_chance real default null,
  p_max_fdr    real default null,
  p_direction  text default null,
  p_verdict    text default null,
  p_limit      int default 50,
  p_offset     int default 0
)
returns table (
  n_total bigint, hit_id uuid, gene_symbol text, direction text, verdict text,
  comparison text, chance_real real, chance_lower real, chance_upper real,
  novelty real, lfc real, fdr real, p_value real, n_guides int, n_good_guides int,
  cn_corrected boolean, atlas_hit_count int, atlas_screen_count int,
  atlas_hit_rate real, model_version text, reason text, flags jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from rpc_internal.api_key_hits(
    p_key_hash, p_screen_id, p_min_chance, p_max_fdr,
    p_direction, p_verdict, p_limit, p_offset)
$$;

revoke all on function public.accept_org_invite(text) from public, anon;
grant execute on function public.accept_org_invite(text) to authenticated;
revoke all on function public.api_key_resolve(text) from public;
revoke all on function public.api_key_touch(text) from public;
revoke all on function public.api_key_screen(text, uuid) from public;
revoke all on function public.api_key_hits(text, uuid, real, real, text, text, int, int) from public;
grant execute on function public.api_key_resolve(text) to anon, authenticated;
grant execute on function public.api_key_touch(text) to anon, authenticated;
grant execute on function public.api_key_screen(text, uuid) to anon, authenticated;
grant execute on function public.api_key_hits(text, uuid, real, real, text, text, int, int)
  to anon, authenticated;

notify pgrst, 'reload schema';
