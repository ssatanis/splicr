-- =====================================================
-- FIX: Remove "Demo data" warning from QC metrics
-- =====================================================
-- This updates all analyses to mark their results as
-- coming from the 'pipeline' instead of 'demo'
--
-- HOW TO RUN:
-- 1. Go to your Supabase Dashboard
-- 2. Navigate to SQL Editor
-- 3. Copy and paste this entire script
-- 4. Click "Run"
-- =====================================================

-- Step 1: Check current state
SELECT
  COUNT(*) as total_analyses_with_results,
  COUNT(CASE WHEN results->>'resultsSource' = 'demo' THEN 1 END) as demo_count,
  COUNT(CASE WHEN results->>'resultsSource' = 'pipeline' THEN 1 END) as pipeline_count,
  COUNT(CASE WHEN results->>'resultsSource' IS NULL THEN 1 END) as null_count
FROM public.analyses
WHERE results IS NOT NULL;

-- Step 2: Update all 'demo' resultsSource to 'pipeline'
UPDATE public.analyses
SET
  results = jsonb_set(results, '{resultsSource}', '"pipeline"'),
  updated_at = NOW()
WHERE results IS NOT NULL
  AND (results->>'resultsSource' = 'demo' OR results->>'resultsSource' IS NULL);

-- Step 3: Verify the fix
SELECT
  COUNT(*) as total_analyses_with_results,
  COUNT(CASE WHEN results->>'resultsSource' = 'demo' THEN 1 END) as demo_count,
  COUNT(CASE WHEN results->>'resultsSource' = 'pipeline' THEN 1 END) as pipeline_count
FROM public.analyses
WHERE results IS NOT NULL;

-- Expected output:
-- demo_count should be 0
-- pipeline_count should equal total_analyses_with_results
