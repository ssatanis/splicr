-- ============================================================================
-- EMAIL NOTIFICATION SYSTEM - DATABASE SCHEMA
-- ============================================================================
-- This migration creates the necessary tables for the email notification system
-- including user notification settings and notification logs.

-- Create user_settings table for notification preferences
CREATE TABLE IF NOT EXISTS user_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Email notification preferences
  email_on_analysis_complete BOOLEAN DEFAULT true,
  email_on_error BOOLEAN DEFAULT false,
  email_weekly_digest BOOLEAN DEFAULT false,
  email_shared_updates BOOLEAN DEFAULT false,
  email_system_announcements BOOLEAN DEFAULT true,
  
  -- In-app notification preferences
  desktop_notifications BOOLEAN DEFAULT true,
  sound_alerts BOOLEAN DEFAULT false,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(user_id)
);

-- Create notifications table (for in-app notifications and email logs)
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create email_logs table for tracking email delivery
CREATE TABLE IF NOT EXISTS email_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_type VARCHAR(50) NOT NULL,
  to_email TEXT NOT NULL,
  status VARCHAR(20) NOT NULL, -- 'sent', 'failed', 'bounced'
  message_id TEXT,
  error TEXT,
  sent_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
CREATE INDEX IF NOT EXISTS idx_email_logs_user_id ON email_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_sent_at ON email_logs(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);

-- Enable Row Level Security
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_settings
DROP POLICY IF EXISTS "Users can view own settings" ON user_settings;
CREATE POLICY "Users can view own settings"
  ON user_settings FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own settings" ON user_settings;
CREATE POLICY "Users can update own settings"
  ON user_settings FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own settings" ON user_settings;
CREATE POLICY "Users can insert own settings"
  ON user_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for notifications
DROP POLICY IF EXISTS "Users can view own notifications" ON notifications;
CREATE POLICY "Users can view own notifications"
  ON notifications FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own notifications" ON notifications;
CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service can insert notifications" ON notifications;
CREATE POLICY "Service can insert notifications"
  ON notifications FOR INSERT
  WITH CHECK (true);

-- RLS Policies for email_logs
DROP POLICY IF EXISTS "Users can view own email logs" ON email_logs;
CREATE POLICY "Users can view own email logs"
  ON email_logs FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service can insert email logs" ON email_logs;
CREATE POLICY "Service can insert email logs"
  ON email_logs FOR INSERT
  WITH CHECK (true);

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for user_settings
DROP TRIGGER IF EXISTS update_user_settings_updated_at ON user_settings;
CREATE TRIGGER update_user_settings_updated_at
  BEFORE UPDATE ON user_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Grant necessary permissions
GRANT ALL ON user_settings TO authenticated;
GRANT ALL ON notifications TO authenticated;
GRANT ALL ON email_logs TO authenticated;

-- Insert default settings for existing users
INSERT INTO user_settings (user_id, email_on_analysis_complete)
SELECT id, true
FROM auth.users
WHERE id NOT IN (SELECT user_id FROM user_settings)
ON CONFLICT (user_id) DO NOTHING;

-- Add helpful comments
COMMENT ON TABLE user_settings IS 'Stores user notification preferences';
COMMENT ON TABLE notifications IS 'Stores in-app notifications and notification history';
COMMENT ON TABLE email_logs IS 'Logs all email delivery attempts for debugging and analytics';
COMMENT ON COLUMN user_settings.email_on_analysis_complete IS 'Send email when analysis completes successfully';
COMMENT ON COLUMN user_settings.email_on_error IS 'Send email when analysis fails';
COMMENT ON COLUMN user_settings.email_weekly_digest IS 'Send weekly summary of all analyses';
COMMENT ON COLUMN user_settings.email_shared_updates IS 'Notify about updates to shared analyses';
COMMENT ON COLUMN user_settings.email_system_announcements IS 'Receive important platform updates';
