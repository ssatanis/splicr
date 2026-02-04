-- Add notification preference columns to user_settings so the Notifications
-- settings tab can persist all toggles (email, in-app, system, collaboration).

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS email_on_analysis_failure BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_daily_digest BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS browser_push_notifications BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS webhook_url TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS webhook_type VARCHAR(20) DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS system_feature_announcements BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS system_maintenance_alerts BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS system_algorithm_updates BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS system_security_notifications BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS collab_team_shares BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS collab_comments_on_analyses BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS collab_mentions BOOLEAN DEFAULT true;

COMMENT ON COLUMN public.user_settings.email_on_analysis_failure IS 'Email when a screen run fails';
COMMENT ON COLUMN public.user_settings.email_daily_digest IS 'Daily summary of completed analyses';
COMMENT ON COLUMN public.user_settings.browser_push_notifications IS 'Browser push when analysis completes';
COMMENT ON COLUMN public.user_settings.webhook_url IS 'Slack/Teams webhook URL for alerts';
COMMENT ON COLUMN public.user_settings.webhook_type IS 'none, slack, or teams';
COMMENT ON COLUMN public.user_settings.system_feature_announcements IS 'New SplicR feature notifications';
COMMENT ON COLUMN public.user_settings.system_maintenance_alerts IS 'Planned maintenance notifications';
COMMENT ON COLUMN public.user_settings.system_algorithm_updates IS 'MAGeCK/BAGEL2 pipeline update notifications';
COMMENT ON COLUMN public.user_settings.system_security_notifications IS 'Security and policy updates';
COMMENT ON COLUMN public.user_settings.collab_team_shares IS 'When someone shares an analysis with you';
COMMENT ON COLUMN public.user_settings.collab_comments_on_analyses IS 'When someone comments on your work';
COMMENT ON COLUMN public.user_settings.collab_mentions IS 'When you are @mentioned in a comment';
