-- ============================================================================
-- VERIFICATION SCRIPT FOR LINTER FIXES
-- ============================================================================
-- Run this script after applying 20260205000000_comprehensive_linter_fixes.sql
-- to verify that all issues have been resolved.
-- ============================================================================

\echo '============================================================================'
\echo 'SUPABASE LINTER FIXES - VERIFICATION REPORT'
\echo '============================================================================'
\echo ''

-- ============================================================================
-- 1. VERIFY RLS IS ENABLED ON ALL PUBLIC TABLES
-- ============================================================================

\echo '1. CHECKING RLS STATUS ON CRITICAL TABLES'
\echo '   (All should show relrowsecurity = true)'
\echo ''

SELECT
  tablename,
  CASE WHEN c.relrowsecurity THEN '✓ ENABLED' ELSE '✗ DISABLED' END as rls_status
FROM pg_tables t
LEFT JOIN pg_class c ON c.relname = t.tablename
WHERE t.schemaname = 'public'
  AND t.tablename IN (
    'structure_cache',
    'system_metrics',
    'error_logs',
    'api_usage_logs',
    'sequencing_files',
    'users',
    'teams',
    'analyses',
    'fastq_files',
    'comments',
    'notifications',
    'email_logs'
  )
ORDER BY tablename;

\echo ''

-- ============================================================================
-- 2. VERIFY AUTH.UID() IS WRAPPED IN POLICIES
-- ============================================================================

\echo '2. CHECKING FOR UNWRAPPED auth.uid() IN RLS POLICIES'
\echo '   (Should show 0 policies with unwrapped auth.uid())'
\echo ''

SELECT COUNT(*) as unwrapped_auth_uid_count
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    pg_get_expr(polqual, polrelid) LIKE '%auth.uid()%'
    OR pg_get_expr(polwithcheck, polrelid) LIKE '%auth.uid()%'
  )
  AND NOT (
    pg_get_expr(polqual, polrelid) LIKE '%(select auth.uid())%'
    OR pg_get_expr(polwithcheck, polrelid) LIKE '%(select auth.uid())%'
  );

\echo ''

-- Detailed list if any found
\echo '   Detailed list of policies with unwrapped auth.uid():'
\echo ''

SELECT
  schemaname,
  tablename,
  policyname,
  CASE
    WHEN pg_get_expr(polqual, polrelid) LIKE '%auth.uid()%' THEN 'USING clause'
    WHEN pg_get_expr(polwithcheck, polrelid) LIKE '%auth.uid()%' THEN 'WITH CHECK clause'
  END as issue_location
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    pg_get_expr(polqual, polrelid) LIKE '%auth.uid()%'
    OR pg_get_expr(polwithcheck, polrelid) LIKE '%auth.uid()%'
  )
  AND NOT (
    pg_get_expr(polqual, polrelid) LIKE '%(select auth.uid())%'
    OR pg_get_expr(polwithcheck, polrelid) LIKE '%(select auth.uid())%'
  )
ORDER BY tablename, policyname;

\echo ''

-- ============================================================================
-- 3. VERIFY FUNCTIONS HAVE SEARCH_PATH SET
-- ============================================================================

\echo '3. CHECKING FUNCTIONS FOR search_path SETTING'
\echo '   (All critical functions should have search_path set)'
\echo ''

SELECT
  n.nspname as schema,
  p.proname as function_name,
  CASE
    WHEN p.proconfig IS NOT NULL THEN '✓ HAS search_path'
    ELSE '✗ MISSING search_path'
  END as search_path_status,
  COALESCE(
    array_to_string(p.proconfig, ', '),
    'NOT SET'
  ) as config
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname IN (
    'get_email_domain',
    'update_updated_at_column',
    'update_updated_at',
    'increment_public_analysis_views',
    'update_user_usage_stats',
    'handle_new_user',
    'update_cache_access',
    'update_drug_gene_cache_updated_at',
    'update_batch_job_progress',
    'increment_template_usage',
    'increment_api_usage'
  )
ORDER BY function_name;

\echo ''

-- ============================================================================
-- 4. VERIFY NO ALWAYS-TRUE RLS POLICIES
-- ============================================================================

\echo '4. CHECKING FOR ALWAYS-TRUE RLS POLICIES'
\echo '   (Should show 0 policies with WITH CHECK (true) for non-SELECT)'
\echo ''

SELECT
  tablename,
  policyname,
  cmd as operation,
  pg_get_expr(polwithcheck, polrelid) as with_check_expression
FROM pg_policies
WHERE schemaname = 'public'
  AND cmd != 'SELECT'
  AND pg_get_expr(polwithcheck, polrelid) = 'true'
ORDER BY tablename, policyname;

\echo ''

-- ============================================================================
-- 5. VERIFY PG_TRGM EXTENSION LOCATION
-- ============================================================================

\echo '5. CHECKING pg_trgm EXTENSION SCHEMA'
\echo '   (Should be in extensions schema, not public)'
\echo ''

SELECT
  extname,
  n.nspname as schema,
  CASE
    WHEN n.nspname = 'extensions' THEN '✓ CORRECT SCHEMA'
    WHEN n.nspname = 'public' THEN '✗ WRONG SCHEMA (public)'
    ELSE '⚠ UNEXPECTED SCHEMA'
  END as status
FROM pg_extension e
JOIN pg_namespace n ON e.extnamespace = n.oid
WHERE extname = 'pg_trgm';

\echo ''

-- ============================================================================
-- 6. VERIFY TABLES HAVE RLS POLICIES
-- ============================================================================

\echo '6. CHECKING FOR TABLES WITH RLS ENABLED BUT NO POLICIES'
\echo '   (Should show 0 tables)'
\echo ''

SELECT
  t.tablename,
  COUNT(p.policyname) as policy_count,
  CASE
    WHEN COUNT(p.policyname) = 0 THEN '✗ NO POLICIES'
    ELSE '✓ HAS POLICIES (' || COUNT(p.policyname) || ')'
  END as status
FROM pg_tables t
JOIN pg_class c ON c.relname = t.tablename
LEFT JOIN pg_policies p ON p.tablename = t.tablename AND p.schemaname = t.schemaname
WHERE t.schemaname = 'public'
  AND c.relrowsecurity = true
  AND t.tablename IN (
    'analysis_exports',
    'analysis_likes',
    'analysis_versions',
    'batch_job_items',
    'collection_items',
    'collections',
    'structure_cache',
    'system_metrics',
    'error_logs',
    'api_usage_logs',
    'sequencing_files'
  )
GROUP BY t.tablename
HAVING COUNT(p.policyname) = 0
ORDER BY t.tablename;

\echo ''

-- ============================================================================
-- 7. SUMMARY STATISTICS
-- ============================================================================

\echo '7. OVERALL STATISTICS'
\echo ''

WITH stats AS (
  SELECT
    (SELECT COUNT(*) FROM pg_tables t JOIN pg_class c ON c.relname = t.tablename WHERE t.schemaname = 'public' AND c.relrowsecurity = true) as tables_with_rls,
    (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public') as total_policies,
    (SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proconfig IS NOT NULL) as functions_with_search_path,
    (SELECT COUNT(*) FROM pg_extension WHERE extname = 'pg_trgm' AND extnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'extensions')) as pg_trgm_in_extensions
)
SELECT
  'Tables with RLS enabled: ' || tables_with_rls as stat_1,
  'Total RLS policies: ' || total_policies as stat_2,
  'Functions with search_path: ' || functions_with_search_path as stat_3,
  'pg_trgm in extensions schema: ' || CASE WHEN pg_trgm_in_extensions > 0 THEN 'YES ✓' ELSE 'NO ✗' END as stat_4
FROM stats;

\echo ''

-- ============================================================================
-- 8. EXPECTED VS ACTUAL COMPARISON
-- ============================================================================

\echo '8. EXPECTED VS ACTUAL FIXES'
\echo ''

WITH expected AS (
  SELECT
    5 as error_fixes,        -- RLS enabled on 5 tables
    16 as auth_uid_fixes,     -- 16 policies optimized
    11 as function_fixes,     -- 11 functions with search_path
    5 as policy_fixes,        -- 5 always-true policies replaced
    1 as extension_fixes,     -- 1 extension moved
    6 as info_fixes          -- 6 tables got policies
),
actual AS (
  SELECT
    (SELECT COUNT(*) FROM pg_tables t JOIN pg_class c ON c.relname = t.tablename
     WHERE t.schemaname = 'public'
       AND c.relrowsecurity = true
       AND t.tablename IN ('structure_cache', 'system_metrics', 'error_logs', 'api_usage_logs', 'sequencing_files')
    ) as error_fixes,
    (SELECT COUNT(*) FROM pg_policies
     WHERE schemaname = 'public'
       AND (pg_get_expr(polqual, polrelid) LIKE '%(select auth.uid())%'
            OR pg_get_expr(polwithcheck, polrelid) LIKE '%(select auth.uid())%')
    ) as auth_uid_fixes,
    (SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
     WHERE n.nspname = 'public' AND p.proconfig IS NOT NULL
    ) as function_fixes,
    (SELECT COUNT(*) FROM pg_policies
     WHERE schemaname = 'public'
       AND cmd != 'SELECT'
       AND pg_get_expr(polwithcheck, polrelid) != 'true'
    ) as policy_fixes,
    (SELECT COUNT(*) FROM pg_extension
     WHERE extname = 'pg_trgm'
       AND extnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'extensions')
    ) as extension_fixes,
    (SELECT COUNT(DISTINCT t.tablename) FROM pg_tables t
     JOIN pg_class c ON c.relname = t.tablename
     JOIN pg_policies p ON p.tablename = t.tablename AND p.schemaname = t.schemaname
     WHERE t.schemaname = 'public'
       AND c.relrowsecurity = true
    ) as info_fixes
)
SELECT
  'ERROR Fixes: ' || e.error_fixes || ' expected, ' || a.error_fixes || ' actual' as error_status,
  'Function Fixes: ' || e.function_fixes || ' expected, ' || a.function_fixes || ' actual' as function_status,
  'Extension Fixes: ' || e.extension_fixes || ' expected, ' || a.extension_fixes || ' actual' as extension_status
FROM expected e, actual a;

\echo ''
\echo '============================================================================'
\echo 'VERIFICATION COMPLETE'
\echo '============================================================================'
\echo ''
\echo 'To run the Supabase linter again:'
\echo '  Visit: Supabase Dashboard → Database → Linter'
\echo '  Or run: npx supabase db lint'
\echo ''
\echo 'All issues should now be resolved!'
\echo '============================================================================'
