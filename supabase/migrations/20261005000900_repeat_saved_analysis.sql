-- A new run reuses reviewed immutable inputs. Previous runs remain available.
create or replace function public.start_screen_analysis(
  p_screen_id uuid,
  p_settings  jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_screen   public.screens;
  v_files    int;
  v_pending  int;
  v_control  int;
  v_treat    int;
  v_run_id   uuid;
  v_stage    text;
  v_position int := 0;
begin
  select * into v_screen from public.screens where id = p_screen_id for update;
  if not found then
    raise exception 'That screen no longer exists.' using errcode = 'no_data_found';
  end if;

  if not private.has_org_role(v_screen.org_id, 'member') then
    raise exception 'You do not have permission to start an analysis in this workspace.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_screen.status not in ('draft', 'failed', 'complete') then
    raise exception 'This screen is already %, so there is nothing to start.', v_screen.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  select count(*) filter (where status = 'complete'),
         count(*) filter (where status <> 'complete')
    into v_files, v_pending
    from public.screen_files
   where screen_id = p_screen_id;

  if v_files = 0 then
    raise exception 'Add at least one count table or FASTQ file before starting.'
      using errcode = 'check_violation';
  end if;
  if v_pending > 0 then
    raise exception 'Wait for every file to finish uploading. % have not.', v_pending
      using errcode = 'check_violation';
  end if;

  select count(*) filter (where role in ('control', 'reference', 'plasmid')),
         count(*) filter (where role = 'treatment')
    into v_control, v_treat
    from public.samples
   where screen_id = p_screen_id;

  if v_control = 0 or v_treat = 0 then
    raise exception 'Name at least one control or reference sample and at least one treated sample.'
      using errcode = 'check_violation';
  end if;

  if not exists (select 1 from public.comparisons where screen_id = p_screen_id and is_primary) then
    raise exception 'This screen has no primary contrast to test.' using errcode = 'check_violation';
  end if;

  insert into public.runs (screen_id, org_id, triggered_by, status, settings)
  values (p_screen_id, v_screen.org_id, auth.uid(), 'queued', coalesce(p_settings, '{}'::jsonb))
  returning id into v_run_id;

  -- Every stage exists from the start, queued, so the console shows the whole
  -- route rather than inventing one stage at a time.
  foreach v_stage in array array['ingest','detect','count','qc','hits','artifacts','atlas','score','report']
  loop
    insert into public.run_stages (run_id, stage, status, position)
    values (v_run_id, v_stage::public.pipeline_stage, 'queued', v_position);
    v_position := v_position + 1;
  end loop;

  -- The idempotency key is the run, so a double submit cannot queue the work
  -- twice even if two runs were somehow created.
  insert into public.jobs (run_id, org_id, kind, payload, status, priority, idempotency_key)
  values (
    v_run_id,
    v_screen.org_id,
    'pipeline',
    jsonb_build_object('run_id', v_run_id, 'screen_id', p_screen_id, 'org_id', v_screen.org_id),
    'queued',
    50,
    'pipeline:' || v_run_id::text
  );

  update public.screens
     set status = 'queued', current_run_id = v_run_id, qc = 'pending'
   where id = p_screen_id;

  insert into public.run_events (run_id, stage, level, message, data)
  values (v_run_id, 'ingest', 'info', 'Queued from the console.',
          jsonb_build_object('files', v_files, 'by', auth.uid()));

  return v_run_id;
end;
$$;
-- Retry a terminal failure with its saved design, preserving the previous run.
create or replace function public.retry_screen_analysis(p_screen_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_screen public.screens; v_settings jsonb;
begin
  select * into v_screen from public.screens where id=p_screen_id for update;
  if not found or not private.has_org_role(v_screen.org_id,'member') then raise exception 'This screen is not available to your workspace.'; end if;
  if v_screen.status not in ('failed','complete') then raise exception 'Only a completed or failed analysis can run again.'; end if;
  if exists(select 1 from public.jobs where run_id=v_screen.current_run_id and status in ('queued','leased','running')) then raise exception 'This analysis already has a retry queued.'; end if;
  select settings into v_settings from public.runs where id=v_screen.current_run_id;
  return public.start_screen_analysis(p_screen_id,v_settings||jsonb_build_object('rerun_of',v_screen.current_run_id));
end $$;
revoke all on function public.retry_screen_analysis(uuid) from public,anon;
grant execute on function public.retry_screen_analysis(uuid) to authenticated;
