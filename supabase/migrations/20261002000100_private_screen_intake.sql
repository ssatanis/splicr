-- ============================================================================
-- Private screen intake: a lab's own reads, from the browser to a queued run.
--
-- WHAT WAS ALREADY HERE
--
-- The data model for a private screen has existed since migration 0005:
-- screens, samples, screen_files, comparisons, runs, run_stages and jobs, with
-- the `uploads` storage bucket namespaced by organization in 0009, and RLS in
-- 0008 that already lets a member create a screen and its children. What was
-- missing was the one privileged step in the middle: nothing could put a job on
-- the queue, because `public.jobs` has a read policy and no write policy, on
-- purpose. Spending a workspace's compute is not something a browser INSERT
-- should be able to do by writing a row of its choosing.
--
-- So this migration adds the gate rather than a new table: one SECURITY DEFINER
-- function that checks the caller's role, checks that the screen is actually
-- analysable, and then creates the run, its stages and its job in one
-- transaction. A draft that fails a check raises a message a researcher can act
-- on, and nothing is queued.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--
-- It does not analyse anything. It creates a run in 'queued' and a job in
-- 'queued', which is exactly what the engine's own CLI path produces, and the
-- worker that leases that job is `process_private_screen` in engine/modal_app.py. A
-- screen whose job nobody leases stays visibly queued; it is never shown as
-- progressing.
-- ============================================================================

-- --- checksums --------------------------------------------------------------
-- screen_files carries checksum_md5 from the engine's own ENA fetch path, which
-- verifies against the MD5 the archive publishes. A browser upload has no such
-- published digest to compare against, so it records the SHA-256 the client
-- computed over the bytes it sent. The two coexist: they answer different
-- questions and neither is a substitute for the other.
alter table public.screen_files
  add column if not exists checksum_sha256 text;

comment on column public.screen_files.checksum_sha256 is
  'SHA-256 of the uploaded bytes, computed in the browser over the same File that was sent. '
  'Provenance for a private upload. checksum_md5 remains the archive-published digest for fetched reads.';

-- A member may remove a draft they are still assembling. Deleting a screen that
-- has run stays an admin action, because results other people have read should
-- not vanish on one person's say-so.
drop policy if exists "members delete their own drafts" on public.screens;
create policy "members delete their own drafts"
  on public.screens for delete to authenticated
  using (
    status = 'draft'
    and current_run_id is null
    and created_by = (select auth.uid())
    and (select private.has_org_role(org_id, 'member'))
  );

-- ---------------------------------------------------------------------------
-- The gate.
-- ---------------------------------------------------------------------------
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

  if v_screen.status not in ('draft', 'failed') then
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

revoke all on function public.start_screen_analysis(uuid, jsonb) from public, anon;
grant execute on function public.start_screen_analysis(uuid, jsonb) to authenticated;

comment on function public.start_screen_analysis(uuid, jsonb) is
  'Validate a draft screen and queue one run for it. The only path by which a browser '
  'session can create a job, which is why it is SECURITY DEFINER and re-checks the role.';

-- ---------------------------------------------------------------------------
-- What the console reads while a draft is being assembled and after it is
-- queued. security_invoker, so the screens policy decides the rows.
-- ---------------------------------------------------------------------------
create or replace view public.screen_intake
with (security_invoker = true) as
select
  s.id,
  s.org_id,
  s.name,
  s.status,
  s.source,
  s.modality,
  s.cell_line,
  s.phenotype,
  s.created_at,
  s.updated_at,
  s.created_by,
  s.current_run_id,
  l.name as library_name,
  (select count(*) from public.screen_files f where f.screen_id = s.id) as n_files,
  (select coalesce(sum(f.byte_size), 0) from public.screen_files f where f.screen_id = s.id) as bytes,
  (select count(*) from public.samples sm where sm.screen_id = s.id) as n_samples,
  r.status as run_status,
  (select count(*) from public.run_stages st where st.run_id = r.id and st.status = 'done') as stages_done
from public.screens s
left join atlas.libraries l on l.id = s.library_id
left join public.runs r on r.id = s.current_run_id
where s.source = 'upload';

grant select on public.screen_intake to authenticated;

comment on view public.screen_intake is
  'Uploaded screens with their file and sample counts, for the New analysis page.';

notify pgrst, 'reload schema';
