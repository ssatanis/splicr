-- Large public libraries exceed the API statement timeout when inserted in one request.
-- Stage bounded batches in a draft; publish only after the complete map is present.
create or replace function public.begin_workspace_library_import(p_screen_id uuid,p_name text,p_n_guides int,p_source jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_id uuid; v_taxid int; v_modality public.modality; v_cas text; v_slug text;
begin
  select org_id into v_org from public.screens where id=p_screen_id and status='draft' and archived_at is null for update;
  if v_org is null or not private.has_org_role(v_org,'member') then raise exception 'A workspace draft is required.'; end if;
  if p_n_guides not between 1 and 200000 or p_source->>'guide_sha256' !~ '^[a-f0-9]{64}$' then raise exception 'Invalid library manifest.'; end if;
  v_taxid := (p_source->>'organism_taxid')::int; v_modality := (p_source->>'modality')::public.modality; v_cas := p_source->>'cas';
  if v_taxid is null or v_taxid not in (9606,10090) or v_modality is null or v_modality::text not in ('knockout','crispri','crispra') or v_cas is null or v_cas not in ('SpCas9','dCas9') then raise exception 'Unsupported guide abundance library.'; end if;
  v_slug := 'custom-'||p_screen_id::text||'-'||md5(p_source::text);
  select id into v_id from atlas.libraries where org_id=v_org and slug=v_slug;
  if v_id is null then
    insert into atlas.libraries(org_id,slug,name,taxid,modality,cas,fingerprint,source_version)
    values(v_org,v_slug,left(p_name,200),v_taxid,v_modality,v_cas,p_source||jsonb_build_object('import_status','importing','expected_guides',p_n_guides),'confirmed-upload-v3') returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.stage_workspace_library_guides(p_screen_id uuid,p_library_id uuid,p_guides jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_library atlas.libraries;
begin
  select org_id into v_org from public.screens where id=p_screen_id and status='draft' and archived_at is null for update;
  if v_org is null or not private.has_org_role(v_org,'member') then raise exception 'A workspace draft is required.'; end if;
  select * into v_library from atlas.libraries where id=p_library_id and org_id=v_org for update;
  if not found or v_library.fingerprint->>'import_status' not in ('importing','ready') or v_library.slug not like 'custom-'||p_screen_id::text||'-%' then raise exception 'This library import is not available.'; end if;
  if jsonb_typeof(p_guides) <> 'array' or jsonb_array_length(p_guides) not between 1 and 2000 then raise exception 'Invalid library batch.'; end if;
  if exists(select 1 from jsonb_array_elements(p_guides) g where coalesce(length(g->>'guide_id'),0)=0 or g->>'guide_id' ~ E'[\\t\\r\\n]' or coalesce(g->>'sequence','') !~ '^[ACGT]{17,30}$' or ((g->>'gene') is null and not coalesce((g->>'is_control')::boolean,false))) then raise exception 'Each guide needs a sequence and a target or control designation.'; end if;
  if (select count(distinct g->>'guide_id') from jsonb_array_elements(p_guides) g) <> jsonb_array_length(p_guides) then raise exception 'Guide IDs must be unique.'; end if;
  if exists(select 1 from jsonb_array_elements(p_guides) g join atlas.guides a on a.library_id=p_library_id and a.guide_key=g->>'guide_id' where a.sequence is distinct from g->>'sequence' or a.gene_symbol is distinct from g->>'gene' or a.is_control is distinct from (g->>'is_control')::boolean) then raise exception 'A saved guide differs from the confirmed import.'; end if;
  if v_library.fingerprint->>'import_status'='ready' then return; end if;
  insert into atlas.guides(library_id,guide_key,sequence,gene_symbol,is_control)
  select p_library_id,g->>'guide_id',g->>'sequence',g->>'gene',(g->>'is_control')::boolean from jsonb_array_elements(p_guides) g
  on conflict(library_id,guide_key) do nothing;
  if (select count(*) from atlas.guides where library_id=p_library_id) > (v_library.fingerprint->>'expected_guides')::int then raise exception 'Library exceeds its manifest.'; end if;
end $$;

create or replace function public.finish_workspace_library_import(p_screen_id uuid,p_library_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_library atlas.libraries; v_total int; v_controls int; v_genes int;
begin
  select org_id into v_org from public.screens where id=p_screen_id and status='draft' and archived_at is null for update;
  if v_org is null or not private.has_org_role(v_org,'member') then raise exception 'A workspace draft is required.'; end if;
  select * into v_library from atlas.libraries where id=p_library_id and org_id=v_org for update;
  if not found or v_library.slug not like 'custom-'||p_screen_id::text||'-%' then raise exception 'This library import is not available.'; end if;
  select count(*),count(*) filter(where is_control),count(distinct gene_symbol) into v_total,v_controls,v_genes from atlas.guides where library_id=p_library_id;
  if v_total <> (v_library.fingerprint->>'expected_guides')::int then raise exception 'The library is incomplete. Retry the import to resume.'; end if;
  update atlas.libraries set n_guides=v_total,n_targeting=v_total-v_controls,n_controls=v_controls,n_genes=v_genes,fingerprint=fingerprint||jsonb_build_object('import_status','ready') where id=p_library_id;
  update public.screens set library_id=p_library_id where id=p_screen_id;
  return p_library_id;
end $$;
revoke all on function public.begin_workspace_library_import(uuid,text,int,jsonb),public.stage_workspace_library_guides(uuid,uuid,jsonb),public.finish_workspace_library_import(uuid,uuid) from public,anon;
grant execute on function public.begin_workspace_library_import(uuid,text,int,jsonb),public.stage_workspace_library_guides(uuid,uuid,jsonb),public.finish_workspace_library_import(uuid,uuid) to authenticated;
