-- ============================================================================
-- Three defects in the screen workspace, fixed where they are caused.
--
-- 1. A SCREEN COULD REPORT TWO QC VERDICTS AT ONCE
--
-- public.screens.qc is a rollup of the current run's public.run_qc.verdict. It
-- was written once, by the engine, at the end of a run. Any run finished before
-- that rollup existed - and any run whose QC row arrived after it - left the
-- screen at the 'pending' default while run_qc said 'fail'. The console then
-- printed "QC pending" beside stage evidence reading "qc done, fail, NNMD
-- -2.63", which is not a cosmetic disagreement: it tells a reader a failed
-- screen has not been checked.
--
-- The rollup is now the database's job. A trigger on run_qc writes the verdict
-- onto whichever screen currently points at that run, and a trigger on screens
-- pulls the verdict whenever current_run_id moves. Neither depends on the
-- engine remembering to do it, so the two cannot drift again.
--
-- 2. READING ARTIFACT FLAGS TOOK SECONDS
--
-- The read policy on hit_flags was an EXISTS into hits calling a SECURITY
-- DEFINER function per row. For a single gene that is nothing. For the console,
-- which asks PostgREST to embed flags beside a page of hits and separately to
-- count every flagged gene in a 20,916-row run, it was measured at 2.9s for the
-- embed and 4.8s for the count, on every page load and every filter change. A
-- filter that answers in fifteen seconds is a filter a researcher believes is
-- broken.
--
-- The fix is to carry screen_id on the flag row. The policy becomes the same
-- array membership the hits policy uses, which Postgres evaluates once as an
-- InitPlan rather than once per row. A trigger fills the column, so the
-- engine's COPY keeps working unchanged.
--
-- 3. THE EFFECT PLOT COULD ONLY EVER SEE 1,000 GENES
--
-- PostgREST caps a collection response at 1,000 rows for this project, which
-- the client's .limit(40000) cannot raise. The plot therefore drew the first
-- 1,000 gene symbols alphabetically and said so in small type - so a
-- genome-wide comparison whose eleven significant genes are COG4, CDK2, CNOT4,
-- PARG and so on showed none of them, and reported "0 emphasised". That is a
-- plot that misrepresents the experiment.
--
-- A function returning one jsonb value is one row, so the cap does not apply.
-- screen_effect_points returns the whole comparison as parallel arrays, which
-- is both complete and about half the bytes of a row-per-gene encoding. It is
-- SECURITY INVOKER, so Row Level Security still decides what the caller sees.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · QC rollup, owned by the database
-- ---------------------------------------------------------------------------

create or replace function private.sync_screen_qc_from_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.screens s
     set qc = new.verdict, updated_at = now()
   where s.current_run_id = new.run_id
     and s.qc is distinct from new.verdict;
  return new;
end;
$$;

comment on function private.sync_screen_qc_from_run() is
  'Roll a run QC verdict onto the screen that currently points at that run.';

drop trigger if exists run_qc_rolls_up_to_screen on public.run_qc;
create trigger run_qc_rolls_up_to_screen
  after insert or update of verdict on public.run_qc
  for each row execute function private.sync_screen_qc_from_run();

create or replace function private.pull_screen_qc_from_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A screen with no current run has no verdict to show, and 'pending' is the
  -- honest answer. A screen that moves to a run with no QC row yet says the
  -- same thing rather than keeping the previous run's verdict.
  if new.current_run_id is null then
    new.qc := 'pending';
  else
    new.qc := coalesce(
      (select q.verdict from public.run_qc q where q.run_id = new.current_run_id),
      'pending'::public.qc_verdict);
  end if;
  return new;
end;
$$;

comment on function private.pull_screen_qc_from_run() is
  'Keep screens.qc equal to the current run''s recorded verdict whenever the run changes.';

drop trigger if exists screen_qc_follows_current_run on public.screens;
create trigger screen_qc_follows_current_run
  before insert or update of current_run_id on public.screens
  for each row execute function private.pull_screen_qc_from_run();

-- Repair every row the engine left behind, including the GSE145743 run that
-- showed "QC pending" over a failed NNMD.
update public.screens s
   set qc = coalesce(q.verdict, 'pending'::public.qc_verdict), updated_at = now()
  from public.runs r
  left join public.run_qc q on q.run_id = r.id
 where r.id = s.current_run_id
   and s.qc is distinct from coalesce(q.verdict, 'pending'::public.qc_verdict);

-- ---------------------------------------------------------------------------
-- 2 · Artifact flags readable without a per-row function call
-- ---------------------------------------------------------------------------

alter table public.hit_flags
  add column if not exists screen_id uuid references public.screens (id) on delete cascade;

create or replace function private.hit_flag_screen_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.screen_id is null then
    new.screen_id := (select h.screen_id from public.hits h where h.id = new.hit_id);
  end if;
  return new;
end;
$$;

comment on function private.hit_flag_screen_id() is
  'Carry the hit''s screen onto the flag so the read policy is an index lookup, not a join.';

drop trigger if exists hit_flags_carry_screen on public.hit_flags;
create trigger hit_flags_carry_screen
  before insert on public.hit_flags
  for each row execute function private.hit_flag_screen_id();

update public.hit_flags f
   set screen_id = h.screen_id
  from public.hits h
 where h.id = f.hit_id
   and f.screen_id is distinct from h.screen_id;

alter table public.hit_flags alter column screen_id set not null;

create index if not exists hit_flags_screen_ix on public.hit_flags (screen_id);

drop policy if exists "read hit flags" on public.hit_flags;
create policy "read hit flags" on public.hit_flags
  for select
  using (screen_id = any (array(select private.readable_screen_ids())));

-- ---------------------------------------------------------------------------
-- 3 · The whole comparison, in one response
-- ---------------------------------------------------------------------------

create or replace function public.screen_effect_points(p_screen uuid, p_comparison uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with point as (
    select h.gene_symbol,
           h.lfc,
           h.fdr,
           -- Bit 1: a stored guide-disagreement report exists, so the dot opens.
           -- Bit 2: the call turns on one guide. Bit 4: the guides disagree more
           -- than this screen's own norm. Absent bits mean "not recorded", never
           -- "checked and fine"; the console says so.
           (case when d.gene_symbol is null then 0 else 1 end)
         + (case when coalesce(d.fragile, false) then 2 else 0 end)
         + (case when coalesce(d.discordant, false) then 4 else 0 end) as marks
      from public.hits h
      left join public.gene_disagreement d
        on d.comparison_id = h.comparison_id
       and d.gene_symbol = upper(h.gene_symbol)
     where h.screen_id = p_screen
       and h.comparison_id = p_comparison
       and h.lfc is not null
     order by h.gene_symbol
  )
  select jsonb_build_object(
    'recorded', count(*),
    'gene',     coalesce(jsonb_agg(gene_symbol), '[]'::jsonb),
    'lfc',      coalesce(jsonb_agg(lfc), '[]'::jsonb),
    -- Null is kept as null. A gene with no recorded FDR is not FDR 1 and is
    -- certainly not FDR 0, and the plot draws it on its own labelled row.
    'fdr',      coalesce(jsonb_agg(fdr), '[]'::jsonb),
    'marks',    coalesce(jsonb_agg(marks), '[]'::jsonb)
  )
  from point;
$$;

comment on function public.screen_effect_points(uuid, uuid) is
  'Every recorded gene of one comparison as parallel arrays. One row, so the '
  'PostgREST collection cap cannot silently drop genes from the effect plot.';

revoke all on function public.screen_effect_points(uuid, uuid) from public;
grant execute on function public.screen_effect_points(uuid, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
