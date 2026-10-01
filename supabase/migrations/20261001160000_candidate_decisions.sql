-- ============================================================================
-- What a researcher decided about a candidate, and what they knew when they
-- decided it.
--
-- WHY IT IS A LOG AND NOT A COLUMN
--
-- A state on the hit row would answer "what does this lab think of PARG now".
-- The question worth answering is "what did they think when they chose it, and
-- what had they seen". Those come apart the moment the screen is reanalysed: a
-- new pipeline moves the FDR, and a status column silently becomes a claim
-- about evidence that no longer exists.
--
-- So every decision is a row, nothing is updated, and nothing is deleted. The
-- current state of a candidate is its most recent row. Changing a decision
-- appends another one, and both survive.
--
-- WHAT IS FROZEN
--
-- `evidence` holds the statistics, flags and Atlas counts as they stood at the
-- moment of the decision, with the run and engine version that produced them.
-- It is written on the server from the stored hit row, never from the client,
-- so it cannot be made to say something the run did not.
--
-- This is the record that lets SplicR eventually ask which kinds of candidate
-- survive validation. That question needs the evidence before the outcome, and
-- a column that the next pipeline run overwrites cannot provide it.
--
-- WHAT THE STATES DO NOT MEAN
--
-- They record what a person decided, not what is true. 'excluded' is a lab's
-- judgement about where to spend bench time; it is not a finding that the gene
-- has no phenotype. The console says so where the states are shown.
-- ============================================================================

create type public.candidate_state as enum (
  'shortlisted',     -- worth taking further
  'needs_validation',-- chosen for a follow-up experiment
  'hold',            -- interesting, not now
  'excluded',        -- not worth bench time, for the reason recorded
  'validated'        -- a bench outcome supported it; the outcome itself lives in validation_outcomes
);

create table public.candidate_decisions (
  id             uuid primary key default private.uuid_v7(),
  org_id         uuid not null references public.organizations (id) on delete cascade,
  screen_id      uuid not null references public.screens (id) on delete cascade,
  --  The run the decision was made against. Not the screen's current run: that
  --  moves, and the point of this row is that this one does not.
  run_id         uuid references public.runs (id) on delete set null,
  comparison_id  uuid references public.comparisons (id) on delete set null,
  gene_symbol    text not null,
  state          public.candidate_state not null,
  --  Why, in the researcher's own words. Optional: a decision with no reason is
  --  still a decision, and demanding prose produces prose nobody reads.
  reason         text,
  --  The evidence as it stood. Written server side from the stored hit row.
  evidence       jsonb not null default '{}'::jsonb,
  decided_by     uuid references auth.users (id) on delete set null,
  decided_at     timestamptz not null default now()
);

create index candidate_decisions_screen_ix
  on public.candidate_decisions (screen_id, gene_symbol, decided_at desc);
create index candidate_decisions_org_ix
  on public.candidate_decisions (org_id, decided_at desc);

alter table public.candidate_decisions enable row level security;

create policy "read candidate decisions" on public.candidate_decisions
  for select using (private.is_org_member(org_id));

create policy "record candidate decisions" on public.candidate_decisions
  for insert with check (
    decided_by = (select auth.uid())
    and private.has_org_role(org_id, 'member')
  );

--  No update policy and no delete policy, deliberately. A decision that can be
--  rewritten is not a record of what was decided. Changing your mind appends.

grant select, insert on public.candidate_decisions to authenticated;

-- ---------------------------------------------------------------------------
-- The current state of each candidate: the latest decision, and only that.
-- ---------------------------------------------------------------------------

create or replace view public.candidate_current
with (security_invoker = true) as
select distinct on (d.screen_id, d.gene_symbol)
       d.screen_id,
       d.gene_symbol,
       d.state,
       d.reason,
       d.decided_by,
       d.decided_at,
       d.id as decision_id,
       (select count(*) from public.candidate_decisions e
         where e.screen_id = d.screen_id and e.gene_symbol = d.gene_symbol) as n_decisions
  from public.candidate_decisions d
 order by d.screen_id, d.gene_symbol, d.decided_at desc, d.id desc;

grant select on public.candidate_current to authenticated;

notify pgrst, 'reload schema';
