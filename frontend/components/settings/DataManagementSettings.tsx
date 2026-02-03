'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import Button from '@/components/Button';
import { Save, Loader2, CheckCircle2, AlertCircle, Database, HardDrive } from 'lucide-react';

interface DataManagementSettings {
  auto_save_enabled: boolean;
  auto_save_interval_minutes: number;
  save_intermediate_results: boolean;
  create_checkpoint_before_major_ops: boolean;
  keep_failed_analyses_days: number;
  archive_old_analyses_days: number;
  auto_delete_archived_days: number | null;
  default_export_format: string;
  include_metadata: boolean;
  include_parameters: boolean;
  compress_large_files: boolean;
  compress_large_files_threshold_mb: number;
  compression_format: string;
}

export function DataManagementSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  
  const [settings, setSettings] = useState<DataManagementSettings>({
    auto_save_enabled: true,
    auto_save_interval_minutes: 5,
    save_intermediate_results: true,
    create_checkpoint_before_major_ops: true,
    keep_failed_analyses_days: 7,
    archive_old_analyses_days: 90,
    auto_delete_archived_days: null,
    default_export_format: 'csv',
    include_metadata: true,
    include_parameters: true,
    compress_large_files: true,
    compress_large_files_threshold_mb: 100,
    compression_format: 'zip',
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
        .from('data_management_settings')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error loading settings:', error);
        return;
      }

      if (data) {
        setSettings(prev => ({ ...prev, ...(data as Partial<DataManagementSettings>) } as DataManagementSettings));
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

      const { error } = await (supabase
        .from('data_management_settings') as any)
        .upsert({
          user_id: user.id,
          ...settings,
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
          <Database className="w-6 h-6" />
          Data Management
        </h2>
        <p className="text-sm text-text-secondary">
          Auto-save, retention, and export preferences
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
          <span className="text-sm">Data management settings saved successfully!</span>
        </div>
      )}

      {/* Auto-Save */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4">Auto-Save</h3>
        <div className="space-y-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.auto_save_enabled}
              onChange={(e) => setSettings({ ...settings, auto_save_enabled: e.target.checked })}
              className="w-4 h-4 rounded border-border accent-accent"
            />
            <span className="text-sm text-text-primary">Auto-save analysis every</span>
            <input
              type="number"
              min="1"
              max="60"
              value={settings.auto_save_interval_minutes}
              onChange={(e) => setSettings({ ...settings, auto_save_interval_minutes: parseInt(e.target.value) })}
              disabled={!settings.auto_save_enabled}
              className="w-16 px-2 py-1 bg-background border border-border rounded text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
            />
            <span className="text-sm text-text-primary">minutes</span>
          </label>
          
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.save_intermediate_results}
              onChange={(e) => setSettings({ ...settings, save_intermediate_results: e.target.checked })}
              className="w-4 h-4 rounded border-border accent-accent"
            />
            <span className="text-sm text-text-primary">Save intermediate results</span>
          </label>
          
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.create_checkpoint_before_major_ops}
              onChange={(e) => setSettings({ ...settings, create_checkpoint_before_major_ops: e.target.checked })}
              className="w-4 h-4 rounded border-border accent-accent"
            />
            <span className="text-sm text-text-primary">Create checkpoint before major operations</span>
          </label>
        </div>
      </div>

      {/* Data Retention */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4">Data Retention</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">
              Keep failed analyses for
            </label>
            <select
              value={settings.keep_failed_analyses_days}
              onChange={(e) => setSettings({ ...settings, keep_failed_analyses_days: parseInt(e.target.value) })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="1">1 day</option>
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">
              Archive old analyses after
            </label>
            <select
              value={settings.archive_old_analyses_days}
              onChange={(e) => setSettings({ ...settings, archive_old_analyses_days: parseInt(e.target.value) })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="30">30 days</option>
              <option value="60">60 days</option>
              <option value="90">90 days</option>
              <option value="180">180 days</option>
              <option value="365">1 year</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">
              Auto-delete archived after
            </label>
            <select
              value={settings.auto_delete_archived_days || 0}
              onChange={(e) => setSettings({ ...settings, auto_delete_archived_days: parseInt(e.target.value) || null })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="0">Never</option>
              <option value="365">1 year</option>
              <option value="730">2 years</option>
              <option value="1825">5 years</option>
              <option value="3650">10 years</option>
            </select>
          </div>
        </div>
      </div>

      {/* Export Preferences */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4">Export Preferences</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">
              Default export format
            </label>
            <select
              value={settings.default_export_format}
              onChange={(e) => setSettings({ ...settings, default_export_format: e.target.value })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="csv">CSV</option>
              <option value="excel">Excel (.xlsx)</option>
              <option value="json">JSON</option>
              <option value="tsv">TSV</option>
            </select>
          </div>
          
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.include_metadata}
              onChange={(e) => setSettings({ ...settings, include_metadata: e.target.checked })}
              className="w-4 h-4 rounded border-border accent-accent"
            />
            <span className="text-sm text-text-primary">Include metadata</span>
          </label>
          
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.include_parameters}
              onChange={(e) => setSettings({ ...settings, include_parameters: e.target.checked })}
              className="w-4 h-4 rounded border-border accent-accent"
            />
            <span className="text-sm text-text-primary">Include parameters</span>
          </label>
          
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.compress_large_files}
              onChange={(e) => setSettings({ ...settings, compress_large_files: e.target.checked })}
              className="w-4 h-4 rounded border-border accent-accent"
            />
            <span className="text-sm text-text-primary">Compress large files (&gt;{settings.compress_large_files_threshold_mb}MB)</span>
          </label>
          
          {settings.compress_large_files && (
            <div className="ml-6">
              <label className="block text-sm font-serif text-text-secondary mb-2">
                Compression format
              </label>
              <select
                value={settings.compression_format}
                onChange={(e) => setSettings({ ...settings, compression_format: e.target.value })}
                className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="zip">ZIP</option>
                <option value="tar.gz">TAR.GZ</option>
                <option value="7z">7Z</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Storage Usage (Mock) */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4 flex items-center gap-2">
          <HardDrive className="w-5 h-5" />
          Storage Usage
        </h3>
        <div className="space-y-4">
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-text-secondary">Current usage: 2.4 GB / 10 GB</span>
              <span className="text-text-primary font-medium">24%</span>
            </div>
            <div className="w-full h-2 bg-background rounded-full overflow-hidden">
              <div className="h-full bg-accent rounded-full" style={{ width: '24%' }} />
            </div>
          </div>
          
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-text-secondary">• Raw FASTQ files:</span>
              <span className="text-text-primary">1.2 GB (50%)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary">• Analysis results:</span>
              <span className="text-text-primary">0.8 GB (33%)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary">• Cached data:</span>
              <span className="text-text-primary">0.4 GB (17%)</span>
            </div>
          </div>
          
          <Button variant="secondary" size="sm" className="mt-4">
            View detailed breakdown →
          </Button>
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
              Save settings
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
