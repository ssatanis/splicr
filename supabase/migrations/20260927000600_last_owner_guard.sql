-- ============================================================================
-- 0011 · An organization must keep at least one owner
--
-- `changeMemberRole` and `removeMember` already refuse to demote or remove the
-- last owner, but they check by counting owners in one statement and writing in
-- the next. Two owners demoted at the same moment both read a count of two,
-- both pass the check, and the workspace is left with nobody who can invite,
-- change roles or mint a key. There is no route back through the UI, so the
-- guarantee has to be atomic, and the only place it can be is here.
--
-- Verified before writing this: the database did not enforce it. Demoting a
-- sole owner succeeded at the SQL level.
--
-- The application guards stay. They produce a readable message on the ordinary
-- single-request path; this is the backstop that makes the race impossible.
-- ============================================================================

create or replace function private.require_org_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Deleting an organization cascades to its members, and an organization being
  -- removed is allowed to end up with no owners. By the time a DEFERRED trigger
  -- runs the parent row is gone, so this test separates "the workspace is being
  -- deleted" from "the workspace just lost its last owner". A non-deferred
  -- trigger cannot tell them apart: referential cascade removes the child rows
  -- while the parent is still visible, so it blocks every organization delete.
  if not exists (select 1 from public.organizations o where o.id = old.org_id) then
    return null;
  end if;

  -- Same reasoning for the member: if the user row is gone, this membership is
  -- being cleaned up behind a deleted account, not taken away by somebody. Every
  -- new signup gets its own workspace and is its own only owner, so without this
  -- the guard would refuse every account deletion, which is a far worse outcome
  -- than the alternative. A workspace whose members have all gone keeps no
  -- owner; it is invisible to everyone under Row Level Security rather than
  -- exposed. Reassigning such a workspace instead of leaving it empty is a
  -- product decision, not something to settle inside a constraint.
  if not exists (select 1 from auth.users u where u.id = old.user_id) then
    return null;
  end if;

  if not exists (
    select 1 from public.org_members m
     where m.org_id = old.org_id and m.role = 'owner'
  ) then
    raise exception
      'A workspace needs at least one owner. Make somebody else an owner first.'
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

comment on function private.require_org_owner is
  'Refuses any transaction that would leave an organization with no owner. Atomic, unlike the application check it backs up.';

drop trigger if exists org_members_require_owner on public.org_members;

-- A CONSTRAINT trigger, deferred to commit, for two reasons. It lets a single
-- transaction hand ownership over in either order, demote-then-promote as
-- readily as promote-then-demote. And it is what makes the concurrent case
-- fail safely: each transaction re-checks at its own commit, so the second of
-- two simultaneous demotions sees the first one's committed result.
create constraint trigger org_members_require_owner
  after update or delete on public.org_members
  deferrable initially deferred
  for each row
  when (old.role = 'owner')
  execute function private.require_org_owner();
