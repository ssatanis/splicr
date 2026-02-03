"use client";

import { useState } from 'react';
import Link from 'next/link';
import type { StructureOption } from '@/lib/screenStructureTypes';
import { TrendingDown, TrendingUp, Star, Dna, ExternalLink } from 'lucide-react';

export interface HitGeneCardProps {
  gene: string;
  rank: number;
  logFoldChange: number;
  fdr: number;
  pValue: number;
  structures: StructureOption[];
  loading?: boolean;
  onLoadStructure: (option: StructureOption) => void;
  onViewIn3D?: (gene: string) => void;
  fdrHighConfidence?: number;
}

export default function HitGeneCard({
  gene,
  rank,
  logFoldChange,
  fdr,
  pValue,
  structures,
  loading = false,
  onLoadStructure,
  onViewIn3D,
  fdrHighConfidence = 0.001,
}: HitGeneCardProps) {
  const [expanded, setExpanded] = useState(false);
  const depleted = logFoldChange < -0.5;
  const enriched = logFoldChange > 0.5;
  const highConf = fdr < fdrHighConfidence;

  return (
    <div className="bg-surface rounded-lg border border-border shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-lg" aria-hidden>🧬</span>
            <span className="font-serif font-semibold text-text-primary truncate">{gene}</span>
            {highConf && (
              <span className="shrink-0 text-amber-500" title="High confidence (FDR &lt; 0.001)">
                <Star className="w-4 h-4" fill="currentColor" />
              </span>
            )}
          </div>
          <span className="text-xs font-mono text-text-tertiary shrink-0">Rank #{rank}</span>
        </div>
        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          {depleted && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
              <TrendingDown className="w-3.5 h-3.5" />
              Depleted
            </span>
          )}
          {enriched && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
              <TrendingUp className="w-3.5 h-3.5" />
              Enriched
            </span>
          )}
          <span className="text-xs font-mono text-text-secondary">
            LFC: {logFoldChange.toFixed(2)} | FDR: {fdr < 0.0001 ? fdr.toExponential(1) : fdr.toFixed(4)}
          </span>
        </div>
      </div>

      <div className="px-4 py-3">
        <p className="text-xs font-medium text-text-tertiary mb-2">Structures</p>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-text-tertiary">
            <span className="inline-block w-4 h-4 border-2 border-text-tertiary border-t-transparent rounded-full animate-spin" />
            Searching PDB & AlphaFold…
          </div>
        ) : structures.length === 0 ? (
          <p className="text-sm text-text-tertiary">No structures found</p>
        ) : (
          <ul className="space-y-1.5">
            {(expanded ? structures : structures.slice(0, 3)).map((opt, i) => (
              <li key={i} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">
                  {opt.type === 'pdb' && (
                    <>
                      <span className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 text-xs font-mono mr-1.5">
                        PDB
                      </span>
                      {opt.identifier}
                      {opt.resolution != null && (
                        <span className="text-text-tertiary ml-1">({opt.resolution} \u00C5)</span>
                      )}
                    </>
                  )}
                  {opt.type === 'alphafold' && (
                    <>
                      <span className="px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-800 dark:text-violet-200 text-xs font-mono mr-1.5">
                        AlphaFold
                      </span>
                      {opt.identifier}
                    </>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => onLoadStructure(opt)}
                  className="shrink-0 text-xs font-medium text-accent hover:underline"
                >
                  Load
                </button>
              </li>
            ))}
            {!expanded && structures.length > 3 && (
              <li>
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  className="text-xs text-accent hover:underline"
                >
                  +{structures.length - 3} more
                </button>
              </li>
            )}
          </ul>
        )}

        <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-border/60">
          {onViewIn3D && (
            <button
              type="button"
              onClick={() => onViewIn3D(gene)}
              className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
            >
              <Dna className="w-3.5 h-3.5" />
              View in 3D
            </button>
          )}
          <a
            href={`https://www.ncbi.nlm.nih.gov/gene/?term=${encodeURIComponent(gene)}[sym]`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
          >
            Gene card
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <a
            href={`https://www.genecards.org/cgi-bin/carddisp.pl?gene=${encodeURIComponent(gene)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
          >
            GeneCards
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}
