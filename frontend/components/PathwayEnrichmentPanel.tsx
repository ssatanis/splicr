'use client';

import { useEffect, useState } from 'react';
import { X, Loader2, TrendingUp, AlertCircle, ExternalLink, Copy, Check } from 'lucide-react';

interface PathwayEnrichmentPanelProps {
  genes: string[];
  onClose: () => void;
}

interface EnrichmentResult {
  term: string;
  pValue: number;
  fdr: number;
  geneCount: number;
  category: string;
  genes?: string[];
  database: string;
}

export default function PathwayEnrichmentPanel({ genes, onClose }: PathwayEnrichmentPanelProps) {
  const [results, setResults] = useState<EnrichmentResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'KEGG' | 'Reactome' | 'GO BP'>('all');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);

    fetch(`/api/enrichment?genes=${genes.join(',')}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setResults(data.results || []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [genes]);

  const filteredResults = filter === 'all' 
    ? results 
    : results.filter(r => r.category === filter);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const categories = ['all', ...new Set(results.map(r => r.category))];

  return (
    <>
      {/* Minimal Backdrop - allows interaction with background */}
      <div
        className="fixed inset-0 bg-black/10 z-[9998]"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed right-0 top-0 bottom-0 w-full max-w-2xl bg-surface/95 backdrop-blur-md shadow-2xl border-l-2 border-accent/20 z-[9999] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-background/90 backdrop-blur-sm">
          <div>
            <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-accent" />
              Pathway Enrichment Analysis
            </h3>
            <p className="text-xs text-text-tertiary mt-1">
              Analyzing {genes.length} genes for enriched pathways and functions
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded hover:bg-surface transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-text-tertiary" />
          </button>
        </div>

        {/* Filters */}
        <div className="px-6 py-3 border-b border-border bg-background/80 backdrop-blur-sm">
          <div className="flex items-center gap-2 overflow-x-auto">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setFilter(cat as typeof filter)}
                className={`px-3 py-1.5 text-sm rounded-lg whitespace-nowrap transition-colors ${
                  filter === cat
                    ? 'bg-accent text-white'
                    : 'bg-background border border-border text-text-primary hover:bg-accent/10'
                }`}
              >
                {cat === 'all' ? 'All' : cat}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <Loader2 className="w-10 h-10 animate-spin text-accent mx-auto mb-2" />
                <p className="text-sm text-text-tertiary">Analyzing pathways...</p>
              </div>
            </div>
          )}

          {error && (
            <div className="p-4 rounded-lg bg-error/10 text-error text-sm flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!loading && !error && filteredResults.length === 0 && (
            <div className="text-center py-12">
              <p className="text-text-tertiary">No significant enrichment found</p>
              <p className="text-xs text-text-quaternary mt-2">
                Try selecting more genes or adjusting the significance threshold
              </p>
            </div>
          )}

          {!loading && !error && filteredResults.length > 0 && (
            <div className="space-y-3">
              {filteredResults.map((result, i) => (
                <div
                  key={i}
                  className="p-4 rounded-lg border border-border bg-background hover:border-accent/50 transition-all"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-medium text-text-primary mb-1">
                        {result.term}
                      </h4>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          result.category === 'KEGG' ? 'bg-blue-500/10 text-blue-500' :
                          result.category === 'Reactome' ? 'bg-purple-500/10 text-purple-500' :
                          result.category === 'GO BP' ? 'bg-green-500/10 text-green-500' :
                          'bg-accent/10 text-accent'
                        }`}>
                          {result.category}
                        </span>
                        <span className="text-xs text-text-tertiary">
                          {result.geneCount} genes
                        </span>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm font-semibold text-text-primary">
                        {result.fdr < 0.001 ? '<0.001' : result.fdr.toFixed(3)}
                      </div>
                      <div className="text-xs text-text-tertiary">FDR</div>
                    </div>
                  </div>

                  {/* FDR Visualization */}
                  <div className="w-full h-1.5 bg-border rounded-full overflow-hidden mb-2">
                    <div
                      className={`h-full ${
                        result.fdr < 0.001 ? 'bg-success' :
                        result.fdr < 0.01 ? 'bg-accent' :
                        'bg-warning'
                      }`}
                      style={{ width: `${Math.max(5, 100 - (result.fdr * 2000))}%` }}
                    />
                  </div>

                  {/* Genes involved */}
                  {result.genes && result.genes.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-text-tertiary">Genes involved:</span>
                        <button
                          onClick={() => copyToClipboard(result.genes!.join(', '))}
                          className="flex items-center gap-1 text-xs text-accent hover:text-accent/80"
                        >
                          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          Copy
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {result.genes.slice(0, 10).map((gene, j) => (
                          <span
                            key={j}
                            className="text-xs px-2 py-1 rounded bg-accent/10 text-accent"
                          >
                            {gene}
                          </span>
                        ))}
                        {result.genes.length > 10 && (
                          <span className="text-xs px-2 py-1 text-text-tertiary">
                            +{result.genes.length - 10} more
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* External link */}
                  <div className="mt-3 pt-3 border-t border-border">
                    <a
                      href={`https://www.gsea-msigdb.org/gsea/msigdb/search.jsp?query=${encodeURIComponent(result.term)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-accent hover:text-accent/80"
                    >
                      View in MSigDB <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {!loading && !error && filteredResults.length > 0 && (
          <div className="px-6 py-4 border-t border-border bg-background/90 backdrop-blur-sm">
            <div className="text-xs text-text-tertiary">
              <p className="mb-1">
                <strong>FDR (False Discovery Rate):</strong> Adjusted p-value accounting for multiple testing
              </p>
              <p>
                <strong>Threshold:</strong> Results with FDR &lt; 0.05 are considered significant
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
