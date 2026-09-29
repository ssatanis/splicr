-- ============================================================================
-- 0018 · Performance advisor fixes and the guide_counts read timeout
--
-- Found while verifying 0017: `GET /rest/v1/guide_counts` as anon failed with
-- 57014 (statement timeout). The read policy called
-- private.can_read_screen(screen_id) once per row, so a request that could see
-- nothing still evaluated a function over ~1.5 million rows. The policies on the
-- screen-keyed tables now compare screen_id against one set of readable screen
-- ids, computed once per statement as a hashed subplan. Who can read what is
-- unchanged: the set is exactly the screens can_read_screen() accepts.
--
-- Also closes these advisor findings:
--   auth_rls_initplan             org_invites "admins read invites"
--   multiple_permissive_policies  write policies declared FOR ALL overlapped the
--                                 SELECT policy; split into insert/update/delete
--   unindexed_foreign_keys        26 covering indexes
--   rls_enabled_no_policy         explicit deny policy on each guide_counts
--                                 partition, so the intent is stated in the schema
--
-- Deliberately left: `unused_index` (INFO). The statistics restarted when the
-- project was restored on 2026-09-29, and those indexes back queries the app
-- and engine issue (symbol lookup, job leasing, Atlas similarity).
-- ============================================================================

-- --- readable screens, once per statement ------------------------------------
create or replace function private.readable_screen_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id from public.screens s
  where s.visibility = 'public' or private.is_org_member(s.org_id);
$$;

revoke all on function private.readable_screen_ids() from public;
grant execute on function private.readable_screen_ids() to anon, authenticated;

alter policy "read guide counts" on public.guide_counts
  using (screen_id in (select private.readable_screen_ids()));
alter policy "read hits" on public.hits
  using (screen_id in (select private.readable_screen_ids()));
alter policy "read reports" on public.reports
  using (screen_id in (select private.readable_screen_ids()));
alter policy "read runs" on public.runs
  using (screen_id in (select private.readable_screen_ids()));
alter policy "read samples" on public.samples
  using (screen_id in (select private.readable_screen_ids()));
alter policy "read comparisons" on public.comparisons
  using (screen_id in (select private.readable_screen_ids()));
alter policy "read screen files" on public.screen_files
  using (screen_id in (select private.readable_screen_ids()));

-- --- auth_rls_initplan ---------------------------------------------------------
alter policy "admins read invites" on public.org_invites
  using (
    (select private.has_org_role(org_id, 'admin'))
    or lower(email) = lower((select auth.jwt()) ->> 'email')
  );

-- --- multiple_permissive_policies: FOR ALL -> insert / update / delete ---------
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('public', 'comparisons',      'write comparisons',
         '(select private.can_write_screen(screen_id))'),
      ('public', 'samples',          'write samples',
         '(select private.can_write_screen(screen_id))'),
      ('public', 'screen_files',     'write screen files',
         '(select private.can_write_screen(screen_id))'),
      ('public', 'validation_plans', 'write validation plans',
         '(select private.has_org_role(org_id, ''member''))'),
      ('atlas',  'libraries',        'members manage custom libraries',
         '(org_id is not null and (select private.has_org_role(org_id, ''member'')))'),
      ('atlas',  'guides',           'members manage custom guides',
         '(exists (select 1 from atlas.libraries l where l.id = library_id and l.org_id is not null and (select private.has_org_role(l.org_id, ''member''))))')
    ) as v(schema_name, table_name, policy_name, expr)
  loop
    execute format('drop policy if exists %I on %I.%I', t.policy_name, t.schema_name, t.table_name);
    execute format('create policy %I on %I.%I for insert to authenticated with check (%s)',
                   t.policy_name || ' (insert)', t.schema_name, t.table_name, t.expr);
    execute format('create policy %I on %I.%I for update to authenticated using (%s) with check (%s)',
                   t.policy_name || ' (update)', t.schema_name, t.table_name, t.expr, t.expr);
    execute format('create policy %I on %I.%I for delete to authenticated using (%s)',
                   t.policy_name || ' (delete)', t.schema_name, t.table_name, t.expr);
  end loop;
end;
$$;

-- --- rls_enabled_no_policy: say "no direct access" out loud --------------------
do $$
declare
  part regclass;
begin
  for part in
    select inhrelid::regclass from pg_catalog.pg_inherits
     where inhparent = 'public.guide_counts'::regclass
  loop
    execute format(
      'create policy "no direct partition access" on %s as restrictive for all '
      'to anon, authenticated using (false) with check (false)', part);
  end loop;
end;
$$;

-- --- unindexed_foreign_keys ------------------------------------------------------
create index if not exists api_keys_created_by_ix            on public.api_keys (created_by);
create index if not exists copy_number_gene_ix               on atlas.copy_number (gene_id);
create index if not exists gene_stats_gene_ix                on atlas.gene_stats (gene_id);
create index if not exists validation_records_gene_ix        on atlas.validation_records (gene_id);
create index if not exists validation_records_reviewed_by_ix on atlas.validation_records (reviewed_by);
create index if not exists calibration_bins_org_ix           on public.calibration_bins (org_id);
create index if not exists hits_gene_id_ix                   on public.hits (gene_id);
create index if not exists jobs_org_ix                       on public.jobs (org_id);
create index if not exists org_invites_invited_by_ix         on public.org_invites (invited_by);
create index if not exists org_members_invited_by_ix         on public.org_members (invited_by);
create index if not exists organizations_created_by_ix       on public.organizations (created_by);
create index if not exists profiles_default_org_ix           on public.profiles (default_org_id);
create index if not exists reports_org_ix                    on public.reports (org_id);
create index if not exists reports_created_by_ix             on public.reports (created_by);
create index if not exists run_neighbors_atlas_screen_ix     on public.run_neighbors (atlas_screen_id);
create index if not exists runs_triggered_by_ix              on public.runs (triggered_by);
create index if not exists sample_qc_sample_ix               on public.sample_qc (sample_id);
create index if not exists score_models_org_ix               on public.score_models (org_id);
create index if not exists screens_cell_model_ix             on public.screens (cell_model_id);
create index if not exists screens_created_by_ix             on public.screens (created_by);
create index if not exists screens_current_run_ix            on public.screens (current_run_id);
create index if not exists validation_outcomes_plan_ix       on public.validation_outcomes (plan_id);
create index if not exists validation_outcomes_logged_by_ix  on public.validation_outcomes (logged_by);
create index if not exists validation_outcomes_hit_ix        on public.validation_outcomes (hit_id);
create index if not exists validation_plans_org_ix           on public.validation_plans (org_id);
create index if not exists validation_plans_created_by_ix    on public.validation_plans (created_by);
