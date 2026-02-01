-- ============================================================================
-- COMBINED MIGRATION: Fix Analysis Sharing
-- ============================================================================
-- Run this entire file in Supabase Dashboard → SQL Editor
-- This fixes the "is_link_share" column error and allows multiple collaborators
-- ============================================================================

-- Step 1: Create share_visibility enum if it doesn't exist
DO $$ BEGIN
  CREATE TYPE share_visibility AS ENUM ('private', 'institution', 'public');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Step 2: Add all required columns to analysis_shares table
ALTER TABLE public.analysis_shares ADD COLUMN IF NOT EXISTS is_link_share BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.analysis_shares ADD COLUMN IF NOT EXISTS visibility share_visibility NOT NULL DEFAULT 'private';
ALTER TABLE public.analysis_shares ADD COLUMN IF NOT EXISTS share_token VARCHAR(64) UNIQUE;
ALTER TABLE public.analysis_shares ADD COLUMN IF NOT EXISTS link_permission TEXT NOT NULL DEFAULT 'view';
ALTER TABLE public.analysis_shares ADD COLUMN IF NOT EXISTS link_expires_at TIMESTAMPTZ;
ALTER TABLE public.analysis_shares ADD COLUMN IF NOT EXISTS institution_domain VARCHAR(255);
ALTER TABLE public.analysis_shares ADD COLUMN IF NOT EXISTS institution_permission TEXT NOT NULL DEFAULT 'view';
ALTER TABLE public.analysis_shares ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Step 3: Fix unique constraint to allow multiple email invites
-- Drop the constraint that blocks multiple email invites
ALTER TABLE public.analysis_shares
  DROP CONSTRAINT IF EXISTS analysis_shares_one_link_per_analysis;

-- One link-share config per analysis (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_analysis_shares_one_link_per_analysis
  ON public.analysis_shares(analysis_id)
  WHERE is_link_share = true;

COMMENT ON INDEX idx_analysis_shares_one_link_per_analysis IS 'Ensures at most one link share config per analysis; email invites are unlimited.';

-- Step 4: Verify the fix worked
DO $$
DECLARE
  col_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'analysis_shares'
      AND column_name = 'is_link_share'
  ) INTO col_exists;

  IF col_exists THEN
    RAISE NOTICE '✅ SUCCESS: is_link_share column exists. Sharing should work now!';
  ELSE
    RAISE NOTICE '❌ ERROR: is_link_share column still missing. Please contact support.';
  END IF;
END $$;
