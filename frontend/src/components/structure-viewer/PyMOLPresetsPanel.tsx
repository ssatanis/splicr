/**
 * PyMOL Presets Panel
 * 
 * Quick-access buttons for PyMOL-style representation presets.
 * Cartoon, Sticks, Surface, Ribbon+Ligand, etc.
 */

"use client";

import { useState } from 'react';
import { PYMOL_PRESETS, type PyMOLPreset } from '@/lib/pymol-presets';
import { Sparkles, Box, Circle, Layers, Package, Activity, Grid, Droplet } from 'lucide-react';

interface PyMOLPresetsPanelProps {
  component: any; // NGL.StructureComponent
  onPresetApplied?: (preset: PyMOLPreset) => void;
}

const PRESET_ICONS: Record<string, React.ReactNode> = {
  'cartoon': <Activity className="w-4 h-4" />,
  'cartoon-chainbow': <Sparkles className="w-4 h-4" />,
  'sticks': <Grid className="w-4 h-4" />,
  'surface': <Circle className="w-4 h-4" />,
  'ribbon-ligand': <Layers className="w-4 h-4" />,
  'ball-stick': <Box className="w-4 h-4" />,
  'spacefill': <Circle className="w-4 h-4" />,
  'backbone': <Activity className="w-4 h-4" />,
  'ribbon': <Activity className="w-4 h-4" />,
  'putty': <Droplet className="w-4 h-4" />,
};

export default function PyMOLPresetsPanel({ component, onPresetApplied }: PyMOLPresetsPanelProps) {
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);

  const handlePresetClick = async (preset: PyMOLPreset) => {
    if (!component || isApplying) return;

    setIsApplying(true);
    try {
      preset.apply(component);
      setActivePreset(preset.id);
      onPresetApplied?.(preset);
    } catch (error) {
      console.error('Failed to apply preset:', error);
      alert(`Failed to apply preset: ${preset.name}`);
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="absolute top-4 left-4 z-20 bg-surface/95 backdrop-blur-sm border border-border rounded-xl shadow-card p-4 max-w-md">
      <div className="flex items-center gap-2 mb-3">
        <Package className="w-5 h-5 text-accent" />
        <h3 className="text-sm font-serif font-semibold text-text-primary">PyMOL Presets</h3>
      </div>

      {/* Preset grid */}
      <div className="grid grid-cols-3 gap-2">
        {PYMOL_PRESETS.slice(0, 9).map((preset) => {
          const isActive = activePreset === preset.id;
          const icon = PRESET_ICONS[preset.id] || <Box className="w-4 h-4" />;

          return (
            <button
              key={preset.id}
              onClick={() => handlePresetClick(preset)}
              disabled={isApplying}
              className={`group relative flex flex-col items-center gap-2 p-3 rounded-lg border transition-all ${
                isActive
                  ? 'bg-accent/20 border-accent text-accent shadow-md'
                  : 'border-border hover:border-border-light text-text-secondary hover:text-text-primary hover:bg-background/50'
              } ${isApplying ? 'opacity-50 cursor-wait' : ''}`}
              title={preset.description}
            >
              <div className={`${isActive ? 'text-accent' : 'text-text-tertiary group-hover:text-text-primary'}`}>
                {icon}
              </div>
              <span className="text-xs font-medium text-center leading-tight">
                {preset.name.replace(' (PyMOL)', '')}
              </span>
              
              {/* Active indicator */}
              {isActive && (
                <div className="absolute -top-1 -right-1 w-3 h-3 bg-accent rounded-full border-2 border-surface" />
              )}
            </button>
          );
        })}
      </div>

      {/* Description */}
      {activePreset && (
        <div className="mt-3 p-2 bg-accent/10 border border-accent/30 rounded-lg">
          <p className="text-xs text-text-secondary">
            {PYMOL_PRESETS.find(p => p.id === activePreset)?.description}
          </p>
        </div>
      )}
    </div>
  );
}
