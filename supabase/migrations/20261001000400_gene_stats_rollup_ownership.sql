-- ============================================================================
-- atlas.gene_stats has one owner: the loader that can see the whole corpus
--
-- WHAT WENT WRONG, MEASURED
--
-- 20260926000900 scheduled splicr-refresh-gene-stats to recompute
-- atlas.gene_stats every night from atlas.screen_hits. That is only correct if
-- atlas.screen_hits holds the whole BioGRID ORCS corpus. It does not.
--
-- atlas.gene_stats is loaded from the ORCS rollup parquet by
-- scripts/data/load-reference-rollups.py and scripts/data/ingest-orcs.py and
-- carries counts over all 1,952 human ORCS screens: ALG11 is 797 hits in the
-- 1,389 screens that tested it. atlas.screen_hits is the several-GB per-screen
-- table, loaded separately and, in practice, for a subset.
--
-- Rolling a subset up over the full table's key overwrites a 1,389-screen
-- denominator with a 1-screen one. Run once against a database holding four
-- loaded screens, it rewrote 27 genes from figures like "797 of 1,389" to
-- "1 of 1" and introduced one gene ORCS does not list. Those rows were restored
-- from the parquet and the introduced row removed before this migration.
--
-- The job had been erroring since strict harmonization went on, because it wrote
-- no ensembl_gene_id. That failure is the only reason the corruption had not
-- already happened nightly. Repairing the write alone - which 20261001000100 did
-- - turns a loud, harmless error into a quiet, harmful one, so it is reverted
-- here.
--
-- WHY THERE IS NO GUARDED VERSION
--
-- The first attempt kept the function and refused unless atlas.screen_hits
-- covered every atlas.screens row. That guard does not work, and the reason is
-- worth recording: atlas.screens held four rows too, so a four-screen corpus
-- looked complete while atlas.gene_stats described 1,952. The database cannot
-- know which corpus a file-loaded rollup came from, so no in-database check can
-- establish that the two tables describe the same experiments.
--
-- So the rollup is not recomputed in SQL at all. atlas.gene_stats is written by
-- the loaders, which read the ORCS rollup directly, resolve every identifier
-- through the harmonization gate and ledger everything they refuse. A rate whose
-- denominator is wrong is worse than a rate that is a day old.
-- ============================================================================

select cron.unschedule('splicr-refresh-gene-stats')
 where exists (select 1 from cron.job where jobname = 'splicr-refresh-gene-stats');

drop function if exists atlas.refresh_gene_stats();

comment on table atlas.gene_stats is
  'Per-gene BioGRID ORCS hit frequency over the whole human corpus, plus '
  'is_common_essential from the DepMap summary. Written only by '
  'scripts/data/ingest-orcs.py --postgres and '
  'scripts/data/load-reference-rollups.py --go, which see every screen and '
  'ledger every identifier they refuse to atlas.harmonization_rejects. Nothing '
  'recomputes it from atlas.screen_hits: that table is loaded separately and a '
  'partial load would overwrite corpus-wide denominators with subset ones.';

notify pgrst, 'reload schema';
