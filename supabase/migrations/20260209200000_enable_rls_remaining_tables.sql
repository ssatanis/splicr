-- ============================================================================
-- ENABLE RLS ON REMAINING PUBLIC TABLES (Supabase Linter Fix)
-- ============================================================================
-- Addresses: rls_disabled_in_public for 6 tables
-- Tables: structure_cache, system_metrics, error_logs, api_usage_logs,
--         sequencing_files, screen_gene_results
--
-- This migration is idempotent and safe to run multiple times.
-- ============================================================================

-- Enable RLS on structure_cache
DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'structure_cache') THEN
    ALTER TABLE public.structure_cache ENABLE ROW LEVEL SECURITY;
  END IF;
END $do$;

-- Enable RLS on system_metrics
DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'system_metrics') THEN
    ALTER TABLE public.system_metrics ENABLE ROW LEVEL SECURITY;
  END IF;
END $do$;

-- Enable RLS on error_logs
DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'error_logs') THEN
    ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;
  END IF;
END $do$;

-- Enable RLS on api_usage_logs
DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'api_usage_logs') THEN
    ALTER TABLE public.api_usage_logs ENABLE ROW LEVEL SECURITY;
  END IF;
END $do$;

-- Enable RLS on sequencing_files
DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'sequencing_files') THEN
    ALTER TABLE public.sequencing_files ENABLE ROW LEVEL SECURITY;
  END IF;
END $do$;

-- Enable RLS on screen_gene_results
DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'screen_gene_results') THEN
    ALTER TABLE public.screen_gene_results ENABLE ROW LEVEL SECURITY;
  END IF;
END $do$;

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- structure_cache: Service manages, authenticated users read
DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'structure_cache') THEN
    DROP POLICY IF EXISTS "Service can manage structure cache" ON public.structure_cache;
    CREATE POLICY "Service can manage structure cache"
      ON public.structure_cache FOR ALL
      USING (
        current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role'
        OR current_setting('role') = 'service_role'
      );

    DROP POLICY IF EXISTS "Authenticated users can read structure cache" ON public.structure_cache;
    CREATE POLICY "Authenticated users can read structure cache"
      ON public.structure_cache FOR SELECT
      USING ((SELECT auth.uid()) IS NOT NULL);
  END IF;
END $do$;

-- system_metrics: Service role only (admin/system data)
DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'system_metrics') THEN
    DROP POLICY IF EXISTS "Service can manage system metrics" ON public.system_metrics;
    CREATE POLICY "Service can manage system metrics"
      ON public.system_metrics FOR ALL
      USING (
        current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role'
        OR current_setting('role') = 'service_role'
      );
  END IF;
END $do$;

-- error_logs: Service manages, users view own
DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'error_logs') THEN
    DROP POLICY IF EXISTS "Service can manage error logs" ON public.error_logs;
    CREATE POLICY "Service can manage error logs"
      ON public.error_logs FOR ALL
      USING (
        current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role'
        OR current_setting('role') = 'service_role'
      );

    DROP POLICY IF EXISTS "Users can view own error logs" ON public.error_logs;
    -- Only add user SELECT policy if error_logs has user_id column
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'error_logs' AND column_name = 'user_id'
    ) THEN
      CREATE POLICY "Users can view own error logs"
        ON public.error_logs FOR SELECT
        USING (user_id = (SELECT auth.uid()));
    ELSE
      -- No user_id: only service can access
      NULL;
    END IF;
  END IF;
END $do$;

-- api_usage_logs: Service manages, users view via api_keys
DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'api_usage_logs') THEN
    DROP POLICY IF EXISTS "Service can manage api usage logs" ON public.api_usage_logs;
    CREATE POLICY "Service can manage api usage logs"
      ON public.api_usage_logs FOR ALL
      USING (
        current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role'
        OR current_setting('role') = 'service_role'
      );

    DROP POLICY IF EXISTS "Users can view own api usage" ON public.api_usage_logs;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'api_keys') THEN
      CREATE POLICY "Users can view own api usage"
        ON public.api_usage_logs FOR SELECT
        USING (
          EXISTS (
            SELECT 1 FROM public.api_keys
            WHERE api_keys.id = api_usage_logs.api_key_id
              AND api_keys.user_id = (SELECT auth.uid())
            LIMIT 1
          )
        );
    END IF;
  END IF;
END $do$;

-- sequencing_files: Users manage own
DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'sequencing_files') THEN
    DROP POLICY IF EXISTS "Users can view own sequencing files" ON public.sequencing_files;
    DROP POLICY IF EXISTS "Users can manage own sequencing files" ON public.sequencing_files;
    -- Use user_id if column exists
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'sequencing_files' AND column_name = 'user_id'
    ) THEN
      CREATE POLICY "Users can view own sequencing files"
        ON public.sequencing_files FOR SELECT
        USING (user_id = (SELECT auth.uid()));
      CREATE POLICY "Users can manage own sequencing files"
        ON public.sequencing_files FOR ALL
        USING (user_id = (SELECT auth.uid()));
    ELSE
      -- Service only if no user_id
      CREATE POLICY "Service can manage sequencing files"
        ON public.sequencing_files FOR ALL
        USING (
          current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role'
          OR current_setting('role') = 'service_role'
        );
    END IF;
  END IF;
END $do$;

-- screen_gene_results: Access via analysis ownership
DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'screen_gene_results') THEN
    DROP POLICY IF EXISTS "Users can view accessible screen gene results" ON public.screen_gene_results;
    DROP POLICY IF EXISTS "Service can manage screen gene results" ON public.screen_gene_results;
    -- Try analysis_id first (links to analyses)
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'screen_gene_results' AND column_name = 'analysis_id'
    ) THEN
      CREATE POLICY "Users can view accessible screen gene results"
        ON public.screen_gene_results FOR SELECT
        USING (
          EXISTS (
            SELECT 1 FROM public.analyses
            WHERE analyses.id = screen_gene_results.analysis_id
              AND (
                analyses.user_id = (SELECT auth.uid())
                OR EXISTS (
                  SELECT 1 FROM public.analysis_shares
                  WHERE analysis_shares.analysis_id = analyses.id
                    AND analysis_shares.user_id = (SELECT auth.uid())
                    AND analysis_shares.status = 'accepted'
                  LIMIT 1
                )
              )
            LIMIT 1
          )
        );
      CREATE POLICY "Service can manage screen gene results"
        ON public.screen_gene_results FOR ALL
        USING (
          current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role'
          OR current_setting('role') = 'service_role'
        );
    ELSIF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'screen_gene_results' AND column_name = 'user_id'
    ) THEN
      CREATE POLICY "Users can view own screen gene results"
        ON public.screen_gene_results FOR SELECT
        USING (user_id = (SELECT auth.uid()));
      CREATE POLICY "Service can manage screen gene results"
        ON public.screen_gene_results FOR ALL
        USING (
          current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role'
          OR current_setting('role') = 'service_role'
        );
    ELSE
      -- Fallback: service role only
      CREATE POLICY "Service can manage screen gene results"
        ON public.screen_gene_results FOR ALL
        USING (
          current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role'
          OR current_setting('role') = 'service_role'
        );
    END IF;
  END IF;
END $do$;
