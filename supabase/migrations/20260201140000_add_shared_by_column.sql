-- Add shared_by column to analysis_shares table
-- This column should have been in the original table but may be missing if the table existed before the migration

DO $$
BEGIN
  -- Check if shared_by column exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'analysis_shares'
      AND column_name = 'shared_by'
  ) THEN
    -- Add shared_by column
    ALTER TABLE public.analysis_shares
      ADD COLUMN shared_by UUID NOT NULL DEFAULT gen_random_uuid() REFERENCES auth.users(id) ON DELETE CASCADE;

    RAISE NOTICE '✅ Added shared_by column to analysis_shares';
  ELSE
    RAISE NOTICE '✅ shared_by column already exists';
  END IF;

  -- Create index if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'analysis_shares'
      AND indexname = 'idx_analysis_shares_shared_by'
  ) THEN
    CREATE INDEX idx_analysis_shares_shared_by ON public.analysis_shares(shared_by);
    RAISE NOTICE '✅ Created index on shared_by column';
  ELSE
    RAISE NOTICE '✅ Index on shared_by already exists';
  END IF;
END $$;

-- Force PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';

-- Show table structure to verify
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'analysis_shares'
ORDER BY ordinal_position;
