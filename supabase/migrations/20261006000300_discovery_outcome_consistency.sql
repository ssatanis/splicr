-- A frozen result and its Truth Loop projection must stay the same measurement.
-- Whole-screen deletion can still remove both through their parent cascades.
alter table public.discovery_results drop constraint discovery_results_outcome_id_fkey;
alter table public.discovery_results add constraint discovery_results_outcome_id_fkey
  foreign key(outcome_id) references public.validation_outcomes(id)
  on delete no action deferrable initially deferred;

create function private.discovery_outcome_immutable() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if exists(select 1 from public.discovery_results where outcome_id=old.id) then
    raise exception 'This outcome belongs to a frozen discovery result and is immutable. Record a new independent assay in a new batch.';
  end if;
  return new;
end; $$;
create trigger discovery_outcome_immutable before update on public.validation_outcomes
  for each row execute function private.discovery_outcome_immutable();
notify pgrst, 'reload schema';
