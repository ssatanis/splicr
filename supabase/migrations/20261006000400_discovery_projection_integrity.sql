-- Direct Data API inserts must preserve the same endpoint, evidence and cost
-- contract as the atomic server-action RPC.
create function private.discovery_projection_integrity() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare b public.discovery_batches; o public.validation_outcomes; ep jsonb; e jsonb; cost numeric;
begin
  select * into b from public.discovery_batches where id=new.batch_id;
  select * into o from public.validation_outcomes where id=new.outcome_id;
  ep := b.receipt->'endpoint';
  select value into e from jsonb_array_elements(b.receipt->'plan'->'experiments') where value->>'id'=new.experiment_id;
  if o.org_id is distinct from new.org_id or o.screen_id is distinct from b.screen_id
    or o.decision_because is distinct from new.because or o.evidence is distinct from e
    or o.context is distinct from b.receipt->'evidence'->'context'
    or o.effect_size is distinct from (new.measurement->>'effect_size')::real
    or o.laboratory_threshold is distinct from (b.receipt->'plan'->'design'->>'laboratory_threshold')::real then
    raise exception 'Truth Loop projection differs from the frozen discovery measurement.';
  end if;
  if new.decision='reported_only' then
    if o.endpoint_id is not null or o.endpoint_decision is not null then raise exception 'Reported-only assays cannot carry a scored endpoint projection.'; end if;
  elsif o.endpoint_decision::text is distinct from new.decision or o.endpoint_id is distinct from ep->>'endpoint_id'
    or o.endpoint_version is distinct from (ep->>'version')::int then
    raise exception 'Truth Loop endpoint projection differs from the frozen discovery decision.';
  end if;
  if jsonb_typeof(new.measurement->'actual_cost') is distinct from 'number' then raise exception 'Actual assay cost must be measured in the declared cost unit.'; end if;
  cost := (new.measurement->>'actual_cost')::numeric;
  if cost < 0 or cost > 1e9 then raise exception 'Actual assay cost is outside the supported range.'; end if;
  return new;
end; $$;
create trigger discovery_results_projection before insert on public.discovery_results
  for each row execute function private.discovery_projection_integrity();
notify pgrst, 'reload schema';
