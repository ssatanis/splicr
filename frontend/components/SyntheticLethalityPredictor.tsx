'use client';

import { useState, useCallback } from 'react';
import { Loader2, ExternalLink } from 'lucide-react';
import {
  fetchStringInteractions,
  pubmedSyntheticLethalityLink,
  stringPairLink,
  type PredictedInteraction,
} from '@/lib/syntheticLethalityPredictor';

interface SyntheticLethalityPredictorProps {
  /** Gene symbols (e.g. depleted hits) */
  genes: string[];
  /** Minimum STRING score (0–1) */
  minScore?: number;
}

export default function SyntheticLethalityPredictor({
  genes,
  minScore = 0.4,
}: SyntheticLethalityPredictorProps) {
  const [pairs, setPairs] = useState<PredictedInteraction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runPrediction = useCallback(async () => {
    if (genes.length < 2) {
      setError('Provide at least 2 genes');
      return;
    }
    setLoading(true);
    setError(null);
    setPairs([]);
    try {
      const data = await fetchStringInteractions(genes, minScore);
      setPairs(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Prediction failed');
    } finally {
      setLoading(false);
    }
  }, [genes, minScore]);

  return (
    <div className="w-full bg-surface rounded-xl p-6 border border-border shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <h3 className="text-2xl font-serif text-text-primary">Genetic interaction predictor</h3>
        <button
          onClick={runPrediction}
          disabled={loading || genes.length < 2}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-background hover:opacity-90 disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Predict interactions
        </button>
      </div>

      <p className="text-sm text-text-tertiary mb-4">
        Pairs of genes from your hit list that interact in STRING may represent synthetic lethal or combination therapy targets.
        Backed by STRING PPI; check PubMed for &quot;synthetic lethality&quot; literature.
      </p>

      {error && (
        <div className="mb-4 p-4 rounded-lg bg-error/10 text-error text-sm">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-10 h-10 animate-spin text-accent" />
        </div>
      )}

      {!loading && pairs.length > 0 && (
        <div className="overflow-x-auto border border-border rounded-lg max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-background sticky top-0">
              <tr>
                <th className="px-4 py-2 text-left font-serif text-text-secondary">Gene A</th>
                <th className="px-4 py-2 text-left font-serif text-text-secondary">Gene B</th>
                <th className="px-4 py-2 text-left font-serif text-text-secondary">Score</th>
                <th className="px-4 py-2 text-left font-serif text-text-secondary">Links</th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((row, idx) => (
                <tr key={idx} className="border-t border-border hover:bg-background/50">
                  <td className="px-4 py-2 font-medium text-text-primary">{row.geneA}</td>
                  <td className="px-4 py-2 font-medium text-text-primary">{row.geneB}</td>
                  <td className="px-4 py-2 text-text-secondary">
                    {(row.combinedScore * 1000).toFixed(0)}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-2">
                      <a
                        href={pubmedSyntheticLethalityLink(row.geneA, row.geneB)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:underline inline-flex items-center gap-0.5"
                      >
                        PubMed <ExternalLink className="w-3 h-3" />
                      </a>
                      <a
                        href={stringPairLink(row.geneA, row.geneB)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:underline inline-flex items-center gap-0.5"
                      >
                        STRING <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && pairs.length === 0 && genes.length >= 2 && (
        <div className="py-12 text-center text-text-tertiary">
          Click &quot;Predict interactions&quot; to find gene pairs from your list that interact in STRING.
        </div>
      )}

      {genes.length < 2 && (
        <div className="py-12 text-center text-text-tertiary">
          Provide at least 2 genes (e.g. depleted hits) to predict genetic interactions.
        </div>
      )}
    </div>
  );
}
