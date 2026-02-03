'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import Button from '@/components/Button';
import { Save, Loader2, CheckCircle2, AlertCircle, Shield } from 'lucide-react';

interface QCSettings {
  min_read_depth_per_sample: number;
  max_low_quality_guides_pct: number;
  min_guide_representation: number;
  max_gini_coefficient: number;
  auto_flag_low_quality: boolean;
  warn_before_analyzing_flagged: boolean;
  include_qc_report_in_exports: boolean;
  min_replicate_correlation: number;
  replicate_correlation_action: string;
  verify_essential_gene_depletion: boolean;
  expected_essential_gene_lfc: number;
  check_nontargeting_distribution: boolean;
  expected_nt_guide_lfc_range: number;
  validate_positive_controls: boolean;
  generate_qc_report_always: boolean;
  include_fastqc_metrics: boolean;
  flag_outliers_automatically: boolean;
  compare_to_historical_qc: boolean;
  qc_report_format: string;
}

export function QualityControlSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  
  const [settings, setSettings] = useState<QCSettings>({
    min_read_depth_per_sample: 1000000,
    max_low_quality_guides_pct: 10.0,
    min_guide_representation: 100,
    max_gini_coefficient: 0.2,
    auto_flag_low_quality: true,
    warn_before_analyzing_flagged: true,
    include_qc_report_in_exports: true,
    min_replicate_correlation: 0.7,
    replicate_correlation_action: 'warn',
    verify_essential_gene_depletion: true,
    expected_essential_gene_lfc: -2.0,
    check_nontargeting_distribution: true,
    expected_nt_guide_lfc_range: 0.5,
    validate_positive_controls: true,
    generate_qc_report_always: true,
    include_fastqc_metrics: true,
    flag_outliers_automatically: true,
    compare_to_historical_qc: true,
    qc_report_format: 'pdf',
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
        .from('qc_settings')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error loading settings:', error);
        return;
      }

      if (data) {
        setSettings(prev => ({ ...prev, ...data }));
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

      const { error } = await supabase
        .from('qc_settings')
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
          <Shield className="w-6 h-6" />
          Quality Control
        </h2>
        <p className="text-sm text-text-secondary">
          Essential QC thresholds and automated checks for research credibility
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
          <span className="text-sm">QC settings saved successfully!</span>
        </div>
      )}

      {/* Read Quality Thresholds */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4">Read Quality Thresholds</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">
              Min Read Depth per Sample
            </label>
            <input
              type="number"
              step="100000"
              value={settings.min_read_depth_per_sample}
              onChange={(e) => setSettings({ ...settings, min_read_depth_per_sample: parseInt(e.target.value) })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <p className="text-xs text-text-tertiary mt-1">Minimum reads required per sample</p>
          </div>
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">
              Max % Low-Quality Guides
            </label>
            <input
              type="number"
              step="1"
              min="0"
              max="100"
              value={settings.max_low_quality_guides_pct}
              onChange={(e) => setSettings({ ...settings, max_low_quality_guides_pct: parseFloat(e.target.value) })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <p className="text-xs text-text-tertiary mt-1">Maximum percentage allowed</p>
          </div>
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">
              Min Guide Representation
            </label>
            <input
              type="number"
              step="10"
              value={settings.min_guide_representation}
              onChange={(e) => setSettings({ ...settings, min_guide_representation: parseInt(e.target.value) })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <p className="text-xs text-text-tertiary mt-1">Minimum reads per guide</p>
          </div>
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">
              Max Gini Coefficient
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={settings.max_gini_coefficient}
              onChange={(e) => setSettings({ ...settings, max_gini_coefficient: parseFloat(e.target.value) })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <p className="text-xs text-text-tertiary mt-1">Library skew threshold (0-1)</p>
          </div>
        </div>
        
        <div className="space-y-3 pt-4 border-t border-border">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.auto_flag_low_quality}
              onChange={(e) => setSettings({ ...settings, auto_flag_low_quality: e.target.checked })}
              className="w-4 h-4 rounded border-border accent-accent"
            />
            <span className="text-sm text-text-primary">Auto-flag low-quality samples</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.warn_before_analyzing_flagged}
              onChange={(e) => setSettings({ ...settings, warn_before_analyzing_flagged: e.target.checked })}
              className="w-4 h-4 rounded border-border accent-accent"
            />
            <span className="text-sm text-text-primary">Warn before analyzing flagged data</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.include_qc_report_in_exports}
              onChange={(e) => setSettings({ ...settings, include_qc_report_in_exports: e.target.checked })}
              className="w-4 h-4 rounded border-border accent-accent"
            />
            <span className="text-sm text-text-primary">Include QC report in exports</span>
          </label>
        </div>
      </div>

      {/* Replicate Correlation */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4">Replicate Correlation</h3>
        <div className="mb-4">
          <label className="block text-sm font-serif text-text-secondary mb-2">
            Minimum Correlation (R²)
          </label>
          <input
            type="number"
            step="0.05"
            min="0"
            max="1"
            value={settings.min_replicate_correlation}
            onChange={(e) => setSettings({ ...settings, min_replicate_correlation: parseFloat(e.target.value) })}
            className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <p className="text-xs text-text-tertiary mt-1">Required correlation between replicates</p>
        </div>
        
        <div>
          <label className="block text-sm font-serif text-text-secondary mb-2">
            Action if below threshold
          </label>
          <div className="space-y-2">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="correlation_action"
                value="warn"
                checked={settings.replicate_correlation_action === 'warn'}
                onChange={(e) => setSettings({ ...settings, replicate_correlation_action: e.target.value })}
                className="w-4 h-4 text-accent focus:ring-accent"
              />
              <span className="text-sm text-text-primary">Warn but proceed</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="correlation_action"
                value="block"
                checked={settings.replicate_correlation_action === 'block'}
                onChange={(e) => setSettings({ ...settings, replicate_correlation_action: e.target.value })}
                className="w-4 h-4 text-accent focus:ring-accent"
              />
              <span className="text-sm text-text-primary">Block analysis until fixed</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="correlation_action"
                value="auto_suggest"
                checked={settings.replicate_correlation_action === 'auto_suggest'}
                onChange={(e) => setSettings({ ...settings, replicate_correlation_action: e.target.value })}
                className="w-4 h-4 text-accent focus:ring-accent"
              />
              <span className="text-sm text-text-primary">Suggest removing outliers automatically</span>
            </label>
          </div>
        </div>
      </div>

      {/* Control Gene Checks */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4">Control Gene Checks</h3>
        <div className="space-y-4">
          <div>
            <label className="flex items-center gap-2 cursor-pointer mb-2">
              <input
                type="checkbox"
                checked={settings.verify_essential_gene_depletion}
                onChange={(e) => setSettings({ ...settings, verify_essential_gene_depletion: e.target.checked })}
                className="w-4 h-4 rounded border-border accent-accent"
              />
              <span className="text-sm text-text-primary font-medium">Verify essential gene depletion</span>
            </label>
            {settings.verify_essential_gene_depletion && (
              <div className="ml-6">
                <label className="block text-xs text-text-secondary mb-1">
                  Expected Essential Gene LFC
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={settings.expected_essential_gene_lfc}
                  onChange={(e) => setSettings({ ...settings, expected_essential_gene_lfc: parseFloat(e.target.value) })}
                  className="w-40 px-3 py-1.5 bg-background border border-border rounded text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            )}
          </div>

          <div>
            <label className="flex items-center gap-2 cursor-pointer mb-2">
              <input
                type="checkbox"
                checked={settings.check_nontargeting_distribution}
                onChange={(e) => setSettings({ ...settings, check_nontargeting_distribution: e.target.checked })}
                className="w-4 h-4 rounded border-border accent-accent"
              />
              <span className="text-sm text-text-primary font-medium">Check non-targeting control distribution</span>
            </label>
            {settings.check_nontargeting_distribution && (
              <div className="ml-6">
                <label className="block text-xs text-text-secondary mb-1">
                  Expected NT Guide LFC Range (±)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={settings.expected_nt_guide_lfc_range}
                  onChange={(e) => setSettings({ ...settings, expected_nt_guide_lfc_range: parseFloat(e.target.value) })}
                  className="w-40 px-3 py-1.5 bg-background border border-border rounded text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.validate_positive_controls}
              onChange={(e) => setSettings({ ...settings, validate_positive_controls: e.target.checked })}
              className="w-4 h-4 rounded border-border accent-accent"
            />
            <span className="text-sm text-text-primary font-medium">Validate positive controls</span>
          </label>
        </div>
      </div>

      {/* Automated QC Reports */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4">Automated QC Reports</h3>
        <div className="space-y-3 mb-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.generate_qc_report_always}
              onChange={(e) => setSettings({ ...settings, generate_qc_report_always: e.target.checked })}
              className="w-4 h-4 rounded border-border accent-accent"
            />
            <span className="text-sm text-text-primary">Generate QC report with every analysis</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.include_fastqc_metrics}
              onChange={(e) => setSettings({ ...settings, include_fastqc_metrics: e.target.checked })}
              className="w-4 h-4 rounded border-border accent-accent"
            />
            <span className="text-sm text-text-primary">Include FastQC-style metrics</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.flag_outliers_automatically}
              onChange={(e) => setSettings({ ...settings, flag_outliers_automatically: e.target.checked })}
              className="w-4 h-4 rounded border-border accent-accent"
            />
            <span className="text-sm text-text-primary">Flag outliers automatically</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.compare_to_historical_qc}
              onChange={(e) => setSettings({ ...settings, compare_to_historical_qc: e.target.checked })}
              className="w-4 h-4 rounded border-border accent-accent"
            />
            <span className="text-sm text-text-primary">Compare to historical QC metrics</span>
          </label>
        </div>

        <div>
          <label className="block text-sm font-serif text-text-secondary mb-2">Report Format</label>
          <select
            value={settings.qc_report_format}
            onChange={(e) => setSettings({ ...settings, qc_report_format: e.target.value })}
            className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="pdf">PDF</option>
            <option value="html">HTML</option>
            <option value="both">Both (PDF + HTML)</option>
          </select>
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
              Save QC settings
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
