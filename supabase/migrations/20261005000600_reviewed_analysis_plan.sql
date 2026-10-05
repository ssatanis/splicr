-- Versioned custom libraries and complete sample factors.
create or replace function public.import_workspace_library(p_screen_id uuid, p_name text, p_guides jsonb, p_source jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_id uuid; v_count int; v_slug text; v_taxid int; v_modality public.modality; v_cas text;
begin
  select org_id into v_org from public.screens where id = p_screen_id and status = 'draft' for update;
  if v_org is null or exists(select 1 from public.screens where id=p_screen_id and archived_at is not null) or not private.has_org_role(v_org, 'member') then raise exception 'A workspace draft is required.'; end if;
  if jsonb_typeof(p_guides) <> 'array' or jsonb_array_length(p_guides) = 0 or jsonb_array_length(p_guides) > 200000 then raise exception 'Invalid guide library.'; end if;
  if exists (select 1 from jsonb_array_elements(p_guides) g where length(g->>'guide_id') = 0 or g->>'sequence' !~ '^[ACGT]{17,30}$' or ((g->>'gene') is null and not coalesce((g->>'is_control')::boolean,false))) then raise exception 'Each guide needs a sequence and a target or control designation.'; end if;
  select count(distinct g->>'guide_id') into v_count from jsonb_array_elements(p_guides) g;
  if v_count <> jsonb_array_length(p_guides) then raise exception 'Guide IDs must be unique.'; end if;
  v_taxid := coalesce((p_source->>'organism_taxid')::int,9606);
  v_modality := coalesce(p_source->>'modality','knockout')::public.modality;
  v_cas := coalesce(p_source->>'cas','SpCas9');
  if v_taxid not in (9606,10090) or v_modality::text not in ('knockout','crispri','crispra') or v_cas not in ('SpCas9','dCas9') then raise exception 'Unsupported guide abundance library.'; end if;
  -- A changed guide map creates a new version. Existing runs retain their library.
  v_slug := 'custom-' || p_screen_id::text || '-' || md5(p_guides::text || p_source::text);
  select id into v_id from atlas.libraries where org_id=v_org and slug=v_slug;
  if v_id is null then
    insert into atlas.libraries(org_id,slug,name,taxid,modality,cas,n_guides,n_targeting,n_controls,n_genes,fingerprint,source_version)
    select v_org,v_slug,left(p_name,200),v_taxid,v_modality,v_cas,count(*),count(*) filter(where not (g->>'is_control')::boolean),count(*) filter(where (g->>'is_control')::boolean),count(distinct g->>'gene'),p_source,'confirmed-upload-v2'
    from jsonb_array_elements(p_guides) g returning id into v_id;
    insert into atlas.guides(library_id,guide_key,sequence,gene_symbol,is_control)
    select v_id,g->>'guide_id',g->>'sequence',g->>'gene',(g->>'is_control')::boolean from jsonb_array_elements(p_guides) g;
  end if;
  update public.screens set library_id=v_id where id=p_screen_id;
  return v_id;
end $$;
revoke all on function public.import_workspace_library(uuid,text,jsonb,jsonb) from public,anon;
grant execute on function public.import_workspace_library(uuid,text,jsonb,jsonb) to authenticated;

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
    insert into public.screens(org_id,created_by,name,source,cell_line,phenotype,modality,library_id,source_ref,tags)
    values(v_parent.org_id,auth.uid(),left(v_item->>'name',200),'upload',v_item->>'model',v_item->>'phenotype',coalesce((v_item->'settings'->>'modality')::public.modality,(select modality from atlas.libraries where id=p_library_id),v_parent.modality),p_library_id,p_screen_id::text,array['experiment:'||p_screen_id::text]) returning id into v_screen;
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
  update public.screens set archived_at=now(),name='Experiment inputs' where id=p_screen_id;
  return v_results;
end $$;
revoke all on function public.start_experiment_analysis(uuid,jsonb,uuid) from public,anon;
grant execute on function public.start_experiment_analysis(uuid,jsonb,uuid) to authenticated;
