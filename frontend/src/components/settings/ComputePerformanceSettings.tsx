'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import Button from '@/components/Button';
import {
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Zap,
  Cpu,
  Mail,
  Clock,
} from 'lucide-react';

type PriorityLevel = 'low' | 'normal' | 'high';
type ThreadOption = 'auto' | '4' | '8' | '16';
type MemoryOption = 'auto' | '4' | '8' | '16' | '32';
type TimeoutOption = '1' | '4' | '12' | '24';

interface ComputeSettings {
  default_priority: PriorityLevel;
  email_when_high_priority_starts: boolean;
  default_thread_count: ThreadOption;
  memory_limit_gb: MemoryOption;
  timeout_hours: TimeoutOption;
}

export function ComputePerformanceSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [settings, setSettings] = useState<ComputeSettings>({
    default_priority: 'normal',
    email_when_high_priority_starts: true,
    default_thread_count: 'auto',
    memory_limit_gb: 'auto',
    timeout_hours: '4',
  });

  const supabase = createClient();

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    if (success) {
      const t = setTimeout(() => setSuccess(false), 3000);
      return () => clearTimeout(t);
    }
  }, [success]);

  async function loadSettings() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from('compute_settings')
        .select('*')
        .eq('user_id', user.id)
        .single();
      if (error && error.code !== 'PGRST116') {
        console.error('Error loading compute settings:', error);
        return;
      }
      if (data) {
        setSettings((prev) => ({
          ...prev,
          default_priority: (data as any).default_priority ?? prev.default_priority,
          email_when_high_priority_starts: (data as any).email_when_high_priority_starts ?? prev.email_when_high_priority_starts,
          default_thread_count: (data as any).default_thread_count ?? prev.default_thread_count,
          memory_limit_gb: (data as any).memory_limit_gb ?? prev.memory_limit_gb,
          timeout_hours: (data as any).timeout_hours ?? prev.timeout_hours,
        }));
      }
    } catch (e) {
      console.error('Error:', e);
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
      const { error } = await (supabase.from('compute_settings') as any).upsert({
        user_id: user.id,
        default_priority: settings.default_priority,
        email_when_high_priority_starts: settings.email_when_high_priority_starts,
        default_thread_count: settings.default_thread_count,
        memory_limit_gb: settings.memory_limit_gb,
        timeout_hours: settings.timeout_hours,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      setSuccess(true);
    } catch (e: any) {
      setError(e.message || 'Failed to save settings');
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
      <div>
        <h2 className="text-2xl font-serif text-text-primary mb-2 flex items-center gap-2">
          <Zap className="w-6 h-6" />
          Compute & Performance
        </h2>
        <p className="text-sm text-text-secondary">
          Analysis priority, resource allocation, and timeouts (plan-dependent)
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-500">
          <AlertCircle className="w-5 h-5" />
          <span className="text-sm">{error}</span>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 p-4 bg-green-500/10 border border-green-500/20 rounded-xl text-green-500">
          <CheckCircle2 className="w-5 h-5" />
          <span className="text-sm">Settings saved.</span>
        </div>
      )}

      {/* Analysis Priority */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4 flex items-center gap-2">
          <Zap className="w-5 h-5" />
          Analysis Priority
        </h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">Default priority level</label>
            <select
              value={settings.default_priority}
              onChange={(e) => setSettings({ ...settings, default_priority: e.target.value as PriorityLevel })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
            <p className="text-xs text-text-tertiary mt-1">Higher priority runs are scheduled earlier (plan limits apply).</p>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.email_when_high_priority_starts}
              onChange={(e) => setSettings({ ...settings, email_when_high_priority_starts: e.target.checked })}
              className="w-4 h-4 rounded border-border accent-accent"
            />
            <Mail className="w-4 h-4 text-text-tertiary" />
            <span className="text-sm text-text-primary">Email me when high-priority analyses start</span>
          </label>
        </div>
      </div>

      {/* Resource Allocation */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4 flex items-center gap-2">
          <Cpu className="w-5 h-5" />
          Resource Allocation
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">Default thread count</label>
            <select
              value={settings.default_thread_count}
              onChange={(e) => setSettings({ ...settings, default_thread_count: e.target.value as ThreadOption })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="auto">Auto (plan default)</option>
              <option value="4">4</option>
              <option value="8">8</option>
              <option value="16">16</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">Memory limit per analysis</label>
            <select
              value={settings.memory_limit_gb}
              onChange={(e) => setSettings({ ...settings, memory_limit_gb: e.target.value as MemoryOption })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="auto">Auto</option>
              <option value="4">4 GB</option>
              <option value="8">8 GB</option>
              <option value="16">16 GB</option>
              <option value="32">32 GB</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2 flex items-center gap-1">
              <Clock className="w-4 h-4" />
              Timeout threshold
            </label>
            <select
              value={settings.timeout_hours}
              onChange={(e) => setSettings({ ...settings, timeout_hours: e.target.value as TimeoutOption })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="1">1 hour</option>
              <option value="4">4 hours</option>
              <option value="12">12 hours</option>
              <option value="24">24 hours</option>
            </select>
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-4 border-t border-border">
        <Button onClick={saveSettings} disabled={saving} size="lg">
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          Save
        </Button>
      </div>
    </div>
  );
}
