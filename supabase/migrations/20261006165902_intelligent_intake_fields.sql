-- Experiment provenance is separate from the account that submitted the run.
-- Existing screens RLS also protects these fields and the saved intake plan.
alter table public.screens
  add column if not exists experiment_date date,
  add column if not exists researcher_id uuid references auth.users(id) on delete set null,
  add column if not exists researcher_name text,
  add column if not exists intake_config jsonb not null default '{}'::jsonb;

-- Read-only, bounded matching, using the caller's catalogue visibility.
create or replace function public.inspect_library_guides(p_library_id uuid, p_ids text[])
returns jsonb language sql stable security invoker set search_path = '' as $$
  with probe as (select distinct value from unnest(p_ids[1:2000]) value),
  matches as (
    select p.value, count(distinct g.guide_key) n, min(g.guide_key) target
    from probe p left join atlas.guides g on g.library_id=p_library_id and (g.guide_key=p.value or g.sequence=upper(p.value))
    group by p.value
  )
  select jsonb_build_object('checked', count(*), 'matched', count(*) filter(where n=1),
    'aliases', coalesce(jsonb_agg(jsonb_build_object('source',value,'target',target)) filter(where n=1 and value<>target),'[]'::jsonb),
    'unmatched', coalesce(jsonb_agg(value) filter(where n<>1),'[]'::jsonb)) from matches;
$$;
revoke all on function public.inspect_library_guides(uuid,text[]) from public,anon;
grant execute on function public.inspect_library_guides(uuid,text[]) to authenticated;

-- FASTQ matching counts distinct reads, rather than treating every possible
-- adapter offset as an independent guide. No unmatched read becomes a hit.
create or replace function public.detect_read_libraries(p_reads text[])
returns table(library_id uuid, slug text, name text, n_guides bigint, n_matched bigint, match_rate numeric, coverage numeric)
language sql stable security invoker set search_path = '' as $$
  with reads as (select ord, upper(value) seq from unnest(p_reads[1:100]) with ordinality as r(value,ord) where length(value) between 17 and 300),
  lengths as (select distinct length(sequence) n from atlas.guides where length(sequence) between 17 and 30),
  probes as (select r.ord, substring(r.seq from pos for len.n) seq from reads r cross join lengths len cross join lateral generate_series(1,least(length(r.seq)-len.n+1,150)) pos),
  matched as (select g.library_id,count(distinct p.ord) n,count(distinct g.guide_key) guides from probes p join atlas.guides g on g.sequence=p.seq or g.sequence=translate(reverse(p.seq),'ACGT','TGCA') group by g.library_id)
  select l.id,l.slug,l.name,l.n_guides::bigint,m.n,m.n::numeric/greatest((select count(*) from reads),1),m.guides::numeric/greatest(l.n_guides,1)
  from matched m join atlas.libraries l on l.id=m.library_id where l.n_guides>0 order by m.n desc limit 4;
$$;
revoke all on function public.detect_read_libraries(text[]) from public,anon;
grant execute on function public.detect_read_libraries(text[]) to authenticated;

-- All comparisons queue in one transaction. Shared objects remain in their original org prefix.
create or replace function public.start_experiment_analysis(p_screen_id uuid, p_comparisons jsonb, p_library_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_parent public.screens; v_item jsonb; v_screen uuid; v_run uuid; v_sample jsonb; v_ids jsonb; v_id uuid; v_results jsonb := '[]';
begin
  select * into v_parent from public.screens where id=p_screen_id for update;
  if not found or (v_parent.status <> 'draft' or v_parent.archived_at is not null) or not private.has_org_role(v_parent.org_id,'member') then raise exception 'This experiment cannot be started.'; end if;
  if jsonb_typeof(p_comparisons) <> 'array' or jsonb_array_length(p_comparisons) not between 1 and 64 then raise exception 'Choose 1 to 64 comparisons.'; end if;
  if p_library_id is not null and not exists(select 1 from atlas.libraries where id=p_library_id and (org_id is null or org_id=v_parent.org_id)) then raise exception 'This library is not available to this workspace.'; end if;
  for v_item in select value from jsonb_array_elements(p_comparisons) loop
    if coalesce(jsonb_array_length(v_item->'treatment'),0)=0 or coalesce(jsonb_array_length(v_item->'control'),0)=0 then raise exception 'Each comparison needs two arms.'; end if;
    if exists(select 1 from jsonb_array_elements_text(v_item->'treatment') t join jsonb_array_elements_text(v_item->'control') c on t.value=c.value) then raise exception 'Comparison arms must be disjoint.'; end if;
    if not exists(select 1 from public.screen_files where screen_id=p_screen_id and id=(v_item->'source'->>'fileId')::uuid and status='complete') then raise exception 'Comparison source is missing.'; end if;
    insert into public.screens(org_id,created_by,name,source,cell_line,phenotype,modality,library_id,source_ref,tags,experiment_date,researcher_id,researcher_name,intake_config)
    values(v_parent.org_id,auth.uid(),left(coalesce(v_item->>'screen_name',v_item->>'name'),200),'upload',v_item->>'model',v_item->>'phenotype',coalesce((v_item->'settings'->>'modality')::public.modality,(select modality from atlas.libraries where id=p_library_id),v_parent.modality),p_library_id,p_screen_id::text,array['experiment:'||p_screen_id::text],v_parent.experiment_date,v_parent.researcher_id,v_parent.researcher_name,v_parent.intake_config) returning id into v_screen;
    insert into public.screen_files(screen_id,kind,storage_key,original_name,byte_size,checksum_sha256,status,metadata)
    select v_screen,kind,storage_key,original_name,byte_size,checksum_sha256,status,metadata || jsonb_build_object('source_file_id',id)
    from public.screen_files where screen_id=p_screen_id and status='complete';
    v_ids := '{}';
    for v_sample in select value from jsonb_array_elements(v_item->'samples') loop
      insert into public.samples(screen_id,label,condition,replicate,role,position,metadata)
      values(v_screen,v_sample->>'label',coalesce(v_sample->'factors'->>'condition',v_sample->>'role'),(v_sample->>'replicate')::int,(v_sample->>'role')::public.sample_role,(select count(*) from jsonb_each(v_ids)),jsonb_build_object('factors',coalesce(v_sample->'factors','{}'::jsonb))) returning id into v_id;
      v_ids := v_ids || jsonb_build_object(v_sample->>'label',v_id);
    end loop;
    insert into public.comparisons(screen_id,name,treatment_ids,control_ids,is_primary,paired,settings)
    values(v_screen,v_item->>'name',array(select (v_ids->>value)::uuid from jsonb_array_elements_text(v_item->'treatment')),array(select (v_ids->>value)::uuid from jsonb_array_elements_text(v_item->'control')),true,coalesce((v_item->'settings'->>'drugz_paired')::boolean,false),v_item->'settings');
    v_run := public.start_screen_analysis(v_screen,(v_item->'settings') || jsonb_build_object('source',v_item->'source','experiment_id',p_screen_id));
    v_results := v_results || jsonb_build_array(jsonb_build_object('screenId',v_screen,'runId',v_run,'name',v_item->>'name'));
  end loop;
  update public.screens set archived_at=now() where id=p_screen_id;
  return v_results;
end $$;
revoke all on function public.start_experiment_analysis(uuid,jsonb,uuid) from public,anon;
grant execute on function public.start_experiment_analysis(uuid,jsonb,uuid) to authenticated;
