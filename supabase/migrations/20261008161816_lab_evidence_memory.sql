-- Deterministic analytical receipts are appended, never overwritten by retries.
-- The exact canonical bytes are hashed, rather than Postgres's JSON formatting.
create table public.lab_evidence (
  screen_id uuid not null references public.screens(id) on delete cascade,
  run_id uuid not null references public.runs(id) on delete cascade,
  comparison_id uuid not null references public.comparisons(id) on delete cascade,
  gene_symbol text not null,
  kind text not null check (kind in ('isoforms','kinetics','context','drift')),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  canonical text not null,
  document jsonb generated always as (canonical::jsonb) stored,
  created_at timestamptz not null default now(),
  primary key (run_id, comparison_id, gene_symbol, kind, sha256),
  check (sha256 = encode(extensions.digest(convert_to(canonical, 'UTF8'), 'sha256'), 'hex')),
  check ((document->>'schema' = 'splicr.lab-evidence.v1' and document->>'gene' = gene_symbol and document->>'kind' = kind) is true),
  check ((jsonb_typeof(document->'payload') = 'object' and jsonb_typeof(document->'inputs') = 'object') is true)
);
create index lab_evidence_lookup_ix on public.lab_evidence(screen_id,run_id,gene_symbol,kind,created_at desc);
alter table public.lab_evidence enable row level security;
create policy "read recorded lab evidence" on public.lab_evidence for select to authenticated
  using ((select private.can_read_screen(screen_id)));
grant select on public.lab_evidence to authenticated;
create function private.check_lab_evidence() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then raise exception 'Lab evidence receipts cannot be overwritten'; end if;
  if not exists (select 1 from public.runs where id = new.run_id and screen_id = new.screen_id)
    or not exists (select 1 from public.comparisons where id = new.comparison_id and screen_id = new.screen_id)
    then raise exception 'Evidence run and comparison must belong to its screen'; end if;
  return new;
end $$;
create trigger lab_evidence_receipt_guard before insert or update on public.lab_evidence
  for each row execute function private.check_lab_evidence();

-- Every visible screen is represented, including absent measurements. Caller
-- thresholds stay run-specific. Historical runs are explicit, not duplicates
-- masquerading as independent screens. SECURITY INVOKER preserves all RLS.
create function public.lab_gene_memory(p_org uuid, p_gene text, p_history boolean default false,
  p_offset int default 0, p_limit int default 100)
returns jsonb language sql stable security invoker set search_path = '' as $$
with visible as (
  select s.id, s.name, s.cell_line, s.phenotype, s.modality, s.library_id, s.current_run_id
  from public.screens s
  where s.org_id = p_org and (select private.is_org_member(p_org))
), records as (
  select s.id as screen_id, s.name as screen_name, s.cell_line, s.phenotype, s.modality,
    s.library_id, rq.verdict as qc_verdict, r.id as run_id, r.status as run_status, r.finished_at,
    r.id = s.current_run_id as current_run, c.id as comparison_id, c.name as comparison_name,
    h.id as hit_id, h.n_guides, h.lfc, h.fdr, h.depleted_fdr, h.enriched_fdr, h.mle_beta, h.mle_fdr,
    h.norm_z, h.drugz_fdr, h.bayes_factor,
    case when st.status = 'done' and st.metrics ? 'fdr_threshold'
      then (st.metrics->>'fdr_threshold')::double precision
      when r.settings ? 'fdr_threshold' then (r.settings->>'fdr_threshold')::double precision else null end as threshold,
    case when st.status = 'done' and st.metrics ? 'fdr_threshold' then 'effective' else 'requested_or_unknown' end as threshold_source,
    st.metrics->'methods' as completed_methods,
    r.settings->'experiment_details' as experiment_details,
    r.settings->'lab_evidence'->>'reagent_lot' as reagent_lot,
    (select jsonb_agg(jsonb_build_object('assay',o.assay,'result',o.result,'evidence',o.evidence,'created_at',o.created_at) order by o.created_at)
      from public.validation_outcomes o where o.screen_id = s.id and upper(o.gene_symbol) = upper(trim(p_gene))) as validation_outcomes
  from visible s
  left join public.runs r on r.screen_id = s.id and (p_history or r.id = s.current_run_id)
  left join public.comparisons c on c.screen_id = s.id and (c.is_primary or exists
    (select 1 from public.hits hh where hh.run_id=r.id and hh.comparison_id=c.id and upper(hh.gene_symbol)=upper(trim(p_gene))))
  left join public.hits h on h.screen_id = s.id and h.run_id = r.id and h.comparison_id=c.id and h.gene_symbol=upper(trim(p_gene))
  left join public.run_qc rq on rq.run_id = r.id
  left join public.run_stages st on st.run_id = r.id and st.stage='hits'
), classified as (
  select records.*, case
    when run_status is distinct from 'complete' then 'not_analysed'
    when hit_id is null or n_guides = 0 then 'not_measured'
    when fdr is null or threshold is null or threshold_source <> 'effective' then 'measured_uncalled'
    when fdr <= threshold then 'hit' else 'measured_not_hit' end as measurement_status
  from records
), paged as (
 select * from classified order by screen_name,screen_id,finished_at desc nulls last,run_id,comparison_id
 offset greatest(0,p_offset) limit least(50000,greatest(1,p_limit))
)
select jsonb_build_object('schema','splicr.lab-memory.v1','gene',upper(trim(p_gene)),
  'total',(select count(*) from classified),'rows',coalesce((select jsonb_agg(to_jsonb(paged)) from paged),'[]'::jsonb));
$$;
revoke all on function public.lab_gene_memory(uuid,text,boolean,int,int) from public,anon;
grant execute on function public.lab_gene_memory(uuid,text,boolean,int,int) to authenticated;
create index if not exists hits_memory_gene_ix on public.hits(gene_symbol,screen_id,run_id);
notify pgrst, 'reload schema';
