"use client";

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Palette } from 'lucide-react';
import type { ColorSchemeType } from '@/types/structure-viewer';

export interface ColorSchemeDropdownProps {
  value: ColorSchemeType;
  onChange: (scheme: ColorSchemeType, uniformColor?: string) => void;
  uniformColor?: string;
  disabled?: boolean;
}

const SCHEMES: { value: ColorSchemeType; label: string; needsUniform?: boolean }[] = [
  { value: 'chainid', label: 'By Chain' },
  { value: 'element', label: 'By Element (CPK)' },
  { value: 'sstruc', label: 'By Secondary Structure' },
  { value: 'hydrophobicity', label: 'By Hydrophobicity' },
  { value: 'bfactor', label: 'By B-factor' },
  { value: 'residueindex', label: 'By Residue Index' },
  { value: 'uniform', label: 'Uniform Color', needsUniform: true },
  { value: 'custom', label: 'Custom (selection string)' },
];

export default function ColorSchemeDropdown({
  value,
  onChange,
  uniformColor = '#9CA3AF',
  disabled = false,
}: ColorSchemeDropdownProps) {
  const [open, setOpen] = useState(false);
  const [localUniform, setLocalUniform] = useState(uniformColor);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLocalUniform(uniformColor);
  }, [uniformColor]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentLabel = SCHEMES.find((s) => s.value === value)?.label ?? value;
  const showUniformPicker = value === 'uniform';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        className={`
          w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border
          bg-surface text-left text-sm font-serif text-text-primary
          transition-colors duration-200
          ${open ? 'border-accent ring-1 ring-accent' : 'border-border hover:border-border-light'}
          ${disabled ? 'opacity-60 cursor-not-allowed' : ''}
        `}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Color scheme"
      >
        <span className="flex items-center gap-2">
          <Palette className="w-4 h-4 text-text-tertiary flex-shrink-0" />
          {currentLabel}
        </span>
        <ChevronDown className={`w-4 h-4 text-text-tertiary flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute z-[9999] mt-1 w-full rounded-lg border border-border bg-white dark:bg-surface shadow-2xl py-1 max-h-64 overflow-y-auto"
        >
          {SCHEMES.map((scheme) => (
            <li key={scheme.value} role="option" aria-selected={value === scheme.value}>
              <button
                type="button"
                onClick={() => {
                  onChange(scheme.value);
                  if (scheme.value !== 'uniform') setOpen(false);
                }}
                className={`
                  w-full px-3 py-2 text-left text-sm font-serif transition-colors
                  ${value === scheme.value ? 'bg-accent/10 text-accent font-medium' : 'text-gray-700 dark:text-text-secondary hover:bg-gray-50 dark:hover:bg-background'}
                `}
              >
                {scheme.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      {showUniformPicker && (
        <div className="mt-3 flex items-center gap-2">
          <label className="text-xs text-text-tertiary font-medium">Color</label>
          <input
            type="color"
            value={localUniform}
            onChange={(e) => {
              const v = e.target.value;
              setLocalUniform(v);
              onChange('uniform', v);
            }}
            className="w-10 h-8 rounded border border-border cursor-pointer bg-surface"
          />
          <input
            type="text"
            value={localUniform}
            onChange={(e) => setLocalUniform(e.target.value)}
            onBlur={() => onChange('uniform', localUniform)}
            className="flex-1 px-2 py-1.5 rounded border border-border bg-surface text-sm font-mono text-text-primary"
          />
        </div>
      )}
    </div>
  );
}
