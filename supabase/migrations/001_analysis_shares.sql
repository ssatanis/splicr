-- Migration: Create analysis_shares table for collaboration feature
-- Run this in your Supabase SQL Editor

-- Create the analysis_shares table
CREATE TABLE IF NOT EXISTS public.analysis_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID NOT NULL REFERENCES public.analyses(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  permission TEXT NOT NULL DEFAULT 'view' CHECK (permission IN ('view', 'edit', 'admin')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  shared_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,

  -- Prevent duplicate shares
  UNIQUE(analysis_id, email)
);

-- Ensure required columns exist before indexes/policies (handles table from previous partial run)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'analysis_shares' AND column_name = 'email'
  ) THEN
    ALTER TABLE public.analysis_shares ADD COLUMN email TEXT NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'analysis_shares' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.analysis_shares ADD COLUMN user_id UUID;
  END IF;
END $$;

-- Ensure analyses has user_id for RLS policies (owner check)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'analyses' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.analyses ADD COLUMN user_id UUID;
  END IF;
END $$;

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_analysis_shares_analysis_id ON public.analysis_shares(analysis_id);
CREATE INDEX IF NOT EXISTS idx_analysis_shares_email ON public.analysis_shares(email);
CREATE INDEX IF NOT EXISTS idx_analysis_shares_user_id ON public.analysis_shares(user_id);

-- Enable RLS
ALTER TABLE public.analysis_shares ENABLE ROW LEVEL SECURITY;

-- Policy: Users can see shares for analyses they own
CREATE POLICY "Users can view shares for their analyses"
  ON public.analysis_shares FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.analyses
      WHERE analyses.id = analysis_shares.analysis_id
      AND analyses.user_id = auth.uid()
    )
    OR email = (auth.jwt()->>'email')
  );

-- Policy: Only analysis owners can create shares
CREATE POLICY "Analysis owners can create shares"
  ON public.analysis_shares FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.analyses
      WHERE analyses.id = analysis_shares.analysis_id
      AND analyses.user_id = auth.uid()
    )
  );

-- Policy: Analysis owners can delete shares
CREATE POLICY "Analysis owners can delete shares"
  ON public.analysis_shares FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.analyses
      WHERE analyses.id = analysis_shares.analysis_id
      AND analyses.user_id = auth.uid()
    )
  );

-- Policy: Users can update their own share (to accept)
CREATE POLICY "Users can accept their shares"
  ON public.analysis_shares FOR UPDATE
  USING (
    email = (auth.jwt()->>'email')
  );

-- Add email column to profiles if not exists (profiles already has email in your schema)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'email'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN email TEXT;
  END IF;
END $$;

-- Grant permissions
GRANT ALL ON public.analysis_shares TO authenticated;
GRANT ALL ON public.analysis_shares TO service_role;

COMMENT ON TABLE public.analysis_shares IS 'Stores analysis sharing permissions between users';
