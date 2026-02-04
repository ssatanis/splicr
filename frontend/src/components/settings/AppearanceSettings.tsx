'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  getStoredAppearance,
  applyAppearance,
  persistAppearance,
  DEFAULT_APPEARANCE,
  type AppearanceState,
  type AccentId,
  type ColorblindMode,
} from '@/lib/appearance';
import Button from '@/components/Button';
import {
  Palette,
  Sun,
  Moon,
  Monitor,
  Type,
  Zap,
  CheckCircle2,
} from 'lucide-react';

const COLOR_SCHEMES: { id: AccentId; name: string; primary: string }[] = [
  { id: 'default', name: 'Default', primary: '#6ABF36' },
  { id: 'ocean', name: 'Ocean', primary: '#06B6D4' },
  { id: 'forest', name: 'Forest', primary: '#10B981' },
  { id: 'sunset', name: 'Sunset', primary: '#F59E0B' },
  { id: 'lavender', name: 'Lavender', primary: '#A78BFA' },
  { id: 'rose', name: 'Rose', primary: '#FB7185' },
];

const COLORBLIND_MODES: { id: ColorblindMode; name: string; description: string }[] = [
  { id: 'none', name: 'None', description: 'Standard colors' },
  { id: 'protanopia', name: 'Protanopia', description: 'Red-blind' },
  { id: 'deuteranopia', name: 'Deuteranopia', description: 'Green-blind' },
  { id: 'tritanopia', name: 'Tritanopia', description: 'Blue-blind' },
];

export function AppearanceSettings() {
  const [settings, setSettings] = useState<AppearanceState>(DEFAULT_APPEARANCE);
  const [showApplied, setShowApplied] = useState(false);

  useEffect(() => {
    const stored = getStoredAppearance();
    setSettings(stored);
    applyAppearance(stored);
  }, []);

  const updateSettings = useCallback((next: Partial<AppearanceState>) => {
    setSettings((prev: AppearanceState) => {
      const nextState = { ...prev, ...next } as AppearanceState;
      applyAppearance(nextState);
      persistAppearance(nextState);
      return nextState;
    });
    setShowApplied(true);
  }, []);

  useEffect(() => {
    applyAppearance(settings);
  }, []);

  useEffect(() => {
    if (!showApplied) return;
    const t = setTimeout(() => setShowApplied(false), 2000);
    return () => clearTimeout(t);
  }, [showApplied]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-serif text-text-primary mb-2 flex items-center gap-2">
          <Palette className="w-6 h-6" />
          Appearance
        </h2>
        <p className="text-sm text-text-secondary">
          Customize the look and feel of SplicR. Changes apply immediately.
        </p>
      </div>

      {showApplied && (
        <div className="flex items-center gap-2 p-4 bg-green-500/10 border border-green-500/20 rounded-xl text-green-600 dark:text-green-400">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span className="text-sm">Settings applied</span>
        </div>
      )}

      {/* Theme */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4">Theme</h3>
        <div className="grid grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => updateSettings({ theme: 'light' })}
            className={`p-4 rounded-lg border-2 transition-all flex flex-col items-center ${
              settings.theme === 'light'
                ? 'border-accent bg-accent/10 dark:bg-accent/20'
                : 'border-border hover:border-accent/50'
            }`}
          >
            <Sun className="w-8 h-8 mb-2 text-text-primary" />
            <span className="text-sm font-medium text-text-primary">Light</span>
          </button>
          <button
            type="button"
            onClick={() => updateSettings({ theme: 'dark' })}
            className={`p-4 rounded-lg border-2 transition-all flex flex-col items-center ${
              settings.theme === 'dark'
                ? 'border-accent bg-accent/10 dark:bg-accent/20'
                : 'border-border hover:border-accent/50'
            }`}
          >
            <Moon className="w-8 h-8 mb-2 text-text-primary" />
            <span className="text-sm font-medium text-text-primary">Dark</span>
          </button>
          <button
            type="button"
            onClick={() => updateSettings({ theme: 'system' })}
            className={`p-4 rounded-lg border-2 transition-all flex flex-col items-center ${
              settings.theme === 'system'
                ? 'border-accent bg-accent/10 dark:bg-accent/20'
                : 'border-border hover:border-accent/50'
            }`}
          >
            <Monitor className="w-8 h-8 mb-2 text-text-primary" />
            <span className="text-sm font-medium text-text-primary">System</span>
          </button>
        </div>
      </div>

      {/* Accent Color */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4">Accent Color</h3>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          {COLOR_SCHEMES.map((scheme) => (
            <button
              key={scheme.id}
              type="button"
              onClick={() => updateSettings({ color_scheme: scheme.id })}
              className={`p-4 rounded-lg border-2 transition-all flex flex-col items-center ${
                settings.color_scheme === scheme.id
                  ? 'border-accent bg-accent/10 dark:bg-accent/20'
                  : 'border-border hover:border-accent/50'
              }`}
            >
              <div
                className="w-12 h-12 rounded-lg mb-2 shrink-0"
                style={{ backgroundColor: scheme.primary }}
              />
              <span className="text-xs font-medium text-text-primary">{scheme.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Typography */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4 flex items-center gap-2">
          <Type className="w-5 h-5" />
          Typography
        </h3>
        <div>
          <label className="block text-sm font-serif text-text-secondary mb-3">
            Font Size
          </label>
          <div className="grid grid-cols-3 gap-3">
            {(['small', 'medium', 'large'] as const).map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => updateSettings({ font_size: size })}
                className={`p-3 rounded-lg border-2 transition-all ${
                  settings.font_size === size
                    ? 'border-accent bg-accent/10 dark:bg-accent/20'
                    : 'border-border hover:border-accent/50'
                }`}
              >
                <span
                  className="font-medium text-text-primary capitalize block text-center"
                  style={{
                    fontSize:
                      size === 'small' ? '0.875rem' : size === 'large' ? '1.125rem' : '1rem',
                  }}
                >
                  {size}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Accessibility */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4">Accessibility</h3>
        <div className="space-y-4">
          <label className="flex items-center justify-between cursor-pointer gap-4">
            <div>
              <p className="text-sm font-medium text-text-primary">Compact mode</p>
              <p className="text-xs text-text-tertiary">Reduce spacing for more content</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.compact_mode}
              onClick={() => updateSettings({ compact_mode: !settings.compact_mode })}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                settings.compact_mode ? 'bg-accent' : 'bg-border'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  settings.compact_mode ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </label>

          <label className="flex items-center justify-between cursor-pointer gap-4">
            <div>
              <p className="text-sm font-medium text-text-primary">Reduce animations</p>
              <p className="text-xs text-text-tertiary">Minimize motion for better performance</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.reduce_animations}
              onClick={() => updateSettings({ reduce_animations: !settings.reduce_animations })}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                settings.reduce_animations ? 'bg-accent' : 'bg-border'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  settings.reduce_animations ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </label>

          <label className="flex items-center justify-between cursor-pointer gap-4">
            <div>
              <p className="text-sm font-medium text-text-primary">High contrast</p>
              <p className="text-xs text-text-tertiary">Increase contrast for better readability</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.high_contrast}
              onClick={() => updateSettings({ high_contrast: !settings.high_contrast })}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                settings.high_contrast ? 'bg-accent' : 'bg-border'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  settings.high_contrast ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </label>

          <div className="pt-4 border-t border-border">
            <label className="block text-sm font-serif text-text-secondary mb-3">
              Colorblind Mode
            </label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {COLORBLIND_MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => updateSettings({ colorblind_mode: mode.id })}
                  className={`p-3 rounded-lg border-2 transition-all text-left ${
                    settings.colorblind_mode === mode.id
                      ? 'border-accent bg-accent/10 dark:bg-accent/20'
                      : 'border-border hover:border-accent/50'
                  }`}
                >
                  <span className="text-sm font-medium text-text-primary block mb-0.5">
                    {mode.name}
                  </span>
                  <p className="text-xs text-text-tertiary">{mode.description}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Preview - inherits document theme/accent/font/accessibility */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4">Preview</h3>
        <div className="p-6 bg-background rounded-lg border border-border">
          <h4 className="text-xl font-serif text-text-primary mb-2">Sample Heading</h4>
          <p className="text-text-secondary mb-4">
            This is how your text will appear with the current settings. The quick brown fox jumps
            over the lazy dog.
          </p>
          <Button size="sm" type="button">
            <Zap className="w-4 h-4 mr-2" />
            Sample Button
          </Button>
        </div>
      </div>
    </div>
  );
}
