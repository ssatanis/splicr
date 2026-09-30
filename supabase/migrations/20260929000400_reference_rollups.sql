-- ============================================================================
-- 0020 · Reference rollups the app reads: DepMap dependency summary, the data
--        source registry, and read views for them and for cell models.
--
-- The bulk reference data live in the Parquet lake on R2 (engine/splicr/lake.py).
-- Postgres keeps only the small per-gene and per-model summaries a page needs
-- in one round trip. Sizes: ~18.5k gene rows, ~2.2k models, ~20 sources.
--
-- Loaded by scripts/data/load-reference-rollups.py from the lake; nothing here
-- is computed in SQL, so the database and the lake cannot disagree.
-- ============================================================================

create table if not exists atlas.gene_dependency (
  gene_symbol          text not null,
  release              text not null,
  hgnc_id              text,
  entrez_id            bigint,
  n_lines              int  not null,
  mean_effect          real,
  median_effect        real,
  min_effect           real,
  n_dependent          int  not null,          -- Chronos dependency probability >= 0.5
  frac_dependent       real not null,
  is_common_essential  boolean not null,       -- dependent in >= 90% of screened lines
  is_selective         boolean not null,       -- dependent in 1%-50% of lines
  top_lineages         jsonb not null default '[]'::jsonb,
  primary key (gene_symbol, release)
);

comment on table atlas.gene_dependency is
  'Per-gene DepMap Chronos summary by release. Definitions: dependent = probability >= 0.5; '
  'common essential = dependent in >= 90% of lines; selective = dependent in 1%-50% of lines. '
  'These are SplicR''s stated thresholds, not DepMap''s own common-essential call.';

create index if not exists gene_dependency_hgnc_ix on atlas.gene_dependency (hgnc_id);

create table if not exists atlas.data_sources (
  id             text primary key,
  name           text not null,
  layer          text not null,
  modality       text not null,
  scale          text not null,
  access         text not null,
  url            text not null,
  licence        text not null,
  status         text not null check (status in
                   ('lake', 'local', 'remote', 'cataloged', 'manual', 'controlled', 'unreachable')),
  holdings       text not null,
  lake_datasets  text[] not null default '{}',
  harmonized_to  text[] not null default '{}',
  notes          text,
  updated_at     timestamptz not null default now()
);

alter table atlas.gene_dependency enable row level security;
alter table atlas.data_sources    enable row level security;

drop policy if exists "atlas gene dependency is public" on atlas.gene_dependency;
create policy "atlas gene dependency is public" on atlas.gene_dependency
  for select to anon, authenticated using (true);
drop policy if exists "atlas data sources are public" on atlas.data_sources;
create policy "atlas data sources are public" on atlas.data_sources
  for select to anon, authenticated using (true);

grant select on atlas.gene_dependency, atlas.data_sources to anon, authenticated;

-- Cell models carry the harmonized identifiers; add the fields the lake holds.
alter table atlas.cell_models add column if not exists lineage text;
alter table atlas.cell_models add column if not exists rrid_source text;
alter table atlas.cell_models add column if not exists in_chronos boolean not null default false;

-- --- Data API views (atlas is not an exposed schema) -------------------------
create or replace view public.gene_dependency
with (security_invoker = true) as
select gene_symbol, release, hgnc_id, entrez_id, n_lines, mean_effect, median_effect, min_effect,
       n_dependent, frac_dependent, is_common_essential, is_selective, top_lineages
from atlas.gene_dependency;

create or replace view public.data_sources
with (security_invoker = true) as
select id, name, layer, modality, scale, access, url, licence, status, holdings,
       lake_datasets, harmonized_to, notes, updated_at
from atlas.data_sources;

create or replace view public.cell_model_catalog
with (security_invoker = true) as
select id, name, cellosaurus_id as rrid, depmap_id, sanger_id, lineage, tissue, disease,
       in_chronos, rrid_source
from atlas.cell_models;

grant select on public.gene_dependency, public.data_sources, public.cell_model_catalog to anon, authenticated;

notify pgrst, 'reload schema';
