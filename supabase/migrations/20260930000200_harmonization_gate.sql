-- ============================================================================
-- 0023 · Harmonization at the gate, part 1: the columns and the ledger
--
-- 20260929000500 made Ensembl ids and Cellosaurus RRIDs mandatory for screens
-- SplicR reanalyzes from raw reads. Everything else - the BioGRID ORCS bulk
-- import, the DepMap rollups - still wrote free text. This migration adds what
-- the gate needs; 0024 turns enforcement on, after the existing corpus has been
-- re-loaded through it. Enforcing before the data complies would only mean the
-- next writer fails on rows that were already there.
--
-- WHY ENFORCEMENT IS SAFE HERE, MEASURED BEFORE WRITING IT
--
-- Of the 87,540 identifiers BioGRID ORCS calls genes, 25,426 (29%) resolve to a
-- current Ensembl gene. That looks alarming and is not: the rest are
-- non-targeting controls and placeholders - `NTC_new_12906`,
-- `Control_ACGCTCAGCACCCGCTATGC`, `pseudo_8663`, `NO_SITE_98`, `NO_CURRENT_371`
-- - plus retired Ensembl ids. They are what a harmonization gate exists to
-- stop. The identifiers that do resolve carry 99.0% of the screen observations
-- and 99.6% of the hit calls, so the gate removes 62,114 junk rows and 0.4% of
-- the measured signal.
--
-- Cell lines resolve for 1,780 of 1,952 ORCS screens (91.2%). The rest are
-- primary cells, patient-derived material and lines Cellosaurus does not list.
-- They are preserved in the rejection ledger, but cannot remain in the strict
-- query tables: every atlas.screens row has one canonical Cellosaurus key.
--
-- NOTHING IS DISCARDED SILENTLY. Every rejection lands in
-- atlas.harmonization_rejects with the raw value, the reason and how many rows
-- it cost, so the gap is queryable rather than inferred from a row count.
-- ============================================================================

alter table atlas.gene_stats add column if not exists ensembl_gene_id text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gene_stats_ensembl_format') then
    alter table atlas.gene_stats add constraint gene_stats_ensembl_format
      check (ensembl_gene_id is null or ensembl_gene_id ~ '^ENS(MUS)?G[0-9]{11}$');
  end if;
end;
$$;

create index if not exists gene_stats_ensembl_ix on atlas.gene_stats (ensembl_gene_id);

-- --- the ledger of what the gate refused -------------------------------------
create table if not exists atlas.harmonization_rejects (
  id          bigint generated always as identity primary key,
  source      text not null,              -- orcs | depmap | geo_rerun | sra_rerun | ...
  source_id   text not null default '',   -- the screen or dataset the value came from
  entity_kind text not null check (entity_kind in ('gene', 'cell_line', 'compound')),
  raw_value   text not null,
  reason      text not null,              -- unresolved (no match) | ambiguous (...) | missing value
  candidates  text[] not null default '{}',
  n_rows      bigint not null default 1,  -- rows this rejection kept out
  at          timestamptz not null default now(),
  unique (source, source_id, entity_kind, raw_value)
);

create index if not exists harmonization_rejects_source_ix on atlas.harmonization_rejects (source, entity_kind);
create index if not exists harmonization_rejects_value_ix on atlas.harmonization_rejects (raw_value);

comment on table atlas.harmonization_rejects is
  'Every entity an ingestion path refused because it did not map to Ensembl, '
  'Cellosaurus or ChEMBL, with the reason. Written by the gate in '
  'engine/splicr/harmonize.py:enforce(); nothing is dropped without a row here.';

-- --- read access --------------------------------------------------------------
alter table atlas.harmonization_rejects enable row level security;
drop policy if exists "harmonization rejects are public" on atlas.harmonization_rejects;
create policy "harmonization rejects are public" on atlas.harmonization_rejects
  for select to anon, authenticated using (true);
grant select on atlas.harmonization_rejects to anon, authenticated;

create or replace view public.harmonization_rejects
with (security_invoker = true) as
select source, source_id, entity_kind, raw_value, reason, candidates, n_rows, at
from atlas.harmonization_rejects;

create or replace view public.harmonization_summary
with (security_invoker = true) as
select source, entity_kind, reason, count(*) as n_values, sum(n_rows) as n_rows
from atlas.harmonization_rejects group by source, entity_kind, reason;

grant select on public.harmonization_rejects, public.harmonization_summary to anon, authenticated;

notify pgrst, 'reload schema';
