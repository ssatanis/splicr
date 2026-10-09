drop function public.inspect_library_guides(uuid,text[]);
create function public.inspect_library_guides(p_library_id uuid, p_ids text[], p_sequences text[] default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with probe as (select value, coalesce(p_sequences[ord],upper(value)) seq from unnest(p_ids[1:2000]) with ordinality r(value,ord)),
  matches as (
    select p.value, count(distinct g.guide_key) n, min(g.guide_key) target
    from probe p left join atlas.guides g on g.library_id=p_library_id and (g.guide_key=p.value or g.sequence=upper(p.value) or (p.seq<>'' and g.sequence=p.seq))
    group by p.value
  )
  select jsonb_build_object('checked', count(*), 'matched', count(*) filter(where n=1),
    'aliases', coalesce(jsonb_agg(jsonb_build_object('source',value,'target',target)) filter(where n=1 and value<>target),'[]'::jsonb),
    'unmatched', coalesce(jsonb_agg(value) filter(where n<>1),'[]'::jsonb)) from matches;
$$;
revoke all on function public.inspect_library_guides(uuid,text[],text[]) from public,anon;
grant execute on function public.inspect_library_guides(uuid,text[],text[]) to authenticated;
