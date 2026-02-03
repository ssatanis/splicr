'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import Button from '@/components/Button';
import { Save, Loader2, CheckCircle2, AlertCircle, Bell } from 'lucide-react';

export function NotificationSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [settings, setSettings] = useState({
    email_on_analysis_complete: true,
    email_on_error: false,
    email_weekly_digest: false,
    email_shared_updates: false,
    email_system_announcements: true,
    desktop_notifications: true,
    sound_alerts: false,
    notification_position: 'top-right',
  });

  const supabase = createClient();

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  async function loadSettings() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error loading settings:', error);
        return;
      }

      if (data) {
        setSettings(prev => ({ ...prev, ...(data as Partial<typeof settings>) } as typeof settings));
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings() {
    setSaving(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error: err } = await (supabase
        .from('user_settings') as any)
        .upsert({
          user_id: user.id,
          ...settings,
          updated_at: new Date().toISOString(),
        });

      if (err) throw err;
      setSuccess(true);
    } catch (err: any) {
      console.error('Error saving settings:', err);
      setError(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-serif text-text-primary mb-2 flex items-center gap-2">
          <Bell className="w-6 h-6" />
          Notifications
        </h2>
        <p className="text-sm text-text-secondary">
          Manage how you receive updates about your analyses
        </p>
      </div>

      {/* Toast Messages */}
      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-500">
          <AlertCircle className="w-5 h-5" />
          <span className="text-sm">{error}</span>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 p-4 bg-green-500/10 border border-green-500/20 rounded-xl text-green-500">
          <CheckCircle2 className="w-5 h-5" />
          <span className="text-sm">Notification settings saved successfully!</span>
        </div>
      )}

      {/* Email Notifications */}
      <div className="bg-surface border border-border rounded-xl p-6">
        <h3 className="text-lg font-serif text-text-primary mb-4">Email Notifications</h3>
        <div className="space-y-4">
          <SettingItem
            id="analysis-complete"
            label="Analysis completion"
            description="Receive an email when a screen run finishes"
            checked={settings.email_on_analysis_complete}
            onChange={(checked) =>
              setSettings({ ...settings, email_on_analysis_complete: checked })
            }
          />

          <SettingItem
            id="error-notifications"
            label="Error notifications"
            description="Get notified when an analysis fails"
            checked={settings.email_on_error}
            onChange={(checked) =>
              setSettings({ ...settings, email_on_error: checked })
            }
          />

          <SettingItem
            id="weekly-digest"
            label="Weekly summary digest"
            description="Receive a weekly summary of your activity"
            checked={settings.email_weekly_digest}
            onChange={(checked) =>
              setSettings({ ...settings, email_weekly_digest: checked })
            }
          />

          <SettingItem
            id="shared-updates"
            label="Shared analysis updates"
            description="Notifications about changes to shared work"
            checked={settings.email_shared_updates}
            onChange={(checked) =>
              setSettings({ ...settings, email_shared_updates: checked })
            }
          />

          <SettingItem
            id="system-announcements"
            label="System announcements"
            description="Important updates about SplicR"
            checked={settings.email_system_announcements}
            onChange={(checked) =>
              setSettings({ ...settings, email_system_announcements: checked })
            }
          />
        </div>
      </div>

      {/* In-App Notifications */}
      <div className="bg-surface border border-border rounded-xl p-6">
        <h3 className="text-lg font-serif text-text-primary mb-4">In-App Notifications</h3>
        <div className="space-y-4">
          <SettingItem
            id="desktop-notifications"
            label="Desktop notifications"
            description="Show system notifications on your device"
            checked={settings.desktop_notifications}
            onChange={(checked) =>
              setSettings({ ...settings, desktop_notifications: checked })
            }
          />

          <SettingItem
            id="sound-alerts"
            label="Sound alerts"
            description="Play a sound when analysis completes"
            checked={settings.sound_alerts}
            onChange={(checked) =>
              setSettings({ ...settings, sound_alerts: checked })
            }
          />

          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">
              Notification position
            </label>
            <select
              value={settings.notification_position}
              onChange={(e) => setSettings({ ...settings, notification_position: e.target.value })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="top-right">Top right</option>
              <option value="top-left">Top left</option>
              <option value="bottom-right">Bottom right</option>
              <option value="bottom-left">Bottom left</option>
            </select>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end pt-4 border-t border-border">
        <Button onClick={saveSettings} disabled={saving} size="lg">
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Save preferences
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// Simple Switch Component
function SettingItem({ 
  id, 
  label, 
  description, 
  checked, 
  onChange 
}: { 
  id: string; 
  label: string; 
  description: string; 
  checked: boolean; 
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="space-y-0.5">
        <label htmlFor={id} className="text-sm font-medium text-text-primary cursor-pointer">
          {label}
        </label>
        <p className="text-sm text-text-secondary">
          {description}
        </p>
      </div>
      <button
        id={id}
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`
          relative inline-flex h-6 w-11 items-center rounded-full transition-colors
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2
          ${checked ? 'bg-accent' : 'bg-border'}
        `}
      >
        <span
          className={`
            inline-block h-4 w-4 transform rounded-full bg-white transition-transform
            ${checked ? 'translate-x-6' : 'translate-x-1'}
          `}
        />
      </button>
    </div>
  );
}
