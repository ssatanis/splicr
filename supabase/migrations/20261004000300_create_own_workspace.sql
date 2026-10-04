-- ============================================================================
-- A principal investigator who ends up with no laboratory can make one.
--
-- WHY THIS IS NARROW
--
-- SplicR is invite-only. `private.handle_new_user` gives every authorized
-- account either a membership of the laboratory that invited it, or a new
-- laboratory of its own when the access grant says `create_workspace`. So a
-- signed-in researcher normally cannot be in no laboratory at all.
--
-- They can get there: the laboratory is deleted, or their membership is removed
-- by an administrator who then leaves. Until now that was a dead end — workspace
-- setup told them their invitation was not attached to a laboratory and offered
-- nothing to do about it, and every console page below it reads an organization
-- that is not there.
--
-- This is the way out, and only for the people the grant already trusted with
-- one: the same `create_workspace` flag `handle_new_user` reads, on a row that
-- is still good. It refuses anyone who is already in a laboratory, so it cannot
-- be used to fork a second workspace out from under a lab's administrators.
-- ============================================================================

create or replace function public.create_own_workspace(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := auth.uid();
  v_email text;
  v_name  text := left(trim(coalesce(p_name, '')), 120);
  v_stem  text;
  v_org   uuid;
  v_zone  text;
begin
  if v_user is null then
    raise exception 'Sign in first.' using errcode = 'insufficient_privilege';
  end if;
  if char_length(v_name) < 2 then
    raise exception 'Give the laboratory a name.' using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.org_members m where m.user_id = v_user) then
    raise exception 'You are already in a laboratory.' using errcode = 'unique_violation';
  end if;

  select lower(trim(email)), time_zone into v_email, v_zone
    from public.profiles where id = v_user;

  if not exists (
    select 1 from public.splicr_access_allowlist a
     where lower(a.email) = v_email
       and a.create_workspace
       and a.status in ('pending', 'invited', 'active')
       and (a.expires_at is null or a.expires_at > now())
  ) then
    raise exception
      'Your access is not authorized to create a laboratory. Ask whoever invited you to add you to theirs.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Same slug shape the signup bootstrap uses, so the two paths produce
  -- workspaces that look alike rather than two conventions in one table.
  v_stem := coalesce(nullif(private.slugify(v_name), ''), 'lab');
  insert into public.organizations (slug, name, kind, created_by, time_zone)
  values (
    left(v_stem, 55) || '-' || substr(replace(v_user::text, '-', ''), 1, 6),
    v_name,
    'academic'::public.org_kind,
    v_user,
    v_zone
  )
  returning id into v_org;

  insert into public.org_members (org_id, user_id, role, invited_by)
  values (v_org, v_user, 'owner', v_user);

  update public.profiles set default_org_id = v_org where id = v_user;

  return v_org;
end;
$$;

revoke all on function public.create_own_workspace(text) from public, anon;
grant execute on function public.create_own_workspace(text) to authenticated;

comment on function public.create_own_workspace(text) is
  'Recovery path for an authorized principal investigator who is in no laboratory. '
  'Requires splicr_access_allowlist.create_workspace, and refuses anyone with an existing membership.';

-- Whether to offer that control at all, without exposing the allowlist itself.
create or replace function public.may_create_workspace()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.splicr_access_allowlist a
     where lower(a.email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
       and a.create_workspace
       and a.status in ('pending', 'invited', 'active')
       and (a.expires_at is null or a.expires_at > now())
  )
  and not exists (select 1 from public.org_members m where m.user_id = (select auth.uid()));
$$;

revoke all on function public.may_create_workspace() from public, anon;
grant execute on function public.may_create_workspace() to authenticated;

notify pgrst, 'reload schema';
