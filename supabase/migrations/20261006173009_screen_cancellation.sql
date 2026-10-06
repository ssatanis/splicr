-- Save the exact invocation so cancellation stops the actual Modal container.
alter table public.jobs add column modal_call_id text,
  add column modal_cancelled_at timestamptz;
create index jobs_modal_cancel_pending_ix on public.jobs (updated_at)
  where kind = 'pipeline' and status = 'canceled' and modal_cancelled_at is null;

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
    when new.status = 'canceled' then 'canceled'::public.run_status
    when new.status = 'succeeded' then 'complete'::public.run_status
    when new.status in ('dead', 'failed') then 'failed'::public.run_status
    else 'queued'::public.run_status end;
  if new.status = 'canceled' then
    update public.run_stages set status = 'failed', finished_at = now(), detail = 'Analysis canceled'
    where run_id = new.run_id and status = 'running';
  end if;
  update public.runs set status = v_status,
    started_at = case when v_status = 'running' then coalesce(started_at, now()) else started_at end,
    finished_at = case when v_status in ('complete', 'failed', 'canceled') then coalesce(new.finished_at, now()) else null end,
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

-- Cancellation is a workspace-authorized operation, not a worker control.
create function public.cancel_screen_analysis(p_screen_id uuid, p_run_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_job public.jobs; v_status public.run_status;
begin
  select org_id into v_org from public.screens
  where id = p_screen_id and current_run_id = p_run_id;
  if auth.uid() is null or v_org is null or not private.has_org_role(v_org, 'member') then
    raise exception 'Analysis not found or cancellation is not permitted.' using errcode = '42501';
  end if;
  -- Same lock order as worker completion: job, then run.
  select * into v_job from public.jobs where run_id = p_run_id and kind = 'pipeline' for update;
  select status into v_status from public.runs where id = p_run_id and screen_id = p_screen_id for update;
  if v_status = 'canceled' then return p_run_id; end if;
  if v_status not in ('queued', 'running') then return null; end if;
  if v_job.id is null then
    raise exception 'The analysis has no worker job.' using errcode = '55000';
  end if;
  update public.jobs set status = 'canceled', finished_at = now(),
    lease_owner = null, lease_expires_at = null, error = null where id = v_job.id;
  insert into public.run_events (run_id, level, message, data)
  values (p_run_id, 'info', 'Analysis canceled by a workspace researcher.',
    jsonb_build_object('user_id', auth.uid(), 'job_id', v_job.id));
  return p_run_id;
end;
$$;
revoke all on function public.cancel_screen_analysis(uuid, uuid) from public, anon;
grant execute on function public.cancel_screen_analysis(uuid, uuid) to authenticated;

-- A late worker must never resurrect or publish into a canceled run.
create function private.keep_run_canceled() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'canceled' and new.status <> 'canceled' then
    raise exception 'Analysis canceled.' using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger run_cancellation_fence before update of status on public.runs
for each row execute function private.keep_run_canceled();

create function private.reject_canceled_run_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_status public.run_status;
begin
  -- Hold this lock through commit: cancellation and a final publish serialize.
  select status into v_status from public.runs where id = new.run_id for share;
  if v_status = 'canceled' then
    raise exception 'Analysis canceled.' using errcode = '55000';
  end if;
  return new;
end;
$$;
do $$
declare t text;
begin
  foreach t in array array['run_stages','guide_counts','sample_qc','run_qc','hits',
    'run_neighbors','reports','run_artifacts','guide_effects','gene_disagreement','validation_predictions'] loop
    execute format('create trigger canceled_run_write before insert or update on public.%I for each row execute function private.reject_canceled_run_write()', t);
  end loop;
end;
$$;
revoke all on function private.keep_run_canceled() from public, anon, authenticated;
revoke all on function private.reject_canceled_run_write() from public, anon, authenticated;
notify pgrst, 'reload schema';
