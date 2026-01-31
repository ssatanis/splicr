-- Fix analysis_shares table - add status column if missing
-- Run this FIRST before the collaboration tables migration

DO $$
BEGIN
  -- Add status column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'analysis_shares'
    AND column_name = 'status'
  ) THEN
    ALTER TABLE public.analysis_shares
      ADD COLUMN status TEXT NOT NULL DEFAULT 'accepted'
      CHECK (status IN ('pending', 'accepted', 'declined'));

    RAISE NOTICE 'Added status column to analysis_shares';
  ELSE
    RAISE NOTICE 'Status column already exists';
  END IF;

  -- Add user_id column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'analysis_shares'
    AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.analysis_shares
      ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

    RAISE NOTICE 'Added user_id column to analysis_shares';
  ELSE
    RAISE NOTICE 'User_id column already exists';
  END IF;
END $$;

-- Verify the columns exist
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name = 'analysis_shares'
ORDER BY ordinal_position;
