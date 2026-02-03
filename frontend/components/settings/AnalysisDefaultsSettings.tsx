'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import Button from '@/components/Button';
import { Save, Loader2, CheckCircle2, AlertCircle, Plus, Trash2 } from 'lucide-react';

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
        setDefaults(prev => ({ ...prev, ...data }));
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

      const { error } = await supabase
        .from('analysis_defaults')
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

      const { error } = await supabase
        .from('analysis_presets')
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

      {/* Visualization Defaults */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4">Visualization Defaults</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">Default Chart Type</label>
            <select
              value={defaults.chart_type}
              onChange={(e) => setDefaults({ ...defaults, chart_type: e.target.value })}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="volcano">Volcano Plot</option>
              <option value="waterfall">Waterfall Plot</option>
              <option value="scatter">Scatter Plot</option>
              <option value="heatmap">Heatmap</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-serif text-text-secondary mb-2">Color Scheme</label>
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
            <label className="block text-sm font-serif text-text-secondary mb-2">Label Top N Hits</label>
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
            <label className="block text-sm font-serif text-text-secondary mb-2">Point Size</label>
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
              Save defaults
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
