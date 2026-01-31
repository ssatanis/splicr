-- Migration: Add collaboration tables
-- Creates: analysis_comments, analysis_activity, activity_logs, comment_reactions
-- Note: profiles, analyses, and analysis_shares already exist

-- =============================================================================
-- 0. Ensure analysis_shares has required columns for RLS policies below
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'analysis_shares' AND column_name = 'status'
  ) THEN
    ALTER TABLE public.analysis_shares
      ADD COLUMN status TEXT NOT NULL DEFAULT 'accepted'
      CHECK (status IN ('pending', 'accepted', 'declined'));
  END IF;
END $$;

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

-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can view comments on accessible analyses" ON public.analysis_comments;
DROP POLICY IF EXISTS "Users can create comments on accessible analyses" ON public.analysis_comments;
DROP POLICY IF EXISTS "Users can update their own comments" ON public.analysis_comments;
DROP POLICY IF EXISTS "Users can delete their own comments" ON public.analysis_comments;

-- RLS Policies for analysis_comments
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

CREATE POLICY "Users can update their own comments"
  ON public.analysis_comments FOR UPDATE
  USING (user_id = auth.uid());

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

-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can view activity on accessible analyses" ON public.analysis_activity;
DROP POLICY IF EXISTS "Users can create activity on accessible analyses" ON public.analysis_activity;

-- RLS Policies for analysis_activity
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

-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can view their own activity logs" ON public.activity_logs;
DROP POLICY IF EXISTS "Users can create activity logs" ON public.activity_logs;

-- RLS Policies for activity_logs
CREATE POLICY "Users can view their own activity logs"
  ON public.activity_logs FOR SELECT
  USING (user_id = auth.uid());

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

-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can view reactions on accessible comments" ON public.comment_reactions;
DROP POLICY IF EXISTS "Users can add reactions to accessible comments" ON public.comment_reactions;
DROP POLICY IF EXISTS "Users can remove their own reactions" ON public.comment_reactions;

-- RLS Policies for comment_reactions
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
