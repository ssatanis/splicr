-- ============================================================================
-- The effect plot must be able to say what it left out.
--
-- A gene with no recorded log2 fold change has no position on an effect axis,
-- so it cannot be drawn. 251 of the 20,916 records in the GSE145743 run are
-- like that. Silently plotting 20,665 and calling it the comparison is the same
-- class of error as the 1,000-row cap this function was written to remove, just
-- smaller, so the function now returns the excluded count and the console
-- prints it beside the plot.
-- ============================================================================

create or replace function public.screen_effect_points(p_screen uuid, p_comparison uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with scoped as (
    select h.gene_symbol, h.lfc, h.fdr, h.comparison_id
      from public.hits h
     where h.screen_id = p_screen
       and h.comparison_id = p_comparison
  ),
  point as (
    select s.gene_symbol,
           s.lfc,
           s.fdr,
           -- Bit 1: a stored guide-disagreement report exists, so the dot opens.
           -- Bit 2: the call turns on one guide. Bit 4: the guides disagree more
           -- than this screen's own norm. Absent bits mean "not recorded", never
           -- "checked and fine"; the console says so.
           (case when d.gene_symbol is null then 0 else 1 end)
         + (case when coalesce(d.fragile, false) then 2 else 0 end)
         + (case when coalesce(d.discordant, false) then 4 else 0 end) as marks
      from scoped s
      left join public.gene_disagreement d
        on d.comparison_id = s.comparison_id
       and d.gene_symbol = upper(s.gene_symbol)
     where s.lfc is not null
     order by s.gene_symbol
  )
  select jsonb_build_object(
    'recorded', (select count(*) from point),
    'without_effect', (select count(*) from scoped where lfc is null),
    'gene',  coalesce((select jsonb_agg(gene_symbol) from point), '[]'::jsonb),
    'lfc',   coalesce((select jsonb_agg(lfc) from point), '[]'::jsonb),
    -- Null is kept as null. A gene with no recorded FDR is not FDR 1 and is
    -- certainly not FDR 0, and the plot draws it on its own labelled row.
    'fdr',   coalesce((select jsonb_agg(fdr) from point), '[]'::jsonb),
    'marks', coalesce((select jsonb_agg(marks) from point), '[]'::jsonb)
  );
$$;

notify pgrst, 'reload schema';
