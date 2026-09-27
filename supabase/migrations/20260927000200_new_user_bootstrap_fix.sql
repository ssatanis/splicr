-- ============================================================================
-- 0011 · Fix the new user bootstrap trigger
--
-- private.handle_new_user() never completed, so every signup failed and
-- auth.users stayed empty. Two defects on the same INSERT:
--
--   1. kind was written as
--        case when v_org is null then 'personal' else 'academic' end
--      Both branches are unknown literals, so Postgres resolves the CASE to
--      text and the insert aborts with 42804, "column kind is of type
--      org_kind but expression is of type text". A plpgsql function body is
--      not type checked at create time, so the migration applied cleanly and
--      the fault only showed up on the first real signup. Fixed by casting
--      the CASE to public.org_kind.
--
--   2. The slug was built from private.slugify(), which returns an empty
--      string when the name has no latin alphanumerics. The slug then began
--      with a hyphen and failed organizations_slug_format,
--      '^[a-z0-9][a-z0-9-]{1,62}$'. Anyone whose display name or workspace
--      name slugified away, for instance a non-latin address local part,
--      could not sign up either. Fixed by falling back to 'lab'.
--
-- The function is otherwise unchanged: profile, personal organization, owner
-- membership, then default_org_id.
-- ============================================================================

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name   text := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Researcher'
  );
  v_org    text := nullif(new.raw_user_meta_data ->> 'organization_name', '');
  v_stem   text;
  v_slug   text;
  v_org_id uuid;
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, new.id::text || '@placeholder.invalid'),
    v_name,
    new.raw_user_meta_data ->> 'avatar_url'
  );

  -- Keep the slug inside organizations_slug_format even when slugify() has
  -- nothing latin to work with.
  v_stem := coalesce(nullif(private.slugify(coalesce(v_org, v_name)), ''), 'lab');
  v_slug := left(v_stem, 55) || '-' || substr(replace(new.id::text, '-', ''), 1, 6);

  insert into public.organizations (slug, name, kind, created_by)
  values (
    v_slug,
    left(coalesce(v_org, v_name || '''s workspace'), 120),
    (case when v_org is null then 'personal' else 'academic' end)::public.org_kind,
    new.id
  )
  returning id into v_org_id;

  insert into public.org_members (org_id, user_id, role, invited_by)
  values (v_org_id, new.id, 'owner', new.id);

  update public.profiles set default_org_id = v_org_id where id = new.id;
  return new;
end;
$$;
