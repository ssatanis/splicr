-- Avoid per-guide RLS subqueries over a genome-scale probe. These read-only
-- functions enforce the equivalent library visibility once before matching.
-- No table mutation, dynamic SQL, unbounded input, or private schema access.
create or replace function public.inspect_library_guides(p_library_id uuid, p_ids text[], p_sequences text[] default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  with visible as (select l.id from atlas.libraries l where l.id=p_library_id and auth.uid() is not null and (l.org_id is null or exists(select 1 from public.org_members m where m.org_id=l.org_id and m.user_id=auth.uid()))),
  probe as (select value, coalesce(nullif(p_sequences[ord],''),upper(value)) seq from unnest(p_ids[1:2000]) with ordinality r(value,ord)),
  exact as (select p.value,g.guide_key target from probe p join visible l on true join atlas.guides g on g.library_id=l.id and g.guide_key=p.value),
  by_sequence as (select p.value,g.guide_key target from probe p join visible l on true join atlas.guides g on g.library_id=l.id and g.sequence=p.seq where not exists(select 1 from exact e where e.value=p.value)),
  matches as (select p.value,count(distinct m.target) n,min(m.target) target from probe p left join (select * from exact union select * from by_sequence) m on m.value=p.value group by p.value)
  select jsonb_build_object('checked',count(*),'matched',count(*) filter(where n=1),
    'aliases',coalesce(jsonb_agg(jsonb_build_object('source',value,'target',target)) filter(where n=1 and value<>target),'[]'::jsonb),
    'unmatched',coalesce(jsonb_agg(value) filter(where n<>1),'[]'::jsonb)) from matches;
$$;
revoke all on function public.inspect_library_guides(uuid,text[],text[]) from public,anon;
grant execute on function public.inspect_library_guides(uuid,text[],text[]) to authenticated;

create or replace function public.detect_read_libraries(p_reads text[])
returns table(library_id uuid, slug text, name text, n_guides bigint, n_matched bigint, match_rate numeric, coverage numeric)
language sql stable security definer set search_path = '' as $$
  with visible as (select l.* from atlas.libraries l where auth.uid() is not null and l.n_guides>0 and (l.org_id is null or exists(select 1 from public.org_members m where m.org_id=l.org_id and m.user_id=auth.uid()))),
  reads as (select ord,upper(value) seq from unnest(p_reads[1:100]) with ordinality r(value,ord) where length(value) between 17 and 300),
  lengths as (select generate_series(17,30) n),
  probes as (select r.ord,substring(r.seq from pos for len.n) seq from reads r cross join lengths len cross join lateral generate_series(1,least(length(r.seq)-len.n+1,150)) pos),
  strands as (select ord,seq from probes union select ord,translate(reverse(seq),'ACGT','TGCA') from probes),
  matched as (select g.library_id,count(distinct p.ord) n,count(distinct g.guide_key) guides from strands p join atlas.guides g on g.sequence=p.seq join visible l on l.id=g.library_id group by g.library_id)
  select l.id,l.slug,l.name,l.n_guides::bigint,m.n,m.n::numeric/greatest((select count(*) from reads),1),m.guides::numeric/greatest(l.n_guides,1)
  from matched m join visible l on l.id=m.library_id order by m.n desc limit 4;
$$;
revoke all on function public.detect_read_libraries(text[]) from public,anon;
grant execute on function public.detect_read_libraries(text[]) to authenticated;
