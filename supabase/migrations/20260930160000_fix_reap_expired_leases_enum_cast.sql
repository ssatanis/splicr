-- Fix private.reap_expired_leases(), which has never once succeeded.
--
-- cron.job_run_details: 4,320 runs, 4,320 failures, zero successes. It is scheduled
-- every minute and has failed every minute since 2026-09-27.
--
--   ERROR:  column "status" is of type job_status but expression is of type text
--   LINE 3:  set status = case when attempts >= max_attempts then 'dead' ...
--   HINT:   You will need to rewrite or cast the expression.
--
-- Both CASE branches are bare quoted literals, so the branches are `unknown`, the
-- CASE resolves to `text`, and assigning text to an enum column needs an explicit
-- cast. The `where status in ('leased', 'running')` on the next line is fine
-- because comparing an enum to an unknown literal resolves against the enum --- it
-- is only the assignment that fails, which is why this looks correct on the page.
--
-- The function carries `SET search_path TO ''`, so the type has to be
-- schema-qualified. Casting each branch rather than the whole CASE makes the
-- expression's type the enum directly and keeps the error impossible to
-- reintroduce by editing one branch.
--
-- No data was harmed: public.jobs is empty, so no lease has ever needed reaping.
-- The consequence was latent rather than absent --- the first job to lose its lease
-- would have sat in 'leased' forever, because the only thing that returns it to the
-- queue is this function.
--
-- The deeper finding is that a job failed 4,320 consecutive times and nothing
-- reported it. Fixing the cast closes the symptom; an alerting channel is what
-- closes the cause, and that is tracked separately.

create or replace function private.reap_expired_leases()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
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
$function$;
