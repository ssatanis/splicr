-- ============================================================================
-- 0019 · Screen-keyed read policies: InitPlan array instead of hashed subplan
--
-- 0018 changed these policies to `screen_id in (select readable_screen_ids())`.
-- That is evaluated once, but as a hashed subplan, which the planner can only
-- apply as a filter over a sequential scan. Measured as anon on guide_counts:
-- 2.5 s cold, over the 3 s anon statement timeout on a cold cache.
--
-- `screen_id = any (array(select ...))` is also evaluated once (an InitPlan),
-- and an `= any(array)` qual can drive the (screen_id, ...) indexes each of
-- these tables already has. Measured on guide_counts: a gene lookup is an index
-- scan per partition (~2 ms), and an unfiltered anon read ~200 ms.
--
-- Visibility is identical: same function, same set of screen ids.
-- ============================================================================

alter policy "read guide counts" on public.guide_counts
  using (screen_id = any (array(select private.readable_screen_ids())));
alter policy "read hits" on public.hits
  using (screen_id = any (array(select private.readable_screen_ids())));
alter policy "read reports" on public.reports
  using (screen_id = any (array(select private.readable_screen_ids())));
alter policy "read runs" on public.runs
  using (screen_id = any (array(select private.readable_screen_ids())));
alter policy "read samples" on public.samples
  using (screen_id = any (array(select private.readable_screen_ids())));
alter policy "read comparisons" on public.comparisons
  using (screen_id = any (array(select private.readable_screen_ids())));
alter policy "read screen files" on public.screen_files
  using (screen_id = any (array(select private.readable_screen_ids())));
