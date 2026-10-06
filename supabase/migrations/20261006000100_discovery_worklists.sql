-- Run/comparison-specific evidence, frozen experiments and prospective outcomes.
-- No imported public data, fitted probabilities or biological superiority claims.
create table public.discovery_inputs (
  id uuid primary key default private.uuid_v7(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  screen_id uuid not null references public.screens(id) on delete cascade,
  run_id uuid not null references public.runs(id) on delete cascade,
  comparison_id uuid not null references public.comparisons(id) on delete cascade,
  document jsonb not null check (jsonb_typeof(document) = 'object' and document->>'version' = '1'),
  document_sha256 text not null check (document_sha256 ~ '^[0-9a-f]{64}$'),
  canonical_document text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (canonical_document::jsonb = document and encode(extensions.digest(canonical_document, 'sha256'), 'hex') = document_sha256)
);
create index discovery_inputs_scope_ix on public.discovery_inputs(org_id, screen_id, run_id, comparison_id, created_at desc);

create table public.discovery_batches (
  id uuid primary key default private.uuid_v7(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  input_id uuid not null references public.discovery_inputs(id) on delete cascade,
  screen_id uuid not null references public.screens(id) on delete cascade,
  run_id uuid not null references public.runs(id) on delete cascade,
  comparison_id uuid not null references public.comparisons(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  receipt jsonb not null check (jsonb_typeof(receipt) = 'object'),
  receipt_sha256 text not null check (receipt_sha256 ~ '^[0-9a-f]{64}$'),
  canonical_receipt text not null,
  frozen_by uuid not null references auth.users(id),
  frozen_at timestamptz not null default now(),
  check (canonical_receipt::jsonb = receipt and encode(extensions.digest(canonical_receipt, 'sha256'), 'hex') = receipt_sha256)
);
create index discovery_batches_scope_ix on public.discovery_batches(org_id, screen_id, frozen_at desc);
create index discovery_batches_input_ix on public.discovery_batches(input_id);

create table public.discovery_results (
  id uuid primary key default private.uuid_v7(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  batch_id uuid not null references public.discovery_batches(id) on delete cascade,
  experiment_id text not null check (char_length(experiment_id) between 1 and 500),
  measurement jsonb not null check (jsonb_typeof(measurement) = 'object'),
  decision text not null check (decision in ('validated', 'failed', 'inconclusive', 'insufficient_record', 'reported_only')),
  because text not null,
  outcome_id uuid references public.validation_outcomes(id) on delete restrict,
  logged_by uuid not null references auth.users(id),
  logged_at timestamptz not null default now(),
  unique(batch_id, experiment_id)
);
create index discovery_results_scope_ix on public.discovery_results(org_id, batch_id);
create index discovery_results_outcome_ix on public.discovery_results(outcome_id);

alter table public.discovery_inputs enable row level security;
alter table public.discovery_batches enable row level security;
alter table public.discovery_results enable row level security;
revoke all on public.discovery_inputs, public.discovery_batches, public.discovery_results from anon, authenticated;
grant select, insert on public.discovery_inputs, public.discovery_batches, public.discovery_results to authenticated;
grant all on public.discovery_inputs, public.discovery_batches, public.discovery_results to service_role;

create policy discovery_inputs_read on public.discovery_inputs for select to authenticated using (private.is_org_member(org_id));
create policy discovery_inputs_insert on public.discovery_inputs for insert to authenticated with check (private.has_org_role(org_id, 'member') and created_by = (select auth.uid()));
create policy discovery_batches_read on public.discovery_batches for select to authenticated using (private.is_org_member(org_id));
create policy discovery_batches_insert on public.discovery_batches for insert to authenticated with check (private.has_org_role(org_id, 'member') and frozen_by = (select auth.uid()));
create policy discovery_results_read on public.discovery_results for select to authenticated using (private.is_org_member(org_id));
create policy discovery_results_insert on public.discovery_results for insert to authenticated with check (private.has_org_role(org_id, 'member') and logged_by = (select auth.uid()));

create function private.discovery_immutable() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'Discovery records are immutable; create a new evidence version or batch.'; end; $$;
create trigger discovery_inputs_immutable before update on public.discovery_inputs for each row execute function private.discovery_immutable();
create trigger discovery_batches_immutable before update on public.discovery_batches for each row execute function private.discovery_immutable();
create trigger discovery_results_immutable before update on public.discovery_results for each row execute function private.discovery_immutable();

-- Scope checks cannot be replaced with a client-provided organization ID.
create function private.discovery_scope() returns trigger language plpgsql security invoker set search_path = '' as $$
declare s public.screens; r public.runs; c public.comparisons; i public.discovery_inputs;
begin
  select * into s from public.screens where id = new.screen_id for share;
  select * into r from public.runs where id = new.run_id;
  select * into c from public.comparisons where id = new.comparison_id;
  if s.id is null or r.id is null or c.id is null or s.org_id <> new.org_id or r.org_id <> new.org_id
    or r.screen_id <> s.id or c.screen_id <> s.id or s.current_run_id is distinct from r.id or r.status <> 'complete' then
    raise exception 'Discovery evidence requires the current completed run and a comparison from the same workspace screen.';
  end if;
  if tg_table_name = 'discovery_batches' then
    select * into i from public.discovery_inputs where id = new.input_id;
    if i.id is null or (i.org_id, i.screen_id, i.run_id, i.comparison_id) is distinct from (new.org_id, new.screen_id, new.run_id, new.comparison_id) then
      raise exception 'Discovery input scope does not match the frozen batch.';
    end if;
    if new.receipt->>'input_sha256' is distinct from i.document_sha256 or new.receipt->'evidence' is distinct from i.document
      or new.receipt->>'screen_id' is distinct from new.screen_id::text or new.receipt->>'run_id' is distinct from new.run_id::text
      or new.receipt->>'comparison_id' is distinct from new.comparison_id::text or new.receipt->>'input_id' is distinct from new.input_id::text then
      raise exception 'Discovery receipt provenance does not match its stored evidence.';
    end if;
  end if;
  return new;
end; $$;
create trigger discovery_inputs_scope before insert on public.discovery_inputs for each row execute function private.discovery_scope();
create trigger discovery_batches_scope before insert on public.discovery_batches for each row execute function private.discovery_scope();

create function private.discovery_result_scope() returns trigger language plpgsql security invoker set search_path = '' as $$
declare b public.discovery_batches; e jsonb; o public.validation_outcomes;
begin
  select * into b from public.discovery_batches where id = new.batch_id;
  if b.id is null or b.org_id <> new.org_id then raise exception 'Discovery batch is not in this workspace.'; end if;
  select value into e from jsonb_array_elements(b.receipt->'plan'->'experiments') where value->>'id' = new.experiment_id;
  if e is null or new.measurement->>'model_id' is distinct from e->>'model_id' then raise exception 'Result must match a frozen experiment and model.'; end if;
  if new.logged_at < b.frozen_at then raise exception 'Discovery outcomes must follow the frozen selection.'; end if;
  if new.outcome_id is not null then
    select * into o from public.validation_outcomes where id = new.outcome_id;
    if o.id is null or o.org_id <> new.org_id or o.screen_id <> b.screen_id or o.gene_symbol <> e->>'gene' then
      raise exception 'Truth Loop outcome does not match the discovery experiment.';
    end if;
  end if;
  return new;
end; $$;
create trigger discovery_results_scope before insert on public.discovery_results for each row execute function private.discovery_result_scope();

-- Verify the existing endpoint rules again at the database boundary. Missing
-- measurements override failures; a laboratory's label never supplies a score.
create function public.discovery_endpoint_verdict(ep jsonb, m jsonb, bar double precision)
returns text language plpgsql immutable set search_path = '' as $$
declare missing boolean := false; failed boolean := false; k text; v jsonb; n double precision; threshold double precision;
begin
  if m->>'result' = 'pending' then return 'insufficient_record'; end if;
  if m->>'result' = 'inconclusive' then return 'inconclusive'; end if;
  if m->>'result' not in ('validated', 'failed') then raise exception 'Unknown assay result.'; end if;
  foreach k in array array['independent_perturbation','distinct_from_screen_constructs'] loop
    if (k = 'independent_perturbation' and (ep->>'requires_independent_perturbation')::boolean)
      or (k = 'distinct_from_screen_constructs' and (ep->>'requires_distinct_constructs')::boolean) then
      v := m->k;
      if v is null or v = 'null'::jsonb then missing := true;
      elsif jsonb_typeof(v) <> 'boolean' then raise exception 'Control measurements must be boolean or null.';
      elsif v = 'false'::jsonb then failed := true; end if;
    end if;
  end loop;
  foreach k in array array['n_perturbations','n_replicates'] loop
    v := m->k;
    if v is null or v = 'null'::jsonb then missing := true;
    elsif jsonb_typeof(v) <> 'number' then raise exception 'Replicate measurements must be numbers.';
    else
      n := (v#>>'{}')::double precision;
      if n <> trunc(n) then missing := true;
      elsif n < (case when k = 'n_perturbations' then (ep->>'min_independent_perturbations')::int else (ep->>'min_biological_replicates')::int end) then failed := true; end if;
    end if;
  end loop;
  threshold := case when ep->>'threshold_owner' = 'laboratory' then bar else (ep->>'effect_threshold')::double precision end;
  v := m->'effect_size';
  if v is null or v = 'null'::jsonb or threshold is null then missing := true;
  elsif jsonb_typeof(v) <> 'number' then raise exception 'Effect measurements must be numbers.';
  else
    n := (v#>>'{}')::double precision;
    if abs(n) < abs(threshold) or (ep->>'direction' = 'depleted' and n >= 0) or (ep->>'direction' = 'enriched' and n <= 0) then failed := true; end if;
  end if;
  for k in select jsonb_array_elements_text(ep->'control_criteria') loop
    v := m->'controls'->k;
    if v is null or v = 'null'::jsonb then missing := true;
    elsif jsonb_typeof(v) <> 'boolean' then raise exception 'Control measurements must be boolean or null.';
    elsif v = 'false'::jsonb then failed := true; end if;
  end loop;
  if missing then return 'insufficient_record'; end if;
  if failed then return 'failed'; end if;
  return 'validated';
end; $$;
revoke all on function public.discovery_endpoint_verdict(jsonb, jsonb, double precision) from public, anon;
grant execute on function public.discovery_endpoint_verdict(jsonb, jsonb, double precision) to authenticated, service_role;

-- Both records are created atomically with the caller's RLS. A failure rolls back both.
create function public.record_discovery_result(p_batch_id uuid, p_experiment_id text, p_measurement jsonb, p_decision text, p_because text, p_endpoint_key text, p_validation_type text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare b public.discovery_batches; e jsonb; ep jsonb; oid uuid; rid uuid; expected text; kind text;
begin
  select * into b from public.discovery_batches where id = p_batch_id;
  if b.id is null or not exists (select 1 from public.org_members where org_id = b.org_id and user_id = auth.uid() and role in ('owner', 'admin', 'member')) then raise exception 'Member access to this discovery batch is required.'; end if;
  select value into e from jsonb_array_elements(b.receipt->'plan'->'experiments') where value->>'id' = p_experiment_id;
  if e is null then raise exception 'Experiment is not in the frozen batch.'; end if;
  ep := b.receipt->'endpoint';
  kind := case e->>'kind' when 'orthogonal_confirmation' then 'independent_guide' when 'pharmacologic_confirmation' then 'small_molecule' when 'partial_suppression' then 'crispri' else 'other' end;
  if p_validation_type is distinct from kind then raise exception 'Validation modality does not match the frozen experiment.'; end if;
  if kind = 'other' or not (ep->'validation_types' ? kind) then expected := 'reported_only';
  else expected := public.discovery_endpoint_verdict(ep, p_measurement, (b.receipt->'plan'->'design'->>'laboratory_threshold')::double precision); end if;
  if p_decision is distinct from expected then raise exception 'Result decision does not match the frozen endpoint rules.'; end if;
  if p_endpoint_key is not null and p_endpoint_key is distinct from ep->>'key' then raise exception 'Result endpoint differs from the frozen endpoint.'; end if;
  if p_decision <> 'reported_only' and p_endpoint_key is null then raise exception 'A scored result requires its frozen endpoint.'; end if;
  insert into public.validation_outcomes(org_id, screen_id, gene_symbol, result, validation_type,
    endpoint_id, endpoint_version, endpoint_decision, decision_because, measurement,
    lab_id, assay, effect_size, notes, evidence_url, logged_by, laboratory_threshold, evidence, context)
  values(b.org_id, b.screen_id, e->>'gene', (p_measurement->>'result')::public.outcome_result,
    p_validation_type::public.validation_type,
    case when p_endpoint_key is null then null else ep->>'endpoint_id' end,
    case when p_endpoint_key is null then null else (ep->>'version')::int end,
    case when p_decision = 'reported_only' then null else p_decision::public.endpoint_decision end, p_because, p_measurement,
    p_measurement->>'lab_id', 'Discovery: ' || (e->>'kind'), (p_measurement->>'effect_size')::real,
    p_measurement->>'notes', p_measurement->>'evidence_url', auth.uid(), (b.receipt->'plan'->'design'->>'laboratory_threshold')::real,
    e, b.receipt->'evidence'->'context') returning id into oid;
  insert into public.discovery_results(org_id, batch_id, experiment_id, measurement, decision, because, outcome_id, logged_by)
  values(b.org_id, p_batch_id, p_experiment_id, p_measurement, p_decision, p_because, oid, auth.uid()) returning id into rid;
  return rid;
end; $$;
revoke all on function public.record_discovery_result(uuid, text, jsonb, text, text, text, text) from public, anon;
grant execute on function public.record_discovery_result(uuid, text, jsonb, text, text, text, text) to authenticated, service_role;
notify pgrst, 'reload schema';
