-- ============================================================================
-- The SplicR Validation Network
--
-- WHAT THIS IS FOR
--
-- `validation_outcomes` already records that somebody put a gene back on a
-- plate and what happened. It cannot say *which experiment* that was, and that
-- single missing column is the difference between a dataset a model can learn
-- from and a dataset it cannot.
--
-- A CRISPR hit can validate genetically and fail pharmacologically. PRKDC in
-- doi:10.1158/0008-5472.CAN-24-0775 did exactly that: individual gRNAs reduced
-- organoid growth, and LTURM34 and AZD7648 showed no potent activity at the
-- tested concentrations. Under the old shape both facts are rows reading
-- 'validated' and 'failed' for the same gene, and nothing distinguishes a
-- genuine disagreement between assay classes from a contradiction.
--
-- So an outcome now names its validation type, the endpoint it was scored
-- against, the version of that endpoint, the laboratory that ran it, the arm of
-- the validation set it was drawn from, and the measurement itself. Those are
-- the fields that make it a training example rather than an anecdote.
--
-- WHAT IS DELIBERATELY NOT HERE
--
-- No `validation_probability` column on `hits`. A probability is a function of
-- a cohort and a stratum, and a column would let one get written without
-- either. Estimates live in `validation_predictions`, each one carrying the
-- cohort that licensed it and the version of the head that produced it, and a
-- candidate outside the calibrated cohort gets a row that says so rather than
-- a null somebody can mistake for zero.
--
-- And no model artefacts. The cohort is the asset and the model is derived from
-- it; `validation_models` records what was fitted, its metrics and the hash of
-- the cohort it was fitted on, so a claim can be re-derived by anybody holding
-- that cohort. A pickle nobody can read is not evidence.
--
-- APPEND-ONLY WHERE IT MATTERS
--
-- `prediction_receipts` has no update and no delete policy. A receipt that can
-- be rewritten is not a commitment, and the whole value of the prospective
-- design is that the prediction cannot be edited after the answer arrives.
-- `validation_rounds` moves forward only, enforced by a trigger rather than by
-- application code, because the application is not the only thing that can
-- write to this database.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Vocabulary. Every one of these mirrors a tuple in
-- engine/splicr/validation/, and apps/web/tests/validation-contract.test.mjs
-- fails when the three drift apart.
-- ---------------------------------------------------------------------------

-- What was done at the bench.
create type public.validation_type as enum (
  'independent_guide', 'independent_guide_set', 'crispri', 'crispra', 'rescue',
  'orthogonal_genetic', 'small_molecule', 'another_model', 'organoid',
  'in_vivo', 'other'
);

-- The four questions. They never share a number.
create type public.validation_question as enum (
  'reproduces', 'target_specific', 'cross_model', 'pharmacologic'
);

-- Which cohort an outcome joins.
create type public.assay_class as enum (
  'ko_fitness', 'drug_modifier', 'reporter', 'organoid_growth',
  'in_vivo_growth', 'other'
);
create type public.phenotype_family as enum (
  'fitness', 'drug_resistance', 'drug_sensitisation', 'reporter',
  'differentiation', 'other'
);
create type public.model_type as enum (
  'cancer_cell_line', 'immortalised_line', 'primary_cell', 'organoid',
  'ipsc_derived', 'in_vivo', 'other'
);

-- Which selection strategy proposed the candidate. 'unassigned' is honest
-- about every outcome recorded before any round existed.
create type public.validation_arm as enum (
  'splicr', 'fdr', 'investigator', 'random', 'unassigned'
);

-- A round goes forwards only.
create type public.round_state as enum ('draft', 'frozen', 'revealed');

-- The result of scoring a record against an endpoint. 'insufficient_record' is
-- the fifth state that exists nowhere else: it means this record cannot be
-- scored, which is neither a failure nor an inconclusive result. Collapsing it
-- into either would put an unmeasured experiment into a rate.
create type public.endpoint_decision as enum (
  'validated', 'failed', 'inconclusive', 'insufficient_record'
);

-- A rung of the validation ladder.
create type public.rung_state as enum ('met', 'not_met', 'mixed', 'not_tested');

-- ---------------------------------------------------------------------------
-- The endpoint registry, mirrored from the engine so the console can read it
-- without running Python, and so a receipt can point at a row.
-- ---------------------------------------------------------------------------
create table public.validation_endpoints (
  endpoint_id   text not null,
  version       int  not null,
  label         text not null,
  question      public.validation_question not null,
  assay_class   public.assay_class not null,
  validation_types public.validation_type[] not null,
  --  Who owns the effect threshold. 'laboratory' for every arrayed endpoint,
  --  because the effect size that counts as a response in one organoid assay is
  --  not the one that counts in another, and a global cut would silently
  --  relabel other people's experiments.
  threshold_owner text not null check (threshold_owner in ('laboratory', 'splicr', 'published')),
  direction     text not null check (direction in ('depleted', 'enriched', 'either')),
  effect_metric text not null,
  effect_threshold real,
  requires_independent_perturbation boolean not null default true,
  requires_distinct_constructs boolean not null default false,
  min_independent_perturbations int not null default 1 check (min_independent_perturbations >= 1),
  min_biological_replicates int not null default 2 check (min_biological_replicates >= 1),
  control_criteria text[] not null default '{}',
  --  What a negative result on this endpoint does and does not mean. Shown next
  --  to every outcome scored against it, because the pharmacologic endpoint is
  --  the one most often misread as falsifying the genetic hit.
  negative_means text not null default '',
  published_example jsonb,
  notes         text not null default '',
  --  sha256 of the canonical definition. A receipt pins this, so a prediction
  --  frozen under one rule cannot be scored as if it had been made under
  --  another.
  definition_sha256 text not null check (definition_sha256 ~ '^[0-9a-f]{64}$'),
  created_at    timestamptz not null default now(),
  primary key (endpoint_id, version),
  --  A laboratory-owned threshold must not be fixed here.
  constraint endpoints_threshold_owner_ck
    check (threshold_owner <> 'laboratory' or effect_threshold is null)
);

comment on table public.validation_endpoints is
  'What "validated" means, per assay class, written down before outcomes are collected. Mirrors engine/splicr/validation/endpoints.py; the engine is the source of truth and this table is its projection.';

-- Readable by every signed-in user: the rules are not anybody's private data,
-- and a reader has to be able to see the criterion their outcome was judged by.
alter table public.validation_endpoints enable row level security;
create policy "read validation endpoints" on public.validation_endpoints
  for select to authenticated using (true);
grant select on public.validation_endpoints to authenticated;

-- ---------------------------------------------------------------------------
-- Blinded rounds
-- ---------------------------------------------------------------------------
create table public.validation_rounds (
  id            uuid primary key default private.uuid_v7(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  screen_id     uuid not null references public.screens (id) on delete cascade,
  run_id        uuid references public.runs (id) on delete set null,
  comparison_id uuid references public.comparisons (id) on delete set null,
  name          text not null,
  state         public.round_state not null default 'draft',

  --  The design, as the cohort builder produced it.
  design        text not null default 'stratified_arms'
                  check (design in ('stratified_arms', 'rank_stratified')),
  budget        int not null check (budget >= 1),
  --  The endpoint the laboratory agreed to, and their own effect bar for it.
  --  Agreed at creation, which is the only time it can be agreed without
  --  knowing the answer.
  endpoint_id   text,
  endpoint_version int,
  laboratory_threshold real,
  --  Seeds the shuffle of the bench's blind list, so an auditor can reproduce
  --  the order and see it was not the ranking order.
  blind_seed    bigint not null default 20261003,

  --  Set on freeze, and only on freeze.
  receipt_sha256 text check (receipt_sha256 ~ '^[0-9a-f]{64}$'),
  frozen_at     timestamptz,
  frozen_by     uuid references auth.users (id) on delete set null,
  revealed_at   timestamptz,
  revealed_by   uuid references auth.users (id) on delete set null,

  notes         text,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  foreign key (endpoint_id, endpoint_version)
    references public.validation_endpoints (endpoint_id, version),
  --  A frozen round has a receipt. Anything else is a round that claims to
  --  have committed to a prediction without committing to one.
  constraint rounds_frozen_needs_receipt
    check (state = 'draft' or (receipt_sha256 is not null and frozen_at is not null)),
  constraint rounds_revealed_needs_freeze
    check (state <> 'revealed' or revealed_at is not null)
);

create index validation_rounds_org_ix on public.validation_rounds (org_id, created_at desc);
create index validation_rounds_screen_ix on public.validation_rounds (screen_id, created_at desc);

create trigger validation_rounds_touch before update on public.validation_rounds
  for each row execute function private.set_updated_at();

-- A round moves draft -> frozen -> revealed and never back, and a frozen
-- round's design is fixed. Enforced here rather than in the application,
-- because the application is not the only thing that can write to this
-- database and "we only ever call the server action" is not a guarantee.
create or replace function private.validation_round_forward_only()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.state = 'revealed' and new.state <> 'revealed' then
    raise exception 'round % has been revealed; a revealed round cannot be reopened', old.id;
  end if;
  if old.state = 'frozen' and new.state = 'draft' then
    raise exception 'round % is frozen; a changed design is a new round', old.id;
  end if;
  if old.state <> 'draft' then
    if new.receipt_sha256 is distinct from old.receipt_sha256 then
      raise exception 'round % is %; its receipt hash cannot change', old.id, old.state;
    end if;
    if new.budget is distinct from old.budget
       or new.design is distinct from old.design
       or new.endpoint_id is distinct from old.endpoint_id
       or new.endpoint_version is distinct from old.endpoint_version
       or new.laboratory_threshold is distinct from old.laboratory_threshold
       or new.blind_seed is distinct from old.blind_seed then
      raise exception 'round % is %; its design was committed and cannot change', old.id, old.state;
    end if;
  end if;
  return new;
end;
$$;

create trigger validation_rounds_forward_only before update on public.validation_rounds
  for each row execute function private.validation_round_forward_only();

alter table public.validation_rounds enable row level security;
create policy "read validation rounds" on public.validation_rounds
  for select to authenticated using ((select private.is_org_member(org_id)));
create policy "create validation rounds" on public.validation_rounds
  for insert to authenticated
  with check ((select private.has_org_role(org_id, 'member'))
              and created_by = (select auth.uid()));
create policy "advance validation rounds" on public.validation_rounds
  for update to authenticated
  using ((select private.has_org_role(org_id, 'member')))
  with check ((select private.has_org_role(org_id, 'member')));
--  Deleting a draft is tidying up. Deleting a frozen round would destroy the
--  commitment it exists to hold, so only a draft can go.
create policy "delete a draft round" on public.validation_rounds
  for delete to authenticated
  using ((select private.has_org_role(org_id, 'admin')) and state = 'draft');

grant select, insert, update, delete on public.validation_rounds to authenticated;

-- ---------------------------------------------------------------------------
-- The frozen validation set: which candidate, which arm, why it was drawn
-- ---------------------------------------------------------------------------
create table public.validation_slots (
  id            uuid primary key default private.uuid_v7(),
  round_id      uuid not null references public.validation_rounds (id) on delete cascade,
  org_id        uuid not null references public.organizations (id) on delete cascade,
  gene_symbol   text not null,
  arm           public.validation_arm not null,
  --  The stratum the design drew it from: 'top_20', 'p25', an arm name.
  stratum       text not null,
  rank_in_arm   int not null,
  --  Every arm that wanted this candidate before deduplication. A candidate
  --  three strategies agreed on cost one validation, and this is how a later
  --  comparison knows that.
  wanted_by     public.validation_arm[] not null default '{}',
  --  The candidate's rank in the full ranking, and the evidence as it stood.
  --  Written server side from the stored hit row, never from a client, and
  --  never after the outcome is known.
  rank_overall  int,
  evidence      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  unique (round_id, gene_symbol)
);

create index validation_slots_round_ix on public.validation_slots (round_id, arm);
create index validation_slots_gene_ix on public.validation_slots (org_id, gene_symbol);

alter table public.validation_slots enable row level security;
create policy "read validation slots" on public.validation_slots
  for select to authenticated using ((select private.is_org_member(org_id)));
create policy "write validation slots" on public.validation_slots
  for insert to authenticated
  with check ((select private.has_org_role(org_id, 'member')));
--  No update and no delete once the round is frozen: the set cannot grow or
--  shrink after the freeze, or it would grow to include whatever worked.
create policy "delete slots on a draft round" on public.validation_slots
  for delete to authenticated
  using ((select private.has_org_role(org_id, 'member'))
         and exists (select 1 from public.validation_rounds r
                      where r.id = round_id and r.state = 'draft'));

grant select, insert, delete on public.validation_slots to authenticated;

-- A slot cannot be added to a frozen round. The RLS insert policy cannot see
-- the round's state cheaply enough to be the only check, so this is a trigger.
create or replace function private.validation_slot_before_freeze()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current public.round_state;
begin
  select state into current from public.validation_rounds where id = new.round_id;
  if current is null then
    raise exception 'no such validation round: %', new.round_id;
  end if;
  if current <> 'draft' then
    raise exception 'round % is %; its validation set was committed and cannot grow',
      new.round_id, current;
  end if;
  return new;
end;
$$;

create trigger validation_slots_before_freeze before insert on public.validation_slots
  for each row execute function private.validation_slot_before_freeze();

-- ---------------------------------------------------------------------------
-- Prediction receipts: append-only, by policy and by the absence of policies
-- ---------------------------------------------------------------------------
create table public.prediction_receipts (
  id            uuid primary key default private.uuid_v7(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  round_id      uuid not null references public.validation_rounds (id) on delete cascade,
  --  The hash is the commitment. Unique, because two different payloads with
  --  one hash would mean sha256 is broken and one payload stored twice under
  --  one hash is a duplicate rather than a second receipt.
  sha256        text not null unique check (sha256 ~ '^[0-9a-f]{64}$'),
  --  The whole payload: the candidate universe, every rank, the frozen
  --  evidence, the model and calibrator manifests, the coverage decision, the
  --  endpoint hash and the engine revision. There is no outcome field, and the
  --  engine refuses to build a payload that carries one at any depth.
  payload       jsonb not null,
  n_candidates  int not null check (n_candidates >= 1),
  n_selected    int not null check (n_selected >= 1),
  engine_schema text not null,
  feature_spec_sha256 text not null check (feature_spec_sha256 ~ '^[0-9a-f]{64}$'),
  endpoint_registry_sha256 text not null check (endpoint_registry_sha256 ~ '^[0-9a-f]{64}$'),
  git_revision  text,
  git_dirty     boolean,
  --  Said out loud in the row, not only in a README: a database row proves
  --  content, not time. An independent custodian has to hold the hash.
  timestamp_trust text not null default
    'local content commitment; an independent custodian must retain the hash for this to evidence timing',
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index prediction_receipts_round_ix on public.prediction_receipts (round_id);
create index prediction_receipts_org_ix on public.prediction_receipts (org_id, created_at desc);

alter table public.prediction_receipts enable row level security;
create policy "read prediction receipts" on public.prediction_receipts
  for select to authenticated using ((select private.is_org_member(org_id)));
create policy "write a prediction receipt" on public.prediction_receipts
  for insert to authenticated
  with check ((select private.has_org_role(org_id, 'member'))
              and created_by = (select auth.uid()));

--  No update policy and no delete policy, deliberately, and no grant for
--  either. This is the same discipline candidate_decisions uses: a record of
--  what was predicted, before the answer, that cannot be rewritten afterwards.
grant select, insert on public.prediction_receipts to authenticated;

-- ---------------------------------------------------------------------------
-- Per-candidate, per-question estimates, frozen with the cohort that licensed
-- them - or with the refusal, which is a row and not a null.
-- ---------------------------------------------------------------------------
create table public.validation_predictions (
  id            uuid primary key default private.uuid_v7(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  screen_id     uuid not null references public.screens (id) on delete cascade,
  run_id        uuid references public.runs (id) on delete set null,
  comparison_id uuid references public.comparisons (id) on delete set null,
  round_id      uuid references public.validation_rounds (id) on delete set null,
  hit_id        uuid references public.hits (id) on delete set null,
  gene_symbol   text not null,
  question      public.validation_question not null,

  --  Exactly one of these two states, enforced below. Available carries a
  --  probability and its cohort; unavailable carries the reason and no
  --  probability at all, so no view can render a fallback value as a
  --  measurement.
  available     boolean not null,
  probability   real check (probability is null or probability between 0 and 1),
  lower         real check (lower is null or lower between 0 and 1),
  upper         real check (upper is null or upper between 0 and 1),
  --  'none', 'upper' or 'lower'. The model can be confident past the edge of
  --  its cohort; outside the evidenced range the estimate is reported as a
  --  bound and the sentence says "at least" rather than a point value.
  bounded       text not null default 'none' check (bounded in ('none', 'upper', 'lower')),

  --  The cohort, as counted at the time. These are the numbers the sentence
  --  beside the percentage is built from.
  cohort_n_decided int,
  cohort_n_labs    int,
  cohort_n_screens int,
  cohort_stratum   text,
  cohort_matched   text,
  cohort_relaxed   text[] not null default '{}',
  cohort_sentence  text,

  --  Why it is unavailable, when it is. A machine code and the reader's
  --  sentence, both naming the shortfall rather than saying "insufficient
  --  data", because a lab that reads "3 of 5 primary screens" knows what would
  --  change it.
  unavailable_reason text,
  because       text not null,

  --  The per-family contribution to the log-odds, so the console can answer
  --  "why did the estimate move" exactly rather than by approximation.
  contributions jsonb,
  missing_channels text[] not null default '{}',
  model_version text,
  created_at    timestamptz not null default now(),

  unique (screen_id, comparison_id, gene_symbol, question, created_at),
  --  An available estimate has a probability and a cohort. An unavailable one
  --  has neither and has a reason. Nothing in between.
  constraint predictions_available_shape check (
    (available and probability is not null and lower is not null
       and upper is not null and cohort_n_decided is not null
       and cohort_sentence is not null and unavailable_reason is null)
    or
    (not available and probability is null and lower is null and upper is null
       and unavailable_reason is not null)
  ),
  constraint predictions_interval_ordered
    check (lower is null or upper is null or lower <= upper)
);

create index validation_predictions_screen_ix
  on public.validation_predictions (screen_id, question, created_at desc);
create index validation_predictions_gene_ix
  on public.validation_predictions (org_id, gene_symbol, question);
create index validation_predictions_round_ix
  on public.validation_predictions (round_id) where round_id is not null;
create index validation_predictions_available_ix
  on public.validation_predictions (screen_id, available, probability desc nulls last);

alter table public.validation_predictions enable row level security;
create policy "read validation predictions" on public.validation_predictions
  for select to authenticated using ((select private.is_org_member(org_id)));
--  Written by the engine through the service role. A member cannot insert one:
--  a probability a client can write is not a probability a gate controls.
grant select on public.validation_predictions to authenticated;

-- ---------------------------------------------------------------------------
-- What was fitted, on what, and how it did on laboratories it never saw
-- ---------------------------------------------------------------------------
create table public.validation_models (
  id            uuid primary key default private.uuid_v7(),
  --  Content-addressed: the question, the model, the calibrator, the feature
  --  spec and the cohort size. Two estimates with one version string came out
  --  of the same machine fitted on the same cohort.
  version       text not null unique,
  question      public.validation_question not null,
  algorithm     text not null,
  calibrator    text not null,
  --  How the calibration scores were obtained. "Calibrated on 310 outcomes"
  --  means something different for a held-out laboratory and for cross-fitted
  --  folds, so the distinction is a column.
  calibration_source text not null,
  --  The cohort the model is derived from. The cohort is the asset; the model
  --  is a function of it, so this hash is what makes the claim re-derivable.
  cohort_sha256 text check (cohort_sha256 ~ '^[0-9a-f]{64}$'),
  feature_spec_sha256 text not null check (feature_spec_sha256 ~ '^[0-9a-f]{64}$'),

  n_outcomes    int not null,
  n_decided     int not null,
  n_labs        int not null,
  n_train       int not null,
  n_calibration int not null,
  n_test        int not null,
  test_labs     text[] not null default '{}',

  --  Measured on laboratories neither the model nor the calibrator saw.
  brier         real,
  brier_base_rate real,
  log_loss      real,
  ece           real,
  calibration_slope real,
  calibration_intercept real,
  --  A model that cannot beat predicting the base rate has learned nothing,
  --  and the console says so instead of drawing a reliability curve.
  beats_base_rate boolean,

  --  The range of calibrated probabilities the cohort actually contains.
  --  Outside it an estimate is reported as a bound.
  evidenced_low  real check (evidenced_low is null or evidenced_low between 0 and 1),
  evidenced_high real check (evidenced_high is null or evidenced_high between 0 and 1),

  reliability_bins jsonb not null default '[]'::jsonb,
  manifest      jsonb not null default '{}'::jsonb,
  fitted_at     timestamptz not null default now(),
  is_current    boolean not null default false,
  org_id        uuid references public.organizations (id) on delete cascade,
  notes         text
);

--  One current model per question per scope. org_id null is the global model;
--  a primary key cannot hold an expression, so two partial indexes do it.
create unique index validation_models_current_global_uq
  on public.validation_models (question) where is_current and org_id is null;
create unique index validation_models_current_org_uq
  on public.validation_models (question, org_id) where is_current and org_id is not null;
create index validation_models_question_ix
  on public.validation_models (question, fitted_at desc);

alter table public.validation_models enable row level security;
create policy "read validation models" on public.validation_models
  for select to authenticated
  using (org_id is null or (select private.is_org_member(org_id)));
grant select on public.validation_models to authenticated;

-- ---------------------------------------------------------------------------
-- Coverage: which strata the cohort covers well enough to license a number
-- ---------------------------------------------------------------------------
create table public.validation_coverage (
  id            uuid primary key default private.uuid_v7(),
  model_version text not null references public.validation_models (version) on delete cascade,
  question      public.validation_question not null,
  stratum_key   text not null,
  assay_class   public.assay_class,
  modality      text,
  phenotype_family text,
  model_type    text,
  describe      text not null,

  n_decided     int not null,
  n_validated   int not null,
  n_failed      int not null,
  n_inconclusive int not null default 0,
  n_pending     int not null default 0,
  n_labs        int not null,
  n_studies     int not null,
  n_screens     int not null,
  --  Whether this stratum clears every floor. The floors themselves live in
  --  engine/splicr/validation/coverage.py and are recorded per row, so a row
  --  read a year from now says what bar it was judged against.
  is_open       boolean not null,
  shortfall     text[] not null default '{}',
  min_outcomes  int not null,
  min_labs      int not null,
  min_screens   int not null,
  created_at    timestamptz not null default now(),
  unique (model_version, stratum_key)
);

create index validation_coverage_open_ix
  on public.validation_coverage (question, is_open, n_decided desc);

alter table public.validation_coverage enable row level security;
create policy "read validation coverage" on public.validation_coverage
  for select to authenticated using (true);
grant select on public.validation_coverage to authenticated;

-- ---------------------------------------------------------------------------
-- The outcome record, extended into something a model can learn from
-- ---------------------------------------------------------------------------
alter table public.validation_outcomes
  --  Nullable, because rows recorded before this migration exist and are not
  --  going to be relabelled by a migration. A null validation type means the
  --  outcome is kept, shown and exported and enters no head, which is the
  --  honest treatment of a record whose experiment was never stated.
  add column validation_type   public.validation_type,
  add column endpoint_id       text,
  add column endpoint_version  int,
  --  The laboratory's own prespecified effect bar, agreed at round creation.
  add column laboratory_threshold real,
  --  What was measured: independent_perturbation, n_perturbations,
  --  n_replicates, effect_size, p_value, controls{}, compound,
  --  concentration_um.
  add column measurement       jsonb not null default '{}'::jsonb,
  --  The evidence as it stood when the candidate was called. Written server
  --  side from the stored hit row, never from a client.
  add column evidence          jsonb not null default '{}'::jsonb,
  --  The unit of the cluster bootstrap. Two screens from one laboratory are
  --  not two independent observations, and an outcome with no laboratory
  --  cannot enter a held-out-laboratory evaluation.
  add column lab_id            text,
  add column study_id          text,
  add column round_id          uuid references public.validation_rounds (id) on delete set null,
  add column arm               public.validation_arm not null default 'unassigned',
  --  The engine's verdict on whether the measurement meets the endpoint. A
  --  check on the recorded result, never a replacement for it: where the two
  --  disagree the disagreement is the finding and both are kept.
  add column endpoint_decision public.endpoint_decision,
  add column decision_because  text,
  add column context           jsonb not null default '{}'::jsonb;

alter table public.validation_outcomes
  add constraint outcomes_endpoint_pair
    check ((endpoint_id is null) = (endpoint_version is null)),
  add constraint outcomes_endpoint_fk
    foreign key (endpoint_id, endpoint_version)
    references public.validation_endpoints (endpoint_id, version);

create index validation_outcomes_type_ix
  on public.validation_outcomes (org_id, validation_type, result);
create index validation_outcomes_round_ix
  on public.validation_outcomes (round_id) where round_id is not null;
create index validation_outcomes_lab_ix
  on public.validation_outcomes (lab_id) where lab_id is not null;

comment on column public.validation_outcomes.validation_type is
  'What was done at the bench. The question it bears on is derived from this, never asked of the person filling the form. Null on rows recorded before the Validation Network existed; those rows are kept and enter no head.';
comment on column public.validation_outcomes.endpoint_decision is
  'The engine''s verdict on whether the measurement meets the prespecified endpoint. ''insufficient_record'' means the record cannot be scored, which is neither a failure nor an inconclusive result.';

-- ---------------------------------------------------------------------------
-- Which question each validation type bears on. One mapping, in the database,
-- so a view and the engine cannot disagree about it.
-- ---------------------------------------------------------------------------
create or replace function public.validation_type_question(kind public.validation_type)
returns public.validation_question
language sql
immutable
set search_path = ''
as $$
  select case kind
    when 'independent_guide'     then 'reproduces'
    when 'independent_guide_set' then 'reproduces'
    when 'crispri'               then 'target_specific'
    when 'crispra'               then 'target_specific'
    when 'rescue'                then 'target_specific'
    when 'orthogonal_genetic'    then 'target_specific'
    when 'small_molecule'        then 'pharmacologic'
    when 'another_model'         then 'cross_model'
    when 'organoid'              then 'cross_model'
    when 'in_vivo'               then 'cross_model'
    --  'other' bears on nothing on purpose: a model cannot learn from a label
    --  whose meaning was never fixed.
    else null
  end::public.validation_question;
$$;

grant execute on function public.validation_type_question(public.validation_type) to authenticated;

-- ---------------------------------------------------------------------------
-- The validation ladder, as one row per gene per rung.
--
-- A rung is 'mixed' when outcomes of the same kind disagree with each other,
-- which is the PTK2 case in doi:10.1158/0008-5472.CAN-24-0775: one inhibitor
-- with no effect on either line, another with a partial response in one. A view
-- that could only say 'met' or 'not_met' would have to pick one of them.
--
-- 'not_tested' covers "nobody ran it" and "it ran and could not decide", and
-- neither is a negative result. An inconclusive outcome never marks a rung
-- against a gene.
-- ---------------------------------------------------------------------------
create or replace view public.validation_ladder
with (security_invoker = true) as
with rungs as (
  select * from (values
    ('guide',         'Guide reproducibility',       'reproduces',      array['independent_guide','independent_guide_set']),
    ('orthogonal',    'Orthogonal genetic evidence', 'target_specific', array['crispri','crispra','rescue','orthogonal_genetic']),
    ('pharmacologic', 'Pharmacologic evidence',      'pharmacologic',   array['small_molecule']),
    ('another_model', 'Another model',               'cross_model',     array['another_model','organoid']),
    ('in_vivo',       'In vivo',                     'cross_model',     array['in_vivo'])
  ) as t(rung_key, rung_label, question, kinds)
),
scored as (
  select o.org_id,
         o.screen_id,
         o.gene_symbol,
         r.rung_key,
         r.rung_label,
         r.question,
         count(*) as n_outcomes,
         count(*) filter (
           where o.result <> 'pending'
             and coalesce(o.endpoint_decision, case o.result
                   when 'validated' then 'validated'
                   when 'failed' then 'failed'
                   else 'inconclusive' end::public.endpoint_decision) = 'validated'
         ) as n_met,
         count(*) filter (
           where o.result <> 'pending'
             and coalesce(o.endpoint_decision, case o.result
                   when 'validated' then 'validated'
                   when 'failed' then 'failed'
                   else 'inconclusive' end::public.endpoint_decision) = 'failed'
         ) as n_not_met,
         count(*) filter (where o.result = 'inconclusive') as n_inconclusive,
         count(*) filter (where o.result = 'pending') as n_pending
    from public.validation_outcomes o
    join rungs r on o.validation_type::text = any (r.kinds)
   group by o.org_id, o.screen_id, o.gene_symbol, r.rung_key, r.rung_label, r.question
)
select org_id, screen_id, gene_symbol, rung_key, rung_label,
       question::public.validation_question as question,
       n_outcomes, n_met, n_not_met, n_inconclusive, n_pending,
       case
         when n_met > 0 and n_not_met > 0 then 'mixed'
         when n_met > 0 then 'met'
         when n_not_met > 0 then 'not_met'
         else 'not_tested'
       end::public.rung_state as state
  from scored;

comment on view public.validation_ladder is
  'One row per gene per rung. ''mixed'' means outcomes of the same kind disagree with each other and both are kept; ''not_tested'' covers both "nobody ran it" and "it ran and could not decide", neither of which is a negative result.';

grant select on public.validation_ladder to authenticated;

-- ---------------------------------------------------------------------------
-- What the network can currently state, per question, for the console's status
-- panel. A question with no current model appears with is_available false and
-- nulls, rather than being absent: a page that silently omits an unfitted head
-- tells the reader the product does four things well.
-- ---------------------------------------------------------------------------
create or replace view public.validation_network_status
with (security_invoker = true) as
select q.question,
       (m.version is not null) as is_available,
       m.version as model_version,
       m.algorithm,
       m.calibrator,
       m.calibration_source,
       m.n_decided,
       m.n_labs,
       m.n_test,
       m.test_labs,
       m.brier,
       m.brier_base_rate,
       m.beats_base_rate,
       m.ece,
       m.calibration_slope,
       m.calibration_intercept,
       m.evidenced_low,
       m.evidenced_high,
       m.reliability_bins,
       m.cohort_sha256,
       m.fitted_at,
       (select count(*) from public.validation_coverage c
         where c.model_version = m.version and c.is_open) as n_open_strata,
       (select count(*) from public.validation_coverage c
         where c.model_version = m.version) as n_strata
  from (values ('reproduces'), ('target_specific'), ('cross_model'), ('pharmacologic'))
         as q(question)
  left join public.validation_models m
    on m.question = q.question::public.validation_question
   and m.is_current
   and m.org_id is null;

grant select on public.validation_network_status to authenticated;

-- ---------------------------------------------------------------------------
-- Seed the endpoint registry. These rows mirror
-- engine/splicr/validation/endpoints.py; the engine is the source of truth and
-- `npm run validation:sync` regenerates them with their hashes.
-- ---------------------------------------------------------------------------
insert into public.validation_endpoints (
  endpoint_id, version, label, question, assay_class, validation_types,
  threshold_owner, direction, effect_metric, effect_threshold,
  requires_independent_perturbation, requires_distinct_constructs,
  min_independent_perturbations, min_biological_replicates, control_criteria,
  negative_means, published_example, notes, definition_sha256
) values
  ('ko_fitness_independent_guide', 1, 'Independent guide, knockout fitness',
   'reproduces', 'ko_fitness', array['independent_guide']::public.validation_type[],
   'laboratory', 'depleted', 'log2_fold_change', null, true, true, 1, 2,
   array['negative_control_guides','positive_control_guides'],
   'A negative result here says this guide did not reproduce the depletion under this assay. It does not establish that the gene has no phenotype.',
   null,
   'The default genetic-reproduction endpoint for pooled knockout fitness screens. The effect bar belongs to the assay that measures it.',
   repeat('0', 64)),
  ('ko_fitness_independent_guide_set', 1, 'Independent guide set, knockout fitness',
   'reproduces', 'ko_fitness', array['independent_guide_set']::public.validation_type[],
   'laboratory', 'depleted', 'log2_fold_change', null, true, true, 2, 2,
   array['negative_control_guides','positive_control_guides'],
   'A negative result here is stronger than one independent guide failing, because two or more perturbations of the same target agreed on not reproducing it.',
   null, '', repeat('0', 64)),
  ('organoid_growth_arrayed', 1, 'Arrayed organoid growth',
   'cross_model', 'organoid_growth', array['organoid']::public.validation_type[],
   'laboratory', 'depleted', 'relative_organoid_area', null, true, false, 2, 2,
   array['empty_vector_control'],
   'A negative result here is about this organoid model. It does not transfer to the 2D line the screen was run in, or to another donor''s organoid.',
   '{"doi": "10.1158/0008-5472.CAN-24-0775", "pmid": "39891928", "screen_hit_criterion": "a reduction of at least 50% (log2 fold change < -1) and a p value < 0.05", "quoted": true}'::jsonb,
   'Modelled on the arrayed individual-gRNA growth assay in doi:10.1158/0008-5472.CAN-24-0775. The 50%/p<0.05 figures in that paper are the screen''s own hit criterion, which is why they are carried as an example and not as this endpoint''s default bar.',
   repeat('0', 64)),
  ('orthogonal_crispri', 1, 'CRISPRi knockdown of the same target',
   'target_specific', 'ko_fitness', array['crispri']::public.validation_type[],
   'laboratory', 'depleted', 'log2_fold_change', null, true, false, 2, 2,
   array['non_targeting_control','knockdown_confirmed'],
   'CRISPRi reduces transcript rather than cutting DNA. A disagreement with knockout can mean the knockout phenotype was a cutting artefact, or that partial knockdown was not enough. It does not by itself decide which.',
   null, '', repeat('0', 64)),
  ('rescue_complementation', 1, 'Rescue by complementation',
   'target_specific', 'ko_fitness', array['rescue']::public.validation_type[],
   'laboratory', 'enriched', 'rescue_log2_fold_change', null, false, false, 1, 2,
   array['empty_vector_control','expression_confirmed'],
   'A rescue that does not restore the phenotype can mean the phenotype was off-target, or that the construct was not expressed or not functional.',
   null,
   'The direction is reversed on purpose: a rescue validates by restoring growth, so the prespecified effect is enriched.',
   repeat('0', 64)),
  ('pharmacologic_inhibition', 1, 'Selective small-molecule inhibition',
   'pharmacologic', 'other', array['small_molecule']::public.validation_type[],
   'laboratory', 'depleted', 'viability_relative_to_vehicle', null, true, false, 1, 2,
   array['vehicle_control'],
   'This is the endpoint most often misread. A compound that does not recapitulate a genetic phenotype may be a poor compound, dosed below its effective range, or aimed at a target that partial inhibition does not touch the way a knockout does. It is not evidence that the screen hit was false. In doi:10.1158/0008-5472.CAN-24-0775 the PRKDC inhibitors LTURM34 and AZD7648 showed no potent activity at the tested concentrations while the individual gRNAs did reduce growth, and of two PTK2 inhibitors one had no effect on either line while the other produced a partial response in one.',
   '{"doi": "10.1158/0008-5472.CAN-24-0775", "pmid": "39891928", "quoted": true}'::jsonb,
   'Records the compound and concentration in the measurement, because a pharmacologic outcome without them cannot be interpreted or reused.',
   repeat('0', 64)),
  ('cross_model_reproduction', 1, 'Reproduction in another cellular model',
   'cross_model', 'ko_fitness', array['another_model']::public.validation_type[],
   'laboratory', 'depleted', 'log2_fold_change', null, false, false, 1, 2,
   array['negative_control_guides'],
   'A dependency that is real and context-specific is expected to fail this endpoint in the wrong context. A negative here is information about transfer, not about the original hit.',
   null, '', repeat('0', 64)),
  ('in_vivo_reproduction', 1, 'Reproduction in vivo',
   'cross_model', 'in_vivo_growth', array['in_vivo']::public.validation_type[],
   'laboratory', 'depleted', 'log2_fold_change', null, false, false, 1, 3,
   array['vehicle_control'],
   'In vivo failure can be pharmacokinetic, immunological or about the microenvironment, none of which is a statement about the in vitro measurement.',
   null, '', repeat('0', 64)),
  ('orthogonal_genetic_other', 1, 'Other orthogonal genetic assay',
   'target_specific', 'other',
   array['orthogonal_genetic','crispra']::public.validation_type[],
   'laboratory', 'either', 'log2_fold_change', null, true, false, 1, 2,
   array[]::text[],
   'The direction is not prespecified for this catch-all endpoint, so it is the weakest of the orthogonal endpoints and is reported separately from CRISPRi and rescue.',
   null,
   'A named endpoint is always preferable. This exists so an unusual assay can be recorded with its criteria rather than dropped.',
   repeat('0', 64));

notify pgrst, 'reload schema';
