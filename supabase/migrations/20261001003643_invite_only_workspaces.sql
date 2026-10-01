-- ============================================================================
-- Invite-only identity, onboarding, and laboratory identity
--
-- Auth configuration disables public sign-up. This migration adds a second,
-- database-enforced boundary: even an accidentally re-enabled sign-up endpoint
-- cannot create a user unless a trusted operator or lab administrator placed
-- that email in splicr_access_allowlist first.
-- ============================================================================

create table public.splicr_access_allowlist (
  id                 uuid primary key default private.uuid_v7(),
  email              text not null,
  org_id             uuid references public.organizations (id) on delete cascade,
  role               public.org_role not null default 'member',
  status             text not null default 'pending',
  create_workspace   boolean not null default false,
  workspace_name     text,
  invited_by         uuid references auth.users (id) on delete set null,
  invited_at         timestamptz,
  accepted_at        timestamptz,
  expires_at         timestamptz default now() + interval '14 days',
  consumed_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint splicr_access_allowlist_email_format
    check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint splicr_access_allowlist_status
    check (status in ('pending', 'invited', 'active', 'revoked')),
  constraint splicr_access_allowlist_target
    check ((org_id is not null) <> create_workspace),
  constraint splicr_access_allowlist_workspace_name
    check (
      (create_workspace and char_length(trim(workspace_name)) between 1 and 120)
      or (not create_workspace and workspace_name is null)
    )
);

create unique index splicr_access_allowlist_email_key
  on public.splicr_access_allowlist (lower(email));
create index splicr_access_allowlist_org_id_idx
  on public.splicr_access_allowlist (org_id);

create trigger splicr_access_allowlist_updated_at
  before update on public.splicr_access_allowlist
  for each row execute function private.set_updated_at();

alter table public.splicr_access_allowlist enable row level security;

create policy "lab admins read their access invitations"
  on public.splicr_access_allowlist for select to authenticated
  using (org_id is not null and (select private.has_org_role(org_id, 'admin')));

create policy "lab admins create access invitations"
  on public.splicr_access_allowlist for insert to authenticated
  with check (
    org_id is not null
    and (select private.has_org_role(org_id, 'admin'))
    and invited_by = (select auth.uid())
    and create_workspace = false
  );

create policy "lab admins update their access invitations"
  on public.splicr_access_allowlist for update to authenticated
  using (org_id is not null and (select private.has_org_role(org_id, 'admin')))
  with check (org_id is not null and (select private.has_org_role(org_id, 'admin')));

create policy "lab admins delete their access invitations"
  on public.splicr_access_allowlist for delete to authenticated
  using (org_id is not null and (select private.has_org_role(org_id, 'admin')));

-- The auth service needs to inspect the allowlist before auth.users exists.
-- No browser-facing role gets table or function access.
grant usage on schema public to supabase_auth_admin;
grant select on table public.splicr_access_allowlist to supabase_auth_admin;
revoke all on table public.splicr_access_allowlist from anon, public;

create or replace function public.hook_splicr_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(event -> 'user' ->> 'email'));
begin
  if v_email <> '' and exists (
    select 1
    from public.splicr_access_allowlist a
    where lower(a.email) = v_email
      and a.status in ('pending', 'invited')
      and a.expires_at > now()
      and a.consumed_at is null
  ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'This SplicR workspace is invitation-only.'
    )
  );
end;
$$;

grant execute on function public.hook_splicr_before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_splicr_before_user_created(jsonb)
  from anon, authenticated, public;

alter table public.profiles
  add column preferred_title text,
  add column professional_role text,
  add column institution text,
  add column time_zone text,
  add column onboarding_step smallint not null default 1,
  add column onboarding_completed_at timestamptz,
  add constraint profiles_preferred_title_length
    check (preferred_title is null or char_length(preferred_title) <= 32),
  add constraint profiles_professional_role_length
    check (professional_role is null or char_length(professional_role) <= 120),
  add constraint profiles_institution_length
    check (institution is null or char_length(institution) <= 160),
  add constraint profiles_time_zone_length
    check (time_zone is null or char_length(time_zone) between 1 and 80),
  add constraint profiles_onboarding_step_range
    check (onboarding_step between 1 and 4);

alter table public.organizations
  add column logo_url text,
  add column location text,
  add column time_zone text,
  add constraint organizations_logo_url_length
    check (logo_url is null or char_length(logo_url) <= 2048),
  add constraint organizations_location_length
    check (location is null or char_length(location) <= 160),
  add constraint organizations_time_zone_length
    check (time_zone is null or char_length(time_zone) between 1 and 80);

alter table public.org_invites
  add column delivery_state text not null default 'pending',
  add column delivered_at timestamptz,
  add column delivery_error text,
  add constraint org_invites_delivery_state
    check (delivery_state in ('pending', 'sent', 'existing_user', 'failed', 'revoked')),
  add constraint org_invites_delivery_error_length
    check (delivery_error is null or char_length(delivery_error) <= 500);

create policy "admins update invite delivery"
  on public.org_invites for update to authenticated
  using ((select private.has_org_role(org_id, 'admin')))
  with check ((select private.has_org_role(org_id, 'admin')));

-- Replace the former open-signup bootstrap. An invited researcher joins the
-- intended lab immediately; an explicitly authorized principal investigator
-- receives a new lab workspace. No user gets an implicit personal workspace.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email   text := lower(trim(coalesce(new.email, '')));
  v_name    text := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Researcher'
  );
  v_access  public.splicr_access_allowlist%rowtype;
  v_stem    text;
  v_org_id  uuid;
begin
  select * into v_access
  from public.splicr_access_allowlist a
  where lower(a.email) = v_email
    and a.status in ('pending', 'invited')
    and a.expires_at > now()
    and a.consumed_at is null
  for update;

  if not found then
    raise exception 'user is not on the SplicR access allowlist' using errcode = '42501';
  end if;

  insert into public.profiles (
    id, email, full_name, avatar_url, preferred_title, professional_role,
    institution, time_zone
  ) values (
    new.id,
    coalesce(new.email, new.id::text || '@placeholder.invalid'),
    v_name,
    new.raw_user_meta_data ->> 'avatar_url',
    nullif(new.raw_user_meta_data ->> 'preferred_title', ''),
    nullif(new.raw_user_meta_data ->> 'professional_role', ''),
    nullif(new.raw_user_meta_data ->> 'institution', ''),
    nullif(new.raw_user_meta_data ->> 'time_zone', '')
  );

  if v_access.create_workspace then
    v_stem := coalesce(nullif(private.slugify(v_access.workspace_name), ''), 'lab');
    insert into public.organizations (
      slug, name, kind, created_by, time_zone
    ) values (
      left(v_stem, 55) || '-' || substr(replace(new.id::text, '-', ''), 1, 6),
      left(trim(v_access.workspace_name), 120),
      'academic'::public.org_kind,
      new.id,
      nullif(new.raw_user_meta_data ->> 'time_zone', '')
    ) returning id into v_org_id;

    insert into public.org_members (org_id, user_id, role, invited_by)
    values (v_org_id, new.id, 'owner', coalesce(v_access.invited_by, new.id));
  else
    v_org_id := v_access.org_id;
    insert into public.org_members (org_id, user_id, role, invited_by)
    values (v_org_id, new.id, v_access.role, v_access.invited_by)
    on conflict (org_id, user_id) do update set role = excluded.role;

    update public.org_invites
      set accepted_at = coalesce(accepted_at, now())
    where org_id = v_org_id
      and lower(email) = v_email
      and accepted_at is null;
  end if;

  update public.profiles set default_org_id = v_org_id where id = new.id;
  update public.splicr_access_allowlist
    set consumed_at = now(),
        accepted_at = now(),
        status = 'active',
        expires_at = null
    where id = v_access.id;

  return new;
end;
$$;

create or replace function public.has_splicr_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.splicr_access_allowlist a
    where lower(a.email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
      and a.status in ('pending', 'invited', 'active')
      and (a.expires_at is null or a.expires_at > now())
  );
$$;

grant execute on function public.has_splicr_access() to authenticated;
revoke execute on function public.has_splicr_access() from anon, public;

-- Accepting a workspace invitation promotes the account-level grant as well as
-- adding membership. Repeated acceptance remains idempotent.
create or replace function public.accept_org_invite(invite_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.org_invites%rowtype;
  v_email text := lower((select auth.jwt() ->> 'email'));
begin
  select * into v_invite from public.org_invites
  where token = invite_token and accepted_at is null and expires_at > now();
  if not found then
    raise exception 'invite not found or expired' using errcode = 'P0002';
  end if;
  if lower(v_invite.email) <> v_email then
    raise exception 'invite was issued to a different email' using errcode = '42501';
  end if;
  insert into public.org_members (org_id, user_id, role, invited_by)
  values (v_invite.org_id, (select auth.uid()), v_invite.role, v_invite.invited_by)
  on conflict (org_id, user_id) do update set role = excluded.role;
  update public.org_invites set accepted_at = now() where id = v_invite.id;
  update public.splicr_access_allowlist
    set status = 'active', accepted_at = now(), consumed_at = coalesce(consumed_at, now()), expires_at = null
    where lower(email) = v_email and org_id = v_invite.org_id;
  update public.profiles set default_org_id = v_invite.org_id where id = (select auth.uid());
  return v_invite.org_id;
end;
$$;

comment on table public.splicr_access_allowlist is
  'Trusted, expiring authorization for creation of an invited SplicR identity.';
comment on function public.hook_splicr_before_user_created(jsonb) is
  'Supabase Before User Created hook. Rejects every identity absent from the active SplicR allowlist.';
