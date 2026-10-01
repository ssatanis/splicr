-- ============================================================================
-- Reconcile: private.reap_expired_leases() needs explicit enum casts
--
-- This migration was applied to the remote database before its source file
-- existed locally. The definition below was recovered from the live catalogue
-- (pg_get_functiondef) on 2026-09-30 and is reproduced verbatim in intent, so
-- the local history and the deployed schema agree.
--
-- WHY IT WAS NEEDED. The function is `set search_path = ''`, which is correct
-- for a security definer routine but means an unqualified name resolves to
-- nothing. The original body wrote `then 'dead' else 'queued' end`, leaving
-- Postgres to infer the CASE result type as text and then assign text to a
-- public.job_status column. That fails at run time with
--   column "status" is of type public.job_status but expression is of type text
-- and, because the function is called once a minute by the splicr-reap-leases
-- cron job, a stuck lease was never released: every reap attempt errored.
-- The fix is to qualify both branches with the enum type.
-- ============================================================================

create or replace function private.reap_expired_leases()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  with expired as (
    update public.jobs
       set status = case
                      when attempts >= max_attempts then 'dead'::public.job_status
                      else 'queued'::public.job_status
                    end,
           lease_owner = null,
           lease_expires_at = null,
           error = coalesce(error, 'lease expired')
     where status in ('leased', 'running')
       and lease_expires_at < now()
    returning id, status
  )
  select count(*) into v_count from expired;
  return v_count;
end;
$$;
