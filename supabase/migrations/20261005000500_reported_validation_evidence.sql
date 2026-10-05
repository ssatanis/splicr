-- Preserve reported laboratory results while exposing records that were not
-- scorable against a prespecified endpoint. The UI must distinguish a reported
-- result from a scored endpoint verdict. No outcome labels are rewritten.

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
         (o.result <> 'pending' and (o.endpoint_decision is null or o.endpoint_decision = 'insufficient_record')) as unscored,
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
         count(*) filter (where placement = 'pending') as n_pending,
         count(*) filter (where unscored) as n_unscored
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
       end::public.rung_state as state,
       n_unscored
  from scored;

grant select on public.validation_ladder to authenticated;
notify pgrst, 'reload schema';
