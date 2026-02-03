"use client";

import { motion } from 'framer-motion';
import { Loader2, Download } from 'lucide-react';
import type { CRISPRPreset } from '@/types/structure-viewer';

export interface PresetCardProps {
  preset: CRISPRPreset;
  onLoad: (preset: CRISPRPreset) => void;
  isLoading?: boolean;
  isActive?: boolean;
}

/**
 * Card for a single CRISPR structure preset: thumbnail, name, PDB ID, organism, Load button.
 */
export default function PresetCard({ preset, onLoad, isLoading = false, isActive = false }: PresetCardProps) {
  const handleClick = () => {
    if (!isLoading) onLoad(preset);
  };

  return (
    <motion.button
      type="button"
      onClick={handleClick}
      disabled={isLoading}
      whileHover={!isLoading ? { scale: 1.02 } : {}}
      whileTap={!isLoading ? { scale: 0.98 } : {}}
      className={`
        w-full text-left rounded-xl border overflow-hidden
        bg-surface shadow-card hover:shadow-elevated
        transition-all duration-300 ease-out
        focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2
        disabled:opacity-70 disabled:cursor-not-allowed
        ${isActive ? 'ring-2 ring-accent border-accent' : 'border-border hover:border-border-light'}
      `}
      style={{ minHeight: '160px' }}
    >
      {/* Thumbnail 140x100 area */}
      <div className="relative h-[100px] bg-background flex items-center justify-center overflow-hidden">
        {preset.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preset.thumbnailUrl}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => {
              const target = e.currentTarget;
              target.style.display = 'none';
              if (target.nextElementSibling) (target.nextElementSibling as HTMLElement).style.display = 'flex';
            }}
          />
        ) : null}
        <div
          className="absolute inset-0 flex items-center justify-center bg-background text-text-tertiary text-xs font-serif"
          style={{ display: preset.thumbnailUrl ? 'none' : 'flex' }}
        >
          {preset.pdbId}
        </div>
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface/80 backdrop-blur-sm">
            <Loader2 className="w-6 h-6 text-accent animate-spin" />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-3">
        <div className="font-serif font-medium text-text-primary text-sm leading-tight line-clamp-2 mb-1">
          {preset.name}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-background text-xs font-mono text-text-secondary">
            {preset.pdbId}
          </span>
          <span className="text-xs text-text-tertiary truncate flex-1 ml-1">{preset.organism}</span>
        </div>
        <div className="mt-2 flex justify-end">
          <span
            className={`
              inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
              transition-colors duration-200
              ${isLoading ? 'bg-background text-text-tertiary' : 'bg-accent/15 text-text-primary hover:bg-accent/25'}
            `}
          >
            {isLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            Load
          </span>
        </div>
      </div>
    </motion.button>
  );
}
