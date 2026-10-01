-- ============================================================================
-- The per-gene guide-disagreement report, computed once and stored
--
-- WHY IT IS STORED RATHER THAN COMPUTED PER REQUEST
--
-- The console's deep dive needs, for one gene: how much its guides disagree
-- against the spread this screen shows for genes of the same size, whether the
-- call survives dropping one guide, and - where the annotation resolved - the
-- 2x2 table of (guide depleted) by (guide cuts the feature the depleting guides
-- share) with its exact Fisher p and the smallest p that table could ever have
-- reached.
--
-- All of that is one function in engine/splicr/validate/domain_report.py. If the
-- console recomputed it the repository would hold the same statistics in Python
-- and in TypeScript, and they would drift. So the engine computes it at analysis
-- time, against a named reference release, and the console reads a recorded
-- value. Two readers a month apart see the same number, and the row says which
-- code and which references produced it.
--
-- WHAT IS QUERYABLE AND WHAT IS A DOCUMENT
--
-- The scalars a reader sorts and filters by are their own columns. The full
-- report - the guide rows, the concordance table, the sentence - is one jsonb
-- document validated against a schema, because it mirrors a pydantic model and a
-- thirty-column table that shadows that model is a second definition of it.
-- schema_version is checked so an older document is recognised rather than
-- silently mis-rendered.
--
-- COVERAGE IS EXPLICIT
--
-- concordance_status = 'not_evaluated' means the protein context was never looked
-- up for this gene, which happens for every gene outside the run's annotation
-- shortlist. It is not the same as 'no_features', which means it was looked up
-- and no curated feature covers any resolved cut. A reader must be able to tell
-- those apart, so they are different values and the console prints different
-- sentences for them.
-- ============================================================================

create table public.gene_disagreement (
  screen_id      uuid not null references public.screens (id) on delete cascade,
  run_id         uuid not null references public.runs (id) on delete cascade,
  comparison_id  uuid not null references public.comparisons (id) on delete cascade,
  gene_symbol    text not null,
  ensembl_gene_id text,

  n_guides       int  not null,
  n_depleting    int  not null,
  mean_lfc       real not null,
  median_lfc     real not null,
  --  Sample standard deviation of this gene's guide fold changes, and that
  --  spread over the median spread of same-size genes in the same comparison.
  --  The ratio is null when the comparison had too few same-size genes to form a
  --  baseline; it is never replaced by an absolute cut.
  spread         real,
  spread_vs_screen real,
  discordant     boolean not null default false,
  --  True when dropping one guide moves the gene mean across the threshold.
  fragile        boolean not null default false,
  pivotal_guide  text,

  concordance_status text not null,
  concordance_feature text,
  --  Two-sided Fisher exact p, and the smallest p the table's margins allow.
  --  Both null unless the table could be built.
  fisher_p       real,
  fisher_p_floor real,

  schema_version text not null default '1',
  report         jsonb not null,
  created_at     timestamptz not null default now(),

  primary key (comparison_id, gene_symbol),
  constraint gene_disagreement_schema_ck check (schema_version in ('1')),
  constraint gene_disagreement_counts_ck
    check (n_guides >= 2 and n_depleting between 0 and n_guides),
  constraint gene_disagreement_status_ck
    check (concordance_status in ('shared_feature', 'spans_features', 'overlapping',
                                 'no_features', 'not_evaluable', 'not_evaluated')),
  --  A named feature requires a table; a table requires both p-values.
  constraint gene_disagreement_feature_ck
    check (concordance_feature is null
           or concordance_status in ('shared_feature', 'overlapping')),
  constraint gene_disagreement_fisher_ck
    check ((fisher_p is null) = (fisher_p_floor is null)),
  constraint gene_disagreement_fisher_range_ck
    check ((fisher_p is null or fisher_p between 0 and 1)
           and (fisher_p_floor is null or fisher_p_floor between 0 and 1)),
  --  Discordance is a statement about the ratio, so it cannot be true without one.
  constraint gene_disagreement_discordant_ck
    check (not discordant or spread_vs_screen is not null)
);

create index gene_disagreement_screen_ix on public.gene_disagreement (screen_id, gene_symbol);
create index gene_disagreement_run_ix on public.gene_disagreement (run_id);
--  The worklist the console opens on: fragile calls first, then widest spread.
create index gene_disagreement_worklist_ix on public.gene_disagreement
  (comparison_id, fragile desc, spread_vs_screen desc nulls last);

comment on table public.gene_disagreement is
  'One row per gene per comparison: how much that gene''s guides disagreed, '
  'whether its call survives dropping one guide, and the concordance table '
  'between depletion and the curated feature the depleting guides share. '
  'Computed by engine/splicr/validate/domain_report.py:build_report and stored '
  'so the console does not reimplement it.';
comment on column public.gene_disagreement.concordance_status is
  'not_evaluated means the protein context was never looked up for this gene '
  '(it was outside the run''s annotation shortlist). no_features means it was '
  'looked up and no curated feature covers any resolved cut. The two are '
  'different facts and must not be rendered the same way.';
comment on column public.gene_disagreement.report is
  'The full report as engine/splicr/validate/domain_report.py:DisagreementReport '
  'serialises it, including every guide row, the concordance table, the named '
  'confound and the reference releases the annotation used.';

-- --- shape of the stored document ---------------------------------------------
-- Enough of a schema to refuse a document that is not this report, without
-- restating every optional field: the pydantic model is the definition and this
-- is the guard that stops something else being written into the column.
alter table public.gene_disagreement add constraint gene_disagreement_report_shape_ck
  check (extensions.jsonb_matches_schema(
    '{
       "type": "object",
       "required": ["gene_symbol", "n_guides", "mean_log2_fold_change",
                    "guides", "concordance", "summary", "provenance"],
       "properties": {
         "gene_symbol": {"type": "string", "minLength": 1},
         "n_guides":    {"type": "integer", "minimum": 2},
         "guides":      {"type": "array", "minItems": 2},
         "summary":     {"type": "string", "minLength": 1},
         "concordance": {
           "type": "object",
           "required": ["status", "interpretation"],
           "properties": {"status": {"type": "string"},
                          "interpretation": {"type": "string", "minLength": 1}}
         },
         "provenance": {
           "type": "object",
           "required": ["coordinate_system", "reference_versions", "measurement_source"]
         }
       }
     }',
    report));

-- --- access -------------------------------------------------------------------
-- Same rule as public.hits: readable by anyone who may read the screen, written
-- only by the engine, which connects with the secret key.
alter table public.gene_disagreement enable row level security;

create policy "read gene disagreement" on public.gene_disagreement
  for select to authenticated, anon
  using ((select private.can_read_screen(screen_id)));

grant select on public.gene_disagreement to authenticated, anon;

notify pgrst, 'reload schema';
