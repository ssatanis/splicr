-- ============================================================================
-- Lab identity and lab usage
--
-- Two things a lab administrator could not do before:
--
--   1. Put the lab's actual logo on the workspace. `organizations.logo_url`
--      existed, but the only way to fill it was to paste a URL to a file
--      hosted somewhere else, which most labs do not have. This adds a bucket
--      they can upload into, keyed by organization id so the existing
--      `private.storage_org_id()` prefix rule governs it like every other
--      object in the system.
--
--   2. See what the lab has actually used. Every screen, run and validation
--      outcome already carries the organization that owns it and the person
--      who did it; nothing read those two columns together. `public.org_usage`
--      does, in one response, so a plan's consumption is a fact on the page
--      rather than an assurance in a sentence.
--
-- Nothing here changes who pays for what, because that was already settled:
-- `plan` is a column on `public.organizations` and on nothing else. A person
-- has no plan. `private.handle_new_user()` gives an invited researcher
-- membership of the inviting lab and no workspace of their own, so their work
-- is written with that lab's `org_id` and there is no second plan it could
-- fall under. This migration surfaces that arrangement; it does not create it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Somewhere to put the logo
-- ---------------------------------------------------------------------------

-- Public, because a logo is printed on shared reports and read by people who
-- were never given a session. 2 MB, because this is a mark and not a figure.
--
-- SVG is deliberately absent from the accepted types. An SVG is a script
-- container, the bucket is world readable, and a lab logo is a raster job; the
-- three bitmap formats below cover every file a lab will actually hand over.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lab-logos',
  'lab-logos',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Objects are `<org_id>/<name>`, the same shape every other bucket uses, so
-- private.storage_org_id() is the authority on which lab an object belongs to.
create policy "lab logos are readable"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'lab-logos');

create policy "admins upload their lab logo"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'lab-logos'
    and (select private.has_org_role(private.storage_org_id(name), 'admin'))
  );

create policy "admins replace their lab logo"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'lab-logos'
    and (select private.has_org_role(private.storage_org_id(name), 'admin'))
  );

create policy "admins delete their lab logo"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'lab-logos'
    and (select private.has_org_role(private.storage_org_id(name), 'admin'))
  );

-- ---------------------------------------------------------------------------
-- 2 · What the lab has used, and who in the lab used it
-- ---------------------------------------------------------------------------

-- security definer with an explicit membership gate rather than security
-- invoker. The aggregates below touch four tables whose read policies are
-- per-row predicates; running them under RLS would evaluate a policy once per
-- screen and once per run to produce five integers. The gate is the same
-- question those policies ask, asked once.
--
-- One jsonb document rather than a collection, because PostgREST serves at
-- most 1000 rows and a usage page that silently stopped counting at a
-- thousand runs would be worse than no usage page at all.
create or replace function public.org_usage(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_org is null or not private.is_org_member(p_org) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  with
  by_screen as (
    select created_by as uid, count(*) as n, max(created_at) as last_at
      from public.screens
     where org_id = p_org and created_by is not null
     group by created_by
  ),
  by_run as (
    select triggered_by as uid,
           count(*) as n,
           count(*) filter (where created_at >= now() - interval '30 days') as n30,
           max(created_at) as last_at
      from public.runs
     where org_id = p_org and triggered_by is not null
     group by triggered_by
  ),
  by_outcome as (
    select logged_by as uid, count(*) as n, max(logged_at) as last_at
      from public.validation_outcomes
     where org_id = p_org and logged_by is not null
     group by logged_by
  ),
  by_key as (
    select created_by as uid,
           count(*) filter (where revoked_at is null) as live,
           max(last_used_at) as last_at
      from public.api_keys
     where org_id = p_org and created_by is not null
     group by created_by
  ),
  person as (
    select m.user_id,
           m.role::text as role,
           m.created_at as joined_at,
           coalesce(nullif(trim(p.full_name), ''), split_part(p.email, '@', 1)) as name,
           p.email,
           coalesce(s.n, 0)    as screens,
           coalesce(r.n, 0)    as runs,
           coalesce(r.n30, 0)  as runs_30d,
           coalesce(o.n, 0)    as outcomes,
           coalesce(k.live, 0) as api_keys,
           -- greatest() returns null only when every argument is null, which
           -- is exactly the "has not done anything yet" case.
           greatest(s.last_at, r.last_at, o.last_at, k.last_at) as last_active_at
      from public.org_members m
      join public.profiles p on p.id = m.user_id
      left join by_screen  s on s.uid = m.user_id
      left join by_run     r on r.uid = m.user_id
      left join by_outcome o on o.uid = m.user_id
      left join by_key     k on k.uid = m.user_id
     where m.org_id = p_org
  ),
  total as (
    select
      (select count(*) from public.screens where org_id = p_org)              as screens,
      (select count(*) from public.runs where org_id = p_org)                 as runs,
      (select count(*) from public.runs
        where org_id = p_org and created_at >= now() - interval '30 days')    as runs_30d,
      (select count(*) from public.validation_outcomes where org_id = p_org)  as outcomes,
      (select count(*) from public.api_keys
        where org_id = p_org and revoked_at is null)                          as api_keys,
      (select count(*) from public.org_members where org_id = p_org)          as members,
      (select count(*) from public.org_invites
        where org_id = p_org and accepted_at is null and expires_at > now())  as pending_invites
  ),
  held as (
    select coalesce(sum(screens), 0)  as screens,
           coalesce(sum(runs), 0)     as runs,
           coalesce(sum(outcomes), 0) as outcomes,
           coalesce(sum(api_keys), 0) as api_keys
      from person
  )
  select jsonb_build_object(
    'org_id', p_org,
    'plan', (select plan::text from public.organizations where id = p_org),
    'people', coalesce(
      (select jsonb_agg(
         jsonb_build_object(
           'user_id', user_id,
           'name', name,
           'email', email,
           'role', role,
           'joined_at', joined_at,
           'screens', screens,
           'runs', runs,
           'runs_30d', runs_30d,
           'outcomes', outcomes,
           'api_keys', api_keys,
           'last_active_at', last_active_at
         ) order by screens + runs + outcomes desc, name
       ) from person),
      '[]'::jsonb
    ),
    'totals', (
      select jsonb_build_object(
        'screens', t.screens,
        'runs', t.runs,
        'runs_30d', t.runs_30d,
        'outcomes', t.outcomes,
        'api_keys', t.api_keys,
        'members', t.members,
        'pending_invites', t.pending_invites
      ) from total t
    ),
    -- What the lab did that nobody currently in it can be credited with: work
    -- by somebody who has since left, or a row whose actor was never recorded.
    -- Reported rather than hidden, so the per-person rows and the lab total
    -- add up on the page instead of quietly disagreeing.
    'unattributed', (
      select jsonb_build_object(
        'screens', t.screens - h.screens,
        'runs', t.runs - h.runs,
        'outcomes', t.outcomes - h.outcomes,
        'api_keys', t.api_keys - h.api_keys
      ) from total t, held h
    )
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.org_usage(uuid) is
  'Everything one workspace has used, per member and in total, in one row. '
  'Membership is checked once at the top; the caller sees their own lab only.';

revoke all on function public.org_usage(uuid) from public, anon;
grant execute on function public.org_usage(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
