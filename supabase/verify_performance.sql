-- ============================================================================
-- PERFORMANCE VERIFICATION SCRIPT
-- ============================================================================
-- Run this after applying the 20260204000000_query_performance_fix migration
-- to verify that the indexes are working and queries are faster.
-- ============================================================================

-- ============================================================================
-- 1. CHECK THAT ALL INDEXES EXIST
-- ============================================================================
SELECT
  '✓ Index Existence Check' as check_type,
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) as size,
  CASE
    WHEN idx_scan > 0 THEN '✓ BEING USED'
    ELSE '⚠ NOT USED YET'
  END as status
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND tablename = 'analyses'
  AND indexrelname LIKE 'idx_analyses_%'
ORDER BY idx_scan DESC;

-- Expected indexes:
-- idx_analyses_user_created_desc
-- idx_analyses_user_list_covering
-- idx_analyses_user_recent
-- idx_analyses_user_id (from old migration)
-- idx_analyses_status (from old migration)

-- ============================================================================
-- 2. CHECK ANALYSIS_SHARES INDEXES
-- ============================================================================
SELECT
  '✓ Shares Index Check' as check_type,
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) as size,
  CASE
    WHEN idx_scan > 0 THEN '✓ BEING USED'
    ELSE '⚠ NOT USED YET'
  END as status
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND tablename = 'analysis_shares'
  AND indexrelname LIKE 'idx_analysis_shares_%'
ORDER BY idx_scan DESC;

-- Expected indexes:
-- idx_analysis_shares_fast_lookup
-- idx_analysis_shares_analysis_user_status

-- ============================================================================
-- 3. TEST QUERY PERFORMANCE (REPLACE UUID WITH REAL USER ID)
-- ============================================================================
-- IMPORTANT: Replace 'YOUR-USER-UUID-HERE' with an actual user_id from your database

-- Get a real user ID to test with
SELECT 'ℹ️ Sample User IDs' as info, user_id
FROM public.analyses
GROUP BY user_id
LIMIT 5;

-- Test the main slow query (paste a user_id from above)
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT
  id, name, status, created_at, updated_at, started_at, completed_at,
  progress, current_step, error_message, method, user_id
FROM public.analyses
WHERE user_id = 'PASTE-USER-UUID-HERE'::uuid
ORDER BY created_at DESC
LIMIT 100;

-- Look for:
-- - Execution Time should be <30ms (was 300-500ms before)
-- - Should use "Index Scan" or "Index Only Scan" on idx_analyses_user_created_desc or idx_analyses_user_list_covering
-- - Buffers shared hit should be high (>95% cache hit rate)

-- ============================================================================
-- 4. TEST CURSOR-BASED PAGINATION FUNCTION
-- ============================================================================
-- Test the new pagination function
SELECT 'ℹ️ Testing Cursor Pagination' as info;

-- First page (replace with real user_id)
SELECT id, name, created_at
FROM get_user_analyses_paginated(
  'PASTE-USER-UUID-HERE'::uuid,
  10,    -- limit
  NULL,  -- cursor (NULL for first page)
  NULL   -- cursor_id
)
LIMIT 5;

-- Check execution time - should be <20ms

-- ============================================================================
-- 5. CHECK RLS POLICY
-- ============================================================================
SELECT
  '✓ RLS Policy Check' as check_type,
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'analyses'
  AND policyname = 'Users can view own analyses';

-- Should show the optimized policy with LIMIT 1 in the EXISTS clause

-- ============================================================================
-- 6. CHECK STATISTICS QUALITY
-- ============================================================================
SELECT
  '✓ Statistics Check' as check_type,
  schemaname,
  tablename,
  attname as column_name,
  n_distinct,
  correlation,
  null_frac
FROM pg_stats
WHERE schemaname = 'public'
  AND tablename = 'analyses'
  AND attname IN ('user_id', 'created_at', 'status')
ORDER BY attname;

-- Good correlation (close to 1.0 or -1.0) = better query planning
-- High n_distinct = good selectivity

-- ============================================================================
-- 7. CHECK TABLE BLOAT
-- ============================================================================
SELECT
  '✓ Table Health Check' as check_type,
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size,
  pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) as indexes_size,
  ROUND(
    100.0 * (pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename))
    / NULLIF(pg_total_relation_size(schemaname||'.'||tablename), 0),
    1
  ) as index_ratio_pct
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('analyses', 'analysis_shares')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Index ratio should be 20-50% (indexes taking 20-50% of total size is normal)
-- If >200%, consider REINDEX or VACUUM FULL

-- ============================================================================
-- 8. MONITOR REAL-TIME QUERY PERFORMANCE
-- ============================================================================
-- This query shows the slowest queries currently running
SELECT
  '⚠ Current Slow Queries' as warning,
  pid,
  now() - pg_stat_activity.query_start AS duration,
  usename,
  state,
  LEFT(query, 100) as query_preview
FROM pg_stat_activity
WHERE (now() - pg_stat_activity.query_start) > interval '500 milliseconds'
  AND state = 'active'
  AND query NOT LIKE '%pg_stat_activity%'
ORDER BY duration DESC
LIMIT 10;

-- After migration, you should see very few (ideally zero) slow queries on analyses table

-- ============================================================================
-- 9. BENCHMARK COMPARISON (OPTIONAL)
-- ============================================================================
-- Run this to compare performance before/after migration

DO $$
DECLARE
  v_user_id uuid;
  v_start_time timestamp;
  v_end_time timestamp;
  v_duration_ms numeric;
  v_count int;
BEGIN
  -- Get a real user_id
  SELECT user_id INTO v_user_id FROM public.analyses LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'No analyses found - cannot benchmark';
    RETURN;
  END IF;

  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'BENCHMARK RESULTS';
  RAISE NOTICE '============================================================================';

  -- Test 1: Simple user query
  v_start_time := clock_timestamp();
  SELECT COUNT(*) INTO v_count
  FROM public.analyses
  WHERE user_id = v_user_id
  ORDER BY created_at DESC
  LIMIT 100;
  v_end_time := clock_timestamp();
  v_duration_ms := EXTRACT(MILLISECOND FROM v_end_time - v_start_time);

  RAISE NOTICE 'Test 1 - User Analyses Query (100 rows)';
  RAISE NOTICE '  Duration: % ms', ROUND(v_duration_ms, 2);
  RAISE NOTICE '  Result count: %', v_count;
  RAISE NOTICE '  Expected: <30ms (was 300-500ms before optimization)';
  RAISE NOTICE '';

  -- Test 2: With RLS (as authenticated user)
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claim.sub = v_user_id::text;

  v_start_time := clock_timestamp();
  SELECT COUNT(*) INTO v_count
  FROM public.analyses
  WHERE user_id = v_user_id
  ORDER BY created_at DESC
  LIMIT 100;
  v_end_time := clock_timestamp();
  v_duration_ms := EXTRACT(MILLISECOND FROM v_end_time - v_start_time);

  RAISE NOTICE 'Test 2 - With RLS Policy Evaluation';
  RAISE NOTICE '  Duration: % ms', ROUND(v_duration_ms, 2);
  RAISE NOTICE '  Result count: %', v_count;
  RAISE NOTICE '  Expected: <50ms (RLS adds slight overhead)';
  RAISE NOTICE '';

  RESET ROLE;

  -- Test 3: Cursor pagination function
  v_start_time := clock_timestamp();
  PERFORM * FROM get_user_analyses_paginated(v_user_id, 50, NULL, NULL);
  v_end_time := clock_timestamp();
  v_duration_ms := EXTRACT(MILLISECOND FROM v_end_time - v_start_time);

  RAISE NOTICE 'Test 3 - Cursor-Based Pagination Function';
  RAISE NOTICE '  Duration: % ms', ROUND(v_duration_ms, 2);
  RAISE NOTICE '  Expected: <20ms';
  RAISE NOTICE '';

  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'If all tests are within expected ranges, optimization is successful!';
  RAISE NOTICE '============================================================================';
END $$;

-- ============================================================================
-- 10. SUMMARY
-- ============================================================================
SELECT
  '📊 OPTIMIZATION SUMMARY' as summary,
  (SELECT COUNT(*) FROM pg_stat_user_indexes WHERE tablename = 'analyses' AND indexrelname LIKE 'idx_analyses_%') as analyses_indexes,
  (SELECT COUNT(*) FROM pg_stat_user_indexes WHERE tablename = 'analysis_shares' AND indexrelname LIKE 'idx_analysis_shares_%') as shares_indexes,
  (SELECT EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'get_user_analyses_paginated')) as pagination_function_exists,
  (SELECT EXISTS(SELECT 1 FROM pg_policies WHERE tablename = 'analyses' AND policyname = 'Users can view own analyses')) as rls_policy_exists;

-- Expected results:
-- analyses_indexes: 5+
-- shares_indexes: 2+
-- pagination_function_exists: true
-- rls_policy_exists: true
