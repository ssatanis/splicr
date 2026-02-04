'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import Button from '@/components/Button';
import { Save, Loader2, CheckCircle2, AlertCircle, Plus, Trash2, Info } from 'lucide-react';

interface AnalysisDefaults {
  fdr_cutoff: number;
  log2_fold_change: number;
  p_value_threshold: number;
  normalization_method: string;
  default_library: string;
  organism: string;
  guides_per_gene: number;
  gene_annotation: string;
  chart_type: string;
  color_scheme: string;
  show_gene_labels: boolean;
  label_top_n: number;
  point_size: string;
  // MAGeCK-specific
  mageck_normalization: 'median' | 'total' | 'control' | 'none';
  mageck_gene_test_method: 'rra' | 'mle';
  mageck_control_sgrna_normalization: boolean;
  mageck_variance_estimation_threshold: number;
  mageck_fdr_method: 'benjamini-hochberg' | 'holm' | 'pounds';
  // BAGEL2-specific
  bagel2_essential_ref_list: string;
  bagel2_nonessential_ref_list: string;
  bagel2_method: 'bootstrap' | 'cross_validation';
  bagel2_multi_target_correction: boolean;
  bagel2_bayes_factor_threshold: number;
  // Visualization
  figure_resolution_dpi: number;
  export_format: 'png' | 'svg' | 'pdf';
}

interface Preset {
  id: string;
  name: string;
  description: string;
  settings: Partial<AnalysisDefaults>;
  is_shared: boolean;
}

export function AnalysisDefaultsSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  
  const [defaults, setDefaults] = useState<AnalysisDefaults>({
    fdr_cutoff: 0.05,
    log2_fold_change: 1.0,
    p_value_threshold: 0.05,
    normalization_method: 'deseq2',
    default_library: 'brunello_v2',
    organism: 'human',
    guides_per_gene: 4,
    gene_annotation: 'ensembl_110',
    chart_type: 'volcano',
    color_scheme: 'viridis',
    show_gene_labels: true,
    label_top_n: 20,
    point_size: 'medium',
    mageck_normalization: 'median',
    mageck_gene_test_method: 'rra',
    mageck_control_sgrna_normalization: true,
    mageck_variance_estimation_threshold: 5,
    mageck_fdr_method: 'benjamini-hochberg',
    bagel2_essential_ref_list: 'CEGv2',
    bagel2_nonessential_ref_list: 'NEGv1',
    bagel2_method: 'bootstrap',
    bagel2_multi_target_correction: true,
    bagel2_bayes_factor_threshold: 5,
    figure_resolution_dpi: 300,
    export_format: 'png',
  });

  const [presets, setPresets] = useState<Preset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [newPresetName, setNewPresetName] = useState('');
  const [showNewPreset, setShowNewPreset] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    loadSettings();
    loadPresets();
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
        .from('analysis_defaults')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error loading settings:', error);
        return;
      }

      if (data) {
        setDefaults(prev => ({ ...prev, ...(data as Partial<AnalysisDefaults>) } as AnalysisDefaults));
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  }

  async function loadPresets() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('analysis_presets')
        .select('*')
        .or(`user_id.eq.${user.id},is_shared.eq.true`)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setPresets(data || []);
    } catch (error) {
      console.error('Error loading presets:', error);
    }
  }

  async function saveSettings() {
    setSaving(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await (supabase
        .from('analysis_defaults') as any)
        .upsert({
          user_id: user.id,
          ...defaults,
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

  async function saveAsPreset() {
    if (!newPresetName.trim()) return;
    
    setSaving(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await (supabase
        .from('analysis_presets') as any)
        .insert({
          user_id: user.id,
          name: newPresetName,
          settings: defaults,
          is_shared: false,
        });

      if (error) throw error;
      
      setSuccess(true);
      setNewPresetName('');
      setShowNewPreset(false);
      await loadPresets();
    } catch (error: any) {
      console.error('Error saving preset:', error);
      setError(error.message || 'Failed to save preset');
    } finally {
      setSaving(false);
    }
  }

  async function loadPreset(presetId: string) {
    const preset = presets.find(p => p.id === presetId);
    if (preset) {
      setDefaults(prev => ({ ...prev, ...preset.settings }));
      setSelectedPreset(presetId);
    }
  }

  async function deletePreset(presetId: string) {
    try {
      const { error } = await supabase
        .from('analysis_presets')
        .delete()
        .eq('id', presetId);

      if (error) throw error;
      await loadPresets();
      if (selectedPreset === presetId) {
        setSelectedPreset('');
      }
    } catch (error) {
      console.error('Error deleting preset:', error);
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
        <h2 className="text-2xl font-serif text-text-primary mb-2">Analysis Defaults</h2>
        <p className="text-sm text-text-secondary">
          Set your preferred analysis parameters to save time on every run
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
          <span className="text-sm">Settings saved successfully!</span>
        </div>
      )}

      {/* Statistical Thresholds */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4">Statistical Thresholds</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">FDR Cutoff</label>
            <input
              type="number"
              step="0.01"
              value={defaults.fdr_cutoff}
              onChange={(e) => setDefaults({ ...defaults, fdr_cutoff: parseFloat(e.target.value) })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">Log2 Fold Change</label>
            <input
              type="number"
              step="0.1"
              value={defaults.log2_fold_change}
              onChange={(e) => setDefaults({ ...defaults, log2_fold_change: parseFloat(e.target.value) })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">P-value Threshold</label>
            <input
              type="number"
              step="0.01"
              value={defaults.p_value_threshold}
              onChange={(e) => setDefaults({ ...defaults, p_value_threshold: parseFloat(e.target.value) })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
        </div>
      </div>

      {/* Normalization Method */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4">Normalization Method</h3>
        <div className="space-y-2">
          {['deseq2', 'median_of_ratios', 'quantile', 'total_count'].map((method) => (
            <label key={method} className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="normalization"
                value={method}
                checked={defaults.normalization_method === method}
                onChange={(e) => setDefaults({ ...defaults, normalization_method: e.target.value })}
                className="w-4 h-4 text-accent focus:ring-accent"
              />
              <span className="text-sm text-text-primary capitalize">
                {method.replace(/_/g, ' ')}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Guide RNA Design */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4">Guide RNA Design</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">Default Library</label>
            <select
              value={defaults.default_library}
              onChange={(e) => setDefaults({ ...defaults, default_library: e.target.value })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="brunello_v2">Brunello v2</option>
              <option value="gecko_v2">GeCKO v2</option>
              <option value="avana">Avana</option>
              <option value="tkov3">TKOv3</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">Organism</label>
            <select
              value={defaults.organism}
              onChange={(e) => setDefaults({ ...defaults, organism: e.target.value })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="human">Human</option>
              <option value="mouse">Mouse</option>
              <option value="rat">Rat</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">Guides per Gene</label>
            <input
              type="number"
              min="1"
              max="10"
              value={defaults.guides_per_gene}
              onChange={(e) => setDefaults({ ...defaults, guides_per_gene: parseInt(e.target.value) })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">Gene Annotation</label>
            <select
              value={defaults.gene_annotation}
              onChange={(e) => setDefaults({ ...defaults, gene_annotation: e.target.value })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="ensembl_110">Ensembl 110</option>
              <option value="ensembl_109">Ensembl 109</option>
              <option value="gencode_44">GENCODE 44</option>
            </select>
          </div>
        </div>
      </div>

      {/* MAGeCK Defaults */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4 flex items-center gap-2">
          MAGeCK
          <span className="text-xs font-normal text-text-tertiary flex items-center gap-1" title="Model-based Analysis of Genome-wide CRISPR-Cas9 Knockout">
            <Info className="w-4 h-4" />
          </span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">Normalization method</label>
            <select
              value={defaults.mageck_normalization}
              onChange={(e) => setDefaults({ ...defaults, mageck_normalization: e.target.value as AnalysisDefaults['mageck_normalization'] })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="median">Median</option>
              <option value="total">Total</option>
              <option value="control">Control</option>
              <option value="none">None</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">Gene test method</label>
            <select
              value={defaults.mageck_gene_test_method}
              onChange={(e) => setDefaults({ ...defaults, mageck_gene_test_method: e.target.value as 'rra' | 'mle' })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="rra">RRA (Robust Rank Aggregation)</option>
              <option value="mle">MLE (Maximum Likelihood)</option>
            </select>
          </div>
          <div className="md:col-span-2 flex items-center gap-2">
            <input
              type="checkbox"
              id="mageck_control_norm"
              checked={defaults.mageck_control_sgrna_normalization}
              onChange={(e) => setDefaults({ ...defaults, mageck_control_sgrna_normalization: e.target.checked })}
              className="w-4 h-4 rounded border-border accent-accent"
            />
            <label htmlFor="mageck_control_norm" className="text-sm text-text-primary cursor-pointer">
              Control sgRNA normalization
            </label>
          </div>
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">Variance estimation sample threshold</label>
            <input
              type="number"
              min="1"
              max="50"
              value={defaults.mageck_variance_estimation_threshold}
              onChange={(e) => setDefaults({ ...defaults, mageck_variance_estimation_threshold: parseInt(e.target.value) || 5 })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">FDR adjustment method</label>
            <select
              value={defaults.mageck_fdr_method}
              onChange={(e) => setDefaults({ ...defaults, mageck_fdr_method: e.target.value as AnalysisDefaults['mageck_fdr_method'] })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="benjamini-hochberg">Benjamini–Hochberg</option>
              <option value="holm">Holm</option>
              <option value="pounds">Pounds</option>
            </select>
          </div>
        </div>
      </div>

      {/* BAGEL2 Defaults */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4 flex items-center gap-2">
          BAGEL2
          <span className="text-xs font-normal text-text-tertiary flex items-center gap-1" title="Bayesian Analysis of Gene Essentiality">
            <Info className="w-4 h-4" />
          </span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">Essential reference list</label>
            <select
              value={defaults.bagel2_essential_ref_list}
              onChange={(e) => setDefaults({ ...defaults, bagel2_essential_ref_list: e.target.value })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="CEGv2">CEGv2 (Core Essential Genes)</option>
              <option value="CEGv1">CEGv1</option>
              <option value="custom">Custom (upload)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">Non-essential reference list</label>
            <select
              value={defaults.bagel2_nonessential_ref_list}
              onChange={(e) => setDefaults({ ...defaults, bagel2_nonessential_ref_list: e.target.value })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="NEGv1">NEGv1 (Non-Essential Genes)</option>
              <option value="NEGv2">NEGv2</option>
              <option value="custom">Custom (upload)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">Method</label>
            <select
              value={defaults.bagel2_method}
              onChange={(e) => setDefaults({ ...defaults, bagel2_method: e.target.value as 'bootstrap' | 'cross_validation' })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="bootstrap">Bootstrap</option>
              <option value="cross_validation">Cross-validation</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="bagel2_multi"
              checked={defaults.bagel2_multi_target_correction}
              onChange={(e) => setDefaults({ ...defaults, bagel2_multi_target_correction: e.target.checked })}
              className="w-4 h-4 rounded border-border accent-accent"
            />
            <label htmlFor="bagel2_multi" className="text-sm text-text-primary cursor-pointer">
              Multi-target correction
            </label>
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-serif text-text-secondary mb-2">
              Bayes Factor threshold (default: 5)
            </label>
            <input
              type="range"
              min="1"
              max="20"
              step="0.5"
              value={defaults.bagel2_bayes_factor_threshold}
              onChange={(e) => setDefaults({ ...defaults, bagel2_bayes_factor_threshold: parseFloat(e.target.value) })}
              className="w-full h-2 bg-background rounded-lg appearance-none cursor-pointer accent-accent"
            />
            <span className="text-sm text-text-tertiary">{defaults.bagel2_bayes_factor_threshold}</span>
          </div>
        </div>
      </div>

      {/* Visualization Defaults */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4">Visualization Defaults</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">Default plot type</label>
            <select
              value={defaults.chart_type}
              onChange={(e) => setDefaults({ ...defaults, chart_type: e.target.value })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="volcano">Volcano</option>
              <option value="rank">Rank</option>
              <option value="qc">QC</option>
              <option value="waterfall">Waterfall</option>
              <option value="scatter">Scatter</option>
              <option value="heatmap">Heatmap</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">Color scheme</label>
            <select
              value={defaults.color_scheme}
              onChange={(e) => setDefaults({ ...defaults, color_scheme: e.target.value })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="viridis">Viridis (colorblind-friendly)</option>
              <option value="plasma">Plasma</option>
              <option value="inferno">Inferno</option>
              <option value="magma">Magma</option>
              <option value="cividis">Cividis (accessible)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">Figure resolution (DPI)</label>
            <select
              value={defaults.figure_resolution_dpi}
              onChange={(e) => setDefaults({ ...defaults, figure_resolution_dpi: parseInt(e.target.value) })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value={300}>300</option>
              <option value={600}>600</option>
              <option value={1200}>1200</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">Export format</label>
            <select
              value={defaults.export_format}
              onChange={(e) => setDefaults({ ...defaults, export_format: e.target.value as 'png' | 'svg' | 'pdf' })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="png">PNG</option>
              <option value="svg">SVG</option>
              <option value="pdf">PDF</option>
            </select>
          </div>
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={defaults.show_gene_labels}
                onChange={(e) => setDefaults({ ...defaults, show_gene_labels: e.target.checked })}
                className="w-4 h-4 rounded border-border accent-accent"
              />
              <span className="text-sm text-text-primary">Show gene labels</span>
            </label>
          </div>
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">Label top N hits</label>
            <input
              type="number"
              min="0"
              max="100"
              value={defaults.label_top_n}
              onChange={(e) => setDefaults({ ...defaults, label_top_n: parseInt(e.target.value) })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">Point size</label>
            <select
              value={defaults.point_size}
              onChange={(e) => setDefaults({ ...defaults, point_size: e.target.value })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </div>
        </div>
      </div>

      {/* Presets */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4">Presets</h3>
        
        {/* Save as new preset */}
        {showNewPreset ? (
          <div className="mb-4 p-4 bg-background rounded-lg border border-border">
            <label className="block text-sm font-serif text-text-secondary mb-2">Preset Name</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                placeholder="e.g., Cornell Lab Standard"
                className="flex-1 px-4 py-2 bg-surface border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <Button onClick={saveAsPreset} disabled={!newPresetName.trim() || saving}>
                <Save className="w-4 h-4 mr-2" />
                Save
              </Button>
              <Button variant="secondary" onClick={() => setShowNewPreset(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button onClick={() => setShowNewPreset(true)} className="mb-4">
            <Plus className="w-4 h-4 mr-2" />
            Save as new preset
          </Button>
        )}

        {/* Load preset */}
        {presets.length > 0 && (
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">Load Preset</label>
            <div className="space-y-2">
              {presets.map((preset) => (
                <div
                  key={preset.id}
                  className="flex items-center justify-between p-3 bg-background rounded-lg border border-border hover:border-accent transition-colors"
                >
                  <div className="flex-1">
                    <p className="text-sm font-serif text-text-primary">{preset.name}</p>
                    {preset.description && (
                      <p className="text-xs text-text-tertiary mt-0.5">{preset.description}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => loadPreset(preset.id)}
                    >
                      Load
                    </Button>
                    <button
                      onClick={() => deletePreset(preset.id)}
                      className="p-2 text-text-tertiary hover:text-error transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex justify-between items-center pt-4 border-t border-border">
        <Button
          variant="secondary"
          onClick={() => setDefaults({
            fdr_cutoff: 0.05,
            log2_fold_change: 1.0,
            p_value_threshold: 0.05,
            normalization_method: 'deseq2',
            default_library: 'brunello_v2',
            organism: 'human',
            guides_per_gene: 4,
            gene_annotation: 'ensembl_110',
            chart_type: 'volcano',
            color_scheme: 'viridis',
            show_gene_labels: true,
            label_top_n: 20,
            point_size: 'medium',
            mageck_normalization: 'median',
            mageck_gene_test_method: 'rra',
            mageck_control_sgrna_normalization: true,
            mageck_variance_estimation_threshold: 5,
            mageck_fdr_method: 'benjamini-hochberg',
            bagel2_essential_ref_list: 'CEGv2',
            bagel2_nonessential_ref_list: 'NEGv1',
            bagel2_method: 'bootstrap',
            bagel2_multi_target_correction: true,
            bagel2_bayes_factor_threshold: 5,
            figure_resolution_dpi: 300,
            export_format: 'png',
          })}
        >
          Reset to defaults
        </Button>
        <Button onClick={saveSettings} disabled={saving} size="lg">
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Save defaults
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
