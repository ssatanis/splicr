'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import Button from '@/components/Button';
import {
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Workflow,
  Clock,
  RefreshCw,
  Layers,
  Share2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

const PIPELINE_TEMPLATES = [
  { id: 'dropout', name: 'Dropout Screen', description: 'Standard dropout / fitness screen' },
  { id: 'drug_resistance', name: 'Drug Resistance', description: 'Resistance gene identification' },
  { id: 'essential_gene', name: 'Essential Gene', description: 'Core essential gene screen' },
  { id: 'crispri', name: 'CRISPRi', description: 'CRISPR interference (repression)' },
  { id: 'crispra', name: 'CRISPRa', description: 'CRISPR activation' },
];

interface WorkflowSettings {
  auto_process_uploads: boolean;
  schedule_enabled: boolean;
  schedule_time: string;
  schedule_timezone: string;
  retry_failed_analyses: boolean;
  max_retries: number;
  max_concurrent_analyses: number;
  saved_workflows: { id: string; name: string; description?: string; is_shared: boolean }[];
}

export function WorkflowAutomationSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(true);
  const [batchOpen, setBatchOpen] = useState(true);

  const [settings, setSettings] = useState<WorkflowSettings>({
    auto_process_uploads: false,
    schedule_enabled: false,
    schedule_time: '02:00',
    schedule_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    retry_failed_analyses: true,
    max_retries: 2,
    max_concurrent_analyses: 2,
    saved_workflows: [],
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
        .from('batch_settings')
        .select('*')
        .eq('user_id', user.id)
        .single();
      if (error && error.code !== 'PGRST116') {
        console.error('Error loading workflow settings:', error);
        return;
      }
      if (data) {
        setSettings((prev) => ({
          ...prev,
          auto_process_uploads: (data as any).auto_process_uploads ?? prev.auto_process_uploads,
          schedule_enabled: (data as any).schedule_enabled ?? prev.schedule_enabled,
          schedule_time: (data as any).schedule_time ?? prev.schedule_time,
          retry_failed_analyses: (data as any).retry_failed_analyses ?? prev.retry_failed_analyses,
          max_retries: (data as any).max_retries ?? prev.max_retries,
          max_concurrent_analyses: (data as any).max_concurrent_analyses ?? prev.max_concurrent_analyses,
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
      const { error } = await (supabase.from('batch_settings') as any).upsert({
        user_id: user.id,
        auto_process_uploads: settings.auto_process_uploads,
        schedule_enabled: settings.schedule_enabled,
        schedule_time: settings.schedule_time,
        retry_failed_analyses: settings.retry_failed_analyses,
        max_retries: settings.max_retries,
        max_concurrent_analyses: settings.max_concurrent_analyses,
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
          <Workflow className="w-6 h-6" />
          Workflow & Automation
        </h2>
        <p className="text-sm text-text-secondary">
          Pipeline presets, batch processing, and scheduled runs
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

      {/* Pipeline Presets */}
      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <button
          type="button"
          onClick={() => setPresetsOpen(!presetsOpen)}
          className="w-full flex items-center gap-2 px-6 py-4 text-left hover:bg-background/50 transition-colors"
        >
          {presetsOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
          <Layers className="w-5 h-5 text-text-secondary" />
          <span className="font-serif text-text-primary">Pipeline Presets</span>
        </button>
        {presetsOpen && (
          <div className="px-6 pb-6 pt-0 border-t border-border">
            <p className="text-sm text-text-secondary mb-4">
              Quick-start templates. Save custom workflows in Analysis Defaults → Presets; clone and share with team.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {PIPELINE_TEMPLATES.map((t) => (
                <div
                  key={t.id}
                  className="p-4 rounded-lg border border-border bg-background hover:border-accent/50 transition-colors"
                >
                  <p className="font-serif text-text-primary">{t.name}</p>
                  <p className="text-xs text-text-tertiary mt-0.5">{t.description}</p>
                  <Button size="sm" variant="secondary" className="mt-2">
                    Use template
                  </Button>
                </div>
              ))}
            </div>
            <p className="text-xs text-text-tertiary mt-3 flex items-center gap-1">
              <Share2 className="w-4 h-4" />
              Share workflow presets with team from Analysis Defaults.
            </p>
          </div>
        )}
      </div>

      {/* Batch Processing */}
      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <button
          type="button"
          onClick={() => setBatchOpen(!batchOpen)}
          className="w-full flex items-center gap-2 px-6 py-4 text-left hover:bg-background/50 transition-colors"
        >
          {batchOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
          <Clock className="w-5 h-5 text-text-secondary" />
          <span className="font-serif text-text-primary">Batch Processing</span>
        </button>
        {batchOpen && (
          <div className="px-6 pb-6 pt-0 border-t border-border space-y-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.auto_process_uploads}
                onChange={(e) => setSettings({ ...settings, auto_process_uploads: e.target.checked })}
                className="w-4 h-4 rounded border-border accent-accent"
              />
              <span className="text-sm text-text-primary">Auto-process uploads matching criteria</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.schedule_enabled}
                onChange={(e) => setSettings({ ...settings, schedule_enabled: e.target.checked })}
                className="w-4 h-4 rounded border-border accent-accent"
              />
              <span className="text-sm text-text-primary">Schedule analysis runs (e.g. overnight)</span>
            </label>
            {settings.schedule_enabled && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 ml-6">
                <div>
                  <label className="block text-sm font-serif text-text-secondary mb-2">Time</label>
                  <input
                    type="time"
                    value={settings.schedule_time}
                    onChange={(e) => setSettings({ ...settings, schedule_time: e.target.value })}
                    className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-serif text-text-secondary mb-2">Timezone</label>
                  <input
                    type="text"
                    value={settings.schedule_timezone}
                    readOnly
                    className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-tertiary"
                  />
                </div>
              </div>
            )}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.retry_failed_analyses}
                onChange={(e) => setSettings({ ...settings, retry_failed_analyses: e.target.checked })}
                className="w-4 h-4 rounded border-border accent-accent"
              />
              <span className="text-sm text-text-primary">Retry failed analyses</span>
            </label>
            {settings.retry_failed_analyses && (
              <div className="ml-6">
                <label className="block text-sm font-serif text-text-secondary mb-2">Max retries</label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={settings.max_retries}
                  onChange={(e) => setSettings({ ...settings, max_retries: parseInt(e.target.value) || 1 })}
                  className="w-24 px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-serif text-text-secondary mb-2">
                Max concurrent analyses (1–10)
              </label>
              <input
                type="range"
                min={1}
                max={10}
                value={settings.max_concurrent_analyses}
                onChange={(e) => setSettings({ ...settings, max_concurrent_analyses: parseInt(e.target.value) })}
                className="w-full accent-accent"
              />
              <span className="text-sm text-text-tertiary ml-2">{settings.max_concurrent_analyses}</span>
            </div>
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
