"use client";

import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown,
  ChevronRight,
  Dna,
  FileUp,
  Eye,
  Sliders,
  Droplets,
  Layers,
  Beaker,
} from 'lucide-react';
import { CRISPR_PRESETS } from '@/lib/crispr-structure-presets';
import PresetCard from './PresetCard';
import RepresentationSelector from './RepresentationSelector';
import ColorSchemeDropdown from './ColorSchemeDropdown';
import type {
  StructureControlPanelProps,
  ControlPanelState,
  CRISPRPreset,
  RepresentationType,
  ColorSchemeType,
  QualityLevel,
} from '@/types/structure-viewer';

const VISIBILITY_OPTIONS: { id: string; label: string; icon: React.ReactNode }[] = [
  { id: 'guideRNA', label: 'Guide RNA', icon: <Dna className="w-4 h-4" /> },
  { id: 'targetDNA', label: 'Target DNA', icon: <Layers className="w-4 h-4" /> },
  { id: 'pam', label: 'PAM sequence', icon: <Beaker className="w-4 h-4" /> },
  { id: 'activeSite', label: 'Active site residues', icon: <Sliders className="w-4 h-4" /> },
  { id: 'water', label: 'Water molecules', icon: <Droplets className="w-4 h-4" /> },
  { id: 'ligands', label: 'Ligands & cofactors', icon: <Beaker className="w-4 h-4" /> },
  { id: 'hbonds', label: 'Hydrogen bonds', icon: <Eye className="w-4 h-4" /> },
];

function useDebounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  return useCallback(
    (...args: A) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => fn(...args), ms);
    },
    [fn, ms]
  );
}

export default function StructureControlPanel({
  onPresetSelect,
  onRepresentationChange,
  onColorSchemeChange,
  onVisibilityToggle,
  onQualityChange,
  currentState,
  isLoading = false,
  componentCounts = {},
  presetsEnabled = true,
  onFileSelect,
}: StructureControlPanelProps) {
  const [uploadKey, setUploadKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    presets: false,
    representation: false,
    color: false,
    visibility: false,
    advanced: true,
  });
  const [advancedCustomSelection, setAdvancedCustomSelection] = useState(currentState.customSelection);

  const debouncedRepresentation = useDebounce<[RepresentationType]>(onRepresentationChange, 300);
  const debouncedColorScheme = useDebounce<[ColorSchemeType, string?]>(
    (scheme: ColorSchemeType, uniform?: string) => onColorSchemeChange(scheme, uniform),
    300
  );

  const toggleSection = (key: string) => {
    setCollapsed((c) => ({ ...c, [key]: !c[key] }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onFileSelect) {
      onFileSelect(file);
      setUploadKey((k) => k + 1);
    }
    e.target.value = '';
  };

  return (
    <aside
      className="w-[320px] flex-shrink-0 h-full flex flex-col rounded-2xl overflow-hidden border border-border bg-surface/95 backdrop-blur-sm shadow-card"
      style={{
        background: 'linear-gradient(180deg, #FFFFFF 0%, #F9FAFB 100%)',
      }}
    >
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {/* Section: Upload */}
        {onFileSelect && (
          <section className="border-b border-border">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-background/50 transition-colors duration-200 disabled:opacity-60"
            >
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-accent/15 text-accent">
                <FileUp className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-serif text-sm font-medium text-text-primary">Upload structure</p>
                <p className="text-xs text-text-tertiary truncate">PDB, CIF, or MMTF</p>
              </div>
            </button>
            <input
              key={uploadKey}
              ref={fileInputRef}
              type="file"
              accept=".pdb,.cif,.mmtf,.ent"
              onChange={handleFileChange}
              className="sr-only"
              aria-label="Upload structure file"
            />
          </section>
        )}

        {/* Section 1: Quick Presets */}
        <section className="border-b border-border">
          <button
            type="button"
            onClick={() => toggleSection('presets')}
            className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-background/30 transition-colors duration-200"
            aria-expanded={!collapsed.presets}
          >
            <span className="font-serif text-sm font-semibold text-text-primary">Quick Presets</span>
            {collapsed.presets ? (
              <ChevronRight className="w-5 h-5 text-text-tertiary" />
            ) : (
              <ChevronDown className="w-5 h-5 text-text-tertiary" />
            )}
          </button>
          <AnimatePresence initial={false}>
            {!collapsed.presets && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
                className="overflow-hidden"
              >
                <div className="px-4 pb-4 grid grid-cols-2 gap-2">
                  {presetsEnabled &&
                    CRISPR_PRESETS.map((preset) => (
                      <PresetCard
                        key={preset.id}
                        preset={preset}
                        onLoad={onPresetSelect}
                        isLoading={isLoading}
                        isActive={currentState.activePreset === preset.id}
                      />
                    ))}
                  {!presetsEnabled && (
                    <p className="col-span-2 text-xs text-text-tertiary py-2">
                      Load a preset from the list above or upload your own structure.
                    </p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Section 2: Representation Controls */}
        <section className="border-b border-border">
          <button
            type="button"
            onClick={() => toggleSection('representation')}
            className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-background/30 transition-colors duration-200"
            aria-expanded={!collapsed.representation}
          >
            <span className="font-serif text-sm font-semibold text-text-primary">Representation</span>
            {collapsed.representation ? (
              <ChevronRight className="w-5 h-5 text-text-tertiary" />
            ) : (
              <ChevronDown className="w-5 h-5 text-text-tertiary" />
            )}
          </button>
          <AnimatePresence initial={false}>
            {!collapsed.representation && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
                className="overflow-hidden"
              >
                <div className="px-4 pb-4">
                  <RepresentationSelector
                    value={currentState.representation}
                    onChange={debouncedRepresentation}
                    quality={currentState.quality}
                    onQualityChange={(q) => onQualityChange?.(q as QualityLevel)}
                    disabled={isLoading}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Section 3: Color Schemes */}
        <section className="border-b border-border">
          <button
            type="button"
            onClick={() => toggleSection('color')}
            className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-background/30 transition-colors duration-200"
            aria-expanded={!collapsed.color}
          >
            <span className="font-serif text-sm font-semibold text-text-primary">Color scheme</span>
            {collapsed.color ? (
              <ChevronRight className="w-5 h-5 text-text-tertiary" />
            ) : (
              <ChevronDown className="w-5 h-5 text-text-tertiary" />
            )}
          </button>
          <AnimatePresence initial={false}>
            {!collapsed.color && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
                className="overflow-hidden"
              >
                <div className="px-4 pb-4">
                  <ColorSchemeDropdown
                    value={currentState.colorScheme}
                    onChange={(scheme, uniform) => debouncedColorScheme(scheme, uniform)}
                    uniformColor={currentState.uniformColor}
                    disabled={isLoading}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Section 4: Component Visibility */}
        <section className="border-b border-border">
          <button
            type="button"
            onClick={() => toggleSection('visibility')}
            className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-background/30 transition-colors duration-200"
            aria-expanded={!collapsed.visibility}
          >
            <span className="font-serif text-sm font-semibold text-text-primary">Visibility</span>
            {collapsed.visibility ? (
              <ChevronRight className="w-5 h-5 text-text-tertiary" />
            ) : (
              <ChevronDown className="w-5 h-5 text-text-tertiary" />
            )}
          </button>
          <AnimatePresence initial={false}>
            {!collapsed.visibility && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
                className="overflow-hidden"
              >
                <div className="px-4 pb-4 space-y-1">
                  {VISIBILITY_OPTIONS.map((opt) => {
                    const visible = currentState.visibleComponents.has(opt.id);
                    const count = componentCounts[opt.id];
                    return (
                      <label
                        key={opt.id}
                        className="flex items-center gap-3 p-2.5 rounded-lg border border-border hover:border-border-light cursor-pointer transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={visible}
                          onChange={(e) => onVisibilityToggle(opt.id, e.target.checked)}
                          className="w-4 h-4 rounded border-border text-accent focus:ring-accent"
                        />
                        <span className="flex items-center gap-2 text-text-secondary text-sm font-serif">
                          {opt.icon}
                          {opt.label}
                        </span>
                        {count != null && (
                          <span className="ml-auto text-xs text-text-tertiary font-mono tabular-nums">
                            {count}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Section 5: Advanced (collapsed by default) */}
        <section className="border-b border-border">
          <button
            type="button"
            onClick={() => toggleSection('advanced')}
            className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-background/30 transition-colors duration-200"
            aria-expanded={!collapsed.advanced}
          >
            <span className="font-serif text-sm font-semibold text-text-primary">Advanced</span>
            {collapsed.advanced ? (
              <ChevronRight className="w-5 h-5 text-text-tertiary" />
            ) : (
              <ChevronDown className="w-5 h-5 text-text-tertiary" />
            )}
          </button>
          <AnimatePresence initial={false}>
            {!collapsed.advanced && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
                className="overflow-hidden"
              >
                <div className="px-4 pb-4 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-text-tertiary uppercase tracking-wide mb-1.5">
                      NGL selection string
                    </label>
                    <input
                      type="text"
                      value={advancedCustomSelection}
                      onChange={(e) => setAdvancedCustomSelection(e.target.value)}
                      onBlur={() => {
                        if (advancedCustomSelection !== currentState.customSelection) {
                          onColorSchemeChange('custom');
                        }
                      }}
                      placeholder="e.g. :A and 100-200"
                      className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm font-mono text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50"
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </div>
    </aside>
  );
}
