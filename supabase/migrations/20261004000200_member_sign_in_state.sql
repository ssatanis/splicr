-- ============================================================================
-- Who has actually signed in
--
-- An invitation creates the identity the moment the code is minted, and
-- `private.handle_new_user()` writes the membership and marks the invite
-- accepted in the same transaction. That is correct, and it has one
-- consequence nobody could see: from that instant the invited researcher is a
-- member of the laboratory, the invitation leaves the pending list, and the
-- only thing standing between them and the console is a six-digit code that
-- expires in an hour.
--
-- If that code expired, there was nothing an administrator could do. The
-- invitation was gone from the panel, so there was no button to press, and the
-- member looked exactly like somebody who had been working in the laboratory
-- for a week.
--
-- The missing fact lives in `auth.users`, which no browser-facing role may
-- read. This exposes the one column that matters, for one organization, to the
-- administrators of that organization and to nobody else.
-- ============================================================================

create or replace function public.org_member_access(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  -- Admins and owners only. A researcher has no business knowing when their
  -- colleagues last signed in, and the sign-in code this answer unlocks is an
  -- administrative action in the first place.
  if p_org is null or not private.has_org_role(p_org, 'admin') then
    raise exception 'admin role required for this workspace' using errcode = '42501';
  end if;

  select coalesce(
           jsonb_object_agg(
             m.user_id::text,
             jsonb_build_object(
               'last_sign_in_at', u.last_sign_in_at,
               'email_confirmed_at', u.email_confirmed_at
             )
           ),
           '{}'::jsonb
         )
    into v_result
    from public.org_members m
    join auth.users u on u.id = m.user_id
   where m.org_id = p_org;

  return v_result;
end;
$$;

comment on function public.org_member_access(uuid) is
  'Whether each member of one workspace has ever signed in, for the admins of '
  'that workspace. The one fact that distinguishes an invited researcher who '
  'has not arrived yet from a colleague who has been here for months.';

revoke all on function public.org_member_access(uuid) from public, anon;
grant execute on function public.org_member_access(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
