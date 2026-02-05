-- Migration: analysis_presence and user_notifications for collaboration features
-- These tables are optional; frontend handles missing tables gracefully.
-- Creates: analysis_presence (who is viewing), user_notifications (user alerts)

-- =============================================================================
-- 1. analysis_presence
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.analysis_presence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID NOT NULL REFERENCES public.analyses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  current_view TEXT DEFAULT 'results_table',
  cursor_position JSONB,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(analysis_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_analysis_presence_analysis_id ON public.analysis_presence(analysis_id);
CREATE INDEX IF NOT EXISTS idx_analysis_presence_last_seen ON public.analysis_presence(last_seen DESC);

ALTER TABLE public.analysis_presence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view presence on accessible analyses" ON public.analysis_presence;
DROP POLICY IF EXISTS "Users can insert own presence" ON public.analysis_presence;
DROP POLICY IF EXISTS "Users can update own presence" ON public.analysis_presence;
DROP POLICY IF EXISTS "Users can delete own presence" ON public.analysis_presence;

CREATE POLICY "Users can view presence on accessible analyses"
  ON public.analysis_presence FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.analyses a
      WHERE a.id = analysis_presence.analysis_id
      AND (a.user_id = auth.uid() OR EXISTS (
        SELECT 1 FROM public.analysis_shares s
        WHERE s.analysis_id = a.id AND s.user_id = auth.uid() AND s.status = 'accepted'
      ))
    )
  );

CREATE POLICY "Users can insert own presence"
  ON public.analysis_presence FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own presence"
  ON public.analysis_presence FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own presence"
  ON public.analysis_presence FOR DELETE
  USING (user_id = auth.uid());

GRANT ALL ON public.analysis_presence TO authenticated;
GRANT ALL ON public.analysis_presence TO service_role;

-- =============================================================================
-- 2. user_notifications
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.user_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT,
  type TEXT DEFAULT 'info',
  read BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB,
  data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_notifications_user_id ON public.user_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_user_notifications_created_at ON public.user_notifications(created_at DESC);

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own notifications" ON public.user_notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON public.user_notifications;
DROP POLICY IF EXISTS "Service can insert notifications" ON public.user_notifications;

CREATE POLICY "Users can view own notifications"
  ON public.user_notifications FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can update own notifications"
  ON public.user_notifications FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Only service_role can insert (e.g. share/API); users don't insert their own notifications
CREATE POLICY "Service can insert notifications"
  ON public.user_notifications FOR INSERT
  WITH CHECK (current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role');

GRANT ALL ON public.user_notifications TO authenticated;
GRANT ALL ON public.user_notifications TO service_role;
