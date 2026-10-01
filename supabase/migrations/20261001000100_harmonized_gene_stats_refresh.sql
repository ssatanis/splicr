-- ============================================================================
-- Keep the nightly Atlas rollup working under strict harmonization
--
-- 20260930155420 made atlas.gene_stats.ensembl_gene_id NOT NULL and added a row
-- trigger that rejects any row whose identifier is not a syntactically valid
-- Ensembl gene id. The nightly rollup scheduled in 20260926000900 predates that
-- and inserts (gene_symbol, n_screens, n_hits, hit_rate) only, so from the
-- moment enforcement went on every 03:17 run raised SQLSTATE 23514 and the
-- rollup stopped refreshing. This migration repairs it.
--
-- The rollup cannot invent an identifier and does not need to: every
-- atlas.screen_hits row now carries its own canonical ensembl_gene_id, so the
-- aggregate carries that identifier through.
--
-- ONE SYMBOL, ONE CANONICAL GENE. atlas.gene_stats is still keyed by
-- gene_symbol. A symbol that arrives under two different canonical ids cannot
-- be rolled into one row without a false merge, and it cannot become two rows
-- without a wider key change, so it is refused and written to
-- atlas.harmonization_rejects instead. That keeps the gap queryable rather than
-- hidden inside an aggregate, and it keeps the statement from failing with
-- "ON CONFLICT DO UPDATE command cannot affect row a second time".
--
-- The body moves into a function so it is versioned with the schema and can be
-- exercised directly, rather than living only as a cron command string.
-- ============================================================================

create or replace function atlas.refresh_gene_stats()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Mirrors engine/splicr/config.py ArtifactThresholds.frequent_hitter_rate.
  -- artifacts.check_frequent_hitter reads the Python value and this rollup
  -- writes the flag the console shows; the two must not drift.
  c_frequent_hitter_rate constant real := 0.25;
  v_count integer;
begin
  create temporary table _gene_stats_rollup on commit drop as
  select sh.gene_symbol,
         min(sh.ensembl_gene_id)                    as ensembl_gene_id,
         count(distinct sh.ensembl_gene_id)::int    as n_canonical,
         count(*)::int                              as n_screens,
         count(*) filter (where sh.is_hit)::int     as n_hits,
         (count(*) filter (where sh.is_hit))::real
           / nullif(count(*), 0)                    as hit_rate
    from atlas.screen_hits sh
   where sh.ensembl_gene_id is not null
   group by sh.gene_symbol;

  insert into atlas.harmonization_rejects
        (source, source_id, entity_kind, raw_value, reason, candidates, n_rows)
  select 'atlas_rollup', '', 'gene', gene_symbol,
         'ambiguous: symbol rolls up under ' || n_canonical || ' canonical Ensembl genes',
         '{}'::text[], n_screens
    from _gene_stats_rollup
   where n_canonical > 1
  on conflict (source, source_id, entity_kind, raw_value) do update
    set reason = excluded.reason, n_rows = excluded.n_rows, at = now();

  insert into atlas.gene_stats
        (gene_symbol, ensembl_gene_id, n_screens, n_hits, hit_rate,
         is_frequent_hitter, updated_at)
  select gene_symbol, ensembl_gene_id, n_screens, n_hits, hit_rate,
         coalesce(hit_rate, 0) > c_frequent_hitter_rate, now()
    from _gene_stats_rollup
   where n_canonical = 1
  on conflict (gene_symbol) do update
    set ensembl_gene_id    = excluded.ensembl_gene_id,
        n_screens          = excluded.n_screens,
        n_hits             = excluded.n_hits,
        hit_rate           = excluded.hit_rate,
        is_frequent_hitter = excluded.is_frequent_hitter,
        updated_at         = now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function atlas.refresh_gene_stats() from public;

comment on function atlas.refresh_gene_stats() is
  'Recomputes atlas.gene_stats screen and hit counts from atlas.screen_hits, '
  'carrying each row''s canonical Ensembl gene id so the strict harmonization '
  'trigger accepts the write. A symbol under two canonical genes is refused to '
  'atlas.harmonization_rejects rather than merged. Scheduled nightly as '
  'splicr-refresh-gene-stats.';

-- cron.schedule() replaces an existing job with the same name.
select cron.schedule(
  'splicr-refresh-gene-stats',
  '17 3 * * *',
  $$select atlas.refresh_gene_stats()$$
);

notify pgrst, 'reload schema';
