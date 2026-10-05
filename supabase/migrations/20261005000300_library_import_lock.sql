-- Completed experiment guide maps cannot be rewritten through their archived input draft.
create or replace function public.import_workspace_library(p_screen_id uuid, p_name text, p_guides jsonb, p_source jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_id uuid; v_count int;
begin
  select org_id into v_org from public.screens where id = p_screen_id and status = 'draft' and archived_at is null for update;
  if v_org is null or not private.has_org_role(v_org, 'member') then raise exception 'A workspace draft is required.'; end if;
  if jsonb_typeof(p_guides) <> 'array' or jsonb_array_length(p_guides) = 0 or jsonb_array_length(p_guides) > 200000 then raise exception 'Invalid guide library.'; end if;
  if exists (select 1 from jsonb_array_elements(p_guides) g where coalesce(length(g->>'guide_id'),0) = 0 or coalesce(g->>'sequence','') !~ '^[ACGT]{17,30}$' or (nullif(trim(g->>'gene'),'') is null and not coalesce(coalesce((g->>'is_control')::boolean,false),false))) then raise exception 'Each guide needs a sequence and a target or control designation.'; end if;
  select count(distinct g->>'guide_id') into v_count from jsonb_array_elements(p_guides) g;
  if v_count <> jsonb_array_length(p_guides) then raise exception 'Guide IDs must be unique.'; end if;
  insert into atlas.libraries(org_id,slug,name,taxid,modality,cas,n_guides,n_targeting,n_controls,n_genes,fingerprint,source_version)
  select v_org, 'custom-' || p_screen_id::text, left(p_name,200),9606,'knockout','SpCas9',count(*),count(*) filter(where not coalesce((g->>'is_control')::boolean,false)),count(*) filter(where coalesce((g->>'is_control')::boolean,false)),count(distinct g->>'gene'),p_source,'confirmed-upload'
  from jsonb_array_elements(p_guides) g
  on conflict (org_id,slug) where org_id is not null do update set name=excluded.name,n_guides=excluded.n_guides,n_targeting=excluded.n_targeting,n_controls=excluded.n_controls,n_genes=excluded.n_genes,fingerprint=excluded.fingerprint returning id into v_id;
  delete from atlas.guides where library_id=v_id;
  insert into atlas.guides(library_id,guide_key,sequence,gene_symbol,is_control)
  select v_id,g->>'guide_id',g->>'sequence',g->>'gene',coalesce((g->>'is_control')::boolean,false) from jsonb_array_elements(p_guides) g;
  update public.screens set library_id=v_id where id=p_screen_id;
  return v_id;
end $$;
revoke all on function public.import_workspace_library(uuid,text,jsonb,jsonb) from public,anon;
grant execute on function public.import_workspace_library(uuid,text,jsonb,jsonb) to authenticated;

