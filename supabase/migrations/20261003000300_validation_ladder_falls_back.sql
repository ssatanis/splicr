-- ============================================================================
-- The ladder falls back to the laboratory's own result when the endpoint
-- cannot score the record.
--
-- THE BUG THIS FIXES
--
-- 20261003000100 built each rung from `coalesce(endpoint_decision, result)` and
-- then matched only 'validated' or 'failed'. An outcome whose endpoint decision
-- is 'insufficient_record' therefore counted as neither, and the rung came out
-- 'not_tested' — which told the reader nobody had run the experiment, while the
-- panel above it said two outcomes were recorded.
--
-- That is the worst possible failure for this view. 'insufficient_record' is
-- the normal state for an outcome logged outside a blinded round: the arrayed
-- endpoints' effect thresholds belong to the laboratory and are agreed at round
-- creation, so an outcome logged on its own has no bar to be scored against.
-- Every outcome a researcher logs from the Truth Loop today is in that state,
-- and the ladder was discarding all of them.
--
-- THE RULE
--
-- The endpoint decision overrides the recorded result only where it is an
-- actual verdict:
--
--   pending                             the assay has not finished
--   decision 'validated'                met
--   decision 'failed'                   not met
--   decision 'inconclusive'             inconclusive
--   'insufficient_record' or no
--   decision at all                     the laboratory's own result stands
--
-- The last line is the point. A criterion nobody recorded is a gap in the
-- paperwork, not grounds to overrule the people who ran the experiment. The
-- Validation Network's own cohort counting is stricter — `coverage` only opens
-- a stratum on decided outcomes, and `endpoint_disagreements` reports every
-- record the endpoint could not score — but a view whose job is to show a
-- scientist what has been done must not erase what they recorded.
--
-- Caught by apps/web/e2e/fast/validation-network.spec.ts against a real
-- session: two pharmacologic outcomes, one met and one not, rendered as a rung
-- nobody had tested.
-- ============================================================================

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
placed as (
  select o.org_id,
         o.screen_id,
         o.gene_symbol,
         r.rung_key,
         r.rung_label,
         r.question,
         case
           when o.result = 'pending' then 'pending'
           when o.endpoint_decision = 'validated' then 'met'
           when o.endpoint_decision = 'failed' then 'not_met'
           when o.endpoint_decision = 'inconclusive' then 'inconclusive'
           --  'insufficient_record', or no decision recorded at all: the
           --  endpoint could not score this record, so the laboratory's own
           --  label stands rather than being discarded.
           when o.result = 'validated' then 'met'
           when o.result = 'failed' then 'not_met'
           else 'inconclusive'
         end as placement
    from public.validation_outcomes o
    join rungs r on o.validation_type::text = any (r.kinds)
),
scored as (
  select org_id, screen_id, gene_symbol, rung_key, rung_label, question,
         count(*) as n_outcomes,
         count(*) filter (where placement = 'met') as n_met,
         count(*) filter (where placement = 'not_met') as n_not_met,
         count(*) filter (where placement = 'inconclusive') as n_inconclusive,
         count(*) filter (where placement = 'pending') as n_pending
    from placed
   group by org_id, screen_id, gene_symbol, rung_key, rung_label, question
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
  'One row per gene per rung. The endpoint decision overrides the recorded result only where it is an actual verdict; ''insufficient_record'' falls back to the laboratory''s own label, because a criterion nobody wrote down is a gap in the paperwork and not grounds to overrule the people who ran the experiment. ''mixed'' means outcomes of the same kind disagree with each other and both are kept; ''not_tested'' covers both "nobody ran it" and "it ran and could not decide", neither of which is a negative result.';

grant select on public.validation_ladder to authenticated;

notify pgrst, 'reload schema';
