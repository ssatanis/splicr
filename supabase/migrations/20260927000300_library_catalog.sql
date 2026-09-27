-- ============================================================================
-- 0010 · public.library_catalog
--
-- The web app needs the library list to populate the analysis defaults in
-- workspace settings. atlas.libraries cannot be read over the Data API: the
-- project exposes only the public and graphql_public schemas, so a request with
-- Accept-Profile: atlas comes back 406 PGRST106, invalid schema. The grants in
-- migration 0008 are for the offline engine and for views such as
-- public.screen_overview that join atlas from inside the database.
--
-- This is the read-only projection the app can reach. security_invoker keeps
-- the caller's own permissions and policies in force, so the
-- "public libraries and own custom libraries" policy on atlas.libraries still
-- decides which rows come back: the public catalog for everyone, plus an
-- organization's own custom libraries for its members. Nothing is added to what
-- a caller could already see, and the columns are reference data only.
-- ============================================================================

create or replace view public.library_catalog
with (security_invoker = true) as
select
  l.id,
  l.org_id,
  l.slug,
  l.name,
  l.taxid,
  l.modality,
  l.cas,
  l.n_guides,
  l.n_targeting,
  l.n_controls,
  l.n_genes,
  l.guides_per_gene,
  l.guide_length,
  l.addgene_id,
  l.source_url,
  l.source_version,
  l.has_coordinates
from atlas.libraries l;

comment on view public.library_catalog is
  'Reference view of atlas.libraries for the Data API. security_invoker, so the atlas.libraries select policy decides the rows.';

grant select on public.library_catalog to anon, authenticated;
