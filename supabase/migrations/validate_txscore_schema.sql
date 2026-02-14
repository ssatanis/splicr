-- =====================================================================
-- TxScore Schema Validation Script
-- =====================================================================
-- Run this script AFTER applying migrations to verify everything is correct
-- =====================================================================

\echo '========================================='
\echo 'TxScore Schema Validation Report'
\echo '========================================='
\echo ''

-- 1. Check all TxScore tables exist
\echo '1. Checking TxScore Tables...'
SELECT 
    COUNT(*) AS total_tables,
    STRING_AGG(table_name, ', ' ORDER BY table_name) AS tables
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name LIKE 'tx_%'
  AND table_type = 'BASE TABLE';

\echo ''
\echo 'Expected: 13 tables (including tx_user_saved_targets)'
\echo ''

-- 2. Check all indexes have correct tx_ prefix
\echo '2. Checking Index Naming...'
SELECT 
    COUNT(*) FILTER (WHERE indexname LIKE 'idx_tx_%') AS correct_indexes,
    COUNT(*) FILTER (WHERE indexname NOT LIKE 'idx_tx_%' AND indexname NOT LIKE '%_pkey') AS incorrect_indexes,
    COUNT(*) AS total_indexes
FROM pg_indexes
WHERE tablename LIKE 'tx_%';

\echo ''
\echo 'Expected: All indexes should start with idx_tx_ (incorrect_indexes = 0)'
\echo ''

-- 3. List any incorrectly named indexes (should be empty)
\echo '3. Incorrectly Named Indexes (should be empty)...'
SELECT 
    tablename,
    indexname
FROM pg_indexes
WHERE tablename LIKE 'tx_%'
  AND indexname NOT LIKE 'idx_tx_%'
  AND indexname NOT LIKE '%_pkey'
  AND indexname NOT LIKE '%_unique_%'
ORDER BY tablename, indexname;

\echo ''

-- 4. Check tx_user_saved_targets table structure
\echo '4. Checking tx_user_saved_targets table...'
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'tx_user_saved_targets'
ORDER BY ordinal_position;

\echo ''

-- 5. Check RLS is enabled on all TxScore tables
\echo '5. Checking Row Level Security...'
SELECT 
    tablename,
    rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename LIKE 'tx_%'
ORDER BY tablename;

\echo ''
\echo 'Expected: All tables should have rls_enabled = true'
\echo ''

-- 6. Check RLS policies exist for tx_user_saved_targets
\echo '6. Checking RLS Policies for tx_user_saved_targets...'
SELECT 
    schemaname,
    tablename,
    policyname,
    cmd AS operation,
    roles
FROM pg_policies
WHERE tablename = 'tx_user_saved_targets'
ORDER BY policyname;

\echo ''
\echo 'Expected: 4 policies (SELECT, INSERT, UPDATE, DELETE)'
\echo ''

-- 7. Check views exist
\echo '7. Checking TxScore Views...'
SELECT 
    table_name AS view_name,
    CASE 
        WHEN view_definition IS NOT NULL THEN 'Regular View'
        ELSE 'Materialized View'
    END AS view_type
FROM information_schema.views
WHERE table_schema = 'public'
  AND (table_name LIKE 'tx_%' OR table_name = 'user_saved_targets')
ORDER BY table_name;

\echo ''

-- 8. Check foreign key constraints
\echo '8. Checking Foreign Key Constraints...'
SELECT 
    tc.table_name,
    tc.constraint_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name LIKE 'tx_%'
ORDER BY tc.table_name, tc.constraint_name;

\echo ''

-- 9. Count of indexes per table
\echo '9. Index Count per Table...'
SELECT 
    tablename,
    COUNT(*) AS index_count
FROM pg_indexes
WHERE tablename LIKE 'tx_%'
GROUP BY tablename
ORDER BY tablename;

\echo ''

-- 10. Check if update trigger exists for tx_user_saved_targets
\echo '10. Checking Triggers...'
SELECT 
    trigger_name,
    event_manipulation AS trigger_event,
    event_object_table AS table_name
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table = 'tx_user_saved_targets';

\echo ''
\echo 'Expected: tx_update_user_saved_targets_updated_at'
\echo ''

-- 11. Quick data check (should be empty for new install)
\echo '11. Record Counts (should be 0 for fresh install)...'
SELECT 
    'tx_genes_master' AS table_name,
    COUNT(*) AS record_count
FROM tx_genes_master
UNION ALL
SELECT 'tx_user_saved_targets', COUNT(*) FROM tx_user_saved_targets
UNION ALL
SELECT 'tx_txscore_cache', COUNT(*) FROM tx_txscore_cache;

\echo ''

-- 12. Check for view dependencies
\echo '12. Checking View Dependencies...'
SELECT DISTINCT
    dependent_view.relname AS view_name,
    source_table.relname AS depends_on_table
FROM pg_depend 
JOIN pg_rewrite ON pg_depend.objid = pg_rewrite.oid 
JOIN pg_class as dependent_view ON pg_rewrite.ev_class = dependent_view.oid 
JOIN pg_class as source_table ON pg_depend.refobjid = source_table.oid 
WHERE dependent_view.relname IN ('tx_user_saved_targets_enriched', 'user_saved_targets', 'tx_top_targets_by_cancer', 'tx_druggable_targets', 'tx_essential_with_precedent')
  AND source_table.relname != dependent_view.relname
ORDER BY view_name, depends_on_table;

\echo ''
\echo '========================================='
\echo 'Validation Complete!'
\echo '========================================='
\echo ''
\echo 'Review the output above for any issues.'
\echo 'All checks should pass for a successful migration.'
\echo ''