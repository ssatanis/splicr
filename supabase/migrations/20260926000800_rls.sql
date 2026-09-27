-- ============================================================================
-- 0008 · Row Level Security for screens, runs, results and the Atlas
--
-- Rule of thumb: a row is visible if it belongs to an organization you are a
-- member of, or if the screen it hangs off is public. Writes go through the
-- engine (secret key, bypasses RLS); the browser only writes the things a
-- person edits by hand: screens, samples, comparisons, plans and outcomes.
-- ============================================================================

alter table public.screens             enable row level security;
alter table public.samples             enable row level security;
alter table public.screen_files        enable row level security;
alter table public.comparisons         enable row level security;
alter table public.runs                enable row level security;
alter table public.run_stages          enable row level security;
alter table public.run_artifacts       enable row level security;
alter table public.run_events          enable row level security;
alter table public.run_neighbors       enable row level security;
alter table public.jobs                enable row level security;
alter table public.guide_counts        enable row level security;
alter table public.sample_qc           enable row level security;
alter table public.run_qc              enable row level security;
alter table public.hits                enable row level security;
alter table public.hit_flags           enable row level security;
alter table public.validation_plans    enable row level security;
alter table public.validation_outcomes enable row level security;
alter table public.reports             enable row level security;
alter table public.score_models        enable row level security;
alter table public.calibration_bins    enable row level security;

-- Visibility helper: member of the owning org, or the screen is public.
create or replace function private.can_read_screen(p_screen_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.screens s
    where s.id = p_screen_id
      and (s.visibility = 'public' or private.is_org_member(s.org_id))
  );
$$;

create or replace function private.can_write_screen(p_screen_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.screens s
    where s.id = p_screen_id and private.has_org_role(s.org_id, 'member')
  );
$$;

grant execute on function private.can_read_screen(uuid) to authenticated, anon;
grant execute on function private.can_write_screen(uuid) to authenticated;

-- --- screens ----------------------------------------------------------------
create policy "read own org screens and public screens"
  on public.screens for select to authenticated, anon
  using (visibility = 'public' or (select private.is_org_member(org_id)));

create policy "members create screens"
  on public.screens for insert to authenticated
  with check ((select private.has_org_role(org_id, 'member')) and created_by = (select auth.uid()));

create policy "members update screens"
  on public.screens for update to authenticated
  using ((select private.has_org_role(org_id, 'member')))
  with check ((select private.has_org_role(org_id, 'member')));

create policy "admins delete screens"
  on public.screens for delete to authenticated
  using ((select private.has_org_role(org_id, 'admin')));

-- --- child tables keyed by screen_id ----------------------------------------
create policy "read samples" on public.samples for select to authenticated, anon
  using ((select private.can_read_screen(screen_id)));
create policy "write samples" on public.samples for all to authenticated
  using ((select private.can_write_screen(screen_id)))
  with check ((select private.can_write_screen(screen_id)));

create policy "read screen files" on public.screen_files for select to authenticated, anon
  using ((select private.can_read_screen(screen_id)));
create policy "write screen files" on public.screen_files for all to authenticated
  using ((select private.can_write_screen(screen_id)))
  with check ((select private.can_write_screen(screen_id)));

create policy "read comparisons" on public.comparisons for select to authenticated, anon
  using ((select private.can_read_screen(screen_id)));
create policy "write comparisons" on public.comparisons for all to authenticated
  using ((select private.can_write_screen(screen_id)))
  with check ((select private.can_write_screen(screen_id)));

create policy "read guide counts" on public.guide_counts for select to authenticated, anon
  using ((select private.can_read_screen(screen_id)));

create policy "read hits" on public.hits for select to authenticated, anon
  using ((select private.can_read_screen(screen_id)));

create policy "read reports" on public.reports for select to authenticated, anon
  using ((select private.can_read_screen(screen_id)));

-- --- runs and their children -------------------------------------------------
create policy "read runs" on public.runs for select to authenticated, anon
  using ((select private.can_read_screen(screen_id)));

create policy "members trigger runs" on public.runs for insert to authenticated
  with check ((select private.can_write_screen(screen_id)) and triggered_by = (select auth.uid()));

create policy "read run stages" on public.run_stages for select to authenticated, anon
  using (exists (select 1 from public.runs r where r.id = run_id and (select private.can_read_screen(r.screen_id))));

create policy "read run artifacts" on public.run_artifacts for select to authenticated, anon
  using (exists (select 1 from public.runs r where r.id = run_id and (select private.can_read_screen(r.screen_id))));

create policy "read run events" on public.run_events for select to authenticated, anon
  using (exists (select 1 from public.runs r where r.id = run_id and (select private.can_read_screen(r.screen_id))));

create policy "read run neighbors" on public.run_neighbors for select to authenticated, anon
  using (exists (select 1 from public.runs r where r.id = run_id and (select private.can_read_screen(r.screen_id))));

create policy "read sample qc" on public.sample_qc for select to authenticated, anon
  using (exists (select 1 from public.runs r where r.id = run_id and (select private.can_read_screen(r.screen_id))));

create policy "read run qc" on public.run_qc for select to authenticated, anon
  using (exists (select 1 from public.runs r where r.id = run_id and (select private.can_read_screen(r.screen_id))));

create policy "read hit flags" on public.hit_flags for select to authenticated, anon
  using (exists (select 1 from public.hits h where h.id = hit_id and (select private.can_read_screen(h.screen_id))));

-- Jobs are operational: members of the owning org may watch them.
create policy "read jobs" on public.jobs for select to authenticated
  using (org_id is not null and (select private.is_org_member(org_id)));

-- --- Truth Loop --------------------------------------------------------------
create policy "read validation plans" on public.validation_plans for select to authenticated
  using ((select private.is_org_member(org_id)));
create policy "write validation plans" on public.validation_plans for all to authenticated
  using ((select private.has_org_role(org_id, 'member')))
  with check ((select private.has_org_role(org_id, 'member')));

create policy "read outcomes" on public.validation_outcomes for select to authenticated
  using ((select private.is_org_member(org_id)));
create policy "log outcomes" on public.validation_outcomes for insert to authenticated
  with check ((select private.has_org_role(org_id, 'member')) and logged_by = (select auth.uid()));
create policy "amend outcomes" on public.validation_outcomes for update to authenticated
  using ((select private.has_org_role(org_id, 'member')))
  with check ((select private.has_org_role(org_id, 'member')));
create policy "delete outcomes" on public.validation_outcomes for delete to authenticated
  using ((select private.has_org_role(org_id, 'admin')));

-- --- models ------------------------------------------------------------------
create policy "read global and own models" on public.score_models for select to authenticated
  using (org_id is null or (select private.is_org_member(org_id)));

create policy "read calibration" on public.calibration_bins for select to authenticated
  using (org_id is null or (select private.is_org_member(org_id)));

-- ============================================================================
-- Atlas: readable by everyone, including signed-out visitors.
-- Custom libraries are the exception.
-- ============================================================================
grant usage on schema atlas to anon, authenticated;
grant select on all tables in schema atlas to anon, authenticated;
alter default privileges in schema atlas grant select on tables to anon, authenticated;

alter table atlas.genes               enable row level security;
alter table atlas.libraries           enable row level security;
alter table atlas.guides              enable row level security;
alter table atlas.gene_sets           enable row level security;
alter table atlas.gene_set_members    enable row level security;
alter table atlas.cell_models         enable row level security;
alter table atlas.copy_number         enable row level security;
alter table atlas.screens             enable row level security;
alter table atlas.screen_hits         enable row level security;
alter table atlas.gene_stats          enable row level security;
alter table atlas.validation_records  enable row level security;

create policy "atlas genes are public" on atlas.genes for select to anon, authenticated using (true);
create policy "atlas gene sets are public" on atlas.gene_sets for select to anon, authenticated using (true);
create policy "atlas gene set members are public" on atlas.gene_set_members for select to anon, authenticated using (true);
create policy "atlas cell models are public" on atlas.cell_models for select to anon, authenticated using (true);
create policy "atlas copy number is public" on atlas.copy_number for select to anon, authenticated using (true);
create policy "atlas screens are public" on atlas.screens for select to anon, authenticated using (true);
create policy "atlas screen hits are public" on atlas.screen_hits for select to anon, authenticated using (true);
create policy "atlas gene stats are public" on atlas.gene_stats for select to anon, authenticated using (true);
create policy "atlas validation records are public" on atlas.validation_records for select to anon, authenticated using (true);

create policy "public libraries and own custom libraries"
  on atlas.libraries for select to anon, authenticated
  using (org_id is null or (select private.is_org_member(org_id)));

create policy "members manage custom libraries"
  on atlas.libraries for all to authenticated
  using (org_id is not null and (select private.has_org_role(org_id, 'member')))
  with check (org_id is not null and (select private.has_org_role(org_id, 'member')));

create policy "guides follow their library"
  on atlas.guides for select to anon, authenticated
  using (exists (
    select 1 from atlas.libraries l
    where l.id = library_id and (l.org_id is null or private.is_org_member(l.org_id))
  ));

create policy "members manage custom guides"
  on atlas.guides for all to authenticated
  using (exists (select 1 from atlas.libraries l where l.id = library_id and l.org_id is not null and private.has_org_role(l.org_id, 'member')))
  with check (exists (select 1 from atlas.libraries l where l.id = library_id and l.org_id is not null and private.has_org_role(l.org_id, 'member')));
