-- ============================================================================
-- 0016 · public.atlas_corpus_state(): is the Atlas corpus loaded at all?
--
-- Purely additive: one stable, read-only function and one grant. Nothing is
-- dropped, altered or deleted.
--
-- WHY THE APP CANNOT ANSWER THIS WITHOUT IT
--
-- The project exposes only `public` and `graphql_public` over the Data API, so
-- a request carrying `Accept-Profile: atlas` comes back 406 PGRST106. That is
-- already why `public.library_catalog` and `public.gene_search` exist. Without
-- an equivalent here, a console asking "is there a corpus to compare against"
-- has no source and has to guess, and the guess it would make is the one thing
-- this data must never say: `public.gene_history()` coalesces a missing gene to
-- `n_screens 0, n_hits 0, hit_rate 0`, which renders as "0 of 0 screens" and is
-- indistinguishable from "we checked and this gene is never a hit anywhere".
--
-- So the panel asks this first, once per page, and renders a corpus state
-- instead of a per-gene zero.
--
-- Both tables it counts already carry `using (true)` select policies for `anon`
-- (`20260926000800_rls.sql`), so `security definer` exposes nothing that a
-- direct read would not, were the schema reachable. `atlas.screen_hits` is
-- deliberately NOT counted: it is the ~26M-row table and a count over it is not
-- a page-load read.
-- ============================================================================

create or replace function public.atlas_corpus_state()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'n_screens',    (select count(*) from atlas.screens),
    'n_gene_stats', (select count(*) from atlas.gene_stats)
  );
$$;

grant execute on function public.atlas_corpus_state() to anon, authenticated;
