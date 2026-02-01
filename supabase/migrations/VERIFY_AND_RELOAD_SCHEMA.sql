-- ============================================================================
-- VERIFY DATABASE SCHEMA & FORCE RELOAD
-- ============================================================================
-- Run this in Supabase Dashboard → SQL Editor to verify the migration worked
-- and force PostgREST to reload the schema cache
-- ============================================================================

-- Step 1: Verify all required columns exist
DO $$
DECLARE
  missing_columns TEXT[] := ARRAY[]::TEXT[];
  col_name TEXT;
BEGIN
  -- Check each required column
  FOR col_name IN
    SELECT unnest(ARRAY[
      'is_link_share',
      'visibility',
      'share_token',
      'link_permission',
      'link_expires_at',
      'institution_domain',
      'institution_permission',
      'updated_at'
    ])
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'analysis_shares'
        AND column_name = col_name
    ) THEN
      missing_columns := array_append(missing_columns, col_name);
    END IF;
  END LOOP;

  IF array_length(missing_columns, 1) > 0 THEN
    RAISE NOTICE '❌ MISSING COLUMNS: %', array_to_string(missing_columns, ', ');
    RAISE NOTICE '⚠️  Run COMBINED_FIX_SHARING.sql to add missing columns';
  ELSE
    RAISE NOTICE '✅ ALL COLUMNS EXIST!';
  END IF;
END $$;

-- Step 2: Verify the enum type exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'share_visibility') THEN
    RAISE NOTICE '✅ share_visibility enum exists';
  ELSE
    RAISE NOTICE '❌ share_visibility enum missing';
  END IF;
END $$;

-- Step 3: Verify the unique index exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'analysis_shares'
      AND indexname = 'idx_analysis_shares_one_link_per_analysis'
  ) THEN
    RAISE NOTICE '✅ Unique index exists (allows multiple collaborators)';
  ELSE
    RAISE NOTICE '⚠️  Unique index missing - multiple collaborators may not work';
  END IF;
END $$;

-- Step 4: Show current table structure
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'analysis_shares'
ORDER BY ordinal_position;

-- Step 5: FORCE POSTGREST TO RELOAD SCHEMA CACHE
-- This is CRITICAL - PostgREST caches the schema and won't see new columns until reloaded
NOTIFY pgrst, 'reload schema';

-- Final success message
DO $$
BEGIN
  RAISE NOTICE '✅ Schema verification complete. PostgREST cache reload triggered.';
  RAISE NOTICE '🔄 If you still get errors, restart your Next.js dev server (Ctrl+C then pnpm dev)';
END $$;
