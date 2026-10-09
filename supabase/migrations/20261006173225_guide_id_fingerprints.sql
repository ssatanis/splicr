-- Count matrices can identify their library without a DNA column.
create index if not exists guides_guide_key_ix on atlas.guides(guide_key);
create function public.detect_guide_libraries(p_ids text[])
returns table(library_id uuid,slug text,name text,n_guides bigint,n_matched bigint,match_rate numeric,coverage numeric)
language sql stable security definer set search_path = '' as $$
  with probe as (select distinct value from unnest(p_ids[1:2000]) value),
  visible as (select l.* from atlas.libraries l where auth.uid() is not null and l.n_guides>0 and (l.org_id is null or exists(select 1 from public.org_members m where m.org_id=l.org_id and m.user_id=auth.uid()))),
  matched as (select g.library_id,count(distinct p.value) n from probe p join atlas.guides g on g.guide_key=p.value join visible l on l.id=g.library_id group by g.library_id)
  select l.id,l.slug,l.name,l.n_guides::bigint,m.n,m.n::numeric/greatest((select count(*) from probe),1),m.n::numeric/greatest(l.n_guides,1)
  from matched m join visible l on l.id=m.library_id order by m.n desc limit 4;
$$;
revoke all on function public.detect_guide_libraries(text[]) from public,anon;
grant execute on function public.detect_guide_libraries(text[]) to authenticated;
