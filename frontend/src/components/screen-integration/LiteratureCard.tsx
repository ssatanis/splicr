"use client";

import { useState } from 'react';
import type { LiteratureCard as LiteratureCardType } from '@/lib/screenStructureTypes';
import { FileText, ExternalLink } from 'lucide-react';

export interface LiteratureCardProps {
  article: LiteratureCardType;
  onCite?: (article: LiteratureCardType) => void;
}

export default function LiteratureCard({ article, onCite }: LiteratureCardProps) {
  const [showAbstract, setShowAbstract] = useState(false);
  const { pmid, title, authors, journal, year, citationCount, doi, abstract } = article;

  return (
    <div className="bg-surface rounded-lg border border-border shadow-sm overflow-hidden">
      <div className="px-4 py-3">
        <div className="flex items-start gap-2">
          <FileText className="w-5 h-5 text-text-tertiary shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="font-serif text-sm text-text-primary leading-snug">{title}</p>
            {(authors || journal || year) && (
              <p className="text-xs text-text-tertiary mt-1">
                {[authors, journal, year].filter(Boolean).join(' · ')}
              </p>
            )}
            {citationCount != null && (
              <p className="text-xs text-text-secondary mt-0.5">Cited {citationCount.toLocaleString()}×</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-3">
          {pmid && (
            <a
              href={`https://pubmed.ncbi.nlm.nih.gov/${pmid}/`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
            >
              PubMed
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          {doi && (
            <a
              href={`https://doi.org/${doi}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
            >
              DOI
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          <button
            type="button"
            onClick={() => setShowAbstract((b) => !b)}
            className="text-xs font-medium text-accent hover:underline"
          >
            {showAbstract ? 'Hide abstract' : 'Read abstract'}
          </button>
          {onCite && (
            <button
              type="button"
              onClick={() => onCite(article)}
              className="text-xs font-medium text-accent hover:underline"
            >
              Cite
            </button>
          )}
        </div>

        {showAbstract && abstract && (
          <p className="text-xs text-text-secondary mt-3 leading-relaxed border-t border-border/60 pt-3">
            {abstract}
          </p>
        )}
      </div>
    </div>
  );
}
