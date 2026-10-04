-- ============================================================================
-- 0020 · Let a signed-in user start a lab
--
-- A user who belongs to no workspace could not make one. The signup trigger
-- private.handle_new_user() creates a personal organization, but there was no
-- path afterwards: somebody who left their only lab, or whose signup predates
-- the trigger fix in 0011, reached a dead end on every workspace page.
--
-- The gap is not a missing policy, it is a chicken and egg in the two policies
-- that already exist. From 0003:
--
--   "authenticated users create organizations"  insert ... with check
--       (created_by = auth.uid())                      -- the org: allowed
--   "admins manage membership"                  insert ... with check
--       (private.has_org_role(org_id, 'admin'))        -- the owner row: NOT
--
-- A caller may insert the organization and then cannot insert their own
-- membership of it, because they are not yet an admin of the thing they just
-- made. Done over two client statements that leaves an orphan organization with
-- no members, which nobody can read, administer or delete. The two inserts have
-- to happen together, above RLS, which is what this function is for.
--
-- Shape follows 0017: the SECURITY DEFINER body lives in rpc_internal, which
-- PostgREST does not expose, and public.create_organization is a thin SECURITY
-- INVOKER wrapper, so /rest/v1/rpc/create_organization keeps working while the
-- privileged body is not independently callable.
--
-- What it deliberately does NOT do:
--   · bypass authentication. auth.uid() null raises rather than inventing an owner.
--   · touch an existing organization. It only ever inserts a new one.
--   · move a user's default. default_org_id is set only when it is still null,
--     so creating a second lab does not silently relocate the first one.
-- ============================================================================

create or replace function rpc_internal.create_organization(
  p_name text,
  p_kind public.org_kind default 'academic'
)
returns public.organizations
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user  uuid := auth.uid();
  v_name  text;
  v_stem  text;
  v_slug  text;
  v_id    uuid;
  v_org   public.organizations;
begin
  if v_user is null then
    raise exception 'sign in to create a lab' using errcode = '42501';
  end if;

  -- organizations_name_length is 1..120. Trim first so whitespace alone is
  -- rejected here with a readable message rather than by the check constraint.
  v_name := left(btrim(coalesce(p_name, '')), 120);
  if v_name = '' then
    raise exception 'a lab needs a name' using errcode = '22023';
  end if;

  -- organizations_slug_format is '^[a-z0-9][a-z0-9-]{1,62}$'. slugify() returns
  -- an empty string for a name with no latin alphanumerics, which would produce
  -- a leading hyphen and fail the constraint, so fall back the same way 0011 does.
  v_stem := coalesce(nullif(private.slugify(v_name), ''), 'lab');

  -- Distinct labs are often named the same thing, so the slug carries a random
  -- suffix. The id is generated up front to take it from: uuid_v7 is time
  -- ordered, so its LAST characters are the random ones and its first are a
  -- timestamp two concurrent callers could well share.
  for i in 1 .. 5 loop
    v_id := private.uuid_v7();
    v_slug := left(v_stem, 55) || '-' || right(replace(v_id::text, '-', ''), 6);
    begin
      -- The cast is explicit on purpose. 0011 documents this exact footgun:
      -- an unknown literal in a CASE resolved to text and the insert aborted
      -- with 42804, and because a plpgsql body is not type checked at create
      -- time the migration applied cleanly and only the first real signup failed.
      insert into public.organizations (id, slug, name, kind, created_by)
      values (v_id, v_slug, v_name, coalesce(p_kind, 'academic'::public.org_kind), v_user)
      returning * into v_org;
      exit;
    exception when unique_violation then
      if i = 5 then
        raise exception 'could not find a free workspace slug for %', v_name
          using errcode = '23505';
      end if;
      -- else: fall through and try another suffix
    end;
  end loop;

  insert into public.org_members (org_id, user_id, role, invited_by)
  values (v_org.id, v_user, 'owner', v_user);

  -- Their first lab becomes the one they land in. A later one does not move
  -- them: that is a choice, not a side effect of creating something.
  update public.profiles
     set default_org_id = v_org.id
   where id = v_user
     and default_org_id is null;

  return v_org;
end;
$$;

revoke all on function rpc_internal.create_organization(text, public.org_kind)
  from public, anon;
grant execute on function rpc_internal.create_organization(text, public.org_kind)
  to authenticated;

create or replace function public.create_organization(
  p_name text,
  p_kind public.org_kind default 'academic'
)
returns public.organizations
language sql
volatile
security invoker
set search_path = ''
as $$ select rpc_internal.create_organization(p_name, p_kind) $$;

revoke all on function public.create_organization(text, public.org_kind) from public, anon;
grant execute on function public.create_organization(text, public.org_kind) to authenticated;

comment on function public.create_organization(text, public.org_kind) is
  'Create a lab and make the caller its owner, in one transaction. Needed '
  'because a caller cannot insert their own first org_members row: that policy '
  'requires an admin role in the organization they are joining.';
