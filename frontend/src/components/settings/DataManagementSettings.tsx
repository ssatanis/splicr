'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { buildDataExport } from '@/lib/data-export';
import Button from '@/components/Button';
import { Save, Loader2, CheckCircle2, AlertCircle, Database, HardDrive, Download, X } from 'lucide-react';
import JSZip from 'jszip';

interface DataManagementSettings {
  auto_save_enabled: boolean;
  auto_save_interval_minutes: number;
  save_intermediate_results: boolean;
  create_checkpoint_before_major_ops: boolean;
  keep_failed_analyses_days: number;
  archive_old_analyses_days: number;
  auto_delete_screens_days: number | null;
  auto_delete_archived_days: number | null;
  default_export_format: string;
  include_metadata: boolean;
  include_parameters: boolean;
  include_raw_counts: boolean;
  include_qc_metrics: boolean;
  compress_large_files: boolean;
  compress_large_files_threshold_mb: number;
  compression_preference: 'none' | 'gzip' | 'zip';
  compression_format: string;
  auto_generate_analysis_report: boolean;
  backup_enabled: boolean;
  backup_frequency: 'manual' | 'weekly' | 'monthly';
}

interface StorageBreakdown {
  totalBytes: number;
  fastqBytes: number;
  analysesCount: number;
  analysesEstimateBytes: number;
  cachedEstimateBytes: number;
  loading: boolean;
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
    auto_delete_screens_days: null,
    auto_delete_archived_days: null,
    default_export_format: 'csv',
    include_metadata: true,
    include_parameters: true,
    include_raw_counts: true,
    include_qc_metrics: true,
    compress_large_files: true,
    compress_large_files_threshold_mb: 100,
    compression_preference: 'gzip',
    compression_format: 'zip',
    auto_generate_analysis_report: false,
    backup_enabled: false,
    backup_frequency: 'manual',
  });

  const [showStorageBreakdown, setShowStorageBreakdown] = useState(false);
  const [storageBreakdown, setStorageBreakdown] = useState<StorageBreakdown>({
    totalBytes: 0,
    fastqBytes: 0,
    analysesCount: 0,
    analysesEstimateBytes: 0,
    cachedEstimateBytes: 0,
    loading: false,
  });
  const [storageSummary, setStorageSummary] = useState<{ used: number; limit: number }>({ used: 0, limit: 10 * 1024 ** 3 });
  const [downloadingZip, setDownloadingZip] = useState(false);

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
        const d = data as Record<string, unknown>;
        setSettings(prev => ({
          ...prev,
          auto_save_enabled: d.auto_save_enabled ?? prev.auto_save_enabled,
          auto_save_interval_minutes: d.auto_save_interval_minutes ?? prev.auto_save_interval_minutes,
          save_intermediate_results: d.save_intermediate_results ?? prev.save_intermediate_results,
          create_checkpoint_before_major_ops: d.create_checkpoint_before_major_ops ?? prev.create_checkpoint_before_major_ops,
          keep_failed_analyses_days: d.keep_failed_analyses_days ?? prev.keep_failed_analyses_days,
          archive_old_analyses_days: d.archive_old_analyses_days ?? prev.archive_old_analyses_days,
          auto_delete_archived_days: d.auto_delete_archived_days ?? prev.auto_delete_archived_days,
          default_export_format: d.default_export_format ?? prev.default_export_format,
          include_metadata: d.include_metadata ?? prev.include_metadata,
          include_parameters: d.include_parameters ?? prev.include_parameters,
          compress_large_files: d.compress_large_files ?? prev.compress_large_files,
          compress_large_files_threshold_mb: d.compress_large_files_threshold_mb ?? prev.compress_large_files_threshold_mb,
          compression_format: d.compression_format ?? prev.compression_format,
        } as DataManagementSettings));
      }
      const profileRes = await (supabase.from('profiles') as any).select('storage_used_bytes').eq('id', user.id).maybeSingle();
      const used = (profileRes.data?.storage_used_bytes as number) ?? 0;
      setStorageSummary(prev => ({ ...prev, used }));
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchStorageBreakdown() {
    setStorageBreakdown(prev => ({ ...prev, loading: true }));
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const sb = supabase as any;
      const uid = user.id;
      let totalBytes = 0;
      let fastqBytes = 0;
      let analysesCount = 0;
      const { data: profileRow } = await sb.from('profiles').select('storage_used_bytes').eq('id', uid).maybeSingle();
      totalBytes = Number(profileRow?.storage_used_bytes ?? 0);
      const { data: analysesList } = await sb.from('analyses').select('id').eq('user_id', uid).limit(5000);
      const analysisIds = (analysesList ?? []).map((r: { id: string }) => r.id);
      analysesCount = analysisIds.length;
      if (analysisIds.length > 0) {
        const { data: fastqRows } = await sb.from('fastq_files').select('file_size').in('analysis_id', analysisIds);
        fastqBytes = (fastqRows ?? []).reduce((sum: number, r: { file_size?: number | null }) => sum + Number(r?.file_size ?? 0), 0);
      }
      const analysesEstimateBytes = totalBytes > 0 ? Math.round(totalBytes * 0.33) : 0;
      const cachedEstimateBytes = totalBytes > 0 ? Math.round(totalBytes * 0.17) : 0;
      if (totalBytes === 0 && (fastqBytes > 0 || analysesCount > 0)) {
        totalBytes = fastqBytes + analysesEstimateBytes + cachedEstimateBytes;
      }
      setStorageBreakdown({
        totalBytes,
        fastqBytes,
        analysesCount,
        analysesEstimateBytes,
        cachedEstimateBytes,
        loading: false,
      });
    } catch {
      setStorageBreakdown(prev => ({ ...prev, loading: false }));
    }
  }

  function openStorageBreakdown() {
    setShowStorageBreakdown(true);
    fetchStorageBreakdown();
  }

  async function downloadAllDataZip() {
    setDownloadingZip(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const payload = await buildDataExport(supabase, 'us');
      const zip = new JSZip();
      zip.file('SplicR-DataExport.json', JSON.stringify(payload, null, 2));
      const analysesFolder = zip.folder('analyses');
      if (analysesFolder && payload.analyses?.length) {
        for (const a of payload.analyses) {
          analysesFolder.file(`${a.id}-${(a.name || 'analysis').replace(/[^a-zA-Z0-9-_]/g, '_')}.json`, JSON.stringify(a, null, 2));
        }
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `SplicR-AllData-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setSuccess(true);
    } catch (err: unknown) {
      console.error('Download ZIP error:', err);
      setError(err instanceof Error ? err.message : 'Failed to create download');
    } finally {
      setDownloadingZip(false);
    }
  }

  async function saveSettings() {
    setSaving(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const payload = {
        user_id: user.id,
        auto_save_enabled: settings.auto_save_enabled,
        auto_save_interval_minutes: settings.auto_save_interval_minutes,
        save_intermediate_results: settings.save_intermediate_results,
        create_checkpoint_before_major_ops: settings.create_checkpoint_before_major_ops,
        keep_failed_analyses_days: settings.keep_failed_analyses_days,
        archive_old_analyses_days: settings.archive_old_analyses_days,
        auto_delete_archived_days: settings.auto_delete_archived_days ?? null,
        default_export_format: settings.default_export_format,
        include_metadata: settings.include_metadata,
        include_parameters: settings.include_parameters,
        compress_large_files: settings.compress_large_files,
        compress_large_files_threshold_mb: settings.compress_large_files_threshold_mb,
        compression_format: settings.compression_format,
        updated_at: new Date().toISOString(),
      };
      const { error } = await (supabase.from('data_management_settings') as any).upsert(payload);
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
              Auto-delete screens after (days)
            </label>
            <select
              value={settings.auto_delete_screens_days ?? 0}
              onChange={(e) => setSettings({ ...settings, auto_delete_screens_days: parseInt(e.target.value) || null })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="0">Never</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="180">180 days</option>
              <option value="365">365 days</option>
            </select>
            <p className="text-xs text-text-tertiary mt-1">Move to archive or delete after this period</p>
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
              <option value="tsv">TSV</option>
              <option value="excel">Excel (.xlsx)</option>
              <option value="hdf5">HDF5</option>
              <option value="json">JSON</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">
              Compression preference
            </label>
            <select
              value={settings.compression_preference}
              onChange={(e) => setSettings({ ...settings, compression_preference: e.target.value as 'none' | 'gzip' | 'zip' })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="none">None</option>
              <option value="gzip">gzip</option>
              <option value="zip">zip</option>
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
              checked={settings.include_raw_counts}
              onChange={(e) => setSettings({ ...settings, include_raw_counts: e.target.checked })}
              className="w-4 h-4 rounded border-border accent-accent"
            />
            <span className="text-sm text-text-primary">Include raw counts in exports</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.include_qc_metrics}
              onChange={(e) => setSettings({ ...settings, include_qc_metrics: e.target.checked })}
              className="w-4 h-4 rounded border-border accent-accent"
            />
            <span className="text-sm text-text-primary">Include QC metrics</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.auto_generate_analysis_report}
              onChange={(e) => setSettings({ ...settings, auto_generate_analysis_report: e.target.checked })}
              className="w-4 h-4 rounded border-border accent-accent"
            />
            <span className="text-sm text-text-primary">Auto-generate analysis report (PDF)</span>
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
                Compression format (for large exports)
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

      {/* Backup & Sync */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4 flex items-center gap-2">
          <Database className="w-5 h-5" />
          Backup & Sync
        </h3>
        <div className="space-y-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.backup_enabled}
              onChange={(e) => setSettings({ ...settings, backup_enabled: e.target.checked })}
              className="w-4 h-4 rounded border-border accent-accent"
            />
            <span className="text-sm text-text-primary">Auto-backup completed analyses</span>
          </label>
          {settings.backup_enabled && (
            <div>
              <label className="block text-sm font-serif text-text-secondary mb-2">Export frequency</label>
              <select
                value={settings.backup_frequency}
                onChange={(e) => setSettings({ ...settings, backup_frequency: e.target.value as 'manual' | 'weekly' | 'monthly' })}
                className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="manual">Manual only</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
          )}
          <Button variant="secondary" className="mt-2" onClick={downloadAllDataZip} disabled={downloadingZip}>
            {downloadingZip ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
            {downloadingZip ? 'Creating ZIP…' : 'Download all data (ZIP)'}
          </Button>
          <p className="text-xs text-text-tertiary">Generates a ZIP of all your analyses and exports.</p>
        </div>
      </div>

      {/* Storage Usage */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4 flex items-center gap-2">
          <HardDrive className="w-5 h-5" />
          Storage Usage
        </h3>
        <div className="space-y-4">
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-text-secondary">
                Current usage: {(storageSummary.used / 1024 ** 3).toFixed(2)} GB / {(storageSummary.limit / 1024 ** 3).toFixed(0)} GB
              </span>
              <span className="text-text-primary font-medium">
                {storageSummary.limit ? Math.round((storageSummary.used / storageSummary.limit) * 100) : 0}%
              </span>
            </div>
            <div className="w-full h-2 bg-background rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all"
                style={{
                  width: `${storageSummary.limit ? Math.min(100, (storageSummary.used / storageSummary.limit) * 100) : 0}%`,
                }}
              />
            </div>
          </div>
          <Button variant="secondary" size="sm" className="mt-4" onClick={openStorageBreakdown}>
            View detailed breakdown →
          </Button>
        </div>
      </div>

      {/* Storage breakdown modal */}
      {showStorageBreakdown && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowStorageBreakdown(false)}>
          <div
            className="bg-surface rounded-xl border border-border shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-serif text-text-primary">Storage breakdown</h3>
              <button
                type="button"
                onClick={() => setShowStorageBreakdown(false)}
                className="p-2 text-text-tertiary hover:text-text-primary rounded-lg"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {storageBreakdown.loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-8 h-8 animate-spin text-accent" />
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                <div className="flex justify-between py-2 border-b border-border">
                  <span className="text-text-secondary">Total</span>
                  <span className="text-text-primary font-medium">
                    {(storageBreakdown.totalBytes / 1024 ** 3).toFixed(3)} GB
                  </span>
                </div>
                <div className="flex justify-between py-2 border-b border-border">
                  <span className="text-text-secondary">Raw FASTQ files</span>
                  <span className="text-text-primary">
                    {(storageBreakdown.fastqBytes / 1024 ** 3).toFixed(3)} GB
                    {storageBreakdown.totalBytes > 0 && ` (${Math.round((storageBreakdown.fastqBytes / storageBreakdown.totalBytes) * 100)}%)`}
                  </span>
                </div>
                <div className="flex justify-between py-2 border-b border-border">
                  <span className="text-text-secondary">Analysis results (est.)</span>
                  <span className="text-text-primary">
                    {(storageBreakdown.analysesEstimateBytes / 1024 ** 3).toFixed(3)} GB
                    {storageBreakdown.totalBytes > 0 && ` (${Math.round((storageBreakdown.analysesEstimateBytes / storageBreakdown.totalBytes) * 100)}%)`}
                  </span>
                </div>
                <div className="flex justify-between py-2 border-b border-border">
                  <span className="text-text-secondary">Cached data (est.)</span>
                  <span className="text-text-primary">
                    {(storageBreakdown.cachedEstimateBytes / 1024 ** 3).toFixed(3)} GB
                    {storageBreakdown.totalBytes > 0 && ` (${Math.round((storageBreakdown.cachedEstimateBytes / storageBreakdown.totalBytes) * 100)}%)`}
                  </span>
                </div>
                <div className="flex justify-between py-2 text-text-tertiary">
                  <span>Analyses count</span>
                  <span>{storageBreakdown.analysesCount}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

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
