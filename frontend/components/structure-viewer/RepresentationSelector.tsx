"use client";

import type { RepresentationType } from '@/types/structure-viewer';

export interface RepresentationSelectorProps {
  value: RepresentationType;
  onChange: (type: RepresentationType) => void;
  quality: 'low' | 'medium' | 'high';
  onQualityChange: (quality: 'low' | 'medium' | 'high') => void;
  disabled?: boolean;
}

const REPRESENTATIONS: { value: RepresentationType; label: string; description: string }[] = [
  { value: 'cartoon', label: 'Cartoon', description: 'Secondary structure (default)' },
  { value: 'backbone', label: 'Backbone', description: 'Cα trace, minimal' },
  { value: 'ball+stick', label: 'Ball & Stick', description: 'All-atom' },
  { value: 'licorice', label: 'Licorice', description: 'Bonds as cylinders' },
  { value: 'surface', label: 'Surface', description: 'Molecular surface (VDW/SAS)' },
  { value: 'ribbon', label: 'Ribbon', description: 'Simplified backbone' },
  { value: 'spacefill', label: 'Spacefill', description: 'CPK spheres' },
];

export default function RepresentationSelector({
  value,
  onChange,
  quality,
  onQualityChange,
  disabled = false,
}: RepresentationSelectorProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-xs font-medium text-text-tertiary uppercase tracking-wide">Primary display</p>
        <div className="grid gap-1.5" role="radiogroup" aria-label="Representation style">
          {REPRESENTATIONS.map((rep) => (
            <label
              key={rep.value}
              className={`
                flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors duration-200
                ${value === rep.value ? 'border-accent bg-accent/5' : 'border-border hover:border-border-light'}
                ${disabled ? 'opacity-60 cursor-not-allowed' : ''}
              `}
            >
              <input
                type="radio"
                name="representation"
                value={rep.value}
                checked={value === rep.value}
                onChange={() => onChange(rep.value)}
                disabled={disabled}
                className="w-4 h-4 text-accent border-border focus:ring-accent"
              />
              <div className="flex-1 min-w-0">
                <span className="font-serif text-sm font-medium text-text-primary">{rep.label}</span>
                <span className="block text-xs text-text-tertiary truncate">{rep.description}</span>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="pt-2 border-t border-border">
        <p className="text-xs font-medium text-text-tertiary uppercase tracking-wide mb-2">Quality</p>
        <div className="flex gap-2">
          {(['low', 'medium', 'high'] as const).map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => onQualityChange(q)}
              disabled={disabled}
              className={`
                flex-1 py-2 rounded-lg text-xs font-medium capitalize transition-colors
                ${quality === q ? 'bg-accent text-text-primary' : 'bg-background text-text-secondary hover:bg-border-light'}
              `}
            >
              {q}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
