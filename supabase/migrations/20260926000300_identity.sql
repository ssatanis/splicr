-- ============================================================================
-- 0003 · Identity and tenancy
-- organizations · profiles · org_members · org_invites · api_keys
-- ============================================================================

create table public.organizations (
  id            uuid primary key default private.uuid_v7(),
  slug          text not null unique,
  name          text not null,
  kind          public.org_kind not null default 'personal',
  plan          public.plan_tier not null default 'free',
  settings      jsonb not null default '{}'::jsonb,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint organizations_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  constraint organizations_name_length check (char_length(name) between 1 and 120)
);

create trigger organizations_updated_at
  before update on public.organizations
  for each row execute function private.set_updated_at();

create table public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  email           text not null,
  full_name       text,
  avatar_url      text,
  orcid           text,
  default_org_id  uuid references public.organizations (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint profiles_orcid_format check (orcid is null or orcid ~ '^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$')
);

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

create table public.org_members (
  org_id      uuid not null references public.organizations (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        public.org_role not null default 'member',
  invited_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index org_members_user_id_idx on public.org_members (user_id);

create table public.org_invites (
  id          uuid primary key default private.uuid_v7(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  email       text not null,
  role        public.org_role not null default 'member',
  token       text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  invited_by  uuid references auth.users (id) on delete set null,
  expires_at  timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  created_at  timestamptz not null default now(),
  constraint org_invites_email_format check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

create index org_invites_org_id_idx on public.org_invites (org_id);
create index org_invites_email_idx on public.org_invites (lower(email));

-- API keys for SplicR Connect. Only the SHA-256 hash is stored.
create table public.api_keys (
  id            uuid primary key default private.uuid_v7(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  name          text not null,
  key_prefix    text not null,                 -- first 12 chars, shown in the UI
  key_hash      text not null unique,          -- sha256(hex) of the full key
  scopes        text[] not null default '{atlas:read,hits:read}',
  created_by    uuid references auth.users (id) on delete set null,
  last_used_at  timestamptz,
  expires_at    timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  constraint api_keys_name_length check (char_length(name) between 1 and 80)
);

create index api_keys_org_id_idx on public.api_keys (org_id);

-- ---------------------------------------------------------------------------
-- Membership helpers (security definer, private schema, not exposed)
-- ---------------------------------------------------------------------------
create or replace function private.is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = org and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.org_role(org uuid)
returns public.org_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role from public.org_members m
  where m.org_id = org and m.user_id = (select auth.uid());
$$;

create or replace function private.has_org_role(org uuid, min_role public.org_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.role_rank(private.org_role(org)) >= private.role_rank(min_role), false);
$$;

create or replace function private.user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.org_id from public.org_members m where m.user_id = (select auth.uid());
$$;

grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.org_role(uuid) to authenticated;
grant execute on function private.has_org_role(uuid, public.org_role) to authenticated;
grant execute on function private.user_org_ids() to authenticated;

-- ---------------------------------------------------------------------------
-- New user bootstrap: profile + personal organization + owner membership
-- ---------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name   text := coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1));
  v_org    text := nullif(new.raw_user_meta_data ->> 'organization_name', '');
  v_slug   text;
  v_org_id uuid;
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (new.id, new.email, v_name, new.raw_user_meta_data ->> 'avatar_url');

  v_slug := private.slugify(coalesce(v_org, v_name)) || '-' || substr(replace(new.id::text, '-', ''), 1, 6);

  insert into public.organizations (slug, name, kind, created_by)
  values (v_slug, coalesce(v_org, v_name || '''s workspace'), case when v_org is null then 'personal' else 'academic' end, new.id)
  returning id into v_org_id;

  insert into public.org_members (org_id, user_id, role, invited_by)
  values (v_org_id, new.id, 'owner', new.id);

  update public.profiles set default_org_id = v_org_id where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.profiles      enable row level security;
alter table public.org_members   enable row level security;
alter table public.org_invites   enable row level security;
alter table public.api_keys      enable row level security;

-- organizations
create policy "members read their organizations"
  on public.organizations for select to authenticated
  using ((select private.is_org_member(id)));

create policy "owners and admins update their organization"
  on public.organizations for update to authenticated
  using ((select private.has_org_role(id, 'admin')))
  with check ((select private.has_org_role(id, 'admin')));

create policy "owners delete their organization"
  on public.organizations for delete to authenticated
  using ((select private.has_org_role(id, 'owner')));

create policy "authenticated users create organizations"
  on public.organizations for insert to authenticated
  with check (created_by = (select auth.uid()));

-- profiles: a user sees themself and members of shared organizations
create policy "users read own profile and co-members"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.org_members a
      join public.org_members b on a.org_id = b.org_id
      where a.user_id = (select auth.uid()) and b.user_id = public.profiles.id
    )
  );

create policy "users update own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- org_members
create policy "members read membership of their organizations"
  on public.org_members for select to authenticated
  using ((select private.is_org_member(org_id)));

create policy "admins manage membership"
  on public.org_members for insert to authenticated
  with check ((select private.has_org_role(org_id, 'admin')));

create policy "admins update membership"
  on public.org_members for update to authenticated
  using ((select private.has_org_role(org_id, 'admin')))
  with check ((select private.has_org_role(org_id, 'admin')));

create policy "admins remove members or members leave"
  on public.org_members for delete to authenticated
  using ((select private.has_org_role(org_id, 'admin')) or user_id = (select auth.uid()));

-- org_invites
create policy "admins read invites"
  on public.org_invites for select to authenticated
  using ((select private.has_org_role(org_id, 'admin')) or lower(email) = lower((select auth.jwt() ->> 'email')));

create policy "admins create invites"
  on public.org_invites for insert to authenticated
  with check ((select private.has_org_role(org_id, 'admin')));

create policy "admins delete invites"
  on public.org_invites for delete to authenticated
  using ((select private.has_org_role(org_id, 'admin')));

-- api_keys
create policy "admins read api keys"
  on public.api_keys for select to authenticated
  using ((select private.has_org_role(org_id, 'admin')));

create policy "admins create api keys"
  on public.api_keys for insert to authenticated
  with check ((select private.has_org_role(org_id, 'admin')) and created_by = (select auth.uid()));

create policy "admins revoke api keys"
  on public.api_keys for update to authenticated
  using ((select private.has_org_role(org_id, 'admin')))
  with check ((select private.has_org_role(org_id, 'admin')));

create policy "admins delete api keys"
  on public.api_keys for delete to authenticated
  using ((select private.has_org_role(org_id, 'admin')));

-- ---------------------------------------------------------------------------
-- Accept an invite (RPC)
-- ---------------------------------------------------------------------------
create or replace function public.accept_org_invite(invite_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.org_invites%rowtype;
  v_email  text := lower((select auth.jwt() ->> 'email'));
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
  return v_invite.org_id;
end;
$$;

grant execute on function public.accept_org_invite(text) to authenticated;
