-- Migration: Initial schema for SplicR
-- Creates core tables: profiles, analyses

-- =============================================================================
-- 1. Create profiles table
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for profiles
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

-- Enable RLS on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- RLS Policies for profiles
-- Policy: Users can view all profiles (for mentions, sharing, etc.)
CREATE POLICY "Profiles are viewable by authenticated users"
  ON public.profiles FOR SELECT
  USING (auth.role() = 'authenticated');

-- Policy: Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (id = auth.uid());

-- Policy: Users can insert their own profile
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (id = auth.uid());

-- =============================================================================
-- 2. Create analyses table
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  library TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'mageck',
  file_names TEXT[] DEFAULT '{}',
  sample_labels JSONB DEFAULT '[]',
  parameters JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'complete', 'failed', 'cancelled')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  current_step TEXT,
  results JSONB,
  logs JSONB DEFAULT '[]',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Create indexes for analyses
CREATE INDEX IF NOT EXISTS idx_analyses_user_id ON public.analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_analyses_status ON public.analyses(status);
CREATE INDEX IF NOT EXISTS idx_analyses_created_at ON public.analyses(created_at DESC);

-- Enable RLS on analyses
ALTER TABLE public.analyses ENABLE ROW LEVEL SECURITY;

-- RLS Policies for analyses
-- Policy: Users can view their own analyses
CREATE POLICY "Users can view own analyses"
  ON public.analyses FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.analysis_shares
      WHERE analysis_shares.analysis_id = analyses.id
      AND analysis_shares.user_id = auth.uid()
      AND analysis_shares.status = 'accepted'
    )
  );

-- Policy: Users can create their own analyses
CREATE POLICY "Users can create own analyses"
  ON public.analyses FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Policy: Users can update their own analyses
CREATE POLICY "Users can update own analyses"
  ON public.analyses FOR UPDATE
  USING (user_id = auth.uid());

-- Policy: Users can delete their own analyses
CREATE POLICY "Users can delete own analyses"
  ON public.analyses FOR DELETE
  USING (user_id = auth.uid());

-- =============================================================================
-- Grant permissions
-- =============================================================================
GRANT ALL ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

GRANT ALL ON public.analyses TO authenticated;
GRANT ALL ON public.analyses TO service_role;

-- =============================================================================
-- Add comments for documentation
-- =============================================================================
COMMENT ON TABLE public.profiles IS 'User profiles and preferences';
COMMENT ON TABLE public.analyses IS 'CRISPR screen analyses and their results';
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
-- Migration: Create collaboration tables for comments and activity tracking
-- Tables: analysis_comments, analysis_activity, activity_logs, comment_reactions

-- =============================================================================
-- 1. Create analysis_comments table
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.analysis_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID NOT NULL REFERENCES public.analyses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_comment_id UUID REFERENCES public.analysis_comments(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL DEFAULT 'analysis' CHECK (target_type IN ('gene', 'plot', 'analysis', 'result_row')),
  target_id TEXT,
  content TEXT NOT NULL,
  mentions JSONB DEFAULT '[]',
  is_resolved BOOLEAN DEFAULT false,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  edited BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for analysis_comments
CREATE INDEX IF NOT EXISTS idx_analysis_comments_analysis_id ON public.analysis_comments(analysis_id);
CREATE INDEX IF NOT EXISTS idx_analysis_comments_user_id ON public.analysis_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_analysis_comments_parent_id ON public.analysis_comments(parent_comment_id);
CREATE INDEX IF NOT EXISTS idx_analysis_comments_created_at ON public.analysis_comments(created_at DESC);

-- Enable RLS on analysis_comments
ALTER TABLE public.analysis_comments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for analysis_comments
-- Policy: Users can view comments on analyses they have access to
CREATE POLICY "Users can view comments on accessible analyses"
  ON public.analysis_comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.analyses
      WHERE analyses.id = analysis_comments.analysis_id
      AND (
        analyses.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.analysis_shares
          WHERE analysis_shares.analysis_id = analyses.id
          AND analysis_shares.user_id = auth.uid()
          AND analysis_shares.status = 'accepted'
        )
      )
    )
  );

-- Policy: Authenticated users can create comments on analyses they have access to
CREATE POLICY "Users can create comments on accessible analyses"
  ON public.analysis_comments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.analyses
      WHERE analyses.id = analysis_comments.analysis_id
      AND (
        analyses.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.analysis_shares
          WHERE analysis_shares.analysis_id = analyses.id
          AND analysis_shares.user_id = auth.uid()
          AND analysis_shares.status = 'accepted'
        )
      )
    )
    AND user_id = auth.uid()
  );

-- Policy: Users can update their own comments
CREATE POLICY "Users can update their own comments"
  ON public.analysis_comments FOR UPDATE
  USING (user_id = auth.uid());

-- Policy: Users can delete their own comments
CREATE POLICY "Users can delete their own comments"
  ON public.analysis_comments FOR DELETE
  USING (user_id = auth.uid());

-- =============================================================================
-- 2. Create analysis_activity table
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.analysis_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID NOT NULL REFERENCES public.analyses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  description TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for analysis_activity
CREATE INDEX IF NOT EXISTS idx_analysis_activity_analysis_id ON public.analysis_activity(analysis_id);
CREATE INDEX IF NOT EXISTS idx_analysis_activity_user_id ON public.analysis_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_analysis_activity_created_at ON public.analysis_activity(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_activity_type ON public.analysis_activity(activity_type);

-- Enable RLS on analysis_activity
ALTER TABLE public.analysis_activity ENABLE ROW LEVEL SECURITY;

-- RLS Policies for analysis_activity
-- Policy: Users can view activity on analyses they have access to
CREATE POLICY "Users can view activity on accessible analyses"
  ON public.analysis_activity FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.analyses
      WHERE analyses.id = analysis_activity.analysis_id
      AND (
        analyses.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.analysis_shares
          WHERE analysis_shares.analysis_id = analyses.id
          AND analysis_shares.user_id = auth.uid()
          AND analysis_shares.status = 'accepted'
        )
      )
    )
  );

-- Policy: Authenticated users can create activity on analyses they have access to
CREATE POLICY "Users can create activity on accessible analyses"
  ON public.analysis_activity FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.analyses
      WHERE analyses.id = analysis_activity.analysis_id
      AND (
        analyses.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.analysis_shares
          WHERE analysis_shares.analysis_id = analyses.id
          AND analysis_shares.user_id = auth.uid()
          AND analysis_shares.status = 'accepted'
        )
      )
    )
    AND user_id = auth.uid()
  );

-- =============================================================================
-- 3. Create activity_logs table (general activity logging)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  metadata JSONB DEFAULT '{}',
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for activity_logs
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON public.activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_resource ON public.activity_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action_type ON public.activity_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON public.activity_logs(created_at DESC);

-- Enable RLS on activity_logs
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for activity_logs
-- Policy: Users can view their own activity logs
CREATE POLICY "Users can view their own activity logs"
  ON public.activity_logs FOR SELECT
  USING (user_id = auth.uid());

-- Policy: Authenticated users can create activity logs
CREATE POLICY "Users can create activity logs"
  ON public.activity_logs FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- =============================================================================
-- 4. Create comment_reactions table
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.comment_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id UUID NOT NULL REFERENCES public.analysis_comments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reaction TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(comment_id, user_id, reaction)
);

-- Create indexes for comment_reactions
CREATE INDEX IF NOT EXISTS idx_comment_reactions_comment_id ON public.comment_reactions(comment_id);
CREATE INDEX IF NOT EXISTS idx_comment_reactions_user_id ON public.comment_reactions(user_id);

-- Enable RLS on comment_reactions
ALTER TABLE public.comment_reactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for comment_reactions
-- Policy: Users can view reactions on comments they can see
CREATE POLICY "Users can view reactions on accessible comments"
  ON public.comment_reactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.analysis_comments
      WHERE analysis_comments.id = comment_reactions.comment_id
      AND EXISTS (
        SELECT 1 FROM public.analyses
        WHERE analyses.id = analysis_comments.analysis_id
        AND (
          analyses.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.analysis_shares
            WHERE analysis_shares.analysis_id = analyses.id
            AND analysis_shares.user_id = auth.uid()
            AND analysis_shares.status = 'accepted'
          )
        )
      )
    )
  );

-- Policy: Users can add reactions to accessible comments
CREATE POLICY "Users can add reactions to accessible comments"
  ON public.comment_reactions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.analysis_comments
      WHERE analysis_comments.id = comment_reactions.comment_id
      AND EXISTS (
        SELECT 1 FROM public.analyses
        WHERE analyses.id = analysis_comments.analysis_id
        AND (
          analyses.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.analysis_shares
            WHERE analysis_shares.analysis_id = analyses.id
            AND analysis_shares.user_id = auth.uid()
            AND analysis_shares.status = 'accepted'
          )
        )
      )
    )
    AND user_id = auth.uid()
  );

-- Policy: Users can remove their own reactions
CREATE POLICY "Users can remove their own reactions"
  ON public.comment_reactions FOR DELETE
  USING (user_id = auth.uid());

-- =============================================================================
-- Grant permissions
-- =============================================================================
GRANT ALL ON public.analysis_comments TO authenticated;
GRANT ALL ON public.analysis_comments TO service_role;

GRANT ALL ON public.analysis_activity TO authenticated;
GRANT ALL ON public.analysis_activity TO service_role;

GRANT ALL ON public.activity_logs TO authenticated;
GRANT ALL ON public.activity_logs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.activity_logs_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.activity_logs_id_seq TO service_role;

GRANT ALL ON public.comment_reactions TO authenticated;
GRANT ALL ON public.comment_reactions TO service_role;

-- =============================================================================
-- Add comments for documentation
-- =============================================================================
COMMENT ON TABLE public.analysis_comments IS 'Stores comments and discussions on analyses and their results';
COMMENT ON TABLE public.analysis_activity IS 'Tracks activity and events on analyses';
COMMENT ON TABLE public.activity_logs IS 'General activity logging across the application';
COMMENT ON TABLE public.comment_reactions IS 'Stores emoji reactions to comments';
