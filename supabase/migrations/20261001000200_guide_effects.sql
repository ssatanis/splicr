-- ============================================================================
-- Per-guide effects, labelled, with the protein context resolved once
--
-- WHY THIS TABLE EXISTS
--
-- public.hits.guide_lfcs is a real[]: the fold changes of a gene's guides with
-- no guide key beside them. It was added for one job - the single-guide artifact
-- check, which only needs the spread - and it does that job correctly.
--
-- It cannot answer the question the deep dive asks. "Which guide depleted, and
-- where in the protein did it cut?" needs the fold change joined to the guide
-- that produced it. Recovering that by position - taking the array's nth element
-- and the nth guide of the library - is not a join. MAGeCK's sgRNA summary is not
-- ordered by the library file, guides with no reads are absent from it, and a
-- library can hold more guides for a gene than the comparison scored. Pairing
-- them by index produces a table that looks right and attributes measurements to
-- the wrong reagents, which is worse than having no table.
--
-- So the labelled rows are written where they are produced, from MAGeCK's own
-- sgrna_summary, keyed by the guide id MAGeCK printed.
--
-- WHY THE PROTEIN CONTEXT IS STORED AND NOT COMPUTED PER REQUEST
--
-- Mapping a cut to a residue needs the Ensembl 116 MANE Select CDS and UniProt's
-- curated residue features. Both live in the engine's reference set, not in
-- Postgres, and a UniProt cache miss is a network call. Resolving it at analysis
-- time means the console reads a recorded value with a recorded reference
-- version, a reader can see which release produced it, and the same request
-- twice returns the same answer. The columns are nullable because a guide often
-- has no resolvable residue - no verified cut position, a cut outside the MANE
-- CDS, a gene with no reviewed UniProt entry - and an empty field is the honest
-- representation of that.
--
-- annotation_evidence says which kind of statement the row supports:
--   curated   a UniProt-annotated feature covers this residue
--   cds_only  the residue resolved, no annotated feature covers it
--   none      no residue could be resolved; nothing about the protein is claimed
-- ============================================================================

create table public.guide_effects (
  screen_id       uuid not null references public.screens (id) on delete cascade,
  run_id          uuid not null references public.runs (id) on delete cascade,
  comparison_id   uuid not null references public.comparisons (id) on delete cascade,
  guide_key       text not null,
  gene_symbol     text,
  sequence        text,

  -- measured, from the caller named in method
  method          text not null default 'mageck',
  lfc             real,
  p_value         real,
  fdr             real,
  control_mean    real,                  -- normalised control count
  treatment_mean  real,                  -- normalised treatment count

  -- library coordinates, copied from atlas.guides at write time so the row stays
  -- readable after a library revision
  chrom           text,
  cut_pos         bigint,
  strand          char(1),

  -- protein context, resolved from the reference versions named below
  uniprot_accession text,
  mane_transcript   text,
  protein_residue   int,
  n_residues        int,
  cds_fraction      real,
  in_last_exon      boolean,
  features_hit      text[] not null default '{}',
  annotation_evidence text not null default 'none',
  reference_versions  jsonb not null default '{}'::jsonb,

  created_at      timestamptz not null default now(),
  primary key (comparison_id, guide_key),
  constraint guide_effects_evidence_ck
    check (annotation_evidence in ('curated', 'cds_only', 'none')),
  constraint guide_effects_residue_ck
    check (protein_residue is null or protein_residue >= 1),
  constraint guide_effects_fraction_ck
    check (cds_fraction is null or cds_fraction between 0 and 1),
  -- A residue cannot be claimed without saying which transcript numbered it.
  constraint guide_effects_transcript_ck
    check (protein_residue is null or mane_transcript is not null),
  -- A curated feature claim requires a resolved residue and at least one feature.
  constraint guide_effects_curated_ck
    check (annotation_evidence <> 'curated'
           or (protein_residue is not null and cardinality(features_hit) > 0)),
  constraint guide_effects_p_ck check (p_value is null or p_value between 0 and 1),
  constraint guide_effects_fdr_ck check (fdr is null or fdr between 0 and 1)
);

create index guide_effects_gene_ix on public.guide_effects (screen_id, gene_symbol);
create index guide_effects_run_ix on public.guide_effects (run_id);
create index guide_effects_residue_ix on public.guide_effects (comparison_id, protein_residue)
  where protein_residue is not null;

comment on table public.guide_effects is
  'One row per guide per comparison: the fold change MAGeCK reported for that '
  'guide key, the library coordinates of its cut, and the protein residue and '
  'curated features that cut falls in when they could be resolved. Written by '
  'engine/splicr/db.py:write_guide_effects.';
comment on column public.guide_effects.features_hit is
  'Curated UniProt feature names covering protein_residue. Empty is empty: it '
  'means no annotated feature covers the residue, never that none was looked for.';
comment on column public.guide_effects.reference_versions is
  'The reference releases this row''s protein context was resolved against, for '
  'example {"ensembl": "116", "assembly": "GRCh38", "uniprot": "reviewed"}.';

-- --- access -------------------------------------------------------------------
-- Same rule as public.guide_counts: readable by anyone who may read the screen,
-- writable only by the engine, which connects with the secret key.
alter table public.guide_effects enable row level security;

create policy "read guide effects" on public.guide_effects for select to authenticated, anon
  using ((select private.can_read_screen(screen_id)));

grant select on public.guide_effects to authenticated, anon;

notify pgrst, 'reload schema';
