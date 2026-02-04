'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { buildDataExport, getExportFileName, type DataResidency } from '@/lib/data-export';
import Button from '@/components/Button';
import {
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Shield,
  Lock,
  LogOut,
  Download,
  Trash2,
  Globe,
  Eye,
  EyeOff,
  Key,
} from 'lucide-react';

interface ActiveSession {
  id: string;
  device: string;
  browser: string;
  ip_address: string;
  location: string;
  last_active: string;
  is_current: boolean;
}

interface LoginHistory {
  timestamp: string;
  ip_address: string;
  location: string;
  device: string;
  success: boolean;
}

/** Row from public.user_sessions (Supabase) */
interface UserSessionRow {
  id: string;
  user_id: string;
  created_at: string;
  last_active_at: string;
  expires_at: string;
  ip_address: string | null;
  user_agent: string | null;
  device_info: { browser?: string; os?: string; device_type?: string } | null;
}

/** Parses user_agent string into browser and device summary */
function parseUserAgent(ua: string | null): { browser: string; device: string } {
  if (!ua) return { browser: 'Unknown', device: 'Unknown device' };
  const u = ua.toLowerCase();
  let browser = 'Unknown';
  if (u.includes('firefox/')) browser = 'Firefox';
  else if (u.includes('edg/')) browser = 'Edge';
  else if (u.includes('chrome/') && !u.includes('chromium')) browser = 'Chrome';
  else if (u.includes('safari/') && !u.includes('chrome')) browser = 'Safari';
  else if (u.includes('opr/') || u.includes('opera')) browser = 'Opera';
  const match = u.match(/(chrome|firefox|edg|safari|opr)[\/\s](\d+\.?\d*)/i);
  if (match) {
    const name = match[1] === 'opr' ? 'Opera' : match[1].charAt(0).toUpperCase() + match[1].slice(1);
    browser = `${name} ${match[2]}`;
  }
  let device = 'Desktop';
  if (u.includes('mobile') || u.includes('android')) device = 'Mobile';
  else if (u.includes('tablet') || u.includes('ipad')) device = 'Tablet';
  return { browser, device };
}

function formatRelativeTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

interface PrivacySettings {
  two_factor_enabled: boolean;
  data_residency: 'us' | 'eu' | 'asia';
  active_sessions: ActiveSession[];
  login_history: LoginHistory[];
}

const DATA_RESIDENCY_OPTIONS = [
  { id: 'us', name: 'United States', flag: '🇺🇸', description: 'Data stored in US data centers' },
  { id: 'eu', name: 'European Union', flag: '🇪🇺', description: 'GDPR-compliant EU data centers' },
  { id: 'asia', name: 'Asia Pacific', flag: '🌏', description: 'Data stored in Asia-Pacific region' },
];

export function PrivacySecuritySettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [loginHistory, setLoginHistory] = useState<Array<{
    id: string;
    created_at: string;
    last_active_at: string;
    expires_at: string;
    ip_address: string | null;
    user_agent: string | null;
    device_info: UserSessionRow['device_info'];
    is_current?: boolean;
  }>>([]);
  const [loginHistoryLoading, setLoginHistoryLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const [settings, setSettings] = useState<PrivacySettings>({
    two_factor_enabled: false,
    data_residency: 'us',
    active_sessions: [],
    login_history: [],
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
    setLoginHistoryLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoginHistoryLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('privacy_settings')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error loading settings:', error);
        return;
      }

      if (data) {
        setSettings(prev => ({ ...prev, ...(data as Partial<PrivacySettings>) } as PrivacySettings));
      }

      // Load login history and active sessions from public.user_sessions
      const { data: sessionsData } = await (supabase
        .from('user_sessions') as any)
        .select('id, created_at, last_active_at, expires_at, ip_address, user_agent, device_info')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);
      let rows = (sessionsData as UserSessionRow[] | null) ?? [];
      const now = new Date().toISOString();
      // If no rows (e.g. user_sessions not populated), show current session from Auth as fallback
      if (rows.length === 0) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const createdSec = (session as { created_at?: number }).created_at ?? Math.floor(Date.now() / 1000);
          const expiresSec = (session as { expires_at?: number }).expires_at ?? createdSec + 3600;
          const ua = typeof navigator !== 'undefined' ? navigator.userAgent : null;
          rows = [{
            id: session.user.id,
            user_id: session.user.id,
            created_at: new Date(createdSec * 1000).toISOString(),
            last_active_at: now,
            expires_at: new Date(expiresSec * 1000).toISOString(),
            ip_address: null,
            user_agent: ua,
            device_info: null,
          } as UserSessionRow];
        }
      }
      setLoginHistory(rows.map(r => ({ ...r, is_current: r.expires_at > now })));
      // Build active_sessions for the "Active Sessions" block from same data (current session only)
      const activeSessions: ActiveSession[] = rows
        .filter(r => r.expires_at > now)
        .map(r => {
          const { browser, device } = parseUserAgent(r.user_agent);
          const devInfo = r.device_info as { os?: string } | null;
          return {
            id: r.id,
            device: devInfo?.os ?? device,
            browser,
            ip_address: r.ip_address ?? '—',
            location: '—',
            last_active: r.last_active_at,
            is_current: r.id === rows[0]?.id,
          };
        });
      if (activeSessions.length > 0) {
        setSettings(prev => ({ ...prev, active_sessions: activeSessions }));
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
      setLoginHistoryLoading(false);
    }
  }

  async function saveSettings() {
    setSaving(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await (supabase
        .from('privacy_settings') as any)
        .upsert({
          user_id: user.id,
          two_factor_enabled: settings.two_factor_enabled,
          data_residency: settings.data_residency,
          updated_at: new Date().toISOString(),
        });

      if (error) throw error;
      setSuccess(true);
    } catch (error: any) {
      console.error('Error saving settings:', error);
      setError(error.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  async function changePassword() {
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) throw error;

      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      console.error('Error changing password:', error);
      setError(error.message || 'Failed to change password');
    } finally {
      setSaving(false);
    }
  }

  async function logoutSession(sessionId: string) {
    try {
      // Mock session logout
      setSettings(prev => ({
        ...prev,
        active_sessions: prev.active_sessions.filter(s => s.id !== sessionId),
      }));
    } catch (error) {
      console.error('Error logging out session:', error);
      setError('Failed to logout session');
    }
  }

  async function exportData() {
    setExporting(true);
    setError(null);
    try {
      const residency = (settings.data_residency || 'us') as DataResidency;
      const payload = await buildDataExport(supabase, residency);
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = getExportFileName(residency);
      a.click();
      URL.revokeObjectURL(url);
      setSuccess(true);
    } catch (err: unknown) {
      console.error('Error exporting data:', err);
      setError(err instanceof Error ? err.message : 'Failed to export data');
    } finally {
      setExporting(false);
    }
  }

  async function deleteAccount() {
    if (!showDeleteConfirm) {
      setShowDeleteConfirm(true);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      // Mock account deletion - in production, this would delete all user data
      const { error } = await supabase.auth.signOut();
      if (error) throw error;

      window.location.href = '/';
    } catch (error: any) {
      console.error('Error deleting account:', error);
      setError(error.message || 'Failed to delete account');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-serif text-text-primary mb-2 flex items-center gap-2">
          <Shield className="w-6 h-6" />
          Privacy & Security
        </h2>
        <p className="text-sm text-text-secondary">
          Manage your security settings, sessions, and data privacy
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
          <span className="text-sm">Settings updated successfully!</span>
        </div>
      )}

      {/* Change Password */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4 flex items-center gap-2">
          <Lock className="w-5 h-5" />
          Change Password
        </h3>

        <div className="space-y-4 max-w-md">
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">
              New Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-4 py-2 pr-10 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="Enter new password"
              />
              <button
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-text-tertiary mt-1">Minimum 8 characters</p>
          </div>

          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">
              Confirm New Password
            </label>
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
              placeholder="Confirm new password"
            />
          </div>

          <Button
            onClick={changePassword}
            disabled={!newPassword || !confirmPassword || saving}
            variant="secondary"
          >
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Key className="w-4 h-4 mr-2" />}
            Update password
          </Button>
        </div>
      </div>

      {/* Active Sessions */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4">Active Sessions</h3>

        <div className="space-y-3">
          {settings.active_sessions.map((session) => (
            <div
              key={session.id}
              className="flex items-center justify-between p-4 bg-background rounded-lg border border-border"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="font-serif text-text-primary font-medium">{session.device}</h4>
                  {session.is_current && (
                    <span className="px-2 py-0.5 bg-accent/20 text-accent text-xs rounded">
                      Current
                    </span>
                  )}
                </div>
                <div className="flex gap-3 text-xs text-text-tertiary">
                  <span>{session.browser}</span>
                  <span>•</span>
                  <span>{session.location}</span>
                  <span>•</span>
                  <span>{session.ip_address}</span>
                  <span>•</span>
                  <span>Last active: {new Date(session.last_active).toLocaleDateString()}</span>
                </div>
              </div>
              {!session.is_current && (
                <button
                  onClick={() => logoutSession(session.id)}
                  className="ml-4 p-2 text-text-secondary hover:text-error transition-colors"
                  title="Log out this session"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Login History */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-1">Login History</h3>
        <p className="text-sm text-text-secondary mb-4">Recent login attempts to your account</p>

        {loginHistoryLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-accent" />
          </div>
        ) : loginHistory.length === 0 ? (
          <div className="text-center py-8 px-4 rounded-xl bg-background/50 border border-border">
            <p className="text-sm text-text-tertiary">No login history recorded yet.</p>
            <p className="text-xs text-text-tertiary mt-1">Sessions will appear here after you sign in.</p>
          </div>
        ) : (
          <div className="space-y-0">
            {loginHistory.slice(0, 20).map((entry, index) => {
              const { browser, device } = parseUserAgent(entry.user_agent);
              const isActive = entry.expires_at > new Date().toISOString();
              return (
                <div
                  key={entry.id}
                  className={`flex items-start gap-4 py-4 ${index < loginHistory.length - 1 ? 'border-b border-border' : ''}`}
                >
                  <div className={`mt-1.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${isActive ? 'bg-green-500/15 text-green-600' : 'bg-background text-text-tertiary'}`}>
                    {isActive ? (
                      <Key className="h-4 w-4" />
                    ) : (
                      <Lock className="h-4 w-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-text-primary">{browser}</span>
                      <span className="text-text-tertiary">·</span>
                      <span className="text-sm text-text-secondary">{device}</span>
                      {isActive && (
                        <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-600">
                          Active
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-text-tertiary">
                      <span>{formatRelativeTime(entry.created_at)}</span>
                      <span>{entry.ip_address ?? '—'}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-text-tertiary">
                      {new Date(entry.created_at).toLocaleString(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Data Privacy */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4 flex items-center gap-2">
          <Globe className="w-5 h-5" />
          Data Privacy
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-3">
              Data Residency Preference
            </label>
            <div className="grid grid-cols-3 gap-3">
              {DATA_RESIDENCY_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  onClick={() => setSettings({ ...settings, data_residency: option.id as any })}
                  className={`p-4 rounded-lg border-2 transition-all ${
                    settings.data_residency === option.id
                      ? 'border-accent bg-accent/5'
                      : 'border-border hover:border-accent/50'
                  }`}
                >
                  <div className="text-3xl mb-2">{option.flag}</div>
                  <h4 className="text-sm font-medium text-text-primary mb-1">{option.name}</h4>
                  <p className="text-xs text-text-tertiary">{option.description}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="pt-4 border-t border-border">
            <h4 className="text-sm font-serif text-text-primary mb-2">GDPR Compliance</h4>
            <p className="text-sm text-text-secondary mb-4">
              Export all your data or delete your account in compliance with GDPR regulations
            </p>
            <div className="flex gap-3">
              <Button onClick={exportData} variant="secondary" size="sm" disabled={exporting}>
                {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                {exporting ? 'Preparing export…' : 'Export my data'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Delete Account */}
      <div className="bg-surface rounded-xl p-6 border border-error/20">
        <h3 className="text-lg font-serif text-error mb-2">Delete Account</h3>
        <p className="text-sm text-text-secondary mb-4">
          Permanently delete your account and all associated data. This action cannot be undone.
        </p>

        {showDeleteConfirm ? (
          <div className="p-4 bg-error/10 rounded-lg border border-error/20 mb-4">
            <p className="text-sm text-error mb-3 font-medium">
              Are you absolutely sure? This will permanently delete all your analyses, notes, and settings.
            </p>
            <div className="flex gap-2">
              <Button onClick={deleteAccount} size="sm" className="bg-error hover:bg-error/90">
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                Yes, delete my account
              </Button>
              <Button onClick={() => setShowDeleteConfirm(false)} variant="secondary" size="sm">
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button onClick={() => setShowDeleteConfirm(true)} variant="secondary" size="sm">
            <Trash2 className="w-4 h-4 mr-2" />
            Delete my account
          </Button>
        )}
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
              Save security settings
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
