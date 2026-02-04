-- Migration: Add RLS policies to tables that have RLS enabled but no policies
-- Fixes linter: rls_enabled_no_policy for:
--   analysis_exports, analysis_likes, analysis_versions, batch_job_items, collection_items, collections
-- Uses DROP IF EXISTS + CREATE so migration is idempotent.

-- =============================================================================
-- 1. analysis_exports
-- =============================================================================
DROP POLICY IF EXISTS "Users can view own exports" ON public.analysis_exports;
CREATE POLICY "Users can view own exports"
  ON public.analysis_exports FOR SELECT
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can create own exports" ON public.analysis_exports;
CREATE POLICY "Users can create own exports"
  ON public.analysis_exports FOR INSERT
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can delete own exports" ON public.analysis_exports;
CREATE POLICY "Users can delete own exports"
  ON public.analysis_exports FOR DELETE
  USING (user_id = (SELECT auth.uid()));

-- =============================================================================
-- 2. analysis_likes
-- =============================================================================
DROP POLICY IF EXISTS "Users can view likes" ON public.analysis_likes;
CREATE POLICY "Users can view likes"
  ON public.analysis_likes FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Users can create own likes" ON public.analysis_likes;
CREATE POLICY "Users can create own likes"
  ON public.analysis_likes FOR INSERT
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can delete own likes" ON public.analysis_likes;
CREATE POLICY "Users can delete own likes"
  ON public.analysis_likes FOR DELETE
  USING (user_id = (SELECT auth.uid()));

-- =============================================================================
-- 3. analysis_versions (use user_id; table has no created_by column)
-- =============================================================================
DROP POLICY IF EXISTS "Users can view own analysis versions" ON public.analysis_versions;
CREATE POLICY "Users can view own analysis versions"
  ON public.analysis_versions FOR SELECT
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Service can insert analysis versions" ON public.analysis_versions;
CREATE POLICY "Service can insert analysis versions"
  ON public.analysis_versions FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can delete own analysis versions" ON public.analysis_versions;
CREATE POLICY "Users can delete own analysis versions"
  ON public.analysis_versions FOR DELETE
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can update own analysis versions" ON public.analysis_versions;
CREATE POLICY "Users can update own analysis versions"
  ON public.analysis_versions FOR UPDATE
  USING (user_id = (SELECT auth.uid()));

-- =============================================================================
-- 4. batch_job_items (batch_jobs.user_id is TEXT, so compare with auth.uid()::text)
-- =============================================================================
DROP POLICY IF EXISTS "Users can view own batch items" ON public.batch_job_items;
CREATE POLICY "Users can view own batch items"
  ON public.batch_job_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.batch_jobs
      WHERE batch_jobs.id = batch_job_items.batch_job_id
        AND batch_jobs.user_id = (SELECT auth.uid())::text
      LIMIT 1
    )
  );

DROP POLICY IF EXISTS "Service can manage batch items" ON public.batch_job_items;
CREATE POLICY "Service can manage batch items"
  ON public.batch_job_items FOR ALL
  USING (
    current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role'
    OR current_setting('role') = 'service_role'
  );

-- =============================================================================
-- 5. collection_items
-- =============================================================================
DROP POLICY IF EXISTS "Users can view accessible collection items" ON public.collection_items;
CREATE POLICY "Users can view accessible collection items"
  ON public.collection_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.collections
      WHERE collections.id = collection_items.collection_id
        AND (
          collections.user_id = (SELECT auth.uid())
          OR collections.is_public = true
        )
      LIMIT 1
    )
  );

DROP POLICY IF EXISTS "Users can manage own collection items" ON public.collection_items;
CREATE POLICY "Users can manage own collection items"
  ON public.collection_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.collections
      WHERE collections.id = collection_items.collection_id
        AND collections.user_id = (SELECT auth.uid())
      LIMIT 1
    )
  );

-- =============================================================================
-- 6. collections
-- =============================================================================
DROP POLICY IF EXISTS "Users can view accessible collections" ON public.collections;
CREATE POLICY "Users can view accessible collections"
  ON public.collections FOR SELECT
  USING (
    user_id = (SELECT auth.uid())
    OR is_public = true
  );

DROP POLICY IF EXISTS "Users can create own collections" ON public.collections;
CREATE POLICY "Users can create own collections"
  ON public.collections FOR INSERT
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can update own collections" ON public.collections;
CREATE POLICY "Users can update own collections"
  ON public.collections FOR UPDATE
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can delete own collections" ON public.collections;
CREATE POLICY "Users can delete own collections"
  ON public.collections FOR DELETE
  USING (user_id = (SELECT auth.uid()));
