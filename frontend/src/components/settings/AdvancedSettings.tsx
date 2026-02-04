'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import Button from '@/components/Button';
import {
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle,
  FlaskConical,
  Bug,
  FileCode,
  Database,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

interface AdvancedSettingsState {
  beta_features: boolean;
  early_access_algorithms: boolean;
  experimental_visualizations: boolean;
  show_debug_info: boolean;
  export_analysis_logs: boolean;
  developer_mode: boolean;
}

export function AdvancedSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [experimentalOpen, setExperimentalOpen] = useState(true);
  const [developerOpen, setDeveloperOpen] = useState(true);

  const [settings, setSettings] = useState<AdvancedSettingsState>({
    beta_features: false,
    early_access_algorithms: false,
    experimental_visualizations: false,
    show_debug_info: false,
    export_analysis_logs: false,
    developer_mode: false,
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
        .from('user_settings')
        .select('*')
        .eq('user_id', user.id)
        .single();
      if (error && error.code !== 'PGRST116') return;
      if (data) {
        const d = data as any;
        setSettings((prev) => ({
          ...prev,
          beta_features: d.beta_features ?? prev.beta_features,
          early_access_algorithms: d.early_access_algorithms ?? prev.early_access_algorithms,
          experimental_visualizations: d.experimental_visualizations ?? prev.experimental_visualizations,
          show_debug_info: d.show_debug_info ?? prev.show_debug_info,
          export_analysis_logs: d.export_analysis_logs ?? prev.export_analysis_logs,
          developer_mode: d.developer_mode ?? prev.developer_mode,
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
      const { error } = await (supabase.from('user_settings') as any).upsert({
        user_id: user.id,
        beta_features: settings.beta_features,
        early_access_algorithms: settings.early_access_algorithms,
        experimental_visualizations: settings.experimental_visualizations,
        show_debug_info: settings.show_debug_info,
        export_analysis_logs: settings.export_analysis_logs,
        developer_mode: settings.developer_mode,
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
      <div className="mb-8">
        <h2 className="text-2xl font-serif text-text-primary mb-2 flex items-center gap-2">
          <FlaskConical className="w-6 h-6" />
          Advanced Settings
        </h2>
        <p className="text-sm text-text-secondary">
          Experimental features and developer options
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

      {/* Experimental Features */}
      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <button
          type="button"
          onClick={() => setExperimentalOpen(!experimentalOpen)}
          className="w-full flex items-center gap-2 px-6 py-4 text-left hover:bg-background/50 transition-colors"
        >
          {experimentalOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
          <FlaskConical className="w-5 h-5 text-text-secondary" />
          <span className="font-serif text-text-primary">Experimental Features</span>
        </button>
        {experimentalOpen && (
          <div className="px-6 pt-5 pb-6 border-t border-border space-y-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.beta_features}
                onChange={(e) => setSettings({ ...settings, beta_features: e.target.checked })}
                className="w-4 h-4 rounded border-border accent-accent"
              />
              <span className="text-sm text-text-primary">Beta features opt-in</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.early_access_algorithms}
                onChange={(e) => setSettings({ ...settings, early_access_algorithms: e.target.checked })}
                className="w-4 h-4 rounded border-border accent-accent"
              />
              <span className="text-sm text-text-primary">Early access to new algorithms</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.experimental_visualizations}
                onChange={(e) => setSettings({ ...settings, experimental_visualizations: e.target.checked })}
                className="w-4 h-4 rounded border-border accent-accent"
              />
              <span className="text-sm text-text-primary">Experimental visualization types</span>
            </label>
          </div>
        )}
      </div>

      {/* Developer Mode */}
      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <button
          type="button"
          onClick={() => setDeveloperOpen(!developerOpen)}
          className="w-full flex items-center gap-2 px-6 py-4 text-left hover:bg-background/50 transition-colors"
        >
          {developerOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
          <Bug className="w-5 h-5 text-text-secondary" />
          <span className="font-serif text-text-primary">Developer Mode</span>
        </button>
        {developerOpen && (
          <div className="px-6 pt-5 pb-6 border-t border-border space-y-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.show_debug_info}
                onChange={(e) => setSettings({ ...settings, show_debug_info: e.target.checked })}
                className="w-4 h-4 rounded border-border accent-accent"
              />
              <span className="text-sm text-text-primary">Show debug information</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.export_analysis_logs}
                onChange={(e) => setSettings({ ...settings, export_analysis_logs: e.target.checked })}
                className="w-4 h-4 rounded border-border accent-accent"
              />
              <span className="text-sm text-text-primary">Export analysis logs</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.developer_mode}
                onChange={(e) => setSettings({ ...settings, developer_mode: e.target.checked })}
                className="w-4 h-4 rounded border-border accent-accent"
              />
              <span className="text-sm text-text-primary">Developer mode (enables script execution, read-only SQL for Enterprise)</span>
            </label>
            <p className="text-xs text-text-tertiary flex items-center gap-1 mt-4">
              <FileCode className="w-4 h-4" />
              Custom script execution and SQL query interface available on Enterprise.
            </p>
          </div>
        )}
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
