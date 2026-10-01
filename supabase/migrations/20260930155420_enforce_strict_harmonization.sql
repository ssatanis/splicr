-- ============================================================================
-- Harmonization at the gate, part 2: strict enforcement
--
-- Run scripts/data/prepare-harmonization.py --apply after 0023 and before this
-- migration.  There is intentionally no legacy exemption: an Atlas row is
-- queryable only when its gene or cell line has one canonical identifier.
-- ============================================================================

do $$
declare
  failures text[] := '{}';
begin
  if exists (select 1 from atlas.screens where cell_line_rrid is null) then
    failures := array_append(failures, 'atlas.screens.cell_line_rrid');
  end if;
  if exists (select 1 from atlas.screen_hits where ensembl_gene_id is null) then
    failures := array_append(failures, 'atlas.screen_hits.ensembl_gene_id');
  end if;
  if exists (select 1 from atlas.gene_stats where ensembl_gene_id is null) then
    failures := array_append(failures, 'atlas.gene_stats.ensembl_gene_id');
  end if;
  if exists (select 1 from atlas.gene_dependency where ensembl_gene_id is null) then
    failures := array_append(failures, 'atlas.gene_dependency.ensembl_gene_id');
  end if;
  if cardinality(failures) > 0 then
    raise exception 'strict harmonization cannot be enabled; unresolved rows remain in %; run prepare-harmonization.py --apply',
      array_to_string(failures, ', ') using errcode = '23514';
  end if;
end;
$$;

alter table atlas.screens alter column cell_line_rrid set not null;
alter table atlas.screen_hits alter column ensembl_gene_id set not null;
alter table atlas.gene_stats alter column ensembl_gene_id set not null;
alter table atlas.gene_dependency alter column ensembl_gene_id set not null;

-- A row-level trigger gives COPY and upsert callers the same explicit error as
-- ordinary INSERTs.  The NOT NULL and CHECK constraints remain the final line
-- of defence if a trigger is ever disabled for maintenance.
create or replace function atlas.require_harmonized_screen() returns trigger
language plpgsql
set search_path = '' as $$
begin
  if new.cell_line_rrid is null or new.cell_line_rrid !~ '^CVCL_[A-Z0-9]{4}$' then
    raise exception 'screen % requires a valid Cellosaurus CVCL_ identifier (got %)',
      new.source_id, new.cell_line_rrid using errcode = '23514';
  end if;
  if new.source in ('geo_rerun', 'sra_rerun') and new.ingest_accession is null then
    raise exception 'reanalyzed screen % has no ingest_accession',
      new.source_id using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function atlas.require_harmonized_hit() returns trigger
language plpgsql
set search_path = '' as $$
begin
  if new.ensembl_gene_id is null
     or new.ensembl_gene_id !~ '^ENS(MUS)?G[0-9]{11}$' then
    raise exception 'gene % in screen % requires a valid Ensembl gene identifier (got %)',
      new.gene_symbol, new.screen_id, new.ensembl_gene_id using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function atlas.require_harmonized_gene() returns trigger
language plpgsql
set search_path = '' as $$
begin
  if new.ensembl_gene_id is null
     or new.ensembl_gene_id !~ '^ENS(MUS)?G[0-9]{11}$' then
    raise exception 'gene % requires a valid Ensembl gene identifier (got %)',
      new.gene_symbol, new.ensembl_gene_id using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists gene_stats_require_harmonized on atlas.gene_stats;
create trigger gene_stats_require_harmonized
before insert or update on atlas.gene_stats
for each row execute function atlas.require_harmonized_gene();

drop trigger if exists gene_dependency_require_harmonized on atlas.gene_dependency;
create trigger gene_dependency_require_harmonized
before insert or update on atlas.gene_dependency
for each row execute function atlas.require_harmonized_gene();

comment on function atlas.require_harmonized_gene() is
  'Rejects every gene rollup row without a syntactically valid Ensembl gene ID.';

notify pgrst, 'reload schema';
