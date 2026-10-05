-- Recreate the dependent view in the same transaction and retain session RLS.
do $$
declare v_definition text := pg_get_viewdef('public.hit_report'::regclass, true);
begin
  drop view public.hit_report;
-- Preserve tool-native probabilities below the float4 range, including guide p-values.
alter table public.guide_effects
  alter column p_value type double precision,
  alter column fdr type double precision;
alter table public.gene_disagreement
  alter column fisher_p type double precision,
  alter column fisher_p_floor type double precision;
alter table public.hits
  alter column rra_score type double precision,
  alter column p_value type double precision,
  alter column fdr type double precision,
  alter column mle_fdr type double precision,
  alter column drugz_fdr type double precision,
  alter column depleted_fdr type double precision,
  alter column enriched_fdr type double precision,
  alter column depleted_p type double precision,
  alter column enriched_p type double precision;

  execute 'create view public.hit_report with (security_invoker=true) as ' || v_definition;
  grant select on public.hit_report to anon, authenticated;
  grant all on public.hit_report to service_role;
end $$;
