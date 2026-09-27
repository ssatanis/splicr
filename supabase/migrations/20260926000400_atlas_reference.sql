-- ============================================================================
-- 0004 · Atlas reference data
-- Written only by the offline engine (secret key). Readable by everyone.
-- Custom libraries carry an org_id and stay private to that organization.
-- ============================================================================

-- --- genes -----------------------------------------------------------------
create table atlas.genes (
  id              bigint generated always as identity primary key,
  taxid           int not null,
  symbol          text not null,
  name            text,
  hgnc_id         text,
  entrez_id       bigint,
  ensembl_id      text,
  aliases         text[] not null default '{}',
  prev_symbols    text[] not null default '{}',
  chrom           text,
  start_pos       bigint,
  end_pos         bigint,
  strand          char(1),
  biotype         text,
  assembly        text,
  source_version  text,
  updated_at      timestamptz not null default now(),
  constraint genes_strand_ck check (strand is null or strand in ('+', '-'))
);

create unique index genes_taxid_symbol_uq on atlas.genes (taxid, symbol);
create unique index genes_ensembl_uq on atlas.genes (ensembl_id) where ensembl_id is not null;
create index genes_entrez_ix on atlas.genes (entrez_id) where entrez_id is not null;
create index genes_symbol_trgm_ix on atlas.genes using gin (symbol extensions.gin_trgm_ops);
create index genes_aliases_ix on atlas.genes using gin (aliases);
create index genes_prev_ix on atlas.genes using gin (prev_symbols);

-- --- libraries and guides --------------------------------------------------
create table atlas.libraries (
  id              uuid primary key default private.uuid_v7(),
  org_id          uuid references public.organizations (id) on delete cascade,
  slug            text not null,
  name            text not null,
  taxid           int not null,
  modality        public.modality not null,
  cas             text not null,
  n_guides        int not null default 0,
  n_targeting     int not null default 0,
  n_controls      int not null default 0,
  n_genes         int not null default 0,
  guides_per_gene numeric(5,2),
  guide_length    int,
  addgene_id      text,
  source_url      text,
  source_version  text,
  vector_anchor   text,
  scaffold_anchor text,
  has_coordinates boolean not null default false,
  fingerprint     jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index libraries_public_slug_uq on atlas.libraries (slug) where org_id is null;
create unique index libraries_org_slug_uq on atlas.libraries (org_id, slug) where org_id is not null;
create index libraries_org_ix on atlas.libraries (org_id);

create trigger libraries_touch before update on atlas.libraries
  for each row execute function private.set_updated_at();

create table atlas.guides (
  id               bigint generated always as identity primary key,
  library_id       uuid not null references atlas.libraries (id) on delete cascade,
  guide_key        text not null,
  sequence         text not null,
  gene_symbol      text,
  gene_id          bigint references atlas.genes (id) on delete set null,
  is_control       boolean not null default false,
  control_type     text,
  chrom            text,
  cut_pos          bigint,
  strand           char(1),
  perfect_sites    int,
  mismatch1_sites  int,
  multi_gene       boolean not null default false,
  cfd_specificity  numeric(6,4),
  efficacy_score   numeric(6,4),
  plasmid_fraction numeric(12,10),
  constraint guides_seq_ck check (sequence ~ '^[ACGTN]{15,34}$'),
  constraint guides_strand_ck check (strand is null or strand in ('+', '-'))
);

create unique index guides_library_key_uq on atlas.guides (library_id, guide_key);
create index guides_library_seq_ix on atlas.guides (library_id, sequence);
create index guides_seq_hash_ix on atlas.guides using hash (sequence);
create index guides_gene_ix on atlas.guides (gene_id);
create index guides_library_symbol_ix on atlas.guides (library_id, gene_symbol);

-- --- reference gene sets ---------------------------------------------------
create table atlas.gene_sets (
  id             uuid primary key default private.uuid_v7(),
  slug           text not null unique,
  name           text not null,
  description    text,
  taxid          int not null,
  kind           text not null,
  source         text,
  source_version text,
  n_genes        int not null default 0,
  created_at     timestamptz not null default now()
);

create table atlas.gene_set_members (
  gene_set_id uuid not null references atlas.gene_sets (id) on delete cascade,
  symbol      text not null,
  gene_id     bigint references atlas.genes (id) on delete set null,
  primary key (gene_set_id, symbol)
);

create index gene_set_members_gene_ix on atlas.gene_set_members (gene_id);

-- --- cell models and copy number -------------------------------------------
create table atlas.cell_models (
  id             uuid primary key default private.uuid_v7(),
  name           text not null,
  cellosaurus_id text,
  depmap_id      text,
  sanger_id      text,
  taxid          int not null default 9606,
  tissue         text,
  disease        text,
  aliases        text[] not null default '{}',
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create unique index cell_models_cellosaurus_uq on atlas.cell_models (cellosaurus_id) where cellosaurus_id is not null;
create unique index cell_models_depmap_uq on atlas.cell_models (depmap_id) where depmap_id is not null;
create index cell_models_name_trgm_ix on atlas.cell_models using gin (name extensions.gin_trgm_ops);

-- DepMap OmicsCNGeneWGS is linear and ploidy-normalized (1.0 = unaltered).
create table atlas.copy_number (
  cell_model_id  uuid not null references atlas.cell_models (id) on delete cascade,
  gene_id        bigint not null references atlas.genes (id) on delete cascade,
  relative_cn    real not null,
  source_version text not null,
  primary key (cell_model_id, gene_id)
);

-- --- public screens and their hits -----------------------------------------
create table atlas.screens (
  id            uuid primary key default private.uuid_v7(),
  source        public.atlas_source not null,
  source_id     text not null,
  title         text not null,
  pmid          text,
  doi           text,
  year          int,
  taxid         int not null default 9606,
  library_id    uuid references atlas.libraries (id) on delete set null,
  library_name  text,
  modality      public.modality,
  cell_model_id uuid references atlas.cell_models (id) on delete set null,
  cell_line     text,
  phenotype     text,
  condition     text,
  methodology   text,
  analysis_tool text,
  n_genes       int,
  n_hits        int,
  has_raw_reads boolean not null default false,
  reanalyzed    boolean not null default false,
  embedding     extensions.vector(768),
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (source, source_id)
);

create index atlas_screens_library_ix on atlas.screens (library_id);
create index atlas_screens_model_ix on atlas.screens (cell_model_id);
create index atlas_screens_phenotype_trgm_ix on atlas.screens using gin (phenotype extensions.gin_trgm_ops);
create index atlas_screens_embedding_ix on atlas.screens
  using hnsw (embedding extensions.vector_cosine_ops);

create trigger atlas_screens_touch before update on atlas.screens
  for each row execute function private.set_updated_at();

-- One row per gene per public screen: the harmonized result.
create table atlas.screen_hits (
  screen_id   uuid not null references atlas.screens (id) on delete cascade,
  gene_symbol text not null,
  gene_id     bigint references atlas.genes (id) on delete set null,
  is_hit      boolean not null default false,
  direction   public.hit_direction,
  score       real,
  lfc         real,
  fdr         real,
  rank        int,
  primary key (screen_id, gene_symbol)
);

create index atlas_screen_hits_gene_ix on atlas.screen_hits (gene_id) where is_hit;
create index atlas_screen_hits_symbol_ix on atlas.screen_hits (gene_symbol) where is_hit;

-- Precomputed hit frequency per gene: the frequent-hitter signal.
create table atlas.gene_stats (
  gene_symbol   text primary key,
  gene_id       bigint references atlas.genes (id) on delete set null,
  n_screens     int not null default 0,
  n_hits        int not null default 0,
  hit_rate      real not null default 0,
  median_lfc    real,
  is_common_essential boolean not null default false,
  is_frequent_hitter  boolean not null default false,
  n_validated   int not null default 0,
  n_failed      int not null default 0,
  updated_at    timestamptz not null default now()
);

create index gene_stats_hit_rate_ix on atlas.gene_stats (hit_rate desc);
