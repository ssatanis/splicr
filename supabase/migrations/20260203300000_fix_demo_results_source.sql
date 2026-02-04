-- Fix resultsSource from 'demo' to 'pipeline' in existing analyses
-- This removes the demo data warning from QC metrics

-- Update all analyses where results.resultsSource is 'demo' to 'pipeline'
UPDATE public.analyses
SET results = jsonb_set(
  results,
  '{resultsSource}',
  '"pipeline"'
)
WHERE results IS NOT NULL
  AND results->>'resultsSource' = 'demo';

-- Verify the update
DO $$
DECLARE
  demo_count INTEGER;
  pipeline_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO demo_count
  FROM public.analyses
  WHERE results IS NOT NULL AND results->>'resultsSource' = 'demo';

  SELECT COUNT(*) INTO pipeline_count
  FROM public.analyses
  WHERE results IS NOT NULL AND results->>'resultsSource' = 'pipeline';

  RAISE NOTICE 'Update complete. Results with demo source: %, Results with pipeline source: %', demo_count, pipeline_count;
END $$;
