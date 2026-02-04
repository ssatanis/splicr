-- ============================================================================
-- USAGE ANALYTICS SYSTEM
-- ============================================================================
-- Tier 1: Raw event storage
-- Tier 2: Pre-aggregated daily metrics for fast dashboard queries

-- ============================================================================
-- 1. ANALYTICS EVENTS (raw event stream)
-- ============================================================================
CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  lab_id UUID REFERENCES public.labs(id) ON DELETE SET NULL,
  event_type VARCHAR(100) NOT NULL,
  event_category VARCHAR(50) NOT NULL,
  resource_id UUID,
  resource_type VARCHAR(50),
  metadata JSONB DEFAULT '{}',
  session_id VARCHAR(100),
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_user_date ON analytics_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_event_type ON analytics_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_lab_date ON analytics_events(lab_id, created_at DESC) WHERE lab_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_analytics_category ON analytics_events(event_category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_created_at ON analytics_events(created_at DESC);

-- ============================================================================
-- 2. ANALYTICS METRICS DAILY (pre-aggregated for dashboard speed)
-- ============================================================================
CREATE TABLE IF NOT EXISTS analytics_metrics_daily (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  lab_id UUID REFERENCES public.labs(id) ON DELETE SET NULL,
  date DATE NOT NULL,
  total_analyses INTEGER DEFAULT 0,
  completed_analyses INTEGER DEFAULT 0,
  failed_analyses INTEGER DEFAULT 0,
  total_screens INTEGER DEFAULT 0,
  mageck_runs INTEGER DEFAULT 0,
  bagel2_runs INTEGER DEFAULT 0,
  drugz_runs INTEGER DEFAULT 0,
  files_uploaded INTEGER DEFAULT 0,
  files_downloaded INTEGER DEFAULT 0,
  total_storage_bytes BIGINT DEFAULT 0,
  active_time_seconds INTEGER DEFAULT 0,
  features_used JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_metrics_user_date ON analytics_metrics_daily(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_lab_date ON analytics_metrics_daily(lab_id, date DESC) WHERE lab_id IS NOT NULL;

-- ============================================================================
-- 3. RLS
-- ============================================================================
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_metrics_daily ENABLE ROW LEVEL SECURITY;

-- Users can insert their own events only (service role used in API for insert)
CREATE POLICY analytics_events_select_own ON analytics_events
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY analytics_events_insert_own ON analytics_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Service role will insert; allow select for own user
CREATE POLICY analytics_metrics_select_own ON analytics_metrics_daily
  FOR SELECT USING (auth.uid() = user_id);

-- Service role inserts/updates for aggregation job
CREATE POLICY analytics_metrics_insert_own ON analytics_metrics_daily
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY analytics_metrics_update_own ON analytics_metrics_daily
  FOR UPDATE USING (auth.uid() = user_id);

-- ============================================================================
-- 4. HELPER: Upsert daily metrics (for cron/aggregation)
-- ============================================================================
CREATE OR REPLACE FUNCTION upsert_analytics_metrics_daily(
  p_user_id UUID,
  p_date DATE,
  p_total_analyses INTEGER DEFAULT 0,
  p_completed_analyses INTEGER DEFAULT 0,
  p_failed_analyses INTEGER DEFAULT 0,
  p_total_screens INTEGER DEFAULT 0,
  p_mageck_runs INTEGER DEFAULT 0,
  p_bagel2_runs INTEGER DEFAULT 0,
  p_drugz_runs INTEGER DEFAULT 0,
  p_files_uploaded INTEGER DEFAULT 0,
  p_files_downloaded INTEGER DEFAULT 0,
  p_total_storage_bytes BIGINT DEFAULT 0,
  p_active_time_seconds INTEGER DEFAULT 0,
  p_features_used JSONB DEFAULT '{}'
)
RETURNS void AS $$
BEGIN
  INSERT INTO analytics_metrics_daily (
    user_id, date, total_analyses, completed_analyses, failed_analyses,
    total_screens, mageck_runs, bagel2_runs, drugz_runs,
    files_uploaded, files_downloaded, total_storage_bytes, active_time_seconds,
    features_used, updated_at
  ) VALUES (
    p_user_id, p_date, p_total_analyses, p_completed_analyses, p_failed_analyses,
    p_total_screens, p_mageck_runs, p_bagel2_runs, p_drugz_runs,
    p_files_uploaded, p_files_downloaded, p_total_storage_bytes, p_active_time_seconds,
    p_features_used, NOW()
  )
  ON CONFLICT (user_id, date) DO UPDATE SET
    total_analyses = analytics_metrics_daily.total_analyses + EXCLUDED.total_analyses,
    completed_analyses = analytics_metrics_daily.completed_analyses + EXCLUDED.completed_analyses,
    failed_analyses = analytics_metrics_daily.failed_analyses + EXCLUDED.failed_analyses,
    total_screens = analytics_metrics_daily.total_screens + EXCLUDED.total_screens,
    mageck_runs = analytics_metrics_daily.mageck_runs + EXCLUDED.mageck_runs,
    bagel2_runs = analytics_metrics_daily.bagel2_runs + EXCLUDED.bagel2_runs,
    drugz_runs = analytics_metrics_daily.drugz_runs + EXCLUDED.drugz_runs,
    files_uploaded = analytics_metrics_daily.files_uploaded + EXCLUDED.files_uploaded,
    files_downloaded = analytics_metrics_daily.files_downloaded + EXCLUDED.files_downloaded,
    total_storage_bytes = GREATEST(analytics_metrics_daily.total_storage_bytes, EXCLUDED.total_storage_bytes),
    active_time_seconds = analytics_metrics_daily.active_time_seconds + EXCLUDED.active_time_seconds,
    features_used = analytics_metrics_daily.features_used || EXCLUDED.features_used,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
