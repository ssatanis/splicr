-- ============================================================================
-- 0022 · Read views for Ensembl-harmonized reference data and reanalyzed screens
--
-- public.gene_dependency gains ensembl_gene_id (filled by
-- scripts/data/load-reference-rollups.py). public.reanalyzed_screens lists the
-- screens the autonomous ingest rebuilt from raw reads, with their harmonized
-- identifiers, so the app can show them without reading atlas directly.
-- ============================================================================

create or replace view public.gene_dependency
with (security_invoker = true) as
select gene_symbol, release, hgnc_id, entrez_id, n_lines, mean_effect, median_effect, min_effect,
       n_dependent, frac_dependent, is_common_essential, is_selective, top_lineages, ensembl_gene_id
from atlas.gene_dependency;

create or replace view public.reanalyzed_screens
with (security_invoker = true) as
select s.id, s.ingest_accession as accession, s.source, s.source_id, s.title, s.pmid, s.year, s.taxid,
       s.library_name, s.modality, s.cell_line, s.cell_line_rrid, s.compound_chembl, s.phenotype,
       s.condition as contrast, s.analysis_tool, s.n_genes, s.n_hits,
       s.metadata ->> 'qc_verdict' as qc_verdict, s.metadata ->> 'pipeline_version' as pipeline_version,
       s.updated_at
from atlas.screens s
where s.reanalyzed and s.source in ('geo_rerun', 'sra_rerun');

create or replace view public.reanalyzed_hits
with (security_invoker = true) as
select h.screen_id, s.ingest_accession as accession, s.condition as contrast, h.gene_symbol, h.ensembl_gene_id,
       h.direction, h.lfc, h.fdr, h.score as rra_score, h.rank
from atlas.screen_hits h
join atlas.screens s on s.id = h.screen_id
where s.reanalyzed and s.source in ('geo_rerun', 'sra_rerun') and h.is_hit;

grant select on public.gene_dependency, public.reanalyzed_screens, public.reanalyzed_hits to anon, authenticated;

notify pgrst, 'reload schema';
