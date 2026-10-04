-- ============================================================================
-- Covering indexes for the Validation Network's foreign keys.
--
-- Same reason as 20260929000200_advisor_performance.sql: a foreign key without
-- a covering index makes the referenced row's delete scan the referencing
-- table, and these tables hang off organizations, screens, runs and auth.users,
-- all of which get deleted. The advisor flags each one; this clears them.
--
-- Split from 20261003000100 rather than folded into it, because that migration
-- has already been applied and an applied migration is not edited.
-- ============================================================================

create index if not exists prediction_receipts_created_by_ix
  on public.prediction_receipts (created_by) where created_by is not null;

create index if not exists validation_models_org_ix
  on public.validation_models (org_id) where org_id is not null;

create index if not exists validation_outcomes_endpoint_ix
  on public.validation_outcomes (endpoint_id, endpoint_version)
  where endpoint_id is not null;

create index if not exists validation_predictions_comparison_ix
  on public.validation_predictions (comparison_id) where comparison_id is not null;
create index if not exists validation_predictions_hit_ix
  on public.validation_predictions (hit_id) where hit_id is not null;
create index if not exists validation_predictions_run_ix
  on public.validation_predictions (run_id) where run_id is not null;

create index if not exists validation_rounds_comparison_ix
  on public.validation_rounds (comparison_id) where comparison_id is not null;
create index if not exists validation_rounds_created_by_ix
  on public.validation_rounds (created_by) where created_by is not null;
create index if not exists validation_rounds_endpoint_ix
  on public.validation_rounds (endpoint_id, endpoint_version)
  where endpoint_id is not null;
create index if not exists validation_rounds_frozen_by_ix
  on public.validation_rounds (frozen_by) where frozen_by is not null;
create index if not exists validation_rounds_revealed_by_ix
  on public.validation_rounds (revealed_by) where revealed_by is not null;
create index if not exists validation_rounds_run_ix
  on public.validation_rounds (run_id) where run_id is not null;

notify pgrst, 'reload schema';
