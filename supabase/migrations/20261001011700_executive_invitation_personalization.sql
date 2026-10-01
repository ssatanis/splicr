-- ============================================================================
-- Personalized invitations prepared by the SplicR executive console.
--
-- The invitation is the source of truth for the first onboarding screen. The
-- Auth trigger copies only explicitly supplied values and leaves every field
-- editable by the researcher afterwards.
-- ============================================================================

alter table public.splicr_access_allowlist
  add column full_name text,
  add column institution text,
  add column preferred_title text,
  add column professional_role text,
  add column lab_location text,
  add column time_zone text,
  add column prepared_by_email text,
  add constraint splicr_access_allowlist_full_name_length
    check (full_name is null or char_length(trim(full_name)) between 1 and 120),
  add constraint splicr_access_allowlist_institution_length
    check (institution is null or char_length(trim(institution)) between 1 and 160),
  add constraint splicr_access_allowlist_preferred_title_length
    check (preferred_title is null or char_length(preferred_title) <= 32),
  add constraint splicr_access_allowlist_professional_role_length
    check (professional_role is null or char_length(professional_role) <= 120),
  add constraint splicr_access_allowlist_lab_location_length
    check (lab_location is null or char_length(lab_location) <= 160),
  add constraint splicr_access_allowlist_time_zone_length
    check (time_zone is null or char_length(time_zone) between 1 and 80),
  add constraint splicr_access_allowlist_prepared_by_email_format
    check (prepared_by_email is null or prepared_by_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

create index splicr_access_allowlist_status_expires_idx
  on public.splicr_access_allowlist (status, expires_at);

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email   text := lower(trim(coalesce(new.email, '')));
  v_access  public.splicr_access_allowlist%rowtype;
  v_name    text;
  v_stem    text;
  v_org_id  uuid;
  v_settings jsonb := '{}'::jsonb;
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

  v_name := coalesce(
    nullif(trim(v_access.full_name), ''),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Researcher'
  );

  insert into public.profiles (
    id, email, full_name, avatar_url, preferred_title, professional_role,
    institution, time_zone
  ) values (
    new.id,
    coalesce(new.email, new.id::text || '@placeholder.invalid'),
    v_name,
    new.raw_user_meta_data ->> 'avatar_url',
    coalesce(nullif(v_access.preferred_title, ''), nullif(new.raw_user_meta_data ->> 'preferred_title', '')),
    coalesce(nullif(v_access.professional_role, ''), nullif(new.raw_user_meta_data ->> 'professional_role', '')),
    coalesce(nullif(v_access.institution, ''), nullif(new.raw_user_meta_data ->> 'institution', '')),
    coalesce(nullif(v_access.time_zone, ''), nullif(new.raw_user_meta_data ->> 'time_zone', ''))
  );

  if v_access.create_workspace then
    v_stem := coalesce(nullif(private.slugify(v_access.workspace_name), ''), 'lab');
    if nullif(v_access.institution, '') is not null then
      v_settings := jsonb_build_object(
        'branding', jsonb_build_object('institution', v_access.institution)
      );
    end if;

    insert into public.organizations (
      slug, name, kind, created_by, location, time_zone, settings
    ) values (
      left(v_stem, 55) || '-' || substr(replace(new.id::text, '-', ''), 1, 6),
      left(trim(v_access.workspace_name), 120),
      'academic'::public.org_kind,
      new.id,
      nullif(v_access.lab_location, ''),
      nullif(v_access.time_zone, ''),
      v_settings
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

comment on column public.splicr_access_allowlist.full_name is
  'Optional executive-prepared profile value copied into onboarding.';
comment on column public.splicr_access_allowlist.institution is
  'Optional executive-prepared institution copied into profile and new-lab branding.';
comment on column public.splicr_access_allowlist.prepared_by_email is
  'Auditable executive identity that prepared the invitation.';
