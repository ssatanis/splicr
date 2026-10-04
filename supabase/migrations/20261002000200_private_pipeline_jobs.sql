-- ============================================================================
-- Private pipeline job leasing for Modal.
--
-- Browser intake creates one queued public.jobs row through start_screen_analysis.
-- These functions are the worker-facing contract: claim one job exactly once for
-- a lease, heartbeat observed progress, and close it with retry semantics.
-- ============================================================================

create or replace function public.claim_pipeline_job(
  p_owner text,
  p_lease interval default '30 minutes'
)
returns table (
  job_id uuid,
  run_id uuid,
  screen_id uuid,
  org_id uuid,
  payload jsonb,
  attempts int
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with chosen as (
    select j.id
      from public.jobs j
     where j.kind = 'pipeline'
       and j.status = 'queued'
       and j.scheduled_at <= now()
       and j.attempts < j.max_attempts
     order by j.priority asc, j.scheduled_at asc, j.created_at asc
     for update skip locked
     limit 1
  ),
  claimed as (
    update public.jobs j
       set status = 'leased',
           attempts = j.attempts + 1,
           lease_owner = p_owner,
           lease_expires_at = now() + p_lease,
           started_at = coalesce(j.started_at, now()),
           error = null
      from chosen
     where j.id = chosen.id
     returning j.id, j.run_id, j.org_id, j.payload, j.attempts
  )
  select c.id, c.run_id, (c.payload->>'screen_id')::uuid, c.org_id, c.payload, c.attempts
    from claimed c;
end;
$$;

create or replace function public.pipeline_job_heartbeat(
  p_job_id uuid,
  p_owner text,
  p_progress numeric default null,
  p_lease interval default '30 minutes'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.jobs
     set status = 'running',
         progress = greatest(progress, coalesce(p_progress, progress)),
         lease_expires_at = now() + p_lease
   where id = p_job_id
     and lease_owner = p_owner
     and status in ('leased', 'running');

  if not found then
    raise exception 'This job is no longer leased by this worker.' using errcode = 'object_not_in_prerequisite_state';
  end if;
end;
$$;

create or replace function public.finish_pipeline_job(
  p_job_id uuid,
  p_owner text,
  p_ok boolean,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
begin
  select * into v_job from public.jobs
   where id = p_job_id
     and lease_owner = p_owner
     and status in ('leased', 'running')
   for update;

  if not found then
    raise exception 'This job is no longer leased by this worker.' using errcode = 'object_not_in_prerequisite_state';
  end if;

  update public.jobs
     set status = case
                    when p_ok then 'succeeded'::public.job_status
                    when attempts >= max_attempts then 'dead'::public.job_status
                    else 'queued'::public.job_status
                  end,
         progress = case when p_ok then 1 else progress end,
         lease_owner = null,
         lease_expires_at = null,
         error = case when p_ok then null else left(coalesce(p_error, 'pipeline failed'), 2000) end,
         finished_at = case when p_ok or attempts >= max_attempts then now() else finished_at end,
         scheduled_at = case when p_ok or attempts >= max_attempts then scheduled_at else now() + interval '5 minutes' end
   where id = p_job_id;

  if not p_ok and v_job.attempts >= v_job.max_attempts and v_job.run_id is not null then
    update public.runs
       set status = 'failed',
           error = left(coalesce(p_error, 'pipeline failed'), 2000),
           finished_at = now()
     where id = v_job.run_id;

    update public.screens
       set status = 'failed', qc = 'pending', updated_at = now()
     where id = (v_job.payload->>'screen_id')::uuid;

    insert into public.run_events (run_id, stage, level, message, data)
    values (
      v_job.run_id,
      'ingest',
      'error',
      'Pipeline job exhausted its retries.',
      jsonb_build_object('job_id', v_job.id, 'error', p_error)
    );
  end if;
end;
$$;

revoke all on function public.claim_pipeline_job(text, interval) from public, anon;
revoke all on function public.pipeline_job_heartbeat(uuid, text, numeric, interval) from public, anon;
revoke all on function public.finish_pipeline_job(uuid, text, boolean, text) from public, anon;

notify pgrst, 'reload schema';
