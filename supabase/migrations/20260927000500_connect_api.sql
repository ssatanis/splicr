-- ============================================================================
-- 0010 · SplicR Connect: bearer API key authentication for /api/v1
--
-- The web app talks to Postgres with the publishable key, which lands on the
-- `anon` role when a request carries no session. `public.api_keys` is readable
-- only by org admins ("admins read api keys"), and `public.hits` is guarded by
-- `private.can_read_screen()`, so an anonymous Route Handler can reach neither.
-- There is no service-role secret in this deployment and there should not be
-- one in a web process, so the four functions below are the only bridge.
--
-- Every one of them takes the sha-256 hex digest of the whole plaintext key and
-- resolves the organization from that digest alone. Nothing accepts an org id
-- or a screen id on its own, so holding the digest is the entire authority: a
-- caller who does not have the key cannot name a workspace to read, and a
-- caller who does have it can only ever read that key's own workspace. That is
-- what makes them safe to grant to `anon`.
--
-- They are `security definer` and owned by the migration role, so they run past
-- Row Level Security on purpose. Keep them narrow.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Resolve a key
--
-- Returns at most one row, and returns it even when the key is revoked or past
-- its expiry, with a flag for each, so the caller can tell "no such key" from
-- "that key is dead" in its logs. Both still answer 401 over HTTP.
-- ---------------------------------------------------------------------------
create or replace function public.api_key_resolve(p_key_hash text)
returns table (
  key_id     uuid,
  key_name   text,
  org_id     uuid,
  org_slug   text,
  org_name   text,
  scopes     text[],
  revoked    boolean,
  expired    boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select k.id,
         k.name,
         k.org_id,
         o.slug,
         o.name,
         k.scopes,
         k.revoked_at is not null,
         k.expires_at is not null and k.expires_at <= now()
    from public.api_keys k
    join public.organizations o on o.id = k.org_id
   where k.key_hash = p_key_hash
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Record a use
--
-- Stamps `last_used_at` on a live key and hands the new value back. A revoked
-- or expired key is left untouched and the function returns null, so a caller
-- cannot keep a dead key's timestamp moving.
-- ---------------------------------------------------------------------------
create or replace function public.api_key_touch(p_key_hash text)
returns timestamptz
language sql
volatile
security definer
set search_path = ''
as $$
  update public.api_keys k
     set last_used_at = now()
   where k.key_hash = p_key_hash
     and k.revoked_at is null
     and (k.expires_at is null or k.expires_at > now())
  returning k.last_used_at;
$$;

-- ---------------------------------------------------------------------------
-- One screen, if the key's organization owns it
--
-- Ownership is `screens.org_id = api_keys.org_id`, not `can_read_screen()`: a
-- key must not reach another workspace's screen just because that screen was
-- published. An empty result is the caller's 404, and it says the same thing
-- whether the screen belongs to somebody else or does not exist at all.
-- ---------------------------------------------------------------------------
create or replace function public.api_key_screen(p_key_hash text, p_screen_id uuid)
returns table (
  screen_id    uuid,
  org_id       uuid,
  name         text,
  description  text,
  cell_line    text,
  modality     text,
  phenotype    text,
  status       text,
  qc           text,
  visibility   text,
  taxid        int,
  library_slug text,
  library_name text,
  run_id       uuid,
  n_hits       int,
  n_real_hits  int,
  created_at   timestamptz,
  updated_at   timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id,
         s.org_id,
         s.name,
         s.description,
         s.cell_line,
         s.modality::text,
         s.phenotype,
         s.status::text,
         s.qc::text,
         s.visibility::text,
         s.taxid,
         l.slug,
         l.name,
         s.current_run_id,
         s.n_hits,
         s.n_real_hits,
         s.created_at,
         s.updated_at
    from public.api_keys k
    join public.screens s on s.org_id = k.org_id
    left join atlas.libraries l on l.id = s.library_id
   where k.key_hash = p_key_hash
     and k.revoked_at is null
     and (k.expires_at is null or k.expires_at > now())
     and s.id = p_screen_id
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Hits for one screen
--
-- Only rows from the screen's current run, so a re-run does not return each
-- gene once per superseded run. `n_total` is the size of the filtered set
-- before the limit, computed with a window so paging needs one round trip.
--
-- The `hits:read` scope is checked here as well as in the Route Handler. The
-- handler's check is what produces a 403; this one means a future caller that
-- forgets cannot read anything anyway.
--
-- `p_direction` and `p_verdict` are cast to their enums, so an unknown value
-- raises 22P02. The handler rejects those before they get here.
-- ---------------------------------------------------------------------------
create or replace function public.api_key_hits(
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
  n_total            bigint,
  hit_id             uuid,
  gene_symbol        text,
  direction          text,
  verdict            text,
  comparison         text,
  chance_real        real,
  chance_lower       real,
  chance_upper       real,
  novelty            real,
  lfc                real,
  fdr                real,
  p_value            real,
  n_guides           int,
  n_good_guides      int,
  cn_corrected       boolean,
  atlas_hit_count    int,
  atlas_screen_count int,
  atlas_hit_rate     real,
  model_version      text,
  reason             text,
  flags              jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with authorized as (
    select k.org_id
      from public.api_keys k
     where k.key_hash = p_key_hash
       and k.revoked_at is null
       and (k.expires_at is null or k.expires_at > now())
       and 'hits:read' = any (k.scopes)
  ),
  filtered as (
    select h.id,
           h.gene_symbol,
           h.direction::text as direction,
           h.verdict::text as verdict,
           c.name as comparison,
           h.chance_real,
           h.chance_lower,
           h.chance_upper,
           h.novelty,
           h.lfc,
           h.fdr,
           h.p_value,
           h.n_guides,
           h.n_good_guides,
           h.cn_corrected,
           h.atlas_hit_count,
           h.atlas_screen_count,
           h.atlas_hit_rate,
           h.model_version,
           h.reason
      from public.hits h
      join public.screens s on s.id = h.screen_id
      join authorized a on a.org_id = s.org_id
      left join public.comparisons c on c.id = h.comparison_id
     where h.screen_id = p_screen_id
       and (s.current_run_id is null or h.run_id = s.current_run_id)
       and (p_min_chance is null or h.chance_real >= p_min_chance)
       and (p_max_fdr is null or h.fdr <= p_max_fdr)
       and (p_direction is null or h.direction = p_direction::public.hit_direction)
       and (p_verdict is null or h.verdict = p_verdict::public.hit_verdict)
  ),
  page as (
    select f.*, count(*) over () as n_total
      from filtered f
     order by f.chance_real desc nulls last,
              f.fdr asc nulls last,
              f.gene_symbol asc
     limit least(greatest(coalesce(p_limit, 50), 1), 500)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select p.n_total::bigint,
         p.id,
         p.gene_symbol,
         p.direction,
         p.verdict,
         p.comparison,
         p.chance_real,
         p.chance_lower,
         p.chance_upper,
         p.novelty,
         p.lfc,
         p.fdr,
         p.p_value,
         p.n_guides,
         p.n_good_guides,
         p.cn_corrected,
         p.atlas_hit_count,
         p.atlas_screen_count,
         p.atlas_hit_rate,
         p.model_version,
         p.reason,
         coalesce(
           (select jsonb_agg(jsonb_build_object(
                     'flag', fl.flag,
                     'severity', fl.severity,
                     'message', fl.message)
                   order by fl.severity desc, fl.flag)
              from public.hit_flags fl
             where fl.hit_id = p.id),
           '[]'::jsonb
         ) as flags
    from page p
   order by p.chance_real desc nulls last,
            p.fdr asc nulls last,
            p.gene_symbol asc;
$$;

-- ---------------------------------------------------------------------------
-- Grants
--
-- A bearer key arrives with no Supabase session, so the Route Handler is on
-- `anon`. `authenticated` is granted too, because the same handler answers when
-- the caller happens to also be carrying a dashboard cookie.
-- ---------------------------------------------------------------------------
revoke all on function public.api_key_resolve(text) from public;
revoke all on function public.api_key_touch(text) from public;
revoke all on function public.api_key_screen(text, uuid) from public;
revoke all on function public.api_key_hits(text, uuid, real, real, text, text, int, int) from public;

grant execute on function public.api_key_resolve(text) to anon, authenticated;
grant execute on function public.api_key_touch(text) to anon, authenticated;
grant execute on function public.api_key_screen(text, uuid) to anon, authenticated;
grant execute on function public.api_key_hits(text, uuid, real, real, text, text, int, int)
  to anon, authenticated;

-- A key lookup happens on every API request. `api_keys.key_hash` is already
-- declared unique in 0003, so the index it needs is there; this is only a
-- guard against that constraint being relaxed later.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_indexes
     where schemaname = 'public' and tablename = 'api_keys'
       and indexdef like '%(key_hash)%'
  ) then
    create index api_keys_key_hash_ix on public.api_keys (key_hash);
  end if;
end;
$$;
