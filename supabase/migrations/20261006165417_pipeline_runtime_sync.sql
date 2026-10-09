-- The durable job lease owns private-run activity, including downloads,
-- retries and expired leases. A screen cannot claim to run without a worker.
create or replace function private.sync_pipeline_job_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_status public.run_status;
begin
  if new.kind <> 'pipeline' or new.run_id is null then return new; end if;
  v_status := case
    when new.status in ('leased', 'running') then 'running'::public.run_status
    when new.status = 'succeeded' then 'complete'::public.run_status
    when new.status in ('dead', 'failed') then 'failed'::public.run_status
    else 'queued'::public.run_status end;
  update public.runs set status = v_status,
    started_at = case when v_status = 'running' then coalesce(started_at, now()) else started_at end,
    finished_at = case when v_status in ('complete', 'failed') then coalesce(new.finished_at, now()) else null end,
    error = case when v_status = 'failed' then new.error else null end
  where id = new.run_id;
  update public.screens set status = v_status::text::public.screen_status, updated_at = now()
  where current_run_id = new.run_id;
  if new.status = 'leased' then
    update public.run_stages set status = 'queued', started_at = null,
      finished_at = null, detail = null where run_id = new.run_id;
    update public.run_stages set status = 'running', started_at = now(),
      detail = 'Downloading and verifying uploaded inputs'
    where run_id = new.run_id and stage = 'ingest';
  elsif new.status = 'queued' then
    update public.run_stages set status = 'queued', started_at = null,
      finished_at = null, detail = null where run_id = new.run_id;
  elsif v_status = 'failed' then
    update public.run_stages set status = 'failed', finished_at = now(),
      detail = coalesce(new.error, 'Worker stopped after exhausting retries')
    where run_id = new.run_id and status = 'running';
  end if;
  return new;
end;
$$;
revoke all on function private.sync_pipeline_job_activity() from public, anon, authenticated;
create trigger pipeline_job_activity after update of status on public.jobs
for each row when (old.status is distinct from new.status)
execute function private.sync_pipeline_job_activity();

-- Worker controls must never be executable by a signed-in browser.
revoke all on function public.claim_pipeline_job(text, interval) from authenticated;
revoke all on function public.pipeline_job_heartbeat(uuid, text, numeric, interval) from authenticated;
revoke all on function public.finish_pipeline_job(uuid, text, boolean, text) from authenticated;
grant execute on function public.claim_pipeline_job(text, interval) to service_role;
grant execute on function public.pipeline_job_heartbeat(uuid, text, numeric, interval) to service_role;
grant execute on function public.finish_pipeline_job(uuid, text, boolean, text) to service_role;

notify pgrst, 'reload schema';
