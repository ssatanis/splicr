-- ============================================================================
-- 0012 · public.gene_search
--
-- The command palette looks genes up by symbol. atlas.genes cannot be read over
-- the Data API: the project exposes only the public and graphql_public schemas,
-- so a request with Accept-Profile: atlas returns 406 PGRST106. This is the
-- same pattern as public.library_catalog in migration 0010.
--
-- security_invoker, so the caller's own permissions and the "atlas genes are
-- public" policy decide the rows. Nothing here widens what anyone could already
-- read; it only makes it reachable.
-- ============================================================================

create or replace view public.gene_search
with (security_invoker = true) as
select
  g.id,
  g.taxid,
  g.symbol,
  g.name,
  g.hgnc_id,
  g.entrez_id,
  g.ensembl_id,
  g.chrom,
  g.biotype
from atlas.genes g;

comment on view public.gene_search is
  'Symbol lookup over atlas.genes for the Data API. security_invoker, so the atlas.genes select policy decides the rows.';

grant select on public.gene_search to anon, authenticated;

-- A prefix search on 157,085 rows needs an index that ILIKE 'TP5%' can use.
-- text_pattern_ops handles the anchored prefix; the trigram index below covers
-- the unanchored contains-match the palette falls back to.
create index if not exists genes_symbol_prefix_ix
  on atlas.genes (upper(symbol) text_pattern_ops);

create index if not exists genes_symbol_trgm_ix
  on atlas.genes using gin (symbol gin_trgm_ops);
